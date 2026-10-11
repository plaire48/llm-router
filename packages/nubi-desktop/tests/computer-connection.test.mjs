import {featureTest} from './beta-feature.mjs';
const test=featureTest('computerUse');
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WinappComputer,requestComputerConnection} from '../runtime/computer-use.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000,maxInputTokens:24000,maxOutputTokens:4096}]});
async function setup(t){
  const value=await fixture(t),{service}=value,task=await service.createTask({request:'메모장 내용을 확인해 주세요.'});
  const identity={hwnd:100,processId:42,processName:'Fixture',windowTitle:'App',windowDpi:96,scale:1,coordinateSpace:'physical-screen-pixels'};
  const calls=[];service.computerAdapter=new WinappComputer({platform:'win32',runner:async args=>{calls.push(args);if(args[1]==='status')return {...identity};throw Error('Unexpected native call');}});
  let modelCalls=0;service.providers={status,dispose(){},async complete(){modelCalls++;return {content:'현재 앱을 연결했으며 실제 내용은 아직 확인하지 않았습니다.',calls:[]};}};
  return {...value,task,identity,calls,modelCalls:()=>modelCalls};
}
function pending(service,task){return requestComputerConnection(service,task,{reason:'요청한 앱의 내용을 확인합니다.',appHint:'메모장'}).request;}

test('connection request pauses the real Pi run without any native access or reviewer call',async t=>{
  const {service,task,calls}=await setup(t);let modelCalls=0;
  service.providers={status,dispose(){},async complete(messages,tools){modelCalls++;assert.ok(tools.some(tool=>tool.function.name==='request_computer_connection'));return call('request_computer_connection',{reason:'메모장 내용을 확인합니다.',appHint:'메모장'});}};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const saved=service.task(task.id);assert.equal(modelCalls,1);assert.equal(calls.length,0);assert.equal(saved.state,'waiting_input');assert.equal(saved.question,null);assert.equal(saved.computerConnectionRequest.state,'pending');assert.equal(saved.trace.find(e=>e.tool==='request_computer_connection').status,'waiting');
  assert.equal(saved.resultReview,undefined);assert.equal(saved.error,null);
  await assert.rejects(()=>service.startAgent({taskId:task.id}),/computer_connection_pending/);
});

test('missing app observation asks for connection immediately instead of failing three times',async t=>{
  const {service,task,calls}=await setup(t);let turns=0;
  service.providers={status,dispose(){},async complete(){turns++;return call('observe_computer',{includeImage:false});}};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(turns,1);assert.equal(calls.length,0);assert.equal(service.task(task.id).state,'waiting_input');assert.equal(service.task(task.id).computerConnectionRequest.state,'pending');assert.equal(service.task(task.id).question,null);
});

test('explicit bind and continuation preserve task scope and do not grant native input',async t=>{
  const {service,task,identity,calls,modelCalls}=await setup(t),request=pending(service,task);
  const foreign=await service.createTask({request:'another task'});
  await assert.rejects(()=>service.computer({method:'bind',taskId:foreign.id,requestId:request.id,window:100}),/computer_connection_changed/);
  assert.equal(calls.length,0);
  await assert.rejects(()=>service.computer({method:'continue_connection',taskId:task.id,requestId:request.id}),/computer_binding_required/);
  await assert.rejects(()=>service.computer({method:'bind',taskId:task.id,requestId:request.id,window:100,expectedIdentity:{...identity,processId:777}}),/computer_target_changed/);
  assert.equal(service.computerBinding,null);
  await service.computer({method:'bind',taskId:task.id,requestId:request.id,window:100,expectedIdentity:identity});
  assert.equal(service.task(task.id).computerConnectionRequest.state,'connected');assert.equal(modelCalls(),0);assert.ok(calls.every(args=>args[1]==='status'));
  await assert.rejects(()=>service.startAgent({taskId:task.id}),/computer_connection_pending/);
  await service.computer({method:'continue_connection',taskId:task.id,requestId:request.id});await service.agent.promise;
  assert.equal(modelCalls(),1);assert.equal(service.task(task.id).computerConnectionRequest.state,'resolved');assert.equal(service.task(task.id).state,'review');assert.ok(calls.every(args=>args[1]==='status'));
  await assert.rejects(()=>service.computer({method:'continue_connection',taskId:task.id,requestId:request.id}),/computer_connection_changed/);
});

