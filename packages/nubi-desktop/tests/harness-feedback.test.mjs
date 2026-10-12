// Found by the first live model baseline (2026-09-29): a refused plan or
// review told the model only an error code, so it repeated the same mistake
// until the run stopped. A refusal must name what was wrong and what is valid.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {SourceObservations} from '../runtime/source-edits.mjs';
import {recordChangePlan} from '../runtime/change-plan.mjs';
import {rememberWikiEvidence} from '../runtime/wiki-evidence.mjs';
import {REVIEW_PROMPT,reviewResult,resultReviewInput} from '../runtime/result-review.mjs';
import {recoveryInstruction} from '../runtime/tool-feedback.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

const plan=(requirement={})=>({summary:'Update observed text',requirements:[{id:'R1',text:'Required result',...requirement}],targets:[{path:'app.txt',reason:'Observed behavior',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'Assert expected stored content'}],assumptions:[]});
const refused=async promise=>{try{await promise;}catch(error){return error;}assert.fail('expected a refusal');};
async function observed(t,criteria=[]){
  const {service,root}=await fixture(t),task=await service.createTask({request:'Improve content',criteria}),seen=new SourceObservations();
  seen.observe(await service.read({path:'app.txt'}));
  return {service,root,task,seen};
}

test('a task without criteria accepts a plan whose requirements name invented criteria, and says which it ignored',async t=>{
  const {service,task,seen}=await observed(t);
  const recorded=await recordChangePlan(service,task,plan({criterionId:'user-request'}),seen,'run1');
  assert.deepEqual(recorded.ignoredCriterionIds,['user-request']);
  assert.equal('criterionId' in recorded.requirements[0],false,'an invented criterion is not stored as if the user wrote it');
  assert.equal(task.changePlan.id,recorded.id);
  const plain=await recordChangePlan(service,task,plan(),seen,'run1');
  assert.deepEqual(plain.ignoredCriterionIds,[]);
});

test('a task with criteria refuses unknown or uncovered criteria and names the valid ones',async t=>{
  const {service,task,seen}=await observed(t,['First result','Second result']);
  const unknown=await refused(recordChangePlan(service,task,plan({criterionId:'user-request'}),seen,'run1'));
  assert.equal(unknown.message,'plan_criteria_missing');
  assert.deepEqual(unknown.details.unknownCriterionIds,['user-request']);
  assert.deepEqual(unknown.details.uncoveredCriterionIds,['AC-1','AC-2']);
  assert.deepEqual(unknown.details.validCriteria,[{id:'AC-1',text:'First result'},{id:'AC-2',text:'Second result'}]);
  const partial=await refused(recordChangePlan(service,task,plan({criterionId:'AC-1'}),seen,'run1'));
  assert.deepEqual(partial.details.unknownCriterionIds,[]);assert.deepEqual(partial.details.uncoveredCriterionIds,['AC-2']);
  assert.equal(task.changePlan,undefined,'a refused plan is not stored');
});

test('an invented Wiki evidence ID is refused with the IDs observed in this run',async t=>{
  const {service,task,seen}=await observed(t);
  const found=await service.wikiQuery({query:'welcome',taskId:task.id});rememberWikiEvidence(seen,found.results);
  const error=await refused(recordChangePlan(service,task,plan({evidenceIds:['ev_2']}),seen,'run1'));
  assert.equal(error.message,'wiki_evidence_required');
  assert.deepEqual(error.details.unknownEvidenceIds,['ev_2']);
  assert.deepEqual(error.details.observedEvidence,found.results.map(row=>({evidenceId:row.evidenceId,path:row.path})));
  const recorded=await recordChangePlan(service,task,plan({evidenceIds:[found.results[0].evidenceId]}),seen,'run1');
  assert.equal(recorded.wikiEvidence[0].path,'openwiki/home.md');
});

