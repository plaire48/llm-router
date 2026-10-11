// Found by the app control baseline of 2026-09-29 (gpt-5.6-luna): a request
// for three inputs cost 51 to 61 model calls and three approvals, because
// every input ran its own observation, proposal, approval and result analysis.
// A batch is one approval for 2 to 5 inputs of one window. The host runs the
// steps in order, checks every target before its input, reads the value or
// state back and stops at the first step that cannot be carried out as it
// was approved.
import {featureTest} from './beta-feature.mjs';
const test=featureTest('computerUse');
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures.mjs';
import {createAppHost} from '../eval/app-host.mjs';
import {WinappComputer,observeComputer,proposeComputerAction,proposeComputerBatch,COMPUTER_BATCH_SCHEMA} from '../runtime/computer-use.mjs';
import {COMPUTER_GUIDANCE,readComputerResult,reviewedAction,computerCheckpoint} from '../runtime/computer-harness.mjs';
import {computerInstruction} from '../runtime/tool-feedback.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const definition=JSON.parse(await readFile(new URL('../eval/computer/apps/expense-form.json',import.meta.url),'utf8'));
async function connected(t,change=runner=>runner,app=definition){
  const {service}=await fixture(t),task=await service.createTask({request:'경비 신청 양식을 채운다.'}),host=createAppHost(app);
  service.computerAdapter=new WinappComputer({platform:'win32',runner:change(host.runner)});
  await service.computer({method:'bind',taskId:task.id,window:host.window});
  return {service,task,host};
}
const FILL=[{selector:'txt-memo',action:'set_value',value:'출장 택시비'},{selector:'chk-urgent',action:'toggle_on'},{selector:'btn-save',action:'invoke'}];
async function proposed(service,task,steps=FILL,extra={}){
  const seen=await observeComputer(service,task.id,{includeImage:false});
  return proposeComputerBatch(service,task.id,{observationId:seen.observationId,reason:'요청한 입력 세 가지',steps,...extra},{wikiEvidence:new Map()});
}
const decide=(service,task,action,decision='approve')=>service.computer({method:'decide',taskId:task.id,id:action.id,fingerprint:action.fingerprint,decision});
const stored=(service,id)=>service.state().computer.actions.find(action=>action.id===id);

test('a batch is proposed without any input and holds every step as it was observed',async t=>{
  const {service,task,host}=await connected(t),batch=await proposed(service,task);
  assert.equal(batch.action,'batch');assert.equal(batch.state,'proposed');assert.equal(batch.inputMode,'uia');
  assert.deepEqual(batch.steps.map(step=>[step.index,step.selector,step.action,step.value]),[[1,'txt-memo','set_value','출장 택시비'],[2,'chk-urgent','toggle_on',undefined],[3,'btn-save','invoke',undefined]]);
  assert.deepEqual(batch.steps.map(step=>step.target.element.name),['메모','긴급 처리','임시 저장']);
  assert.ok(batch.expiresAt-Date.now()<=120000&&batch.expiresAt>Date.now());
  assert.deepEqual(host.state().inputs,[],'a proposal sends nothing');
  assert.equal(stored(service,batch.id).fingerprint,batch.fingerprint);
  const images=await service.computer({method:'artifact',taskId:task.id,id:batch.id});
  assert.equal(images.before.scope,'window_region','the user is shown the window, not one control');
});

