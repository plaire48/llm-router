import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewExecution, normalizeScriptCommandEvidence} from '../review-execution.js';
import {goalReviewMessages,parseGoalReview} from '../goal-review.js';
test('dispatch proof distinguishes pure reading from attempted actions, unknown tools and prior runs',()=>{
  const run=createReviewExecution({taskStartObserved:true});assert(!run.snapshot().onlyReadOnlyToolsInvoked);
  run.record('read_page');run.record('delegate_analysis');assert(run.snapshot().onlyReadOnlyToolsInvoked);
  run.record('run_playwright');assert(!run.snapshot().onlyReadOnlyToolsInvoked);
  const custom=createReviewExecution({taskStartObserved:false});custom.record('unknown_custom_tool');assert(!custom.snapshot().onlyReadOnlyToolsInvoked);assert(!custom.snapshot().taskStartObserved);
});
test('host receipt is independently citeable for dispatched tools and does not mutate source evidence',()=>{
  const run=createReviewExecution({taskStartObserved:true});run.record('read_page');
  const evidence=[];const review=goalReviewMessages({goal:'Read only. Do not submit.',history:[],evidence,answer:'Read result',inputBudget:12000,executionLedger:run.snapshot()});
  const payload=JSON.parse(review.messages[1].content);assert.equal(evidence.length,0);assert.equal(payload.evidence.length,1);
  assert.equal(payload.evidence[0].result.dataKind,'host_tool_dispatch');assert.deepEqual(payload.source_snapshot_evidence_ids,[]);
  assert.equal(parseGoalReview({content:JSON.stringify({status:'complete',checks:[{requirement:'No browser action tool invoked during this fresh run',status:'met',evidence_ids:[1]}],next_step:''})},review.evidence).status,'complete');
});

test('E-05 navigation and reading proves no page interaction, not read-only execution',()=>{
  const run=createReviewExecution({taskStartObserved:true});
  for(const tool of ['update_plan','select_tools','navigate_page','update_plan','navigate_page','read_page','navigate_page','read_page','update_plan','read_page']) run.record(tool);
  const ledger=run.snapshot();
  assert.equal(ledger.onlyReadOnlyToolsInvoked,false);
  assert.equal(ledger.noPageInteractionToolsInvoked,true);
  assert.equal(ledger.calls.find(call=>call.tool==='navigate_page').count,3);
  assert.match(ledger.scopeNote,/Navigation may cause account or server effects/);
  const review=goalReviewMessages({goal:'영상의 제목과 길이를 알려줘. 구독하거나 좋아요를 누르지 마.',history:[],evidence:[],answer:'영상 정보',inputBudget:12000,executionLedger:ledger});
  const payload=JSON.parse(review.messages[1].content);
  assert(payload.evidence[0].result.absenceCertificates.includes('no_click_input_or_script_tool_dispatched'));
  assert.equal(payload.evidence[0].result.noPageInteractionToolsInvoked,undefined);
  assert.deepEqual(payload.citeable_evidence_ids,[1]);
});

test('no interaction proof fails closed for empty, resumed, interaction and unclassified dispatches',()=>{
  assert.equal(createReviewExecution({taskStartObserved:true}).snapshot().noPageInteractionToolsInvoked,false);
  for(const taskStartObserved of [false,undefined]) {
    const run=createReviewExecution({taskStartObserved});run.record('navigate_page');run.record('read_page');
    assert.equal(run.snapshot().noPageInteractionToolsInvoked,false);
  }
  for(const tool of ['click','fill_form','press_key','run_playwright','unknown_custom_tool']) {
    const run=createReviewExecution({taskStartObserved:true});run.record('navigate_page');run.record('read_page');run.record(tool);
    assert.equal(run.snapshot().noPageInteractionToolsInvoked,false,tool);
  }
});

const clickResult = (name = 'Play video') => ({ok: true, actionIssued: true, actionTargetReceipt: {
  dataKind: 'click_target_dispatch', version: 1, status: 'observed', actionIssued: true,
  target: {tabId: 3, topDocumentId: 'top-document', frameId: 2, documentId: 'child-document', role: 'button', name, tag: 'button'},
}});

