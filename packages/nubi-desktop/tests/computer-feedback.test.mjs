// Found by the app control baseline of 2026-09-29 (gpt-5.6-luna, simulated
// expense form). The model could not read what a field holds: the only tool
// that reads a value compares it with an expected text. Every refused app
// operation returned the same instruction, so the model repeated the mistake:
// a proposal with an evidence id of its own making was refused six times in
// two cases without a word about the id.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures.mjs';
import {createAppHost} from '../eval/app-host.mjs';
import {WinappComputer,observeComputer,proposeComputerAction} from '../runtime/computer-use.mjs';
import {computerInstruction} from '../runtime/tool-feedback.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);

const definition=JSON.parse(await readFile(new URL('../eval/computer/apps/expense-form.json',import.meta.url),'utf8'));
async function connected(t,change=runner=>runner){
  const {service}=await fixture(t),task=await service.createTask({request:'경비 신청 양식을 확인한다.'}),host=createAppHost(definition);
  service.computerAdapter=new WinappComputer({platform:'win32',runner:change(host.runner)});
  await service.computer({method:'bind',taskId:task.id,window:host.window});
  return {service,task,host};
}

test('an observation of one control tells what it holds',async t=>{
  const {service,task,host}=await connected(t);
  const amount=await observeComputer(service,task.id,{selector:'txt-amount',includeImage:false});
  assert.equal(amount.target.value,'30000');
  const list=await observeComputer(service,task.id,{selector:'cmb-department',includeImage:false});
  assert.equal(list.target.value,'영업팀');
  const empty=await observeComputer(service,task.id,{selector:'txt-memo',includeImage:false});
  assert.equal(empty.target.value,'','an empty field is empty, not unknown');
  assert.match(amount.instruction,/target\.value/);
  assert.deepEqual(host.state().inputs,[],'reading sends no input');
  const whole=await observeComputer(service,task.id,{includeImage:false});
  assert.equal(whole.target,undefined,'values are read for the one control that is asked for');
});

test('a password is never read and a control without a value is observed all the same',async t=>{
  const asked=[],{service,task}=await connected(t,runner=>async args=>{
    if(args[1]==='get-value'){asked.push(args[2]);if(args[2]==='btn-save')throw Object.assign(new Error('pattern not supported'),{code:2});}
    return runner(args);
  });
  const secret=await observeComputer(service,task.id,{selector:'txt-approval-password',includeImage:false});
  assert.equal(secret.target.password,'True');assert.equal(secret.target.value,undefined);assert.ok(!JSON.stringify(secret).includes('p@ss-7731'));
  assert.deepEqual(asked,[],'the value of a password field is not requested');
  const button=await observeComputer(service,task.id,{selector:'btn-save',includeImage:false});
  assert.equal(button.target.value,null,'null: the control offers no value');assert.equal(button.target.resolvedSelector,'btn-save');
});

test('a refused app operation says what to correct for its own reason',()=>{
  const codes=['computer_invalid','computer_observation_stale','computer_review_required','computer_target_unavailable','computer_target_changed','computer_busy','computer_command_failed','computer_password','computer_input_unavailable'];
  const texts=codes.map(code=>computerInstruction(code));
  assert.equal(new Set(texts).size,codes.length,'each reason has its own instruction');
  for(const text of texts){assert.ok(text.length<420,String(text.length));assert.match(text,/No input was sent/);}
  assert.match(computerInstruction('computer_invalid'),/set_value needs value/);
  assert.match(computerInstruction('computer_observation_stale'),/observe_computer again/);
  assert.match(computerInstruction('computer_review_required'),/read_computer_result/);
  assert.match(computerInstruction('computer_target_unavailable'),/query/);
  assert.match(computerInstruction('computer_unknown_reason'),/computer_checkpoint/,'an unknown reason keeps the general instruction');
});

test('a proposal with an evidence id that this run did not observe names the id and the way out',async t=>{
  const {service,task}=await connected(t);
  const seen=await observeComputer(service,task.id,{selector:'txt-amount',includeImage:false});
  const refused=await proposeComputerAction(service,task.id,{observationId:seen.observationId,selector:'txt-amount',action:'set_value',value:'45000',reason:'금액 변경',evidenceIds:['ev_4','wiki:unknown']},{wikiEvidence:new Map()}).then(()=>null,error=>error);
  assert.equal(refused.message,'wiki_evidence_required');
  assert.deepEqual(refused.details.unknownEvidenceIds,['ev_4','wiki:unknown']);assert.deepEqual(refused.details.observedEvidence,[]);
  assert.match(computerInstruction('wiki_evidence_required'),/Omit evidenceIds when no Wiki rule/);
  assert.deepEqual(service.state().computer.actions,[],'nothing was proposed');
});