test('a batch that breaks a rule is refused with the step and the reason',async t=>{
  const {service,task,host}=await connected(t);
  const refused=async(steps,extra)=>proposed(service,task,steps,extra).then(()=>null,error=>error);
  const problems=async steps=>{const error=await refused(steps);assert.equal(error?.message,'computer_batch_invalid',JSON.stringify(steps));return error.details.problems;};
  assert.deepEqual(await problems([FILL[0]]),[{problem:'steps_between_2_and_5'}]);
  assert.deepEqual(await problems([...FILL,{selector:'txt-amount',action:'set_value',value:'1'},{selector:'txt-date',action:'set_value',value:'2026-09-22'},{selector:'txt-applicant',action:'set_value',value:'이영희'}].slice(0,6)),[{problem:'steps_between_2_and_5'}]);
  assert.deepEqual(await problems([FILL[2],FILL[0]]),[{step:1,problem:'invoke_is_the_last_step'}]);
  assert.deepEqual(await problems([FILL[0],{selector:'btn-save',action:'invoke'},{selector:'btn-submit',action:'invoke'}]),[{step:2,problem:'invoke_is_the_last_step'}]);
  assert.deepEqual(await problems([FILL[0],{selector:'txt-memo',action:'set_value',value:'다른 값'}]),[{step:2,problem:'control_used_twice'}]);
  assert.deepEqual(await problems([FILL[0],{selector:'btn-save',action:'pointer_click'}]),[{step:2,problem:'action_not_allowed'}]);
  assert.deepEqual(await problems([FILL[0],{selector:'btn-save',action:'click'}]),[{step:2,problem:'action_not_allowed'}]);
  assert.deepEqual(await problems([FILL[0],{selector:'txt-amount',action:'set_value'}]),[{step:2,problem:'set_value_needs_value'}]);
  assert.deepEqual(await problems([FILL[0],{selector:'chk-urgent',action:'toggle_on',value:'On'}]),[{step:2,problem:'value_only_with_set_value'}]);
  assert.deepEqual(await problems([FILL[0],{selector:'txt-amount',action:'set_value',value:'-5'}]),[{step:2,problem:'value_invalid'}]);
  const secret=await refused([FILL[0],{selector:'txt-approval-password',action:'set_value',value:'1234'}]);
  assert.equal(secret.message,'computer_input_unavailable');assert.deepEqual(secret.details,{step:2,selector:'txt-approval-password'});
  const fixed=await refused([FILL[0],{selector:'txt-document-number',action:'set_value',value:'EXP-1'}]);
  assert.equal(fixed.message,'computer_input_unavailable');assert.equal(fixed.details.step,2);
  const absent=await refused([FILL[0],{selector:'txt-bank-account',action:'set_value',value:'1234'}]);
  assert.equal(absent.message,'computer_target_unavailable','a control that the observation does not hold');assert.equal(absent.details.step,2);
  const unsupported=await refused([FILL[0],{selector:'txt-amount',action:'toggle_on'}]);
  assert.equal(unsupported.message,'computer_target_unavailable');assert.equal(unsupported.details.step,2);
  assert.equal(unsupported.pointerFallback,undefined,'a refused batch does not count toward mouse control');
  const evidence=await refused(FILL,{evidenceIds:['ev_1']});
  assert.equal(evidence.message,'wiki_evidence_required');assert.deepEqual(evidence.details.unknownEvidenceIds,['ev_1']);
  assert.deepEqual(host.state().inputs,[]);assert.deepEqual(service.state().computer.actions,[],'nothing was proposed');
  assert.match(computerInstruction('computer_batch_invalid'),/details\.problems/);assert.match(computerInstruction('computer_batch_invalid'),/No input was sent/);
  assert.equal(COMPUTER_BATCH_SCHEMA.properties.steps.maxItems,5);
});

test('one proposal waits at a time, single or batch',async t=>{
  const {service,task}=await connected(t),batch=await proposed(service,task);
  const again=await proposed(service,task,[{selector:'txt-amount',action:'set_value',value:'45000'},{selector:'chk-urgent',action:'toggle_on'}]).then(()=>null,error=>error);
  assert.equal(again.message,'computer_review_required');
  const seen=await observeComputer(service,task.id,{includeImage:false});
  const single=await proposeComputerAction(service,task.id,{observationId:seen.observationId,selector:'txt-amount',action:'set_value',value:'45000',reason:'금액'},{wikiEvidence:new Map()}).then(()=>null,error=>error);
  assert.equal(single.message,'computer_review_required');
  assert.equal(stored(service,batch.id).state,'proposed');
});