test('a malformed plan names the broken rule and an unread target names its path',async t=>{
  const {service,task,seen}=await observed(t);
  const orphan=plan();orphan.checks[0].requirementId='invented';
  const structure=await refused(recordChangePlan(service,task,orphan,seen,'run1'));
  assert.equal(structure.message,'plan_invalid');
  assert.deepEqual(structure.details.problems,['check 1 names unknown requirement "invented"','requirement "R1" has no check']);
  const shape=plan();delete shape.summary;shape.targets[0].action='delete';
  const schema=await refused(recordChangePlan(service,task,shape,seen,'run1'));
  assert.equal(schema.message,'plan_invalid');
  assert.ok(schema.details.problems.some(problem=>problem.includes('summary')),JSON.stringify(schema.details));
  assert.ok(schema.details.problems.some(problem=>problem.includes('/targets/0/action')),JSON.stringify(schema.details));
  const unread=plan();unread.targets[0].path='openwiki/home.md';
  const source=await refused(recordChangePlan(service,task,unread,seen,'run1'));
  assert.equal(source.message,'source_read_required');assert.deepEqual(source.details,{path:'openwiki/home.md',reason:'not_read_in_this_run'});
});

test('each refusal carries guidance for its own code only',()=>{
  const criteria=recoveryInstruction('plan_criteria_missing','record_change_plan');
  assert.match(criteria,/details/);assert.match(criteria,/criterionId/);
  for(const unrelated of ['preview_http_error','proposal_invalid_syntax','elevation','new files'])assert.ok(!criteria.includes(unrelated),unrelated);
  assert.ok(criteria.length<500,String(criteria.length));
  assert.match(recoveryInstruction('range_invalid','read_source'),/The read failed/);
  assert.match(recoveryInstruction('wiki_evidence_required','record_change_plan'),/evidenceId/);
  assert.match(recoveryInstruction('change_plan_required','propose_patch'),/record_change_plan/);
  const unknown=recoveryInstruction('some_new_code','propose_patch');
  assert.match(unknown,/No source was changed/);assert.ok(unknown.length<500);
  for(const code of ['preview_source_required','preview_scope','preview_http_error','work_plan_invalid','elevation_unavailable','elevation_command_limit','elevation_approval_required','conversation_range','file_exists','parent_missing','project_rules_changed','rules_unavailable','setup_invalid','setup_changed','search_unavailable','workspace_status_invalid','quality_unavailable','proposal_invalid_syntax','wiki_evidence_required','wiki_evidence_stale','tool_timeout','source_missing','source_unavailable','repair_invalid','shell_unavailable','plan_invalid','plan_criteria_missing','change_plan_required','change_scope_unplanned','change_plan_stale','tool_arguments_invalid','source_read_required','source_stale','range_invalid','edits_invalid','edit_text_missing','edit_text_ambiguous','edits_overlap','edit_no_change','content_limit','path_scope']){
    const text=recoveryInstruction(code,'propose_patch');assert.ok(text.length>=40&&text.length<700,code+': '+text.length);
  }
});

test('the model receives the details and the short guidance through the real tool loop',async t=>{
  const {service}=await fixture(t);let round=0,hash;const results=[];
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;if(result)results.push(result);
    switch(round++){
      case 0:return call('read_source',{path:'app.txt'});
      case 1:hash=result.hash;return call('record_change_plan',plan({evidenceIds:['ev_2']}));
      case 2:return call('record_change_plan',plan({criterionId:'user-request'}));
      case 3:return call('propose_patch',{path:'app.txt',expectedHash:hash,edits:[{oldText:'first',newText:'1st'}],reason:'요청 반영'});
      default:return {content:'수정안을 준비했습니다.',calls:[]};
    }
  }};
  const task=await service.createTask({request:'첫 줄을 1st로 바꿔 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const refusal=results.find(result=>result.error==='wiki_evidence_required');
  assert.deepEqual(refusal.details.unknownEvidenceIds,['ev_2']);assert.ok(refusal.instruction.length<500,String(refusal.instruction.length));
  assert.ok(!refusal.instruction.includes('preview_http_error'));
  assert.equal(service.state().proposals.length,1,'the corrected plan lets the edit proceed');
  assert.deepEqual(service.task(task.id).changePlan.ignoredCriterionIds,['user-request']);
});