test('connection cancellation clears only its binding and cannot automatically resume',async t=>{
  const {service,task,calls,modelCalls}=await setup(t),request=pending(service,task);
  await service.computer({method:'bind',taskId:task.id,requestId:request.id,window:100});
  await service.computer({method:'cancel_connection',taskId:task.id,requestId:request.id});
  assert.equal(service.computerBinding,null);assert.equal(service.task(task.id).computerConnectionRequest.state,'cancelled');assert.equal(service.task(task.id).state,'cancelled');assert.equal(modelCalls(),0);assert.equal(calls.length,1);
  await assert.rejects(()=>service.computer({method:'continue_connection',taskId:task.id,requestId:request.id}),/computer_cancelled/);
  await service.drainRecovery();assert.equal(modelCalls(),0);
});

test('question and connection requests cannot overlap and stop cancels pending connection',async t=>{
  const {service,task}=await setup(t);task.question={id:'question',text:'Which app?'};task.state='waiting_input';service.store.set('task:'+task.id,task);
  assert.throws(()=>pending(service,task),/question_pending/);assert.equal(service.task(task.id).computerConnectionRequest,undefined);
  task.question=null;service.store.set('task:'+task.id,task);pending(service,task);
  await service.stopAgent({taskId:task.id});assert.equal(service.task(task.id).computerConnectionRequest.state,'cancelled');
});

test('host restart keeps the request but requires a fresh explicit connection',async t=>{
  const {service,task,root}=await setup(t),request=pending(service,task);
  await service.computer({method:'bind',taskId:task.id,requestId:request.id,window:100});
  service.store.close();await service.open(root);
  const saved=service.task(task.id);assert.equal(saved.state,'waiting_input');assert.equal(saved.computerConnectionRequest.state,'pending');assert.equal(saved.computerConnectionRequest.id,request.id);assert.equal(saved.computerConnectionRequest.bindingId,undefined);assert.equal(service.computerBinding,null);
  await assert.rejects(()=>service.startAgent({taskId:task.id}),/computer_connection_pending/);
});

test('unavailable hosts create no impossible connection prompt',async t=>{
  const {service,task}=await setup(t);service.computerAdapter=new WinappComputer({platform:'darwin'});
  const result=requestComputerConnection(service,task,{reason:'앱을 확인합니다.'});assert.equal(result.availability.available,false);assert.equal(result.requiresUserInput,undefined);assert.equal(service.task(task.id).computerConnectionRequest,undefined);
});


test('connection continuation rechecks window identity and retains retryable request',async t=>{
  const {service,task,identity,modelCalls}=await setup(t),request=pending(service,task);
  await service.computer({method:'bind',taskId:task.id,requestId:request.id,window:100});
  identity.processId=999;
  await assert.rejects(()=>service.computer({method:'continue_connection',taskId:task.id,requestId:request.id}),/computer_target_changed/);
  assert.equal(service.task(task.id).computerConnectionRequest.state,'connected');assert.equal(modelCalls(),0);
  identity.processId=42;service.providers.status=()=>({connected:false});
  await assert.rejects(()=>service.computer({method:'continue_connection',taskId:task.id,requestId:request.id}),/provider_missing/);
  assert.equal(service.task(task.id).computerConnectionRequest.state,'connected');assert.equal(modelCalls(),0);
});

test('queued recovery waits for connection and cannot restart a cancelled request',async t=>{
  const {service,task,modelCalls}=await setup(t),request=pending(service,task);
  const process={id:'fixture-process',taskId:task.id,state:'failed',recoveryState:'queued'};
  service.store.set('process:'+process.id,process);service.recoveryQueue.add(process.id);
  await service.drainRecovery();assert.equal(modelCalls(),0);assert.equal(service.recoveryQueue.has(process.id),true);assert.equal(service.store.get('process:'+process.id).recoveryState,'queued');
  await service.computer({method:'cancel_connection',taskId:task.id,requestId:request.id});await service.drainRecovery();
  assert.equal(modelCalls(),0);assert.equal(service.recoveryQueue.has(process.id),false);assert.equal(service.store.get('process:'+process.id).recoveryState,'cancelled');
});

