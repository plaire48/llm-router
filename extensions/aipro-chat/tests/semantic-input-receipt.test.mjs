import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptInputWitness} from '../browser-script-receipt.js';
import {createReviewExecution} from '../review-execution.js';
import {goalReviewMessages} from '../goal-review.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools,BUILTIN_SKILLS} from '../skills.js';
const target={tabId:11,frameId:0,topDocumentId:'doc-before',documentId:'doc-before',controlId:'node-1',role:'textbox',name:'Search',tag:'input',type:'search'};
async function filled(value='actual wrong query', options={}) {
  const witness=await createScriptInputWitness({method:'fill',value,captureTarget:async()=>options.target===undefined?target:options.target,
    readMatch:async()=>options.matches!==false,cancelled:()=>options.cancelled===true});
  await witness.beforeIssued();witness.onIssued();
  const inputReceipt=await witness.finish(options.state||'returned');
  return {ok:true,verified:true,actionIssued:true,applied:1,matched:1,inputExecution:{commands:[{method:'fill',state:options.state||'returned',actionIssued:true,inputReceipt}],omitted:0}};
}
const args=value=>({fields:[{field_id:'observed-ref',value}]});
test('host digest binds the actual entered argument only in the review view, without deciding whether it was requested',async()=>{
  const run=createReviewExecution({taskStartObserved:true}),id=run.record('fill_form'),result=await filled();
  run.complete(id,result);assert(await run.bindInputArguments(id,args('actual wrong query')));
  const normal=JSON.stringify(run.snapshot()), review=run.reviewSnapshot();
  assert(!normal.includes('actual wrong query'));assert.equal(review.historicalInputValues[0].value,'actual wrong query');
  assert.equal(review.historicalInputValues[0].dispatchId,id);assert.equal(review.semanticInputReceipts[0].commands[0].inputReceipt.target.documentId,'doc-before');
  assert.equal(review.onlyReadOnlyToolsInvoked,false);assert.equal(review.allPageInteractionTargetsObserved,false);assert.equal(review.noPageInteractionToolsInvoked,false);
  assert.equal(review.historicalInputValues[0].requestedMatch,undefined);
  result.inputExecution.commands[0].inputReceipt.target.documentId='caller-mutated';
  review.historicalInputValues[0].value='changed';
  assert.equal(run.reviewSnapshot().historicalInputValues[0].value,'actual wrong query');
  assert.equal(run.reviewSnapshot().semanticInputReceipts[0].commands[0].inputReceipt.target.documentId,'doc-before');
});
test('different argument, unknown, protected, cancelled, partial and unverified writes cannot retain argument text',async()=>{
  const changes=[r=>r, r=>{r.error='fill_not_retained';},r=>{r.cancelled=true;},r=>{r.verified=false;},r=>{r.matched=0;},
    r=>{r.applied=2;},r=>{r.recovery={execution:'unknown'};},r=>{r.unresolvedAction={kind:'unknown_write'};},
    r=>{r.inputExecution.omitted=1;},r=>{r.inputExecution.commands[0].state='failed';},
    r=>{r.inputExecution.commands[0].inputReceipt.target.type='password';},r=>{r.inputExecution.commands[0].inputReceipt.readback.matchesExpected=false;}];
  for(let i=0;i<changes.length;i++) {
    const run=createReviewExecution({taskStartObserved:true}),id=run.record('fill_form'),result=await filled();changes[i](result);run.complete(id,result);
    assert.equal(await run.bindInputArguments(id,args(i===0?'different query':'actual wrong query')),false,`case ${i}`);
    assert.deepEqual(run.reviewSnapshot().historicalInputValues,[]);
  }
  for(const options of [{target:null},{target:{...target,documentId:''}},{cancelled:true},{state:'failed'}]) {
    const run=createReviewExecution({taskStartObserved:true}),id=run.record('fill_form');run.complete(id,await filled('actual wrong query',options));
    assert.equal(await run.bindInputArguments(id,args('actual wrong query')),false);assert.deepEqual(run.reviewSnapshot().historicalInputValues,[]);
  }
});
test('missing dispatches, replayed completion and bounded omissions cannot acquire review-only values',async()=>{
  const run=createReviewExecution({taskStartObserved:true});assert.equal(await run.bindInputArguments(7,args('actual wrong query')),false);
  for(let i=0;i<65;i++){const id=run.record('fill_form');run.complete(id,await filled());await run.bindInputArguments(id,args('actual wrong query'));}
  assert.equal(run.snapshot().semanticInputReceipts.length,64);assert.equal(run.snapshot().semanticInputReceiptsOmitted,1);
  assert.equal(run.reviewSnapshot().historicalInputValues.length,64);
  assert.equal(run.complete(1,await filled('new')),false);assert.equal(await run.bindInputArguments(1,args('new')),false);
});
test('Enter preserves historical target issuance and never creates search success or current value',async()=>{
  const run=createReviewExecution({taskStartObserved:true}),id=run.record('press_key');
  const witness=await createScriptInputWitness({method:'press',key:'Enter',captureTarget:async()=>target});await witness.beforeIssued();witness.onIssued();
  run.complete(id,{ok:true,actionIssued:true,inputExecution:{commands:[{method:'press',state:'returned',actionIssued:true,inputReceipt:await witness.finish('returned')}],omitted:0}});
  assert.equal(await run.bindInputArguments(id,args('value')),false);
  const r=run.reviewSnapshot();assert.equal(r.semanticInputReceipts[0].commands[0].inputReceipt.key,'Enter');
  assert.deepEqual(r.historicalInputValues,[]);assert.equal(r.semanticInputReceipts[0].searchSucceeded,undefined);assert.equal(r.onlyReadOnlyToolsInvoked,false);
});

