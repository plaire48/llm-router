import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {inputBinding,canDrainInputs} from '../runtime/agent-input.mjs';
import {runReviewedAgent} from '../runtime/result-review.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const reply=content=>({content,calls:[]});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
async function waitFor(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Condition did not become true');}
async function running(t,complete){const f=await fixture(t);f.service.providers={status,dispose(){},complete};const task=await f.service.createTask({request:'기존 파일을 보존하고 요청을 확인해 주세요.',criteria:['파일 보존']});await f.service.startAgent({taskId:task.id});return {...f,task,runId:f.service.agent.runId};}
const submit=(service,task,id,text,mode='queue')=>service.invoke('agentInput',{taskId:task.id,action:'enqueue',runId:service.agent.runId,id,text,mode});

test('persisted queue deduplicates and drains FIFO in the same task after checked answers',async t=>{
 const entered=gate(),release=gate(),seen=[];let round=0;
 const {service,task}=await running(t,async messages=>{seen.push(JSON.stringify(messages));if(++round===1){entered.release();await release.promise;}return reply('확인했습니다.');});await entered.promise;
 await submit(service,task,'one','두 번째 메시지');await submit(service,task,'one','두 번째 메시지');await submit(service,task,'two','세 번째 메시지');
 assert.equal(service.task(task.id).inbox.length,2);assert.equal(round,1);assert.equal(service.task(task.id).messages.length,0);
 release.release();await waitFor(()=>service.task(task.id).messages.filter(m=>m.role==='assistant').length===3&&!service.agent.running);
 const saved=service.task(task.id);assert.deepEqual(saved.messages.filter(m=>m.inputId).map(m=>m.content),['두 번째 메시지','세 번째 메시지']);assert.equal(saved.inbox.length,0);assert.equal(saved.criteria[0].state,'unknown');assert(seen.some(s=>s.includes('두 번째 메시지'))&&seen.some(s=>s.includes('세 번째 메시지')));
 await submit(service,task,'one','두 번째 메시지');assert.equal(service.task(task.id).messages.filter(m=>m.inputId==='one').length,1);
});
test('steering aborts inference, discards partial output and enters history once',async t=>{
 const entered=gate();let actors=0,aborts=0;const history=[];
 const {service,task}=await running(t,async(messages,tools,signal)=>{actors++;history.push(JSON.stringify(messages));if(actors===1){entered.release();await new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(Error('cancelled'));},{once:true}));}return reply('추가 요청을 반영했습니다.');});await entered.promise;
 await submit(service,task,'steer-1','수정하지 말고 설명만 해 주세요.','steer');await service.agent.promise;
 assert.equal(aborts,1);assert.equal(service.task(task.id).state,'review');assert.equal(service.task(task.id).messages.filter(m=>m.inputId==='steer-1').length,1);assert.equal(service.task(task.id).messages.at(-1).content,'추가 요청을 반영했습니다.');assert(history.slice(1).some(s=>s.includes('수정하지 말고 설명만')));
});
test('steering awaits an in-flight tool and preserves its result without replay',async t=>{
 const entered=gate(),release=gate();let rounds=0,reads=0,seen='';
 const {service,task}=await running(t,async messages=>{if(++rounds===1)return call('read_source',{path:'app.txt'});seen=JSON.stringify(messages);return reply('읽은 결과를 설명합니다.');});
 const realRead=service.read.bind(service);service.read=async args=>{reads++;entered.release();await release.promise;return realRead(args);};await entered.promise;
 await submit(service,task,'steer-tool','이 결과를 설명만 해 주세요.','steer');assert.equal(service.agent.controller.signal.aborted,false);release.release();await service.agent.promise;
 assert.equal(reads,1);assert.match(seen,/first/);assert.match(seen,/이 결과를 설명만/);
});
test('cancel preserves queue without auto-resume and explicit start consumes once',async t=>{
 const entered=gate();let rounds=0;
 const {service,task}=await running(t,async(messages,tools,signal)=>{if(++rounds===1){entered.release();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}return reply('명시적으로 이어갑니다.');});await entered.promise;
 await submit(service,task,'after-stop','이어서 확인해 주세요.');await service.stopAgent({taskId:task.id});await new Promise(r=>setTimeout(r,20));assert.equal(rounds,1);assert.equal(service.task(task.id).state,'cancelled');assert.equal(service.task(task.id).inbox.length,1);
 await service.invoke('agentInput',{taskId:task.id,action:'start',id:'after-stop'});await service.agent.promise;assert.equal(service.task(task.id).inbox.length,0);assert.equal(service.task(task.id).messages.filter(m=>m.inputId==='after-stop').length,1);
});
test('snapshot reorder, edit/delete and stale-run guards preserve intended messages',async t=>{
 const entered=gate(),release=gate();const {service,task,runId}=await running(t,async()=>{entered.release();await release.promise;return reply('완료');});await entered.promise;
 for(const id of ['a','b','c'])await submit(service,task,id,id);
 await service.invoke('agentInput',{taskId:task.id,action:'reorder',id:'c',overId:'a',order:['a','b','c']});assert.deepEqual(service.task(task.id).inbox.map(m=>m.id),['c','a','b']);
 await assert.rejects(service.invoke('agentInput',{taskId:task.id,action:'reorder',id:'a',overId:'b',order:['a','b','c']}),/agent_input_changed/);
 assert.equal((await service.invoke('agentInput',{taskId:task.id,action:'remove',id:'a'})).text,'a');
 await assert.rejects(service.invoke('agentInput',{taskId:task.id,runId:runId+'stale',action:'enqueue',id:'bad',text:'wrong',mode:'queue'}),/agent_input_closed/);
 for(const item of service.task(task.id).inbox)await service.invoke('agentInput',{taskId:task.id,action:'remove',id:item.id});release.release();await service.agent.promise;
});
test('questions, approvals, peer waits and changed connections block automatic admission',async t=>{
 const {service}=await fixture(t);service.providers={status,dispose(){}};
 const task=await service.createTask({request:'승인이 필요한 작업'}),ready={...task,state:'review',resultReview:{status:'ready'}};
 assert.equal(canDrainInputs(service,ready),true);
 for(const patch of [{question:{text:'어느 파일?'}},{peerWait:'browser'},{computerConnectionRequest:{state:'pending'}},{state:'cancelled'},{resultReview:{status:'revise'}}])assert.equal(canDrainInputs(service,{...ready,...patch}),false);
 service.store.set('proposal:p',{id:'p',taskId:task.id,state:'proposed'});assert.equal(canDrainInputs(service,ready),false);
 const old=inputBinding(service,task.id);service.inputEpoch=1;assert.notEqual(inputBinding(service,task.id).credentialReceivedAt,old.credentialReceivedAt);
 service.store.set('task:'+task.id,{...ready,inbox:[{...old,id:'old',mode:'queue',text:'이전 연결 메시지',runId:'old-run'}]});
 await assert.rejects(service.invoke('agentInput',{taskId:task.id,action:'start',id:'old'}),/agent_input_changed/);
});
test('input during final review discards stale verdict and reviews corrected answer',async()=>{
 const entered=gate(),release=gate(),controller=new AbortController();let pending=false,runs=0,reviews=0;const published=[];
 const work=runReviewedAgent({messages:[],signal:controller.signal,run:async()=>{pending=false;return reply('answer-'+(++runs));},waiting:()=>false,hasInput:()=>pending,continuation:()=>[],snapshot:()=>({evidence:[],receipts:{}}),review:async()=>{if(++reviews===1){entered.release();await release.promise;}return {status:'ready',checks:[],nextStep:''};},onReview:v=>published.push(v)});
 await entered.promise;pending=true;release.release();assert.equal((await work).content,'answer-2');assert.equal(reviews,2);assert.equal(published.length,1);
});