const reviewInput=()=>({task:{request:'Original request',criteria:[{id:'AC-1',text:'Preserve original acceptance'}],questionHistory:[]},
  evidence:[{tool:'wiki_query',result:{results:[{evidenceId:'wiki:42bd061d752c75c6d9bd9480',path:'openwiki/home.md',excerpt:'welcome'}]}},{tool:'read_source',result:{error:'range_invalid',ok:false}}],
  receipts:{proposals:[],processes:[]},candidate:'Observed',model:{contextLength:32000},signal:new AbortController().signal});
const checks=(messages,edit)=>{const body={status:'revise',nextStep:'현재 파일을 읽으세요.',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'확인한 범위만 설명합니다.'}))};edit(body);return {content:JSON.stringify(body),calls:[]};};

test('an ID quoted from inside a tool result counts as that tool result',async()=>{
  let calls=0;
  const review=await reviewResult({...reviewInput(),invoke:async messages=>{calls++;return checks(messages,body=>{body.checks[0]={...body.checks[0],state:'supported',evidenceIds:['wiki:42bd061d752c75c6d9bd9480','tool:0']};});}});
  assert.equal(calls,1);
  assert.deepEqual(review.checks[0].evidenceIds,['tool:0'],'the quoted ID is replaced by the entry that contains it, once');
  assert.equal(review.checks[0].state,'supported');
});

test('a refused review is asked again with the exact problems and the valid IDs',async()=>{
  const prompts=[];
  const review=await reviewResult({...reviewInput(),invoke:async messages=>{
    prompts.push(messages[0].content);
    return checks(messages,body=>{
      if(prompts.length>1)return;
      body.checks[0]={...body.checks[0],state:'supported',evidenceIds:['fake']};
      body.checks[1]={...body.checks[1],state:'supported',evidenceIds:[]};
    });
  }});
  assert.equal(prompts.length,2);assert.equal(prompts[0],REVIEW_PROMPT);
  assert.match(prompts[1],/Unknown evidence IDs: "fake"/);
  assert.match(prompts[1],/supported needs at least one evidence ID: criterion:AC-1/);
  assert.match(prompts[1],/Usable evidence IDs: host, user, tool:0\./,'usable IDs are listed, unusable ones are not');
  assert.equal(review.status,'revise');
});

test('a review that stays wrong is still refused after the second attempt',async()=>{
  let calls=0;
  await assert.rejects(reviewResult({...reviewInput(),invoke:async messages=>{calls++;return checks(messages,body=>{body.checks[0]={...body.checks[0],state:'supported',evidenceIds:['fake']};});}}),/goal_review_failed/);
  assert.equal(calls,2);
});

// Found in baseline case C4: three proposals waited for the user, the reviewer
// itself said the run had stopped at the approval boundary, and still asked the
// executor to apply and verify. Six review rounds later the user got a question.
const patchFlow=()=>{let round=0,hash;return (messages,after)=>{
  const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  switch(round++){
    case 0:return call('read_source',{path:'app.txt'});
    case 1:hash=result.hash;return call('record_change_plan',plan());
    case 2:return call('propose_patch',{path:'app.txt',expectedHash:hash,edits:[{oldText:'first',newText:'1st'}],reason:'요청 반영'});
    default:return after(round);
  }};};
const verdict=(messages,status,state,nextStep='')=>({content:JSON.stringify({status,nextStep,checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state,evidenceIds:[],detail:'변경안은 제안 상태입니다.'}))}),calls:[]});
const fixtureStatus=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]});

