// Found by the first live model baseline (2026-09-29): every operation carried
// the same 200-character explanation of its progress argument, about 9,000
// characters in each model request. Desktop states the rule once instead.
import {test} from 'node:test';
import {featureTest} from './beta-feature.mjs';
const computerTest=featureTest('computerUse');
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {progressTools,PROGRESS_RULE} from '../../../extensions/aipro-chat/agent-runtime.js';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

const tool=name=>({type:'function',function:{name,description:'d',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}});

test('the progress argument keeps its explanation by default and drops it only when asked',()=>{
  const standard=progressTools([tool('read_source'),tool('update_plan')],true);
  assert.match(standard[0].function.parameters.properties.progress.description,/Short public action label/);
  assert.equal(standard[1].function.parameters.properties.progress,undefined,'plan, question and approval tools have no progress argument');
  const compact=progressTools([tool('read_source'),tool('update_plan')],true,{compact:true});
  assert.deepEqual(compact[0].function.parameters.properties.progress,{type:'string',maxLength:100});
  assert.deepEqual(compact[0].function.parameters.required,['path'],'progress stays optional');
  assert.equal(compact[1].function.parameters.properties.progress,undefined);
  assert.deepEqual(progressTools([tool('read_source')],false,{compact:true}),[tool('read_source')],'no progress argument outside stepwise runs');
  assert.match(PROGRESS_RULE,/progress/);assert.match(PROGRESS_RULE,/omit secrets/);
});

test('Desktop sends the progress rule once and no per-tool copy',async t=>{
  const {service}=await fixture(t);let request;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){request??={messages,tools};return {content:'확인했습니다.',calls:[]};}};
  const task=await service.createTask({request:'app.txt를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  const withProgress=request.tools.filter(item=>item.function.parameters.properties.progress);
  // 32 tools carried it until the two VOC tools left the agent (user decision 2026-09-30).
  assert.ok(withProgress.length>=30,String(withProgress.length));
  for(const item of withProgress)assert.deepEqual(item.function.parameters.properties.progress,{type:'string',maxLength:100},item.function.name);
  const system=request.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
  assert.equal(system.split(PROGRESS_RULE).length-1,1,'the rule appears exactly once');
  assert.ok(JSON.stringify(request.tools).length<32000,'tool definitions: '+JSON.stringify(request.tools).length);
});

// Found in baseline case W4: on a host that cannot control apps the agent
// still held eight app tools, asked to connect an app for a Wiki question,
// and answered that it could not check.
import {WinappComputer} from '../runtime/computer-use.mjs';
import {COMPUTER_GUIDANCE} from '../runtime/computer-harness.mjs';
const APP_TOOLS=['computer_checkpoint','read_computer_result','request_computer_connection','list_computer_apps','propose_computer_launch','verify_computer_value','observe_computer','propose_computer_action','propose_computer_batch'];
async function firstRequest(t,prepare=()=>{}){
  const {service}=await fixture(t);let request;prepare(service);
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){request??={messages,tools};return {content:'확인했습니다.',calls:[]};}};
  const task=await service.createTask({request:'app.txt를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  return {names:request.tools.map(item=>item.function.name),system:request.messages.filter(message=>message.role==='system').map(message=>message.content),size:JSON.stringify(request.tools).length};
}

test('a host that cannot control apps offers no app tools and no app guidance',async t=>{
  const {names,system,size}=await firstRequest(t,service=>{service.computerAdapter=new WinappComputer({platform:'darwin'});});
  assert.deepEqual(names.filter(name=>APP_TOOLS.includes(name)),[]);
  assert.ok(!system.includes(COMPUTER_GUIDANCE));
  for(const name of ['wiki_query','read_source','source_search','analyze_documents','record_change_plan','propose_patch','ask_user','update_plan'])assert.ok(names.includes(name),name);
  // Measured 26,748 characters on 2026-09-29, down from 39,500.
  // 28,000 before the user decision of 2026-09-30 on large windows; clearer descriptions may use the room.
  assert.ok(size<40000,'tool definitions: '+size);
});

computerTest('a host that can control apps keeps every app tool and the guidance',async t=>{
  const {names,system}=await firstRequest(t,service=>{service.computerAdapter=new WinappComputer({platform:'win32',runner:async()=>({})});});
  assert.deepEqual(names.filter(name=>APP_TOOLS.includes(name)).sort(),[...APP_TOOLS].sort());
  assert.ok(system.includes(COMPUTER_GUIDANCE));
});