test('each host click result is bound to its dispatch, copied and never classified as permitted',()=>{
  const run=createReviewExecution({taskStartObserved:true});
  const first=run.record('click_element'), read=run.record('read_page'), second=run.record('click_element');
  const result=clickResult('Subscribe'); result.actionTargetReceipt.target.href='https://example.com/watch?token=PRIVATE#secret';
  assert.equal(run.complete(second,result),true);
  assert.equal(run.complete(read,result),false);
  assert.equal(run.complete(second,clickResult('Forged replacement')),false);
  result.actionTargetReceipt.target.name='Mutated caller';
  const snapshot=run.snapshot();
  assert.equal(snapshot.noPageInteractionToolsInvoked,false);
  assert.equal(snapshot.clickTargetReceipts[0].dispatchId,first);
  assert.equal(snapshot.clickTargetReceipts[0].status,'unknown');
  assert.equal(snapshot.clickTargetReceipts[0].outcome,'pending');
  assert.equal(snapshot.clickTargetReceipts[1].target.name,'Subscribe');
  assert.equal(snapshot.clickTargetReceipts[1].target.href,'https://example.com/watch');
  assert(!JSON.stringify(snapshot).includes('PRIVATE'));
  assert.equal(snapshot.clickTargetReceipts[1].allowed,undefined);
  snapshot.clickTargetReceipts[1].target.name='Mutated snapshot';
  assert.equal(run.snapshot().clickTargetReceipts[1].target.name,'Subscribe');
  assert.equal(run.complete(first,{...clickResult(),error:'browser_stale'}),true);
  assert.equal(run.snapshot().clickTargetReceipts[0].outcome,'error');
  assert.equal(run.snapshot().clickTargetReceipts[0].actionIssued,true);
});

test('missing, inconsistent and malformed target receipts remain unknown',()=>{
  for (const alter of [r=>delete r.actionTargetReceipt, r=>delete r.actionIssued,
    r=>{r.actionIssued=false;}, r=>{r.actionTargetReceipt.target.documentId='';},
    r=>{r.actionTargetReceipt.target.frameId='2';}, r=>{r.actionTargetReceipt.target.name='x'.repeat(180);},
    r=>{r.actionTargetReceipt.status='unknown';r.actionTargetReceipt.reason='document_identity_changed';}]) {
    const run=createReviewExecution({taskStartObserved:true}), id=run.record('click_element');
    const result=clickResult();alter(result);run.complete(id,result);
    const receipt=run.snapshot().clickTargetReceipts[0];
    assert.equal(receipt.status,'unknown');assert.equal(receipt.target,undefined);
    assert.equal(run.snapshot().noPageInteractionToolsInvoked,false);
  }
});

test('bounded target receipts expose omitted attempts and do not certify scripts or prior runs',()=>{
  const run=createReviewExecution({taskStartObserved:false});
  for(let i=0;i<66;i++){const id=run.record('click_element');run.complete(id,clickResult());}
  const script=run.record('run_playwright');assert.equal(run.complete(script,clickResult()),true);
  const snapshot=run.snapshot();
  assert.equal(snapshot.clickTargetReceipts.length,64);
  assert.equal(snapshot.clickTargetReceiptsOmitted,2);
  assert.equal(snapshot.calls.find(item=>item.tool==='click_element').count,66);
  assert.equal(snapshot.taskStartObserved,false);
  assert.equal(snapshot.noPageInteractionToolsInvoked,false);
  assert.equal(snapshot.allPageInteractionTargetsObserved,false);
  assert.equal(snapshot.scriptCommandReceipts[0].status,'unknown');
});

test('full interaction-target coverage requires fresh, exclusively observed semantic clicks',()=>{
  assert.equal(createReviewExecution({taskStartObserved:true}).snapshot().allPageInteractionTargetsObserved,false);
  for(const extra of [null,'read_page','navigate_page','press_key','run_playwright','click_at','unknown_custom']) {
    for(const fresh of [true,false]) {
      const run=createReviewExecution({taskStartObserved:fresh}), id=run.record('click_element');
      if(extra)run.record(extra);
      assert.equal(run.snapshot().allPageInteractionTargetsObserved,false);
      run.complete(id,clickResult('Like'));
      assert.equal(run.snapshot().allPageInteractionTargetsObserved,fresh && [null,'read_page','navigate_page'].includes(extra),`${fresh}:${extra}`);
      // "Like" remains an observed name, never host-certified permission.
      assert.equal(run.snapshot().clickTargetReceipts[0].allowed,undefined);
    }
  }
  for(const result of [undefined,{error:'browser_stale',actionIssued:false},
    {error:'browser_stale',actionIssued:true,actionTargetReceipt:{dataKind:'click_target_dispatch',version:1,status:'unknown',actionIssued:true}}]) {
    const run=createReviewExecution({taskStartObserved:true}), id=run.record('click_element');run.complete(id,result);
    assert.equal(run.snapshot().allPageInteractionTargetsObserved,false);
  }
});