test('a prepared proposal that only waits for the user is handed over at the second review',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0,executorRounds=0;const flow=patchFlow();
  service.providers={status:fixtureStatus,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){reviews++;return verdict(messages,'revise','pending','승인 후 적용하고 검증하세요.');}
    return flow(messages,()=>{executorRounds++;return {content:'수정안을 준비했습니다. 반영 승인을 기다립니다.',calls:[]};});
  }};
  const task=await service.createTask({request:'첫 줄을 1st로 바꿔 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.state,'review',done.error);assert.equal(done.question,null);
  assert.equal(reviews,2,'one round to correct the answer, then the handover');assert.equal(executorRounds,2);
  assert.equal(done.messages.at(-1).content,'수정안을 준비했습니다. 반영 승인을 기다립니다.');
  assert.equal(done.resultReview.status,'ready');assert.equal(done.resultReview.handoff,'approval_boundary');
  assert.equal(service.state().proposals.filter(p=>p.state==='proposed').length,1,'nothing was applied');
});

test('without anything waiting for approval the review keeps its own verdict',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0;
  service.providers={status:fixtureStatus,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){reviews++;return verdict(messages,'revise','pending','현재 파일을 읽으세요.');}
    return {content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  // Three reviews without new evidence hand the answer over (user decision 2026-09-29).
  assert.equal(done.state,'review');assert.equal(done.question,null);assert.equal(reviews,3);
  assert.equal(done.resultReview.status,'revise');assert.equal(done.resultReview.handoff,'review_stalled','not an approval boundary');
});

test('unverified items with new evidence arriving are not handed over early',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0,reads=0;const flow=patchFlow();
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:fixtureStatus,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){reviews++;return reviews<4?verdict(messages,'revise','unknown','관련 문서를 더 확인하세요.'):verdict(messages,'ready','unknown');}
    // Each executor round reads something new before answering.
    return flow(messages,round=>round%2===0?call('wiki_query',{query:['welcome','project','knowledge','screen'][reads++%4]}):{content:'수정안을 준비했습니다.',calls:[]});
  }};
  const task=await service.createTask({request:'첫 줄을 1st로 바꿔 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.state,'review',done.error);assert.equal(reviews,4);
  assert.equal(done.resultReview.handoff,undefined);
});

// Found in B1 case C1: the executor filled each round with side work, so "no
// new evidence" never held and the handover came at the sixth review. What
// matters is whether the list waiting for the user changed.
test('side work between reviews does not postpone the handover; a new proposal does',async t=>{
  const {service,root}=await fixture(t,{scriptedReview:true});let reviews=0,round=0,hash,second;
  const {writeFile}=await import('node:fs/promises'),path=await import('node:path');
  await writeFile(path.join(root,'other.txt'),'alpha\nbeta\n');
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const mixed=(messages,nextStep)=>{const body=JSON.parse(verdict(messages,'revise','pending',nextStep).content);body.checks.at(-1).state='unknown';return {content:JSON.stringify(body),calls:[]};};
  const both={summary:'Update two files',requirements:[{id:'R1',text:'Required result'}],targets:[{path:'app.txt',reason:'Observed',requirementIds:['R1']},{path:'other.txt',reason:'Observed',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'Assert stored content'}],assumptions:[]};
  service.providers={status:fixtureStatus,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){reviews++;return mixed(messages,'승인 후 적용하고 검증하세요.');}
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    switch(round++){
      case 0:return call('read_source',{path:'app.txt'});
      case 1:hash=result.hash;return call('read_source',{path:'other.txt'});
      case 2:second=result.hash;return call('record_change_plan',both);
      case 3:return call('propose_patch',{path:'app.txt',expectedHash:hash,edits:[{oldText:'first',newText:'1st'}],reason:'요청 반영'});
      case 4:return {content:'첫 수정안을 준비했습니다.',calls:[]};
      // After the first review: a second proposal. The waiting list changed.
      case 5:return call('propose_patch',{path:'other.txt',expectedHash:second,edits:[{oldText:'alpha',newText:'A'}],reason:'요청 반영'});
      case 6:return {content:'두 수정안을 준비했습니다.',calls:[]};
      // After the second review: side work only.
      case 7:return call('wiki_query',{query:'welcome'});
      case 8:return call('inspect_workspace_changes',{});
      default:return {content:'두 수정안이 반영 승인을 기다립니다.',calls:[]};
    }
  }};
  const task=await service.createTask({request:'두 파일의 첫 줄을 바꿔 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.state,'review',done.error);assert.equal(done.resultReview.handoff,'approval_boundary');
  assert.equal(reviews,3,'first review, the review after the new proposal, then the handover');
  assert.equal(service.state().proposals.filter(p=>p.state==='proposed').length,2);
});

