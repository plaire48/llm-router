import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {hostShell} from '../runtime/processes.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('task did not continue');};
const command=(script,title)=>({title,kind:'inspect',profile:hostShell(),script,reason:'요청한 출력 확인',effects:'표준 출력만 표시',verification:'출력과 종료 상태 확인',references:[]});

test('a self-contained answer does not require discovery, documents or a tool plan',async t=>{
 const {service}=await fixture(t);
 service.providers={status,dispose(){},complete:async()=>({content:'회의 일정을 확인해 주세요.',calls:[]})};
 const task=await service.createTask({request:'다음 문장을 정중하게: 회의 일정 확인해'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(service.store.list('operation:').length,0);
 assert.equal(service.task(task.id).workPlan,undefined);
 assert.equal(service.task(task.id).state,'review');
});

test('a directly executed successful command automatically returns its actual output to the agent',async t=>{
 const {service}=await fixture(t);let reviewed=false;
 service.providers={status,dispose(){},complete:async messages=>{const wire=JSON.stringify(messages);assert.match(wire,/DIRECT_CHECK/);assert.match(wire,/completed/);reviewed=true;return {content:'DIRECT_CHECK 출력을 확인했습니다.',calls:[]};}};
 const task=await service.createTask({request:'실행한 결과를 확인해 주세요.'});
 await service.run({taskId:task.id,profile:hostShell(),script:'echo DIRECT_CHECK'});
 await wait(()=>reviewed&&!service.agent.running);
 assert.equal(service.store.list('process:').length,1);
 assert.equal(service.store.list('process:')[0].recoveryState,'review');
});

test('two approved commands run sequentially with output-driven continuation and no unrelated file reads',async t=>{
 const {service}=await fixture(t);const observed=new Set();let final=false;
 service.providers={status,dispose(){},complete:async messages=>{
  const processes=service.store.list('process:');
  const results=messages.filter(message=>message.role==='tool').map(message=>{try{return JSON.parse(message.content);}catch{return {};}});
  for(const record of processes){if(results.some(result=>result.processId===record.id&&result.source==='saved_log'))observed.add(record.id);}
  const unread=processes.find(record=>record.state==='completed'&&!observed.has(record.id));
  if(unread)return call('read_process_output',{processId:unread.id});
  const actions=service.store.list('setup-action:');
  if(!actions.length)return call('propose_setup_action',command('echo FIRST_RESULT','첫 번째 확인'));
  if(processes.length===1&&observed.size===1&&actions.length===1)return call('propose_setup_action',command('echo SECOND_RESULT','두 번째 확인'));
  if(processes.length===2&&observed.size===2){final=true;return {content:'FIRST_RESULT와 SECOND_RESULT를 순서대로 확인했습니다.',calls:[]};}
  return {content:'다음 명령의 실행 승인을 기다립니다.',calls:[]};
 }};
 const task=await service.createTask({request:'첫 번째 확인을 실행하고 결과를 본 다음 두 번째 확인도 진행해 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(service.store.list('process:').length,0,'preparation is not execution');
 for(let index=0;index<2;index++){
  const action=service.store.list('setup-action:').find(row=>row.state==='proposed');assert(action);
  await service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  await wait(()=>!service.agent.running&&service.store.list('process:').length===index+1&&service.store.list('process:').every(row=>row.recoveryState==='review'));
 }
 assert(final);assert.equal(observed.size,2);assert.equal(service.store.list('process:').length,2);
 assert(!service.store.list('operation:').some(row=>['read_source','wiki_query','ask_openwiki','discover_capabilities','inspect_environment'].includes(row.tool)));
 assert.equal(service.task(task.id).state,'review');
});
