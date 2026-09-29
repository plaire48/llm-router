import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptInputWitness,normalizeScriptInputReceipt} from '../browser-script-receipt.js';
import {normalizeScriptCommandEvidence} from '../review-execution.js';
import {keyboardInput} from '../browser-keyboard.js';

const target=()=>({tabId:3,frameId:0,topDocumentId:'doc',documentId:'doc',controlId:'node-1',
  role:'textbox',name:'Search',tag:'input',type:'search'});
async function fixture(overrides={}) {
  let observed=target(),value='museum',cancelled=false,reads=0;
  const witness=await createScriptInputWitness({method:'fill',value:'museum',captureTarget:async()=>structuredClone(observed),
    readMatch:async expected=>{reads++;return value===expected;},cancelled:()=>cancelled,...overrides});
  return {witness,setTarget:t=>{observed=t;},setValue:v=>{value=v;},cancel:()=>{cancelled=true;},reads:()=>reads};
}
test('fill witness attributes issued input and stable readback without retaining values or current ref authority',async()=>{
  const f=await fixture();await f.witness.beforeIssued();f.witness.onIssued();
  const r=await f.witness.finish('returned');assert.equal(r.target.controlId,'node-1');
  assert.equal(r.targetStatus,'observed');assert.equal(r.readback.matchesExpected,true);
  assert.match(r.readback.expectedDigest,/^[a-f0-9]{64}$/);assert.equal(f.reads(),2);
  assert(!JSON.stringify(r).includes('museum'));assert.equal(r.target.ref,undefined);assert.equal(r.allowed,undefined);
});
test('a mismatch is an observed negative, never successful retained input',async()=>{
  const f=await fixture();await f.witness.beforeIssued();f.witness.onIssued();f.setValue('other');
  const r=await f.witness.finish('returned');assert.equal(r.readback.status,'observed');assert.equal(r.readback.matchesExpected,false);
  assert(!JSON.stringify(r).includes('other'));
});
test('stale documents, replaced equal-label controls, unsafe targets and unknown identity fail closed',async()=>{
  for(const alter of [t=>({...t,documentId:'new'}),t=>({...t,topDocumentId:'new'}),t=>({...t,controlId:'node-2'}),
    t=>({...t,tag:'div',type:'contenteditable'}),t=>({...t,type:'password'}),t=>({...t,documentId:null})]) {
    const f=await fixture();await f.witness.beforeIssued();f.witness.onIssued();f.setTarget(alter(target()));
    const r=await f.witness.finish('returned');assert.equal(r.readback.status,'unknown');assert.equal(r.readback.expectedDigest,undefined);
  }
  const f=await fixture({captureTarget:async()=>null});await f.witness.beforeIssued();f.witness.onIssued();
  assert.equal((await f.witness.finish('returned')).targetStatus,'unknown');
});
test('cancellation and failed fill cannot produce a successful readback or cause another action',async()=>{
  for(const state of ['failed','started']) {
    const f=await fixture();await f.witness.beforeIssued();f.witness.onIssued();
    const r=await f.witness.finish(state);assert.equal(r.readback.status,'unknown');assert.equal(f.reads(),0);
  }
  const f=await fixture();await f.witness.beforeIssued();f.witness.onIssued();f.cancel();
  const r=await f.witness.finish('returned');assert.equal(r.readback.status,'unknown');assert.equal(f.reads(),0);
});
test('value/document changes during readback never certify a stable retained value',async()=>{
  let reads=0,captures=0;
  const f=await fixture({captureTarget:async()=>{captures++;return captures===3?{...target(),controlId:'replacement'}:target();},
    readMatch:async()=>{reads++;return true;}});
  await f.witness.beforeIssued();f.witness.onIssued();assert.equal((await f.witness.finish('returned')).readback.status,'unknown');assert.equal(reads,1);
  let pass=true;
  const g=await fixture({readMatch:async()=>{pass=!pass;return pass;}});
  await g.witness.beforeIssued();g.witness.onIssued();assert.equal((await g.witness.finish('returned')).readback.status,'unknown');
});
test('only bounded ordinary fills and exact Enter have this certificate; no-op metadata is not issuance',async()=>{
  for(const options of [{method:'appendText',value:'x'},{method:'fill',value:'x'.repeat(513)},
    {method:'press',key:'Control+Enter'},{method:'pressSequentially',value:'x'}]) assert.equal(await createScriptInputWitness(options),null);
  const f=await fixture();await f.witness.beforeIssued();const r=await f.witness.finish('returned');
  assert.equal(r.actionIssued,false);assert.equal(r.targetStatus,'unknown');assert.equal(r.readback.status,'unknown');
  const w=await createScriptInputWitness({method:'press',key:'Enter',captureTarget:async()=>target()});
  await w.beforeIssued();w.onIssued();const key=await w.finish('returned');assert.equal(key.key,'Enter');assert.equal(key.readback,undefined);
});
test('command sanitizer accepts only matching host input certificates and discards forged script results',async()=>{
  const f=await fixture();await f.witness.beforeIssued();f.witness.onIssued();const r=await f.witness.finish('returned');
  const command={method:'fill',state:'returned',actionIssued:true,inputReceipt:{...r,value:'PRIVATE_VALUE',allowed:true}};
  const kept=normalizeScriptCommandEvidence({commands:[command],omitted:0,result:{inputReceipt:{...r,value:'PRIVATE_RETURN'}}});
  assert(kept.commands[0].inputReceipt.readback.matchesExpected);assert(!JSON.stringify(kept).includes('PRIVATE'));
  assert.equal(kept.commands[0].inputReceipt.allowed,undefined);
  assert.equal(normalizeScriptInputReceipt(r,{...command,actionIssued:false}),null);
  assert.equal(normalizeScriptInputReceipt(r,{...command,method:'press'}),null);
  assert.equal(normalizeScriptInputReceipt({...r,target:{...r.target,type:'password'}},command).targetStatus,'unknown');
  assert.equal(normalizeScriptCommandEvidence({commands:[{...command,inputReceipt:undefined}],omitted:0,result:{inputReceipt:r}}).commands[0].inputReceipt,undefined);
  assert.equal(normalizeScriptInputReceipt(r,{...command,state:'failed'}).readback.status,'unknown');
});