test('resumed verification cannot certify that earlier actions never occurred',async()=>{
  const {runAgent}=await import('../agent-runtime.js');
  const {browserTools,BUILTIN_SKILLS}=await import('../skills.js');
  for(const resumed of [false,true]) {
    let round=0, reviewed=false;
    await runAgent({messages:[{role:'user',content:'현재 상태를 확인해줘.'}],tools:browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')),
      signal:new AbortController().signal,harness:true,resumeVerification:resumed,
      complete:async()=>round++===0?{calls:[{id:'verify',type:'function',function:{name:'verify_page',arguments:JSON.stringify({checks:[{kind:'text_present',expected:'ready'}]})}}]}:{content:'현재 상태 확인'},
      execute:async()=>({ok:true,verified:true,text:'ready'}),
      reviewGoal:async({executionLedger})=>{reviewed=true;assert.equal(executionLedger.taskStartObserved,!resumed);assert(executionLedger.onlyReadOnlyToolsInvoked);assert.equal(executionLedger.noPageInteractionToolsInvoked,!resumed);return {status:'complete'};}});
    assert(reviewed);
  }
});

test('a supported long click ledger reaches review atomically without the generic 14k truncation',()=>{
  const run=createReviewExecution({taskStartObserved:true});
  for(let i=0;i<40;i++) {
    const id=run.record('click_element');
    run.complete(id,clickResult(`${i}: ${'Observed target '.repeat(10)}`));
  }
  const ledger=run.snapshot();assert(JSON.stringify(ledger).length>14000);
  const review=goalReviewMessages({goal:'Do not press Like.',history:[],evidence:[],answer:'Observed result',inputBudget:32000,executionLedger:ledger});
  const payload=JSON.parse(review.messages[1].content), evidence=payload.evidence[0];
  assert.equal(evidence.truncated,false);assert.equal(evidence.usable,true);
  assert.equal(evidence.result.clickTargetReceipts.length,40);
  assert.equal(evidence.result.clickTargetReceipts[0].target.name,ledger.clickTargetReceipts[0].target.name);
  assert.deepEqual(payload.citeable_evidence_ids,[evidence.id]);
  assert.throws(()=>goalReviewMessages({goal:'Do not press Like.',history:[],evidence:[],answer:'Observed result',inputBudget:100,executionLedger:ledger}),/goal_review_failed/);
});

const scriptResult = (method='fill') => ({ok:true, actionIssued:true, result:{claimed:'PRIVATE_SCRIPT_RETURN'},
  code:'PRIVATE_CODE', execution:{commands:[{index:1,method,state:'returned',actionIssued:true,
    args:['PRIVATE_VALUE'],target:'PRIVATE_TARGET'}],omitted:0}});

test('historical script commands are bound, copied, sanitized and never certify targets or values',()=>{
  const run=createReviewExecution({taskStartObserved:true}), id=run.record('run_playwright');
  assert.equal(run.snapshot().scriptCommandReceipts[0].outcome,'pending');
  const result=scriptResult();assert(run.complete(id,result));
  assert.equal(run.complete(id,scriptResult('press')),false);
  result.execution.commands[0].method='click';
  const ledger=run.snapshot(), receipt=ledger.scriptCommandReceipts[0];
  assert.deepEqual(receipt.commands,[{method:'fill',state:'returned',actionIssued:true}]);
  assert.equal(receipt.status,'observed');assert.equal(receipt.dispatchId,id);
  assert.equal(ledger.onlyReadOnlyToolsInvoked,false);assert.equal(ledger.allPageInteractionTargetsObserved,false);
  assert(!JSON.stringify(ledger).includes('PRIVATE'));assert.equal(receipt.allowed,undefined);
  receipt.commands[0].method='click';assert.equal(run.snapshot().scriptCommandReceipts[0].commands[0].method,'fill');
});

