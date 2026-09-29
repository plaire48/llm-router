import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewExecution,projectReviewExecution} from '../review-execution.js';
import {createScriptInputWitness} from '../browser-script-receipt.js';
import {goalReviewMessages,parseGoalReview} from '../goal-review.js';
const flags=['onlyReadOnlyToolsInvoked','noPageInteractionToolsInvoked','allPageInteractionTargetsObserved','searchAndReadOnly'];
const click=(name='Search tab')=>({ok:true,actionIssued:true,actionTargetReceipt:{dataKind:'click_target_dispatch',version:1,status:'observed',actionIssued:true,
  target:{tabId:1,frameId:0,documentId:'d',topDocumentId:'d',name,role:'button',tag:'button'}}});
const inputTarget={tabId:1,frameId:0,documentId:'d',topDocumentId:'d',controlId:'search',name:'Search',role:'textbox',tag:'input',type:'search'};
function envelope(ledger,goal){const review=goalReviewMessages({goal,history:[{role:'user',content:goal}],evidence:[],answer:'Candidate',inputBudget:22000,executionLedger:ledger});
  const payload=JSON.parse(review.messages[1].content);return {review,payload,receipt:payload.evidence[0]};}
function unchangedFields(original,projection){for(const [key,value] of Object.entries(original))if(!flags.includes(key)&&key!=='scopeNote')assert.deepEqual(projection[key],value,key);}

test('requested search is delivered as exact historical input and click facts, never a read-only violation or automatic permission',async()=>{
  const run=createReviewExecution({taskStartObserved:true});
  const witness=await createScriptInputWitness({method:'fill',value:'museum',captureTarget:async()=>inputTarget,readMatch:async()=>true});
  await witness.beforeIssued();witness.onIssued();const id=run.record('fill_form');
  run.complete(id,{ok:true,verified:true,actionIssued:true,applied:1,matched:1,inputExecution:{commands:[{method:'fill',state:'returned',actionIssued:true,inputReceipt:await witness.finish('returned')}],omitted:0}});
  assert(await run.bindInputArguments(id,{fields:[{value:'museum'}]}));
  const pressed=run.record('press_key');run.complete(pressed,{ok:true,actionIssued:true}); // missing target stays unknown
  run.complete(run.record('click_element'),click());
  const raw=run.reviewSnapshot(),before=structuredClone(raw),goal='검색창에 museum을 입력하고 검색해줘. 읽기 전용으로 조사하고 등록하지 마.';
  const {receipt,payload}=envelope(raw,goal);
  for(const flag of flags)assert.equal(Object.hasOwn(receipt.result,flag),false);
  assert.deepEqual(receipt.result.absenceCertificates,[]);assert.equal(receipt.result.semanticClickTargetCoverage,'not_established');
  unchangedFields(raw,receipt.result);assert.deepEqual(raw,before);assert.deepEqual(run.reviewSnapshot(),before);
  assert.equal(receipt.result.historicalInputValues[0].value,'museum');assert.equal(receipt.result.semanticInputReceipts[1].status,'unknown');
  assert.equal(payload.goal,goal);assert.deepEqual(payload.conversation,[{role:'user',content:goal}]);
  assert.equal(receipt.result.allowed,undefined);assert.equal(receipt.result.compliant,undefined);assert.equal(receipt.result.verified,undefined);
  assert.equal(raw.onlyReadOnlyToolsInvoked,false);assert(!JSON.stringify(run.snapshot()).includes('museum'));
  const noInput='아무 입력도 하지 말고 현재 화면만 읽어줘.';
  const prohibited=envelope(raw,noInput);assert.equal(prohibited.payload.goal,noInput);
  assert.deepEqual(prohibited.receipt.result.semanticInputReceipts,receipt.result.semanticInputReceipts);
  assert.deepEqual(prohibited.receipt.result.historicalInputValues,receipt.result.historicalInputValues);
  const verdict=parseGoalReview({content:JSON.stringify({status:'revise',checks:[{requirement:noInput,status:'unmet',evidence_ids:[prohibited.receipt.id]}],next_step:'실제 입력한 사실을 정확히 보고하세요.'})},prohibited.review.evidence);
  assert.equal(verdict.status,'revise');assert.equal(verdict.checks[0].status,'unmet');
});

