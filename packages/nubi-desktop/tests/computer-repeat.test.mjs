// Found by the app control measurement of 2026-09-29 with gpt-5.6-sol (case
// A10). The model pressed a list item with invoke. The app took the input and
// changed nothing. The model proposed the same press again, the user approved,
// and so on: four approvals for an action that the host had seen fail to
// change the window. The model never tried select, and its one attempt to
// select on the list itself was refused without a word about how to select.
import {featureTest} from './beta-feature.mjs';
const test=featureTest('computerUse');
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures.mjs';
import {createAppHost} from '../eval/app-host.mjs';
import {WinappComputer,observeComputer,proposeComputerAction} from '../runtime/computer-use.mjs';
import {reviewedAction,readComputerResult} from '../runtime/computer-harness.mjs';
import {computerInstruction} from '../runtime/tool-feedback.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const definition=JSON.parse(await readFile(new URL('../eval/computer/apps/expense-form.json',import.meta.url),'utf8'));
async function connected(t){
  const {service}=await fixture(t),task=await service.createTask({request:'부서를 개발팀으로 바꾼다.'}),host=createAppHost(definition);
  service.computerAdapter=new WinappComputer({platform:'win32',runner:host.runner});
  await service.computer({method:'bind',taskId:task.id,window:host.window});
  return {service,task,host};
}
const none={wikiEvidence:new Map()};
async function propose(service,task,args){
  const seen=await observeComputer(service,task.id,{includeImage:false});
  return proposeComputerAction(service,task.id,{observationId:seen.observationId,reason:'요청한 동작',...args},none);
}
async function carryOut(service,task,args){
  const action=await propose(service,task,args);
  await service.computer({method:'decide',taskId:task.id,id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  return service.state().computer.actions.find(item=>item.id===action.id);
}
const press={selector:'item-dept-dev',action:'invoke'};

test('an action that changed nothing is not proposed again without a warning',async t=>{
  const {service,task,host}=await connected(t);
  const first=await carryOut(service,task,press);
  assert.equal(first.state,'observed');assert.equal(first.verification,'not_verified');
  assert.equal(host.state().controls['cmb-department'].value,'영업팀','the press did not select');
  const refused=await propose(service,task,press).then(()=>null,error=>error);
  assert.equal(refused?.message,'computer_no_effect_repeat');
  assert.deepEqual(refused.details,{actionId:first.id,action:'invoke',selector:'item-dept-dev',times:1});
  assert.equal(service.state().computer.actions.filter(item=>item.state==='proposed').length,0,'nothing waits for the user');
  assert.equal(host.state().inputs.length,1);
  const text=computerInstruction('computer_no_effect_repeat');
  assert.match(text,/No input was sent/);assert.match(text,/select/);assert.match(text,/controlState/);assert.match(text,/accepted/);assert.ok(text.length<520,String(text.length));
});

test('the warning is given once: the same proposal after it is accepted and marked for the user',async t=>{
  const {service,task}=await connected(t);
  const first=await carryOut(service,task,press);
  await propose(service,task,press).then(()=>assert.fail('not warned'),error=>assert.equal(error.message,'computer_no_effect_repeat'));
  const again=await propose(service,task,press);
  assert.equal(again.state,'proposed');assert.deepEqual(again.repeats,{actionId:first.id,times:1,observed:'no_change'});
  await service.computer({method:'decide',taskId:task.id,id:again.id,fingerprint:again.fingerprint,decision:'approve'});
  // A second press that changed nothing either: the model is warned once more.
  const third=await propose(service,task,press).then(()=>null,error=>error);
  assert.equal(third?.message,'computer_no_effect_repeat');assert.equal(third.details.times,2);
});

test('another action on the control, and an action that changed the window, are not held back',async t=>{
  const {service,task,host}=await connected(t);
  await carryOut(service,task,press);
  const select=await carryOut(service,task,{selector:'item-dept-dev',action:'select'});
  assert.equal(select.verification,'state_matched');assert.equal(host.state().controls['cmb-department'].value,'개발팀');
  const saved=await carryOut(service,task,{selector:'btn-save',action:'invoke'});
  assert.equal(saved.state,'observed');
  const twice=await propose(service,task,{selector:'btn-save',action:'invoke'});
  assert.equal(twice.state,'proposed','the first press changed the status line, so a second one is the user\'s to decide');
  assert.equal(twice.repeats,undefined);
});

test('a repetition that the user asked for after the action is not held back',async t=>{
  const {service,task}=await connected(t);
  await carryOut(service,task,press);
  const record=service.task(task.id);record.messages=[...(record.messages||[]),{id:'m1',role:'user',content:'한 번 더 눌러 줘.'}];service.store.set('task:'+task.id,record);
  const again=await propose(service,task,press);
  assert.equal(again.state,'proposed');
});

test('the receipt of an action without an observed change says so',async t=>{
  const {service,task}=await connected(t);
  const first=await carryOut(service,task,press);
  assert.equal(reviewedAction(service,task.id,first.id).observed,'no_change');
  assert.equal(readComputerResult(service,task.id,{actionId:first.id}).observed,'no_change');
  const saved=await carryOut(service,task,{selector:'btn-save',action:'invoke'});
  assert.equal(reviewedAction(service,task.id,saved.id).observed,'changed');
  const amount=await carryOut(service,task,{selector:'txt-amount',action:'set_value',value:'45000'});
  assert.equal(reviewedAction(service,task.id,amount.id).observed,undefined,'a value that was read back needs no such mark');
});

test('a refused select with a value tells how a list is chosen from',()=>{
  const text=computerInstruction('computer_invalid');
  assert.match(text,/list item/);assert.match(text,/set_value needs value/);assert.ok(text.length<420,String(text.length));
});

// Found by the second measurement with gpt-5.6-sol (case A10): the model found
// the list item by search and proposed from that observation. The receipt then
// compared the one control of the search with the tree after the action and
// listed 21 controls as added. The model was told of changes that never
// happened, and the warning above did not fire.
test('an action proposed from a search is compared with the window, not with the search',async t=>{
  const {service,task,host}=await connected(t);
  const found=await observeComputer(service,task.id,{query:'개발팀',includeImage:false});
  assert.deepEqual(found.elements.map(element=>element.selector),['item-dept-dev']);
  const action=await proposeComputerAction(service,task.id,{observationId:found.observationId,reason:'개발팀 선택',...press},none);
  await service.computer({method:'decide',taskId:task.id,id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  const reviewed=reviewedAction(service,task.id,action.id);
  assert.deepEqual([reviewed.changes.changed,reviewed.changes.added,reviewed.changes.removed],[[],[],[]]);
  assert.equal(reviewed.observed,'no_change');
  const again=await observeComputer(service,task.id,{query:'개발팀',includeImage:false});
  const refused=await proposeComputerAction(service,task.id,{observationId:again.observationId,reason:'개발팀 선택',...press},none).then(()=>null,error=>error);
  assert.equal(refused?.message,'computer_no_effect_repeat');
  assert.equal(host.state().inputs.length,1);
});

test('a press proposed from a search that changed the window shows that change only',async t=>{
  const {service,task}=await connected(t);
  const found=await observeComputer(service,task.id,{query:'임시 저장',includeImage:false});
  const action=await proposeComputerAction(service,task.id,{observationId:found.observationId,reason:'임시 저장',selector:'btn-save',action:'invoke'},none);
  await service.computer({method:'decide',taskId:task.id,id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  const reviewed=reviewedAction(service,task.id,action.id);
  assert.deepEqual(reviewed.changes.changed,[{selector:'lbl-status',before:{name:'상태: 작성 중'},after:{name:'상태: 임시 저장됨'}}]);
  assert.deepEqual([reviewed.changes.added,reviewed.changes.removed],[[],[]]);assert.equal(reviewed.observed,'changed');
});

// The model chose the press because the search result said only that the item
// can be invoked. With the state of the control beside it, the item shows that
// it is a choice that is not selected.
test('a search with few matches tells the state of each match',async t=>{
  const {service,task,host}=await connected(t);
  const found=await observeComputer(service,task.id,{query:'개발팀',includeImage:false});
  assert.deepEqual(found.elements.map(element=>[element.selector,element.controlState]),[['item-dept-dev',{selected:'False',toggle:null,expansion:null}]]);
  assert.match(found.instruction,/controlState/);
  const boxes=await observeComputer(service,task.id,{query:'chk-',includeImage:false});
  assert.deepEqual(boxes.elements.map(element=>[element.selector,element.controlState.toggle]),[['chk-receipt','On'],['chk-urgent','Off']]);
  // The stored observation is unchanged, so a proposal from it is still checked against the control itself.
  const action=await proposeComputerAction(service,task.id,{observationId:boxes.observationId,reason:'긴급 처리 켜기',selector:'chk-urgent',action:'toggle_on'},none);
  assert.equal(action.state,'proposed');
  const many=await observeComputer(service,task.id,{query:'grp-',includeImage:false});
  assert.ok(many.elements.length>5);assert.ok(many.elements.every(element=>element.controlState===undefined),'more than five matches are listed without their state');
  const tree=await observeComputer(service,task.id,{includeImage:false});
  assert.ok(tree.elements.every(element=>element.controlState===undefined),'the tree is listed without state: a selector reads one control');
  assert.deepEqual(host.state().inputs,[]);
});