test('connection request stops in-flight analysis workers through the shared HITL boundary', {timeout:10000},async t=>{
  const {service,task,calls}=await setup(t);let round=0,childStarted=false,childAborted=false;
  service.providers={status,dispose(){},async complete(messages,tools,signal){
    if(messages[0].content.includes('isolated research analyst')){
      childStarted=true;return new Promise((resolve,reject)=>{const abort=()=>{childAborted=true;reject(Error('cancelled'));};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
    }
    if(round++===0)return call('delegate_analysis',{tasks:[{role:'research',task:'Read app requirements',done_when:'Return scoped evidence',evidence_ids:[]}]});
    return call('request_computer_connection',{reason:'실제 결과를 볼 앱을 연결해 주세요.'});
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.ok(childStarted&&childAborted);assert.equal(calls.length,0);assert.equal(service.task(task.id).state,'waiting_input');assert.equal(service.task(task.id).computerConnectionRequest.state,'pending');
});

test('connection free-text draft is scoped and answers continue the same task without app access',async t=>{
  const {service,task,calls}=await setup(t),request=pending(service,task);
  assert.deepEqual(await service.computer({method:'save_connection_draft',taskId:task.id,requestId:request.id,draft:'앱 대신 소스부터 확인해 주세요.'}),{saved:true});
  assert.equal(service.task(task.id).computerConnectionRequest.draft,'앱 대신 소스부터 확인해 주세요.');
  await assert.rejects(()=>service.computer({method:'save_connection_draft',taskId:task.id,requestId:'wrong',draft:'text'}),/computer_connection_changed/);
  await assert.rejects(()=>service.computer({method:'answer_connection',taskId:task.id,requestId:request.id,text:'  '}),/answer_invalid/);
  await assert.rejects(()=>service.computer({method:'answer_connection',taskId:task.id,requestId:request.id,text:'x'.repeat(16001)}),/answer_invalid/);
  await service.computer({method:'answer_connection',taskId:task.id,requestId:request.id,text:'앱 대신 소스부터 확인해 주세요.'});await service.agent.promise;
  const saved=service.task(task.id);assert.equal(saved.id,task.id);assert.equal(saved.request,task.request);assert.equal(saved.computerConnectionRequest.state,'answered');assert.equal(saved.computerConnectionRequest.answer.text,'앱 대신 소스부터 확인해 주세요.');assert.equal(saved.computerConnectionRequest.draft,undefined);assert(saved.messages.some(message=>message.role==='user'&&message.content==='앱 대신 소스부터 확인해 주세요.'));assert.equal(calls.length,0);assert.equal(service.computerBinding,null);
});

test('connection free-text survives unavailable model and later inference failure',async t=>{
  const {service,task,calls}=await setup(t),request=pending(service,task),text='확인할 프로그램은 메모장입니다.';
  service.providers.status=()=>({connected:false});
  await assert.rejects(()=>service.computer({method:'answer_connection',taskId:task.id,requestId:request.id,text}),/provider_missing/);
  assert.equal(service.task(task.id).computerConnectionRequest.draft,text);assert.equal(service.task(task.id).computerConnectionRequest.state,'pending');
  service.recoveryOptions={model:{retries:0}};service.providers={status,dispose(){},async complete(){throw Object.assign(Error('Unauthorized'),{status:401});}};
  await service.computer({method:'answer_connection',taskId:task.id,requestId:request.id,text});await service.agent.promise;
  const saved=service.task(task.id);assert.equal(saved.state,'paused');assert.equal(saved.computerConnectionRequest.state,'answered');assert(saved.messages.some(message=>message.role==='user'&&message.content===text));assert.equal(calls.length,0);
});

test('cancellation during window identity lookup cannot restore a connection request',async t=>{
  const {service,task,identity}=await setup(t),request=pending(service,task);let seen,release;
  const observed=new Promise(resolve=>{seen=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  service.computerAdapter=new WinappComputer({platform:'win32',runner:async args=>{assert.equal(args[1],'status');seen();await gate;return identity;}});
  const binding=service.computer({method:'bind',taskId:task.id,requestId:request.id,window:100});await observed;
  await service.stopAgent({taskId:task.id});release();await assert.rejects(()=>binding,/computer_cancelled/);
  assert.equal(service.task(task.id).state,'cancelled');assert.equal(service.task(task.id).computerConnectionRequest.state,'cancelled');assert.equal(service.computerBinding,null);
});