test('the review instruction states the verdict at an approval boundary',()=>{
  assert.match(REVIEW_PROMPT,/all remaining actions await existing host approvals/);
  assert.match(REVIEW_PROMPT,/use ready/);
});

// Found in B1 case D1: the reviewer marked every requirement supported, wrote
// "revise" with no next step, and repeated it after being told. The run stopped
// and a correct answer was discarded.
test('a revise verdict with nothing left to do is a ready verdict',async()=>{
  let calls=0;
  const review=await reviewResult({...reviewInput(),invoke:async messages=>{calls++;return checks(messages,body=>{body.nextStep='';body.checks=body.checks.map(check=>({...check,state:'supported',evidenceIds:['tool:0']}));});}});
  assert.equal(calls,1);assert.equal(review.status,'ready');assert.equal(review.normalized,'nothing_to_revise');
  assert.ok(review.checks.every(check=>check.state==='supported'));
});

test('a revise verdict without a next step takes it from the open requirements',async()=>{
  let calls=0;
  const review=await reviewResult({...reviewInput(),invoke:async messages=>{calls++;return checks(messages,body=>{body.nextStep='  ';body.checks[0]={...body.checks[0],state:'supported',evidenceIds:['tool:0']};body.checks[1]={...body.checks[1],state:'unknown',detail:'현재 파일 내용을 확인하지 못했습니다.'};});}});
  assert.equal(calls,1);assert.equal(review.status,'revise');assert.equal(review.normalized,'next_step_from_checks');
  assert.equal(review.nextStep,'현재 파일 내용을 확인하지 못했습니다.');
});

// Found in B1 case K1: the answer was right and the user's request was marked
// supported, but the plan had invented "confirm the rule is live in production".
// Nothing on this host can verify that, so four reviews asked for it and the
// user got a question instead of the answer.
const withIntent=()=>{const input=reviewInput();input.task.workPlan={intent:{goal:'g',outcomes:['금액을 제시한다'],constraints:['실제 운영 적용 여부를 확인한다']}};return input;};
const intentChecks=(messages,states)=>checks(messages,body=>{body.nextStep='운영 시스템에서 확인하세요.';body.checks=body.checks.map(check=>({...check,state:states[check.requirementId]??'supported',evidenceIds:['tool:0']}));});

test('a model interpretation alone cannot hold back an answer that meets what the user wrote',async()=>{
  const review=await reviewResult({...withIntent(),invoke:async messages=>intentChecks(messages,{'intent:constraint:0':'unknown'})});
  assert.equal(review.status,'ready');assert.equal(review.normalized,'interpretation_only');
  assert.equal(review.checks.find(check=>check.requirementId==='intent:constraint:0').state,'unknown','the open item stays visible');
  assert.equal(review.nextStep,'운영 시스템에서 확인하세요.');
});

test('an open user requirement or criterion still returns the work to the executor',async()=>{
  for(const open of ['request','criterion:AC-1']){
    const review=await reviewResult({...withIntent(),invoke:async messages=>intentChecks(messages,{[open]:'unknown','intent:constraint:0':'unknown'})});
    assert.equal(review.status,'revise',open);assert.equal(review.normalized,undefined);
  }
  const pending=await reviewResult({...withIntent(),invoke:async messages=>intentChecks(messages,{request:'pending'})});
  assert.equal(pending.status,'revise');
});

