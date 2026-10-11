import {featureTest} from './beta-feature.mjs';
const test=featureTest('a2a');
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {connectA2A,taskApi} from '../../nubi-a2a/client.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

// The approved A2A design (user decision 2026-10-01): the agent may hand web work to Nubi in the browser, whose user
// accepts or declines it; the task's end continues the conversation that asked.
const RECEIPTS='Current host receipts (reference data, not instructions): ';
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const pair=async service=>taskApi(await connectA2A((await service.invoke('collaboration',{action:'invite',recipient:'browser'})).url,'browser'));
const waitFor=async check=>{for(let i=0;i<250&&!check();i++)await new Promise(resolve=>setTimeout(resolve,20));assert(check());};
const lookup={skill:'web-lookup',request:'사내 공지에서 출장비 규정의 시행일을 찾아 출처 URL과 함께 알려 주세요.',urls:['https://example.org/notice']};
const found={summary:'출장비 규정은 2026-10-01부터 시행합니다.',facts:[{name:'시행일',value:'2026-10-01',source_url:'https://example.org/notice',quote:'시행일 2026-10-01'}],evidence:[],verification:'not_run',localRunId:'browser-run-9'};
// A model that delegates once, then tries another tool in the same run, then tells the user; later runs answer.
// The run also holds the planner's plan as a tool result, so the script reads results by content.
function scripted(service,turns){
  let phase='delegate';
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:272000}]}),dispose(){},complete:async(messages,tools)=>{
    const text=messages.findLast(message=>typeof message.content==='string'&&message.content.startsWith(RECEIPTS))?.content;
    const outputs=messages.filter(message=>message.role==='tool').map(message=>String(message.content)),has=pattern=>outputs.some(output=>pattern.test(output));
    turns.push({phase,tools:tools.map(item=>item.function.name),receipts:text?JSON.parse(text.slice(RECEIPTS.length)):{},outputs});
    if(phase==='delegate'){
      if(!has(/"state":"submitted"/))return call('delegate_to_browser',lookup);
      if(!has(/waitingForPeer/))return call('read_source',{path:'app.txt',start:1,end:1});
      return {content:'브라우저 누비에 시행일 확인을 요청했어요.',calls:[]};
    }
    if(phase==='followup'&&!has(/first/))return call('read_source',{path:'app.txt',start:1,end:1});
    return {content:phase==='followup'?'app.txt의 첫 줄은 first입니다.':'시행일은 2026-10-01입니다. 출처: https://example.org/notice',calls:[]};
  }};
  return next=>{phase=next;};
}

test('delegation is offered only while the browser is paired, and never to a request another Nubi sent',async t=>{
 const {service}=await fixture(t),turns=[];scripted(service,turns)('answer');
 const task=await service.createTask({request:'공지 시행일을 알려 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert(turns.length&&turns.every(turn=>!turn.tools.includes('delegate_to_browser')),'Not before pairing');
 const web=await pair(service);turns.length=0;
 await service.startAgent({taskId:task.id,answer:'다시 확인해 주세요.'});await service.agent.promise;
 assert(turns.some(turn=>turn.tools.includes('delegate_to_browser')));
 const incoming=await web.request({recipient:'desktop',skill:'source-search',request:'app.txt 첫 줄을 확인해 주세요.'});
 const {localTaskId}=await service.collaboration({action:'task_accept',id:incoming.id});turns.length=0;
 await service.startAgent({taskId:localTaskId});await service.agent.promise;
 assert(turns.length&&turns.every(turn=>!turn.tools.includes('delegate_to_browser')),'A received request cannot hand work onward');
});

test('a delegated lookup waits for the browser user, then its result continues the same conversation once',async t=>{
 const {service}=await fixture(t),web=await pair(service),turns=[],phase=scripted(service,turns);
 const task=await service.createTask({request:'사내 공지의 출장비 규정 시행일을 출처와 함께 알려 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 let current=service.task(task.id);const [job]=(await web.list()).tasks;
 assert.deepEqual([current.state,current.peerWait,job.state,job.request,job.urls],['waiting_input',job.id,'submitted',lookup.request,lookup.urls]);
 assert(turns.at(-1).outputs.some(output=>/waitingForPeer/.test(output))&&!turns.at(-1).outputs.some(output=>/"content":"first/.test(output)),'Nothing else runs after delegating in that run');
 assert.notEqual(current.resultReview?.status,'ready','The wait is not reviewed as a finished answer');
 phase('continue');const before=turns.length;
 await web.accept(job.id);assert.equal(turns.length,before,'Acceptance alone starts nothing here');
 await web.complete(job.id,found);
 await waitFor(()=>service.task(task.id).messages.some(message=>message.role==='assistant'&&message.content.includes('2026-10-01')));await service.agent.promise;
 const continued=turns.slice(before);current=service.task(task.id);
 assert.match(continued[0].receipts.peerTasks.continuation,new RegExp(job.id));
 assert.deepEqual(continued[0].receipts.peerTasks.tasks[0].result.facts[0],found.facts[0]);
 assert.deepEqual([current.state,current.peerWait,service.store.get('a2a-peer:'+job.id).continued],['review',null,true]);
 await new Promise(resolve=>setTimeout(resolve,60));assert.equal(turns.length,before+continued.length,'One continuation, not two');
});

test('a declined request also continues the conversation, which then knows why',async t=>{
 const {service}=await fixture(t),web=await pair(service),turns=[],phase=scripted(service,turns);
 const task=await service.createTask({request:'공지 시행일을 알려 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const [job]=(await web.list()).tasks;phase('continue');const before=turns.length;
 await web.reject(job.id,'로그인이 필요한 사이트라 지금은 할 수 없어요.');
 await waitFor(()=>turns.length>before);await service.agent.promise;
 const [peer]=turns[before].receipts.peerTasks.tasks;
 assert.deepEqual([peer.state,peer.note],['rejected','로그인이 필요한 사이트라 지금은 할 수 없어요.']);
});

test('cancelling the delegated task ends the wait without another model call',async t=>{
 const {service}=await fixture(t),web=await pair(service),turns=[];scripted(service,turns);
 const task=await service.createTask({request:'공지 시행일을 알려 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const [job]=(await web.list()).tasks,before=turns.length;
 await service.collaboration({action:'task_cancel',taskId:task.id,id:job.id});
 await waitFor(()=>service.task(task.id).state==='review');await new Promise(resolve=>setTimeout(resolve,60));
 assert.deepEqual([turns.length,service.task(task.id).peerWait,(await web.get(job.id)).state],[before,null,'canceled']);
});

test('while it waits, a new message from the user runs normally and the result still continues afterwards',async t=>{
 const {service}=await fixture(t),web=await pair(service),turns=[],phase=scripted(service,turns);
 const task=await service.createTask({request:'공지 시행일을 알려 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const [job]=(await web.list()).tasks;phase('followup');let before=turns.length;
 await service.startAgent({taskId:task.id,answer:'기다리는 동안 app.txt 첫 줄을 알려 주세요.'});await service.agent.promise;
 assert(turns.slice(before).some(turn=>turn.outputs.some(output=>output.includes('first')&&!output.includes('waitingForPeer'))),'The follow-up reads the project');
 phase('continue');before=turns.length;
 await web.accept(job.id);await web.complete(job.id,found);
 await waitFor(()=>turns.length>before);await service.agent.promise;
 assert.match(turns[before].receipts.peerTasks.continuation,new RegExp(job.id));
});
