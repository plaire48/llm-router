import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBrowserRecovery} from '../browser-recovery.js';
const image=bytes=>({mimeType:'image/png',imageHash:createHash('sha256').update(bytes).digest('hex')});
const shot=(id,{document='doc',text='Same PDF toolbar',url='https://example.test/rules.pdf'}={})=>({screenshot_id:id,
  attachment:{id,availableInChat:true},capture_mode:'viewport',viewport:{width:631,height:808,scrollX:0,scrollY:0},
  observation:{tabId:4,topDocumentId:document,url,frames:[{frame:0,documentId:document,url,text,elements:[]} ]}});
const capture=(run,result,pixels)=>run.observe('capture_page',{full_page:false},result,run.signature('capture_page',{full_page:false}),pixels);
const click=(run,id,result={error:'browser_stale',reason:'browser_stale',actionIssued:false})=>{
  const args={screenshot_id:id,x:100,y:100};return run.observe('click_at',args,result,run.signature('click_at',args));
};
test('five actual-shape capture/stale-click cycles accumulate despite renewed screenshot and attachment IDs',()=>{
  const run=createBrowserRecovery(),original=[];
  for(let i=1;i<=5;i++) {
    const result=shot(`capture-${i}`),before=structuredClone(result);original.push(result);
    const observed=capture(run,result,image('same bytes'));assert.equal(observed.changed,false);assert.equal(observed.repetitions,i);
    const failure=click(run,result.screenshot_id);assert.equal(failure.changed,false);assert.equal(failure.repetitions,i);
    assert.deepEqual(result,before);assert.match(run.guidance(),new RegExp(`failures without changed evidence: ${i}`));
  }
  assert.notEqual(original[0].screenshot_id,original[4].screenshot_id);
});
test('new actual image bytes, document scope and DOM text remain progress, never just a new opaque ID',()=>{
  for(const change of ['image','document','text','url']) {
    const run=createBrowserRecovery();capture(run,shot('initial'),image('A'));click(run,'initial');
    const result=shot('next',change==='document'?{document:'new-doc'}:change==='text'?{text:'Actual next rule'}:change==='url'?{url:'https://example.test/other.pdf'}:{});
    const next=capture(run,result,image(change==='image'?'B':'A'));assert.equal(next.changed,true,change);assert.equal(next.repetitions,1);
    assert.equal(click(run,'next').repetitions,1);
  }
  const run=createBrowserRecovery();capture(run,shot('same-id'),image('A'));
  assert.equal(capture(run,shot('same-id'),image('B')).changed,true,'same ID does not hide actual bytes changing');
});
test('missing or malformed image evidence is unknown and cannot imply visual change from an ID or claimed payload hash',()=>{
  const run=createBrowserRecovery();
  for(let i=1;i<=5;i++) {
    const result=shot(`capture-${i}`);result.image={mimeType:'image/png',data:'MODEL_CLAIM'};
    const observed=capture(run,result,i%2?undefined:{mimeType:'image/png',imageHash:'not-a-host-digest'});
    assert.equal(observed.changed,false);assert.equal(observed.repetitions,i);
    assert.equal(click(run,result.screenshot_id).repetitions,i);
  }
  const unknown=createBrowserRecovery();
  for(let i=1;i<=3;i++) assert.equal(click(unknown,`unobserved-${i}`).repetitions,i);
});
test('images revisiting A/B do not indefinitely reset failed actions, and disposal drops screenshot associations',()=>{
  const run=createBrowserRecovery();
  for(let i=0;i<6;i++) {
    const p=capture(run,shot('s'+i),image(i%2?'B':'A'));
    if(i>=2)assert.equal(p.changed,false);
    click(run,'s'+i);
  }
  assert.match(run.guidance(),/failures without changed evidence: 5/);
  const known=run.signature('click_at',{screenshot_id:'s5',x:100,y:100});run.dispose();
  assert.notEqual(run.signature('click_at',{screenshot_id:'s5',x:100,y:100}),known);
  assert.equal(click(run,'s5').repetitions,1);
});
test('cancelled captures and unchanged captures cannot clear uncertain-write diagnosis or certify success',()=>{
  const run=createBrowserRecovery();capture(run,shot('s0'),image('same'));
  click(run,'s0',{error:'action_outcome_unknown',actionIssued:true});
  const cancelled={...shot('cancel'),error:'cancelled'};assert.deepEqual(capture(run,cancelled,image('new')),{changed:false,repetitions:0});
  assert.match(run.guidance(),/action_outcome_unknown/);
  for(let i=1;i<4;i++) {capture(run,shot('s'+i),image('same'));assert.match(run.guidance(),/action_outcome_unknown/);}
  assert.equal(run.signature('click_at',{screenshot_id:'cancel'}),run.signature('click_at',{screenshot_id:'unobserved'}));
  const observation=capture(run,shot('s4'),image('same'));assert.equal(observation.verified,undefined);assert.equal(observation.resolvesAction,undefined);
});
test('attachment identifiers remain meaningful outside capture storage bookkeeping',()=>{
  const run=createBrowserRecovery();run.observe('read_document',{}, {attachment:{id:'doc-a'}},'read');
  assert.equal(run.observe('read_document',{}, {attachment:{id:'doc-b'}},'read').changed,true);
});