test('an approved batch runs its steps in order and reads every value and state back',async t=>{
  const {service,task,host}=await connected(t),batch=await proposed(service,task);
  await decide(service,task,batch);
  assert.deepEqual(host.state().inputs,[{action:'set_value',selector:'txt-memo',value:'출장 택시비'},{action:'toggle_on',selector:'chk-urgent'},{action:'invoke',selector:'btn-save'}]);
  assert.deepEqual(host.state().events,['saved']);
  const done=stored(service,batch.id);
  assert.equal(done.state,'observed');assert.equal(done.verification,'steps_matched');assert.equal(done.execution,'command_returned');
  assert.deepEqual(done.steps.map(step=>[step.execution,step.verification]),[['command_returned','value_matched'],['command_returned','state_matched'],['command_returned','not_verified']]);
  assert.equal(done.steps[1].controlCheck.actual,'On');assert.ok(done.finishedAt);
  assert.equal(service.computerObservation,null,'the observation before the batch no longer counts');
  const images=await service.computer({method:'artifact',taskId:task.id,id:batch.id});
  assert.ok(images.after&&images.afterObservation.elements.length);
});

test('a step that already holds the requested state sends no input',async t=>{
  const {service,task,host}=await connected(t);
  const batch=await proposed(service,task,[{selector:'chk-receipt',action:'toggle_on'},{selector:'txt-amount',action:'set_value',value:'45000'}]);
  await decide(service,task,batch);
  assert.deepEqual(host.state().inputs,[{action:'set_value',selector:'txt-amount',value:'45000'}]);
  const done=stored(service,batch.id);
  assert.deepEqual(done.steps.map(step=>[step.execution,step.verification]),[['already_at_target','state_matched'],['command_returned','value_matched']]);
  assert.equal(done.state,'observed');assert.equal(done.verification,'steps_matched');
});

test('a rejected batch sends nothing',async t=>{
  const {service,task,host}=await connected(t),batch=await proposed(service,task);
  await decide(service,task,batch,'reject');
  assert.equal(stored(service,batch.id).state,'rejected');assert.deepEqual(host.state().inputs,[]);
  await decide(service,task,batch);
  assert.deepEqual(host.state().inputs,[],'a decided batch is not decided again');
});

test('an approval counts for the steps that were shown and for nothing else',async t=>{
  const {service,task,host}=await connected(t),batch=await proposed(service,task);
  const changed=structuredClone(stored(service,batch.id));changed.steps[0].value='다른 메모';
  service.store.set('computer-action:'+batch.id,changed);
  await decide(service,task,batch);
  assert.deepEqual(host.state().inputs,[],'steps that differ from the approved ones are not run');
  assert.equal(stored(service,batch.id).state,'stale');
  const wrong=await service.computer({method:'decide',taskId:task.id,id:batch.id,fingerprint:'0'.repeat(64),decision:'approve'}).then(()=>null,error=>error);
  assert.equal(wrong.message,'computer_invalid');
});

test('a target that changed before the approval stops the whole batch',async t=>{
  const {service,task,host}=await connected(t),batch=await proposed(service,task);
  // The user typed into the memo field while the proposal waited.
  await host.runner(['ui','set-value','txt-memo','사용자가 적은 메모','-w',String(host.window),'--json']);
  const before=host.state().inputs.length;
  await decide(service,task,batch);
  const done=stored(service,batch.id);
  assert.equal(done.state,'stale');assert.equal(done.error,'computer_target_changed');assert.equal(done.execution,'not_started');
  assert.deepEqual(done.steps.map(step=>step.execution),['not_started','not_started','not_started']);
  assert.equal(done.stopped.step,1);
  assert.equal(host.state().inputs.length,before,'no step ran');assert.equal(host.state().controls['txt-memo'].value,'사용자가 적은 메모');
});

test('an approval that ran out of time stops the whole batch',async t=>{
  const {service,task,host}=await connected(t),batch=await proposed(service,task);
  service.store.set('computer-action:'+batch.id,{...stored(service,batch.id),expiresAt:Date.now()-1});
  await decide(service,task,batch);
  assert.equal(stored(service,batch.id).state,'stale');assert.deepEqual(host.state().inputs,[]);
});