test('missing, partial, invalid and failed script metadata remain explicit without invented success',()=>{
  assert.deepEqual(normalizeScriptCommandEvidence(undefined),{status:'unknown',commands:[],omitted:null,reason:'script_command_receipt_invalid'});
  const metadata=normalizeScriptCommandEvidence({commands:[
    {method:'fill',state:'returned',actionIssued:true},
    {method:'press',state:'failed',actionIssued:false,reason:'script_timeout'},
    {method:'PRIVATE_METHOD',state:'PRIVATE_STATE',actionIssued:'true',reason:'PRIVATE_REASON'},
  ],omitted:2});
  assert.equal(metadata.status,'unknown');assert.equal(metadata.omitted,2);
  assert.deepEqual(metadata.commands[1],{method:'press',state:'failed',actionIssued:false,reason:'script_timeout'});
  assert.deepEqual(metadata.commands[2],{method:'unsupported',state:'unknown',actionIssued:null});
  assert(!JSON.stringify(metadata).includes('PRIVATE'));
  const run=createReviewExecution({taskStartObserved:false}), id=run.record('run_playwright');
  run.complete(id,{error:'cancelled',actionIssued:true,execution:{commands:[{method:'fill',state:'failed',actionIssued:true,reason:'cancelled'}],omitted:0}});
  assert.equal(run.snapshot().scriptCommandReceipts[0].outcome,'error');
  assert.equal(run.snapshot().scriptCommandReceipts[0].commands[0].state,'failed');
  assert.equal(run.snapshot().taskStartObserved,false);
});

test('script dispatch and command retention is bounded and missing coverage cannot be erased',()=>{
  const run=createReviewExecution({taskStartObserved:true});
  for(let i=0;i<66;i++)run.complete(run.record('run_playwright'),scriptResult());
  const ledger=run.snapshot();assert.equal(ledger.scriptCommandReceipts.length,64);
  assert.equal(ledger.scriptCommandReceiptsOmitted,2);assert.equal(ledger.calls[0].count,66);
  const metadata=normalizeScriptCommandEvidence({commands:Array.from({length:35},()=>({method:'inputValue',state:'returned',actionIssued:false})),omitted:4});
  assert.equal(metadata.commands.length,32);assert.equal(metadata.omitted,7);
  assert.equal(normalizeScriptCommandEvidence({commands:[],omitted:-1}).status,'unknown');
  assert.equal(normalizeScriptCommandEvidence({commands:[{}],omitted:Number.MAX_SAFE_INTEGER}).status,'unknown');
});

test('E01 historical fill and press remain in final review after their live observations are superseded',async()=>{
  const {runAgent}=await import('../agent-runtime.js');
  const {browserTools,BUILTIN_SKILLS}=await import('../skills.js');
  const tools=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent'));
  const call=(name,args)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
  const operations=[['run_playwright',{code:'await browser.ref("query").fill("museum");'}],
    ['verify_page',{checks:[{kind:'field_value',ref:'query',expected:'museum'}]}],
    ['run_playwright',{code:'await browser.ref("query").press("Enter");'}],
    ['verify_page',{checks:[{kind:'text_present',expected:'museum'}]}],['hover_element',{ref:'menu'}]];
  let round=0, scripts=0, reviewed=false;
  const observation={url:'https://search.example.test/',frames:[{text:'museum result',elements:[]}]};
  await runAgent({messages:[{role:'user',content:'Type museum into search and inspect the results.'}],tools,
    harness:true,signal:new AbortController().signal,
    complete:async()=>round<operations.length?{calls:[call(...operations[round++])]}:{content:'Observed search results.'},
    execute:async(name,args)=> name==='run_playwright'?{...scriptResult(scripts++?'press':'fill'),observation}:
      name==='verify_page'?{ok:true,verified:true,checks:args.checks.map(c=>({kind:c.kind,passed:true})),observation}:{ok:true,observation},
    reviewGoal:async payload=>{
      reviewed=true;assert(payload.evidence.filter(e=>e.tool==='run_playwright').every(e=>e.superseded&&!e.usable));
      const review=goalReviewMessages({...payload,goal:'Type museum into search and inspect the results.',history:[],inputBudget:16000});
      const body=JSON.parse(review.messages[1].content),receipt=body.evidence.find(e=>e.result?.dataKind==='host_tool_dispatch');
      assert.equal(receipt.usable,true);assert(body.citeable_evidence_ids.includes(receipt.id));
      assert.deepEqual(receipt.result.scriptCommandReceipts.map(r=>r.commands[0].method),['fill','press']);
      assert(!JSON.stringify(receipt.result).includes('PRIVATE'));
      assert.deepEqual(receipt.result.absenceCertificates,[]);assert.equal(receipt.result.onlyReadOnlyToolsInvoked,undefined);
      // This fixture checks transport of history only. It does not certify
      // the actual target/value or score a successful real-world search.
      return {status:'complete'};
    }});
  assert(reviewed);assert.equal(scripts,2);
});
