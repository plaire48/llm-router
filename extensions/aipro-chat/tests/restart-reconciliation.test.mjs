import test from 'node:test';
import assert from 'node:assert/strict';
import {reconciliationProof,unresolvedReconciliations,reconcilesProofs} from '../restart-reconciliation.js';
import {taskReceipt,pauseTask} from '../context-state.js';
const observation={url:'https://work.test/form',tabId:101,topDocumentId:'document-a',frames:[{frame:0,documentId:'document-a',url:'https://work.test/form',elements:[{ref:'old',role:'textbox',name:'본문',id:'body',tag:'input'}]}]};
const args={fields:[{field_id:'old',value:'private fixture text'}]};
test('restart proof stores fingerprints and only fresh matching target/value checks reconcile it',async()=>{
  const proof=await reconciliationProof('fill_form',args,observation);
  assert.ok(proof);assert(!JSON.stringify(proof).includes('private'));assert(!JSON.stringify(proof).includes('old'));
  const fresh=structuredClone(observation);fresh.frames[0].elements[0].ref='new';
  const check={kind:'field_value',ref:'new',expected:args.fields[0].value};
  assert.equal(await reconcilesProofs([proof],[check],fresh),true);
  assert.equal(await reconcilesProofs([proof],[{...check,expected:'wrong'}],fresh),false);
  assert.equal(await reconcilesProofs([proof],[{kind:'text',expected:'success'}],fresh),false);
  fresh.frames[0].url='https://work.test/different';
  assert.equal(await reconcilesProofs([proof],[check],fresh),false);
});
test('pending proof survives worker pause, JSON reload and more than 32 read receipts',async()=>{
  const proof=await reconciliationProof('fill_form',args,observation);
  let task=pauseTask(taskReceipt({steps:[]},'fill_form','start',{reconciliation:proof}));
  task=JSON.parse(JSON.stringify(task));
  for(let n=0;n<40;n++){task=taskReceipt(task,'browser_snapshot','start');task=taskReceipt(task,'browser_snapshot','end',{ok:true});}
  assert.equal(task.steps.length,32);assert.deepEqual(unresolvedReconciliations(task),[proof]);
  task=taskReceipt(task,'verify_page','start');
  task=taskReceipt(task,'verify_page','end',{ok:true,verified:true,checks:[{passed:true}]});
  assert.deepEqual(unresolvedReconciliations(task),[proof],'generic verification cannot clear unknown writes');
  task=taskReceipt(task,'verify_page','start');
  task=taskReceipt(task,'verify_page','end',{ok:true,verified:true,reconciledAction:true,checks:[{passed:true}]});
  assert.deepEqual(unresolvedReconciliations(task),[]);
});
test('known returned and unissued inputs release proofs; lost or cancelled receipts retain them',async()=>{
  const proof=await reconciliationProof('fill_form',args,observation);
  for(const result of [{ok:true},{error:'missing',actionIssued:false}]) {
    const task=taskReceipt(taskReceipt({steps:[]},'fill_form','start',{reconciliation:proof}),'fill_form','end',result);
    assert.deepEqual(unresolvedReconciliations(task),[]);
  }
  for(const result of [{error:'cancelled'},{error:'script_timeout',actionIssued:true}]) {
    const task=taskReceipt(taskReceipt({steps:[]},'fill_form','start',{reconciliation:proof}),'fill_form','end',result);
    assert.deepEqual(unresolvedReconciliations(task),[proof]);
  }
});
test('an uncertain write without a scoped proof remains blocked after restart',()=>{
 const marker={version:2,unverifiable:true};
 const task=pauseTask(taskReceipt({steps:[]},'fill_form','start',{reconciliation:marker}));
 assert.deepEqual(unresolvedReconciliations(task),[marker]);
 assert.equal(unresolvedReconciliations({steps:[{tool:'fill_form',status:'unknown'}]})[0].version,2);
 assert.equal(unresolvedReconciliations(taskReceipt(task,'verify_page','end',{ok:true,verified:true,checks:[{passed:true}]}))[0].version,2);
});
test('ambiguous or incomplete control observations cannot mint a durable proof',async()=>{
  const ambiguous=structuredClone(observation);ambiguous.frames[0].elements.push({...ambiguous.frames[0].elements[0],ref:'duplicate'});
  assert.equal(await reconciliationProof('fill_form',args,ambiguous),null);
  assert.equal(await reconciliationProof('fill_form',args,{...observation,frames:[{...observation.frames[0],truncated:true}]}),null);
});
test('persisted proof rejects another tab, another document and observations without host scope',async()=>{
 const proof=await reconciliationProof('fill_form',args,observation);
 const check={kind:'field_value',ref:'new',expected:args.fields[0].value};
 for(const change of [next=>{next.tabId=202;},next=>{next.topDocumentId='document-b';next.frames[0].documentId='document-b';},next=>{delete next.topDocumentId;}]){
  const fresh=structuredClone(observation);fresh.frames[0].elements[0].ref='new';change(fresh);
  assert.equal(await reconcilesProofs([proof],[check],fresh),false);
 }
});