test('a target that changes during the batch stops it at that step and keeps what was done',async t=>{
  // The app disables the urgent box as soon as a memo is entered.
  const app=structuredClone(definition);app.rules=[...(app.rules||[]),{on:{selector:'txt-memo',action:'set_value'},set:[{selector:'chk-urgent',enabled:false}]}];
  const {service,task,host}=await connected(t,runner=>runner,app),batch=await proposed(service,task);
  await decide(service,task,batch);
  assert.deepEqual(host.state().inputs,[{action:'set_value',selector:'txt-memo',value:'출장 택시비'}],'the steps after the changed target did not run');
  assert.deepEqual(host.state().events,[],'the button was not pressed');
  const done=stored(service,batch.id);
  assert.equal(done.state,'observed');assert.equal(done.verification,'steps_partial');
  assert.deepEqual(done.steps.map(step=>[step.execution,step.verification]),[['command_returned','value_matched'],['not_started','not_verified'],['not_started','not_verified']]);
  assert.deepEqual(done.stopped,{step:2,reason:'computer_target_changed'});
});

test('a value that the app did not keep stops the batch for the user to look',async t=>{
  // The app rewrites what was entered.
  const {service,task,host}=await connected(t,runner=>async args=>{
    const result=await runner(args);
    if(args[1]==='set-value'&&args[2]==='txt-memo')await runner(['ui','set-value','txt-memo','출장','-w',args[args.indexOf('-w')+1],'--json']);
    return result;
  });
  const batch=await proposed(service,task);
  await decide(service,task,batch);
  const done=stored(service,batch.id);
  assert.equal(done.state,'attention');assert.equal(done.verification,'steps_mismatch');
  assert.deepEqual(done.steps.map(step=>[step.execution,step.verification]),[['command_returned','value_mismatch'],['not_started','not_verified'],['not_started','not_verified']]);
  assert.deepEqual(done.stopped,{step:1,reason:'value_mismatch'});
  assert.ok(!host.state().inputs.some(input=>input.selector==='btn-save'),'the button was not pressed after a mismatch');
});

test('a command whose outcome is unknown stops the batch and is not repeated',async t=>{
  let failed=0;
  const {service,task,host}=await connected(t,runner=>async args=>{
    if(args[1]==='invoke'&&args[2]==='chk-urgent'){failed++;throw Object.assign(new Error('timeout'),{code:1});}
    return runner(args);
  });
  const batch=await proposed(service,task);
  await decide(service,task,batch);
  const done=stored(service,batch.id);
  assert.equal(done.state,'attention');assert.equal(done.error,'computer_outcome_unknown');assert.equal(failed,1);
  assert.deepEqual(done.steps.map(step=>step.execution),['command_returned','unknown','not_started']);
  assert.deepEqual(done.stopped,{step:2,reason:'computer_outcome_unknown'});
  assert.deepEqual(host.state().inputs,[{action:'set_value',selector:'txt-memo',value:'출장 택시비'}]);
  const checkpoint=computerCheckpoint(service,task.id);
  assert.equal(checkpoint.unresolvedCount,1);assert.equal(checkpoint.actions[0].action,'batch');
});

test('a task that is stopped between two steps keeps what ran and runs nothing more',async t=>{
  let service,task;
  const made=await connected(t,runner=>async args=>{
    const result=await runner(args);
    // The user stops the task right after the first input.
    if(args[1]==='set-value'&&args[2]==='txt-memo'){const record=service.task(task.id);record.state='cancelled';service.store.set('task:'+task.id,record);}
    return result;
  });
  service=made.service;task=made.task;
  const batch=await proposed(service,task);
  await decide(service,task,batch);
  const done=stored(service,batch.id);
  assert.deepEqual(made.host.state().inputs,[{action:'set_value',selector:'txt-memo',value:'출장 택시비'}]);
  assert.deepEqual(done.steps.map(step=>step.execution),['command_returned','not_started','not_started']);
  assert.equal(done.state,'observed');assert.equal(done.verification,'steps_partial');assert.equal(done.stopped.step,undefined);assert.match(done.stopped.reason,/^(computer|task)_/);
});