test('the model receives the reason, its details and the instruction through the tool loop',async t=>{
  const {service,task}=await connected(t);let round=0;const results=[];
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;if(result)results.push(result);
    switch(round++){
      case 0:return call('observe_computer',{selector:'txt-amount',includeImage:false});
      case 1:return call('propose_computer_action',{observationId:result.observationId,selector:'txt-amount',action:'set_value',value:'45000',reason:'금액 변경',evidenceIds:['ev_4']});
      case 2:return call('propose_computer_action',{observationId:results.find(item=>item.observationId).observationId,selector:'txt-amount',action:'set_value',reason:'값 없이 요청'});
      default:return {content:'확인했습니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const evidence=results.find(item=>item.error==='wiki_evidence_required'),invalid=results.find(item=>item.error==='computer_invalid');
  assert.deepEqual(evidence.details.unknownEvidenceIds,['ev_4']);assert.match(evidence.instruction,/Omit evidenceIds/);assert.equal(evidence.actionIssued,false);
  assert.match(invalid.instruction,/set_value needs value/);assert.ok(!invalid.instruction.includes('computer_checkpoint'));
  assert.equal(results.find(item=>item.observationId).target.value,'30000');
});

// Found by the app control baseline: a run that ended with a proposal was
// reviewed before the user had decided. The review could only say that the
// action waits for approval. Three approvals in one case cost twelve reviews.
test('a run that stops at a proposed app action is handed over without a review',async t=>{
  const {REVIEW_PROMPT}=await import('../runtime/result-review.mjs'),{fixture:make}=await import('./fixtures.mjs');
  const {service}=await make(t,{scriptedReview:true}),task=await service.createTask({request:'금액을 45000으로 바꿔 줘.'}),host=createAppHost(definition);
  service.computerAdapter=new WinappComputer({platform:'win32',runner:host.runner});
  await service.computer({method:'bind',taskId:task.id,window:host.window});
  let round=0,reviews=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){reviews++;return {content:JSON.stringify({status:'ready',nextStep:'',checks:JSON.parse(messages[1].content).requirements.map(item=>({requirementId:item.id,state:'unknown',evidenceIds:[],detail:'확인'}))}),calls:[]};}
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    switch(round++){
      case 0:return call('observe_computer',{selector:'txt-amount',includeImage:false});
      case 1:return call('propose_computer_action',{observationId:result.observationId,selector:'txt-amount',action:'set_value',value:'45000',reason:'금액 변경'});
      default:return {content:'금액을 45000으로 바꿨습니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(reviews,0,'nothing to review before the user decides');
  const proposal=service.state().computer.actions[0];assert.equal(proposal.state,'proposed');
  await service.computer({method:'decide',taskId:task.id,id:proposal.id,fingerprint:proposal.fingerprint,decision:'approve'});
  await service.computer({method:'review_result',taskId:task.id,id:proposal.id,fingerprint:proposal.fingerprint});await service.agent.promise;
  assert.equal(reviews,1,'the answer after the action is reviewed');assert.equal(service.task(task.id).messages.at(-1).content,'금액을 45000으로 바꿨습니다.');
  assert.equal(host.state().controls['txt-amount'].value,'45000');
});

// Found by the app control baseline (case A7): the save button was pressed,
// the receipt said "not verified", and the agent proposed the same press
// again. The user approved it and the app received the input twice. The
// receipt held the controls after the action but not what had changed.
test('the receipt of an action tells what changed in the app',async t=>{
  const {readComputerResult}=await import('../runtime/computer-harness.mjs');
  const {service,task,host}=await connected(t);
  const seen=await observeComputer(service,task.id,{includeImage:false});
  const proposal=await proposeComputerAction(service,task.id,{observationId:seen.observationId,selector:'btn-save',action:'invoke',reason:'임시 저장'},{wikiEvidence:new Map()});
  await service.computer({method:'decide',taskId:task.id,id:proposal.id,fingerprint:proposal.fingerprint,decision:'approve'});
  assert.deepEqual(host.state().events,['saved']);
  const result=readComputerResult(service,task.id,{actionId:proposal.id});
  assert.equal(result.receipt.verification,'not_verified','a button press has no value to read back');
  assert.deepEqual(result.changes,{changed:[{selector:'lbl-status',before:{name:'상태: 작성 중'},after:{name:'상태: 임시 저장됨'}}],added:[],removed:[],compared:result.changes.compared});
  assert.ok(result.changes.compared>10);
  assert.match(result.instruction,/changes/);
  // An action that changed nothing visible says so.
  const again=await observeComputer(service,task.id,{includeImage:false});
  const second=await proposeComputerAction(service,task.id,{observationId:again.observationId,selector:'chk-receipt',action:'toggle_on',reason:'이미 켜짐'},{wikiEvidence:new Map()});
  await service.computer({method:'decide',taskId:task.id,id:second.id,fingerprint:second.fingerprint,decision:'approve'});
  const same=readComputerResult(service,task.id,{actionId:second.id});
  assert.equal(same.receipt.execution,'already_at_target');assert.deepEqual([same.changes.changed,same.changes.added,same.changes.removed],[[],[],[]]);
});

test('the run that follows an approval is given the receipt and the changes',async t=>{
  const {service,task,host}=await connected(t);let round=0,receipts;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    switch(round++){
      case 0:return call('observe_computer',{includeImage:false});
      case 1:return call('propose_computer_action',{observationId:result.observationId,selector:'btn-save',action:'invoke',reason:'임시 저장'});
      default:{const text=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Current host receipts')).content;receipts=JSON.parse(text.slice(text.indexOf('{')));return {content:'임시 저장했습니다.',calls:[]};}
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const proposal=service.state().computer.actions[0];
  await service.computer({method:'decide',taskId:task.id,id:proposal.id,fingerprint:proposal.fingerprint,decision:'approve'});
  await service.computer({method:'review_result',taskId:task.id,id:proposal.id,fingerprint:proposal.fingerprint});await service.agent.promise;
  const reviewed=receipts.computer.reviewed;
  assert.equal(reviewed.id,proposal.id);assert.deepEqual([reviewed.action,reviewed.selector,reviewed.execution,reviewed.verification],['invoke','btn-save','command_returned','not_verified']);
  assert.deepEqual(reviewed.changes.changed,[{selector:'lbl-status',before:{name:'상태: 작성 중'},after:{name:'상태: 임시 저장됨'}}]);
  assert.ok(JSON.stringify(reviewed).length<2500,String(JSON.stringify(reviewed).length));
  assert.deepEqual(host.state().inputs,[{action:'invoke',selector:'btn-save'}]);
});