test('actual runtime keeps verified input in review after navigation invalidates the old DOM, with current results separate',async()=>{
  const tools=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')).filter(t=>t.function.name!=='update_plan');
  const original='Search for requested query. Read only; do not register.', value='actual wrong query';
  const before={tabId:11,topDocumentId:'doc-before',url:'https://example.test/',frames:[{frame:0,documentId:'doc-before',text:'Before search',elements:[{ref:'observed-ref',role:'textbox',name:'Search',id:'query'}]}]};
  const after={tabId:11,topDocumentId:'doc-after',url:'https://example.test/results',frames:[{frame:0,documentId:'doc-after',text:'Results for actual wrong query',elements:[]}]};
  const call=(name,a={})=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(a)}}]});
  let round=0,reviewed=0;
  const result=await runAgent({messages:[{role:'user',content:original}],tools,signal:new AbortController().signal,harness:true,
    complete:async()=>{round++;if(round===1)return call('read_page');if(round===2)return call('fill_form',args(value));if(round===3)return call('verify_page',{checks:[{kind:'field_value',ref:'observed-ref',expected:value}]});if(round===4)return call('navigate_page',{url:'https://example.test/results'});if(round===5)return call('verify_page',{checks:[{kind:'text_present',expected:'Results'}]});return {content:'Done',calls:null};},
    execute:async name=>name==='verify_page'?{ok:true,verified:true,observation:round===3?before:after}:name==='ask_user'?{requiresUserInput:true}:name==='read_page'?before:name==='fill_form'?{...await filled(value),observation:before}:{ok:true,observation:after},
    reviewGoal:async request=>{
      reviewed++;assert.equal(request.executionLedger.historicalInputValues[0].value,value);
      const old=request.evidence.find(e=>e.tool==='fill_form');assert.equal(old.superseded,true);
      const messages=goalReviewMessages({...request,goal:original,history:[],inputBudget:22000});
      const payload=JSON.parse(messages.messages[1].content),ledger=payload.evidence.find(e=>e.tool==='execution_receipt');
      assert.equal(ledger.result.historicalInputValues[0].value,value);
      assert.equal(ledger.result.semanticInputReceipts[0].commands[0].inputReceipt.target.documentId,'doc-before');
      assert.equal(payload.evidence.find(e=>e.tool==='fill_form').usable,false);
      assert(JSON.stringify(payload).includes('doc-after'));
      // The only dispatched input went to an observed search field; the certificate states that and nothing about the query text.
      assert.deepEqual(ledger.result.absenceCertificates,['only_search_input_and_link_navigation_dispatched']);assert.equal(ledger.result.onlyReadOnlyToolsInvoked,undefined);assert.equal(ledger.result.searchAndReadOnly,undefined);
      return {status:'blocked',checks:[{requirement:'Requested query',status:'unmet',evidence_ids:[ledger.id]}],next_step:'The actual query differs. Continue with the requested query?'};
    }});
  assert.equal(reviewed,1);assert.equal(result.awaitingUser,true);assert.equal(result.content,'');
});

test('review-only input text has a bounded additive budget and omissions cannot masquerade as known values',async()=>{
  const run=createReviewExecution({taskStartObserved:true}),id=run.record('fill_form'),value='x'.repeat(512),result=await filled(value);
  result.inputExecution.commands=Array.from({length:20},()=>structuredClone(result.inputExecution.commands[0]));result.applied=result.matched=20;
  run.complete(id,result);
  assert.equal(await run.bindInputArguments(id,{fields:Array.from({length:20},(_,i)=>({field_id:'r'+i,value}))}),false);
  assert.deepEqual(run.reviewSnapshot().historicalInputValues,[]);assert.equal(run.reviewSnapshot().historicalInputValuesOmitted,20);
  assert(!JSON.stringify(run.snapshot()).includes(value));assert.equal(run.snapshot().historicalInputValuesOmitted,undefined);
});