test('the receipt of a batch tells every step, what changed and what is not verified',async t=>{
  const {service,task}=await connected(t),batch=await proposed(service,task);
  await decide(service,task,batch);
  const {receipt,changes,instruction}=readComputerResult(service,task.id,{actionId:batch.id});
  assert.equal(receipt.action,'batch');assert.equal(receipt.verification,'steps_matched');
  assert.deepEqual(receipt.steps,[
    {index:1,action:'set_value',selector:'txt-memo',name:'메모',execution:'command_returned',verification:'value_matched'},
    {index:2,action:'toggle_on',selector:'chk-urgent',name:'긴급 처리',execution:'command_returned',verification:'state_matched',state:{property:'toggle',expected:'On',actual:'On'}},
    {index:3,action:'invoke',selector:'btn-save',name:'임시 저장',execution:'command_returned',verification:'not_verified'}]);
  assert.ok(Array.isArray(changes.changed));assert.match(instruction,/every step/);
  const reviewed=reviewedAction(service,task.id,batch.id);
  assert.equal(reviewed.action,'batch');assert.equal(reviewed.steps.length,3);assert.equal(reviewed.steps[2].verification,'not_verified');
  assert.match(reviewed.instruction,/every step/i);
  assert.ok(!JSON.stringify(receipt).includes('출장 택시비'),'a receipt does not repeat what was entered');
});

test('the agent proposes a batch through its tool and stops for the user',async t=>{
  const {service,task,host}=await connected(t);let round=0;const results=[];let offered;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages,tools){
    offered??=tools;
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;if(result)results.push(result);
    switch(round++){
      case 0:return call('propose_computer_batch',{observationId:'not-observed',reason:'관찰 없이',steps:FILL});
      case 1:return call('observe_computer',{includeImage:false});
      case 2:return call('propose_computer_batch',{observationId:result.observationId,reason:'순서가 틀린 묶음',steps:[FILL[2],FILL[0]]});
      case 3:return call('propose_computer_batch',{observationId:results.find(item=>item.observationId).observationId,reason:'요청한 입력 세 가지',steps:FILL});
      default:return {content:'승인을 기다립니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const tool=offered.find(item=>item.function.name==='propose_computer_batch').function;
  assert.deepEqual(tool.parameters.properties.steps,COMPUTER_BATCH_SCHEMA.properties.steps);assert.deepEqual(tool.parameters.required,COMPUTER_BATCH_SCHEMA.required);assert.match(tool.description,/2 to 5/);assert.ok(tool.description.length<700,String(tool.description.length));
  assert.equal(results[0].error,'computer_observation_stale');
  const invalid=results.find(item=>item.error==='computer_batch_invalid');
  assert.deepEqual(invalid.details.problems,[{step:1,problem:'invoke_is_the_last_step'}]);assert.match(invalid.instruction,/details\.problems/);assert.equal(invalid.actionIssued,false);
  assert.equal(round,4,'the run ends with the proposal: the model is not asked again before the user decides');
  assert.equal(service.task(task.id).state,'review');assert.deepEqual(host.state().inputs,[]);
  assert.equal(service.state().computer.actions.filter(action=>action.state==='proposed').length,1);
  assert.match(COMPUTER_GUIDANCE,/propose_computer_batch/);
  // Measured 2026-09-30 with gpt-5.6-sol (case A14): the model stated that the
  // rules forbid automation to submit, then proposed pressing Submit for the
  // user's approval. An approval does not lift a rule that forbids the action.
  assert.match(COMPUTER_GUIDANCE,/never an exception to a project or Wiki rule/);
  assert.match(COMPUTER_GUIDANCE,/tell the user what they must do themselves/);
});
