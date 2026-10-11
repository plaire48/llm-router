import {featureTest} from './beta-feature.mjs';
const test=featureTest('computerUse');
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures.mjs';
import {createAppHost} from '../eval/app-host.mjs';
import {WinappComputer,observeComputer,verifyComputerOutcome,groundComputerTarget} from '../runtime/computer-use.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);
const definition=JSON.parse(await readFile(new URL('../eval/computer/apps/expense-form.json',import.meta.url),'utf8'));
async function connected(t,change=runner=>runner){const {service}=await fixture(t),task=await service.createTask({request:'앱의 결과를 확인해 주세요.'}),host=createAppHost(definition);service.computerAdapter=new WinappComputer({platform:'win32',runner:change(host.runner)});await service.computer({method:'bind',taskId:task.id,window:host.window});return {service,task,host};}
const check=(o,checks,extra={})=>({observationId:o.observationId,checks,...extra}),value={selector:'txt-amount',property:'value',expected:'30000'};
test('delayed outcome is read without repeating input and needs two matching snapshots',async t=>{
 let reads=0;const {service,task,host}=await connected(t,runner=>async args=>{const result=await runner(args);if(args[1]==='get-value'&&args[2]==='txt-amount')result.text=++reads<3?'pending':'30000';return result;});
 const o=await observeComputer(service,task.id,{includeImage:false}),result=await verifyComputerOutcome(service,task.id,check(o,[value,{selector:'txt-amount',property:'enabled',expected:true}]));
 assert.equal(result.verification,'predicates_matched');assert.equal(result.attempts,4);assert.equal(result.stable,true);assert.equal(result.actionIssued,false);assert.equal(result.checks.length,2);assert.match(result.reflection.instruction,/does not prove saving/);assert.deepEqual(host.state().inputs,[]);assert.equal(service.store.get('computer-check:'+result.id).scope,'literal_control_predicates');
});
test('unsupported state, literal mismatch and a single snapshot remain distinct',async t=>{
 const {service,task,host}=await connected(t),o=await observeComputer(service,task.id,{includeImage:false});
 const missing=await verifyComputerOutcome(service,task.id,check(o,[{selector:'txt-amount',property:'toggle',expected:'On'}],{timeoutMs:0}));assert.equal(missing.verification,'predicates_unavailable');assert.equal(missing.checks[0].actual,null);
 const wrong=await verifyComputerOutcome(service,task.id,check(o,[{...value,expected:'30,000'}],{timeoutMs:0}));assert.equal(wrong.verification,'predicates_mismatch');assert.equal(wrong.reflection.unmet.length,1);
 const once=await verifyComputerOutcome(service,task.id,check(o,[value],{timeoutMs:0}));assert.equal(once.verification,'predicates_unstable');assert.equal(once.stable,false);assert.deepEqual(host.state().inputs,[]);
});
test('invalid predicates and passwords are refused before value access',async t=>{
 let passwordReads=0;const {service,task}=await connected(t,runner=>async args=>{if(args[1]==='get-value'&&args[2]==='txt-approval-password')passwordReads++;return runner(args);});const o=await observeComputer(service,task.id,{includeImage:false});
 for(const checks of [[value,value],[{...value,property:'enabled',expected:'True'}],[{...value,property:'selected',expected:'yes'}]])await assert.rejects(()=>verifyComputerOutcome(service,task.id,check(o,checks)),/computer_invalid/);
 await assert.rejects(()=>verifyComputerOutcome(service,task.id,check(o,[{selector:'txt-approval-password',property:'value',expected:'secret'}])),/computer_password/);assert.equal(passwordReads,0);
});
test('moved controls and stale or disconnected observations cannot produce success receipts',async t=>{
 let moved=false;const {service,task}=await connected(t,runner=>async args=>{const result=await runner(args);if(moved&&args[1]==='get-property')result.element.x+=1;return result;});const o=await observeComputer(service,task.id,{includeImage:false});moved=true;
 await assert.rejects(()=>verifyComputerOutcome(service,task.id,check(o,[value])),/computer_target_changed/);moved=false;service.computerObservation.at-=120001;
 await assert.rejects(()=>verifyComputerOutcome(service,task.id,check(o,[value])),/computer_observation_stale/);service.computerBinding=null;await assert.rejects(()=>verifyComputerOutcome(service,task.id,check(o,[value])),/computer_binding_required/);assert.equal(service.store.list('computer-check:').length,0);
});
test('cancelled verification leaves no success receipt or native input',async t=>{
 const controller=new AbortController();let cancel=false;const {service,task,host}=await connected(t,runner=>async args=>{const result=await runner(args);if(cancel&&args[1]==='get-value')controller.abort();return result;});const o=await observeComputer(service,task.id,{includeImage:false});cancel=true;
 await assert.rejects(()=>verifyComputerOutcome(service,task.id,check(o,[value]),controller.signal),/computer_cancelled/);assert.equal(service.store.list('computer-check:').length,0);assert.deepEqual(host.state().inputs,[]);
});
test('local grounding needs an actual capture and rechecks its connection after inference',async t=>{
 const {service,task,host}=await connected(t);let calls=0;service.localPerception={dispose(){},async ground({image,target}){calls++;assert.equal(image.mimeType,'image/png');assert.equal(target,'금액');return {available:true,advisory:true,actionIssued:false,point:{x:.5,y:.5,space:'image_fraction'}};}};
 let o=await observeComputer(service,task.id,{includeImage:false});await assert.rejects(()=>groundComputerTarget(service,task.id,{observationId:o.observationId,target:'금액',provider:'omniparser'}),/computer_perception_image_required/);
 o=await observeComputer(service,task.id,{selector:'txt-amount'});const result=await groundComputerTarget(service,task.id,{observationId:o.observationId,target:'금액',provider:'omniparser'});assert.equal(result.advisory,true);assert.equal(calls,1);assert.deepEqual(host.state().inputs,[]);
 service.localPerception.ground=async()=>{service.computerBinding=null;return {available:true};};await assert.rejects(()=>groundComputerTarget(service,task.id,{observationId:o.observationId,target:'금액',provider:'omniparser'}),/computer_binding_required/);
});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
for(const name of ['verify_computer_outcome','ground_computer_target'])test('Pi refuses '+name+' from another run before native/model access',async t=>{
 const {service,task,host}=await connected(t),old=await observeComputer(service,task.id,{includeImage:false});let rounds=0,reason;service.localPerception={dispose(){},ground(){throw Error('must not call');}};
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages,tools){assert(tools.some(tool=>tool.function.name===name));if(++rounds===1)return call(name,name==='verify_computer_outcome'?check(old,[value]):{observationId:old.observationId,target:'금액'});const last=messages.findLast(message=>message.role==='tool');if(last)reason=JSON.parse(last.content).error;return {content:'새로 화면을 확인해야 합니다.',calls:[]};}};
 await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(reason,'computer_observation_stale');assert.equal(service.store.list('computer-check:').length,0);assert.deepEqual(host.state().inputs,[]);
});
test('Pi carries fresh outcome predicates and reflection into its next model call',async t=>{
 const {service,task,host}=await connected(t);let turns=0,verified=false;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;if(++turns===1)return call('observe_computer',{includeImage:false});if(turns===2)return call('verify_computer_outcome',check(result,[value]));if(result?.verification==='predicates_matched'){verified=true;assert.equal(result.reflection.scope,'literal_control_predicates');}return {content:'현재 금액은 30000입니다. 저장 여부는 별도 확인이 필요합니다.',calls:[]};}};
 await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(verified,true);assert.deepEqual(host.state().inputs,[]);
});
test('Pi grounds a capture through the same logged-in provider without local model or input',async t=>{
 const {service,task,host}=await connected(t);let turns=0,groundings=0,seen=false;
 service.providers={status:()=>({connected:true,vision:true,model:'logged-in-fixture',models:[{id:'logged-in-fixture',contextLength:32000,supportsImages:true}]}),dispose(){},async complete(messages,tools){
   if(messages[0]?.content?.startsWith('You are a read-only visual target grounder')){groundings++;assert.equal(tools.length,0);assert(messages[1].content.some(part=>part.type==='image_url'));return {content:'{"label":"금액","point":null}',calls:[]};}
   const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
   if(++turns===1)return call('observe_computer',{selector:'txt-amount'});
   if(turns===2)return call('ground_computer_target',{observationId:result.observationId,target:'금액'});
   if(result?.provider==='connected-model'){seen=true;assert.equal(result.advisory,true);assert.equal(result.label,'금액');}
   return {content:'화면의 금액 입력란을 찾았습니다. 입력 동작은 하지 않았습니다.',calls:[]};
 }};await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(groundings,1);assert.equal(seen,true);assert.equal(service.localPerception,undefined);assert.deepEqual(host.state().inputs,[]);
});
test('text actor delegates isolated capture analysis to catalog Qwen and keeps the main model',async t=>{
 const {service,task,host}=await connected(t);let turns=0,groundings=0,seen=false;
 const text={id:'GLM-5.2-NVFP4',contextLength:524288},qwen={id:'QWEN3.8-27B-FP8-256K',contextLength:262144};
 service.providers={status:()=>({provider:'aipro',connected:true,vision:false,model:text.id,models:[text,qwen]}),dispose(){},async complete(messages,tools,signal,onText,onPhase,onActivity,options){
   if(messages[0]?.content?.startsWith('You are a read-only visual target grounder')){groundings++;assert.equal(options.visionModel,qwen.id);assert.equal(tools.length,0);assert.equal(messages.length,2);return {content:'{"label":"금액","point":null}',calls:[],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}};}
   assert.equal(options?.visionModel,undefined);assert(!messages.some(message=>message.content?.some?.(part=>part.type==='image_url')));
   const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
   if(++turns===1)return call('observe_computer',{selector:'txt-amount'});
   if(turns===2){assert.equal(result.image,undefined);assert.equal(result.imageStatus,'not_sent_model_image_support_unconfirmed');return call('ground_computer_target',{observationId:result.observationId,target:'금액'});}
   if(result?.provider==='connected-model')seen=true;
   return {content:'Qwen이 찾은 금액 입력란을 UIA로 확인하겠습니다. 아직 입력하지 않았습니다.',calls:[]};
 }};await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(groundings,1);assert.equal(seen,true);assert.equal(service.providers.status().model,text.id);assert.deepEqual(host.state().inputs,[]);
 const events=service.store.db.prepare("SELECT value FROM events WHERE kind='metric_model'").all().map(row=>JSON.parse(row.value));assert(events.some(row=>row.purpose==='analysis'&&row.model===qwen.id&&row.usage?.prompt_tokens===100&&row.usage?.completion_tokens===10));
});