// Found in B1 case S2: the first answer held the whole call flow. After the
// review returned it, the executor replied only "the explanation is complete,
// runtime is unverified", and that short note was all the user received.
test('an answer returned by review is rewritten in full, because only the last reply is delivered',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0;const continuations=[];
  service.providers={status:fixtureStatus,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){reviews++;return reviews===1?verdict(messages,'revise','unknown','검증 범위를 밝히세요.'):verdict(messages,'ready','unknown');}
    const feedback=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Independent review found unfinished work'));
    if(feedback)continuations.push(feedback.content);
    return {content:feedback?'전체 답변을 다시 씁니다.':'첫 답변입니다.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt를 설명해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(continuations.length,1);
  assert.match(continuations[0],/replaces the previous/);assert.match(continuations[0],/complete/);
  assert.equal(service.task(task.id).messages.at(-1).content,'전체 답변을 다시 씁니다.');
  assert.equal(service.task(task.id).messages.filter(message=>message.role==='assistant').length,1,'only the last reply is stored for the user');
});

// Found in B1 case S3 and five baseline cases: a requirement supported by four
// usable results and one truncated result refused the whole review. Evidence
// that cannot be used is set aside; the verdict can only become more cautious.
test('unusable evidence is set aside and never counts as support',async()=>{
  let calls=0;
  const review=await reviewResult({...reviewInput(),invoke:async messages=>{calls++;return checks(messages,body=>{
    body.checks[0]={...body.checks[0],state:'supported',evidenceIds:['tool:0','tool:1']};
    body.checks[1]={...body.checks[1],state:'supported',evidenceIds:['tool:1']};
  });}});
  assert.equal(calls,1);
  assert.deepEqual(review.checks[0],{...review.checks[0],state:'supported',evidenceIds:['tool:0']});
  assert.equal(review.checks[1].state,'unknown','nothing usable is left, so the requirement is unverified');
  assert.deepEqual(review.checks[1].evidenceIds,[]);
  assert.deepEqual(review.setAside,['tool:1']);
});

// Found in B2 cases D2 and D3: each round read a new range, so the review
// never stalled, and ten reviews later the time ran out with no answer at all.
test('after four reviews that still ask for more, the answer is handed over with its open checks',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0,answers=0,line=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  let reading=true;
  service.providers={status:fixtureStatus,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){reviews++;return verdict(messages,'revise','unknown','남은 범위를 더 읽으세요.');}
    // Each round reads a line that no earlier round read: new evidence, so no stall.
    if(reading){reading=false;line++;return call('read_source',{path:'app.txt',start:line,end:line});}
    reading=true;answers++;return {content:'확인한 범위까지 정리했습니다. '+answers,calls:[]};
  }};
  const task=await service.createTask({request:'app.txt를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.state,'review',done.error);assert.equal(done.question,null,'no question replaces the answer');
  assert.equal(reviews,4);assert.equal(answers,4);
  assert.equal(done.messages.at(-1).content,'확인한 범위까지 정리했습니다. 4');
  assert.equal(done.resultReview.status,'revise','the host does not call an unfinished review ready');
  assert.equal(done.resultReview.handoff,'review_limit');
  assert.equal(done.resultReview.nextStep,'남은 범위를 더 읽으세요.');
  assert.ok(done.resultReview.checks.every(check=>check.state==='unknown'));
});

// Found in B2 case C5: the executor wrote its question in the final answer,
// the review accepted it, and the task ended without waiting for the user.
test('the executor and the review are told that a question goes through ask_user',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let system='',continued='',reviews=0;
  service.providers={status:fixtureStatus,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){reviews++;return reviews===1?verdict(messages,'revise','unknown','인상 폭을 확인하세요.'):verdict(messages,'ready','unknown');}
    system||=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    if(reviews===1)continued||=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Independent review')).content;
    return {content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.match(system,/ask_user[^.]*\. A question written in the final response ends the run without an answer/);
  // E5 (S27, 2026-09-30): the command the user named failed and the run stopped without the corrected command.
  // User decision 2026-10-01: the goal, not the words of the command; a command known to be wrong is not run.
  // K1 (S28, 2026-10-01): a correct answer named no file it rested on.
  assert.match(system,/Name the files or Wiki pages an answer rests on, with path and lines when known\./);
  assert.match(system,/When the command asked for is wrong[^.]*whether its run failed or project files show it[^.]*do not stop at reporting it: propose the corrected command[^.]*do not run a command known to be wrong/);
  assert.match(continued,/call ask_user/);
  assert.match(REVIEW_PROMPT,/user decision is needed[^.]*ask_user/);
});