function keyboardFixture() {
  let state={connected:true,hidden:false,secret:false,disabled:false,editable:true,focused:false,type:'search',name:'Search'},pressed=[];
  const handle={evaluate:async()=>({...state}),focus:async()=>{state.focused=true;}};
  const page={keyboard:{press:async key=>pressed.push(key)}};
  return {handle,page,pressed,change:fields=>Object.assign(state,fields)};
}
test('Enter beforeIssued hook rechecks focus, cancellation and document detachment before native issuance',async()=>{
  for(const failure of ['focus','document','cancel']) {
    const f=keyboardFixture();let cancelled=false,issued=0;
    await assert.rejects(keyboardInput(f.handle,f.page,'press','Enter',{},
      {beforeIssued:async()=>{if(failure==='focus')f.change({focused:false});if(failure==='document')f.change({connected:false});if(failure==='cancel')cancelled=true;},
        cancelled:()=>cancelled,onIssued:()=>issued++}),failure==='focus'?/script_focus/:failure==='document'?/browser_stale/:/cancelled/);
    assert.deepEqual(f.pressed,[]);assert.equal(issued,0);
  }
  const f=keyboardFixture();let observed=0,issued=0;
  await keyboardInput(f.handle,f.page,'press','Enter',{}, {beforeIssued:async()=>{observed++;},onIssued:()=>issued++});
  assert.equal(observed,1);assert.equal(issued,1);assert.deepEqual(f.pressed,['Enter']);
});
test('a partial Enter failure retains attempted native issuance but never certifies successful submission',async()=>{
  const f=keyboardFixture();
  const witness=await createScriptInputWitness({method:'press',key:'Enter',captureTarget:async()=>target()});
  f.page.keyboard.press=async()=>{throw new Error('native_response_lost');};
  await assert.rejects(keyboardInput(f.handle,f.page,'press','Enter',{},
    {beforeIssued:()=>witness.beforeIssued(),onIssued:()=>witness.onIssued()}),/native_response_lost/);
  const receipt=await witness.finish('failed');assert.equal(receipt.actionIssued,true);assert.equal(receipt.key,'Enter');
  const commands=normalizeScriptCommandEvidence({commands:[{method:'press',state:'failed',actionIssued:true,inputReceipt:receipt,reason:'script_failed'}],omitted:0});
  assert.equal(commands.commands[0].state,'failed');assert.equal(commands.commands[0].inputReceipt.readback,undefined);
  assert.equal(commands.commands[0].inputReceipt.success,undefined);
  assert.equal(normalizeScriptInputReceipt({...receipt,key:'Control+Enter'},commands.commands[0]),null);
});