test('explicit no-click and no-input restrictions remain original requirements, including observed prohibited targets',()=>{
  const run=createReviewExecution({taskStartObserved:true});run.complete(run.record('click_element'),click('Like'));
  for(const goal of ['좋아요 버튼을 누르지 마.','아무 곳도 클릭하거나 입력하지 마.']) {
    const raw=run.snapshot(),{receipt,payload,review}=envelope(raw,goal);
    unchangedFields(raw,receipt.result);assert.equal(receipt.result.semanticClickTargetCoverage,'complete');
    assert.deepEqual(receipt.result.absenceCertificates,[]);assert.equal(receipt.result.clickTargetReceipts[0].target.name,'Like');assert.equal(payload.goal,goal);
    const verdict=parseGoalReview({content:JSON.stringify({status:'revise',checks:[{requirement:goal,status:'unmet',evidence_ids:[receipt.id]}],next_step:'관찰한 제한 위반을 정확히 보고하세요.'})},review.evidence);
    assert.equal(verdict.status,'revise');assert.equal(verdict.checks[0].status,'unmet');
  }
});

test('unknown writes, cancellation, pending receipts, omitted history and resumed coverage are preserved exactly',()=>{
  const run=createReviewExecution({taskStartObserved:false});
  run.record('fill_form');run.complete(run.record('run_playwright'),{error:'action_outcome_unknown',actionIssued:true,execution:{commands:[{method:'click',state:'failed',actionIssued:true}],omitted:1}});
  run.complete(run.record('press_key'),{error:'cancelled',cancelled:true,actionIssued:false});
  for(let i=0;i<66;i++)run.record('click_element');
  const raw=run.reviewSnapshot(),{receipt}=envelope(raw,'읽기 전용. 결과가 불확실한 쓰기를 반복하지 마.');
  unchangedFields(raw,receipt.result);assert.deepEqual(receipt.result.absenceCertificates,[]);assert.equal(receipt.result.semanticClickTargetCoverage,'not_established');
  assert.equal(receipt.result.clickTargetReceiptsOmitted,2);assert.equal(receipt.result.semanticInputReceipts[0].outcome,'pending');
  assert.equal(receipt.result.scriptCommandReceipts[0].actionIssued,true);assert.equal(receipt.result.scriptCommandReceipts[0].outcome,'error');
  assert.equal(receipt.result.semanticInputReceipts[1].outcome,'error');assert.equal(receipt.result.semanticInputReceipts[1].actionIssued,false);
});

test('only narrow positive absence certificates are emitted for fully observed nonempty runs',()=>{
  for(const fresh of [true,false])for(const names of [[],['read_page'],['navigate_page','read_page'],['scroll_page'],['unknown_custom_tool']]) {
    const run=createReviewExecution({taskStartObserved:fresh});for(const name of names)run.record(name);
    const raw=run.snapshot(),projected=projectReviewExecution(raw);
    assert.deepEqual(projectReviewExecution(projected),projected);unchangedFields(raw,projected);
    const expected=fresh&&names.length&&names.every(n=>['read_page','navigate_page'].includes(n))?
      [...(names.includes('navigate_page')?[]:['only_observation_or_coordination_tools_dispatched']),'no_click_input_or_script_tool_dispatched']:[];
    assert.deepEqual(projected.absenceCertificates,expected,`${fresh}:${names}`);
    projected.calls.push({tool:'mutated',count:1});assert.equal(raw.calls.some(c=>c.tool==='mutated'),false);
  }
});

test('mixed semantic input and click attribution survives projection without certifying permission',async()=>{
  const run=createReviewExecution({taskStartObserved:true});
  for(const [tool,method] of [['fill_form','fill'],['press_key','press']]) {
    const witness=await createScriptInputWitness({method,value:method==='fill'?'museum':undefined,key:method==='press'?'Enter':undefined,captureTarget:async()=>inputTarget,readMatch:async()=>true});
    await witness.beforeIssued();witness.onIssued();
    run.complete(run.record(tool),{ok:true,actionIssued:true,inputExecution:{commands:[{method,state:'returned',actionIssued:true,inputReceipt:await witness.finish('returned')}],omitted:0}});
  }
  run.complete(run.record('click_element'),click('Like'));
  const original=run.snapshot(),projected=projectReviewExecution(original);
  assert.equal(projected.interactionTargetCoverage,'complete');
  assert.equal(projected.semanticClickTargetCoverage,'not_established');
  assert.equal(projected.clickTargetReceipts[0].target.name,'Like'); // known forbidden target must remain reviewable
  assert.equal(projected.compliant,undefined);assert.equal(projected.allowed,undefined);
  unchangedFields(original,projected);
  for(const change of [
    value=>{value.taskStartObserved=false;},
    value=>{value.semanticInputReceiptsOmitted=1;},
    value=>{value.semanticInputReceipts[1].outcome='pending';},
    value=>{value.semanticInputReceipts[1].commands[0].inputReceipt.targetStatus='unknown';},
    value=>{value.calls.push({tool:'run_playwright',count:1});},
    value=>{value.calls.find(row=>row.tool==='press_key').count++;},
  ]) {const altered=structuredClone(original);change(altered);assert.equal(projectReviewExecution(altered).interactionTargetCoverage,'not_established');}
});