// Found in B1 and B2 case L1: in the third turn of one task the review still
// judged the answer against the first request, asked for the earlier answers
// again, and after three rounds the user got a question instead of the answer.
test('the review is told which turn the answer belongs to',()=>{
  const turns={id:'t',request:'먼저 배송 정책을 설명해 줘.',criteria:[],messages:[{role:'user',content:'회의록을 정리해 줘.'},{role:'assistant',content:'정리했습니다.'},{role:'user',content:'주문 상태 순서를 위키에서 찾아 줘.'}]};
  const later=resultReviewInput({task:turns,evidence:[],receipts:{},candidate:'답',model:{contextLength:200000},history:['회의록을 정리해 줘.','주문 상태 순서를 위키에서 찾아 줘.']}).data;
  assert.equal(later.currentTurn,'주문 상태 순서를 위키에서 찾아 줘.');
  assert.deepEqual(later.requirements[0],{id:'request',text:'먼저 배송 정책을 설명해 줘.'},'the requirement keeps the words of the task');
  assert.deepEqual(later.corrections,['회의록을 정리해 줘.','주문 상태 순서를 위키에서 찾아 줘.'],'earlier turns stay in view');
  const first=resultReviewInput({task:{...turns,messages:[]},evidence:[],receipts:{},candidate:'답',model:{contextLength:200000},history:[]}).data;
  assert.deepEqual(first.requirements[0],{id:'request',text:'먼저 배송 정책을 설명해 줘.'});assert.equal('currentTurn' in first,false);
  assert.match(REVIEW_PROMPT,/currentTurn is the latest request: judge requirement turn against it/);
  assert.match(REVIEW_PROMPT,/not an earlier answer/);
});

test('an answer to a question is not taken for a new turn',()=>{
  const asked={id:'t',request:'할인율 좀 올려 줘.',criteria:[],messages:[{role:'assistant',content:'얼마나 올릴까요?'},{role:'user',content:'모든 등급 2%p 인상'}],questionHistory:[{text:'얼마나 올릴까요?',answer:{text:'모든 등급 2%p 인상',at:'2026-09-29T00:00:00.000Z'}}]};
  const data=resultReviewInput({task:asked,evidence:[],receipts:{},candidate:'답',model:{contextLength:200000},history:['모든 등급 2%p 인상']}).data;
  assert.deepEqual(data.requirements[0],{id:'request',text:'할인율 좀 올려 줘.'});assert.equal('currentTurn' in data,false);
  assert.deepEqual(data.corrections,['모든 등급 2%p 인상']);
  const next=resultReviewInput({task:{...asked,messages:[...asked.messages,{role:'user',content:'이제 테스트도 고쳐 줘.'}]},evidence:[],receipts:{},candidate:'답',model:{contextLength:200000},history:['모든 등급 2%p 인상','이제 테스트도 고쳐 줘.']}).data;
  assert.equal(next.currentTurn,'이제 테스트도 고쳐 줘.');assert.equal(next.requirements[0].text,'할인율 좀 올려 줘.');
});

// Found in B2 cases W3 and D3: the Wiki did not cover what was asked and the
// answer said so, but the review kept asking for the fact the sources lack.
test('the review instruction accepts a report that the sources lack the fact',()=>{
  assert.match(REVIEW_PROMPT,/Sourced absence answers only within covered scope/);
  assert.match(REVIEW_PROMPT,/For behavior\/code questions verify relevant source, not only Wiki/);
  assert.match(REVIEW_PROMPT,/do not demand unavailable facts/);
});

