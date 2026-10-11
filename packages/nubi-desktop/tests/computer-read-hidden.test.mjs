// Found by the app control measurement of 2026-09-29 with gpt-5.6-sol (case
// A5). The model found the field by search and asked for its value by
// selector. The host refused twice: the field lies below the depth of the
// tree, and it is off screen. Both refusals said that the selector was not
// among the observed elements. Reading a value needs neither a place in the
// tree nor a place on the screen; only input does.
import {featureTest} from './beta-feature.mjs';
const test=featureTest('computerUse');
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures.mjs';
import {createAppHost} from '../eval/app-host.mjs';
import {WinappComputer,observeComputer,proposeComputerAction,verifyComputerValue} from '../runtime/computer-use.mjs';
import {computerInstruction} from '../runtime/tool-feedback.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const definition=JSON.parse(await readFile(new URL('../eval/computer/apps/expense-form.json',import.meta.url),'utf8'));
async function connected(t,app=definition){
  const {service}=await fixture(t),task=await service.createTask({request:'입금 계좌 끝 4자리를 확인한다.'}),host=createAppHost(app);
  service.computerAdapter=new WinappComputer({platform:'win32',runner:host.runner});
  await service.computer({method:'bind',taskId:task.id,window:host.window});
  return {service,task,host};
}

test('a control below the tree and off the screen is read by its selector',async t=>{
  const {service,task,host}=await connected(t);
  const whole=await observeComputer(service,task.id,{includeImage:false});
  assert.ok(!whole.elements.some(element=>element.selector==='txt-bank-account'),'the tree does not reach the field');
  const read=await observeComputer(service,task.id,{selector:'txt-bank-account',includeImage:true});
  assert.equal(read.target.value,'4821');assert.equal(read.target.element.isOffscreen,true);
  assert.equal(read.image,undefined,'nothing to capture off the screen');assert.equal(read.imageStatus,'target_not_on_screen');
  assert.ok(read.elements.some(element=>element.selector==='txt-bank-account'),'the observation holds the control it read');
  const searched=await observeComputer(service,task.id,{selector:'txt-bank-account',query:'계좌',includeImage:false});
  assert.equal(searched.target.value,'4821');assert.equal(searched.coverage.mode,'search');
  assert.match(read.instruction,/off screen or disabled can be read but takes no input/);
  assert.deepEqual(host.state().inputs,[],'reading sends no input');
  assert.ok(!host.state().commands.some(command=>command.startsWith('screenshot txt-bank-account')));
});

test('its value is compared like any other',async t=>{
  const {service,task}=await connected(t);
  const read=await observeComputer(service,task.id,{selector:'txt-bank-account',includeImage:false});
  const receipt=await verifyComputerValue(service,task.id,{observationId:read.observationId,selector:'txt-bank-account',expected:'4821'});
  assert.equal(receipt.verification,'value_matched');
});

test('it still takes no input, and the refusal says why',async t=>{
  const {service,task,host}=await connected(t);
  const read=await observeComputer(service,task.id,{selector:'txt-bank-account',includeImage:false});
  const refused=await proposeComputerAction(service,task.id,{observationId:read.observationId,selector:'txt-bank-account',action:'set_value',value:'0000',reason:'값 변경'},{wikiEvidence:new Map()}).then(()=>null,error=>error);
  assert.equal(refused?.message,'computer_target_unavailable');assert.deepEqual(refused.details,{reason:'off_screen'});
  assert.deepEqual(host.state().inputs,[]);assert.deepEqual(service.state().computer.actions,[]);
  const text=computerInstruction('computer_target_unavailable');
  assert.match(text,/details\.reason/);assert.match(text,/off_screen/);assert.match(text,/can still be read/);assert.ok(text.length<420,String(text.length));
});

test('a password is not read there either, and a selector that names nothing is refused',async t=>{
  const app=structuredClone(definition);
  const walk=list=>{for(const control of list){if(control.selector==='txt-bank-account')control.password=true;if(control.children)walk(control.children);}};walk(app.controls);
  const {service,task}=await connected(t,app);
  const secret=await observeComputer(service,task.id,{selector:'txt-bank-account',includeImage:false});
  assert.equal(secret.target.password,'True');assert.equal(secret.target.value,undefined);assert.ok(!JSON.stringify(secret).includes('4821'));
  const absent=await observeComputer(service,task.id,{selector:'txt-no-such-control',includeImage:false}).then(()=>null,error=>error);
  assert.equal(absent?.message,'computer_target_unavailable');assert.deepEqual(absent.details,{reason:'not_found'});
});

test('the agent reads the hidden value through its tool',async t=>{
  const {service,task,host}=await connected(t);let round=0;const results=[];
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;if(result)results.push(result);
    switch(round++){
      case 0:return call('observe_computer',{query:'계좌',includeImage:false});
      case 1:return call('observe_computer',{selector:'txt-bank-account',includeImage:false});
      default:return {content:'입금 계좌 끝 4자리는 '+results.at(-1).target?.value+'입니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).messages.at(-1).content,'입금 계좌 끝 4자리는 4821입니다.');
  assert.deepEqual(host.state().inputs,[]);
});