// Found in B6 case L1: the planner returned steps without a status, twice.
// The second request said only that the response was invalid, and the run
// stopped with work_plan_invalid before any work.
test('a plan whose steps have no status is completed by the host',async()=>{
  const {prepareWorkPlan}=await import('../runtime/work-plan.mjs');
  const capabilities={workflows:[{id:'knowledge'}],skills:[]},task={request:'주문 상태를 위키에서 찾아 줘',criteria:[],questionHistory:[]};
  const plan={intent:{goal:'위키 확인',constraints:[],outcomes:['상태 순서 설명'],workflowIds:['knowledge'],skillPaths:[]},steps:[{text:'위키 조회',expected_outcome:'근거 확인'},{text:'정리',expected_outcome:'설명 제공'}]};
  let calls=0;
  const prepared=await prepareWorkPlan({task,history:[],model:{contextLength:200000},capabilities,signal:new AbortController().signal,invoke:async()=>{calls++;return {content:JSON.stringify(plan),calls:[]};}});
  assert.equal(calls,1,'no second request is needed');
  assert.deepEqual(prepared.steps.map(step=>[step.text,step.status]),[['위키 조회','in_progress'],['정리','pending']]);
  assert.equal(prepared.intent.goal,'위키 확인');
});

test('a plan that stays invalid is asked again with the rule it broke',async()=>{
  const {prepareWorkPlan}=await import('../runtime/work-plan.mjs');
  const capabilities={workflows:[{id:'knowledge'}],skills:[]},task={request:'확인해 줘',criteria:[],questionHistory:[]},seen=[];
  const broken={intent:{goal:'확인',constraints:[],outcomes:['결과'],workflowIds:['unknown-workflow'],skillPaths:[]},steps:[{text:'확인',expected_outcome:'결과',status:'completed'}]};
  const fixed={intent:{goal:'확인',constraints:[],outcomes:['결과'],workflowIds:['knowledge'],skillPaths:[]},steps:[{text:'확인',expected_outcome:'결과',status:'in_progress'}]};
  const prepared=await prepareWorkPlan({task,history:[],model:{contextLength:200000},capabilities,signal:new AbortController().signal,invoke:async messages=>{seen.push(messages[0].content);return {content:JSON.stringify(seen.length===1?broken:fixed),calls:[]};}});
  assert.equal(seen.length,2);assert.equal(prepared.steps[0].status,'in_progress');
  assert.match(seen[1],/Problems found:/);assert.match(seen[1],/status/);assert.match(seen[1],/unknown-workflow/);assert.match(seen[1],/knowledge/,'the valid workflow ids are named');
  await assert.rejects(prepareWorkPlan({task,history:[],model:{contextLength:200000},capabilities,signal:new AbortController().signal,invoke:async()=>({content:JSON.stringify(broken),calls:[]})}),/work_plan_invalid/);
});

// E5 and E6 (S27, 2026-10-01): the command the user named failed because it was wrong, and the review took an
// accurate report of the error for the answer. The host names what is still owed as a requirement of its own.
test('a wrong command that nothing followed is a requirement of the review until it is corrected or asked about',async()=>{
  const {WRONG_COMMAND_REQUIREMENT}=await import('../runtime/result-review.mjs');
  const task={id:'t',request:'npm run test:discount 로 할인 검사만 돌려서 결과를 알려 줘.',criteria:[],messages:[]};
  const input=receipts=>resultReviewInput({task,evidence:[],receipts,candidate:'스크립트가 없어 실행되지 않았습니다.',model:{contextLength:200000},history:[]}).data;
  const wrong=input({processes:[],wrongCommand:{processId:'p',script:'npm run test:discount',kind:'missing_script',detail:'test:discount'}});
  assert.deepEqual(wrong.requirements.find(item=>item.id==='host:command'),{id:'host:command',text:WRONG_COMMAND_REQUIREMENT});
  assert.match(WRONG_COMMAND_REQUIREMENT,/a report of the error alone does not meet it/);
  assert.equal(input({processes:[]}).requirements.some(item=>item.id==='host:command'),false);
});
