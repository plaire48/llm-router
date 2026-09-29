// What the approval card of a batch says. The user approves what the card
// shows: every step is listed in order with its control and its value, and
// after the run each step tells what happened to it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {batchView} from '../ui/computer-batch-view.mjs';

const verbs={invoke:'누르기',set_value:'입력',toggle_on:'체크 켜기'};
const step=(index,action,name,more={})=>({index,action,selector:'s'+index,target:{element:{name,type:'Edit'}},...more});
const batch=(state,steps,more={})=>({id:'b',action:'batch',state,steps,...more});

test('a waiting batch lists every step in order with its control and value',()=>{
  const view=batchView(batch('proposed',[step(1,'set_value','메모',{value:'출장 택시비'}),step(2,'toggle_on','긴급 처리'),step(3,'invoke','임시 저장')]),verbs);
  assert.equal(view.title,'묶음 입력 3단계');
  assert.deepEqual(view.steps,[{index:1,label:'입력: 메모',value:'출장 택시비',result:''},{index:2,label:'체크 켜기: 긴급 처리',result:''},{index:3,label:'누르기: 임시 저장',result:''}]);
  assert.match(view.summary,/순서대로 한 번 실행/);assert.match(view.summary,/멈춥니다/);
  const empty=batchView(batch('proposed',[step(1,'set_value','',{value:''}),step(2,'toggle_on','긴급 처리')]),verbs);
  assert.deepEqual(empty.steps[0],{index:1,label:'입력: Edit',value:'',result:''},'an empty value is shown as a value, a control without a name by its type');
});

test('a finished batch tells what happened to each step',()=>{
  const done=batchView(batch('observed',[step(1,'set_value','메모',{value:'a',execution:'command_returned',verification:'value_matched'}),step(2,'toggle_on','긴급 처리',{execution:'already_at_target',verification:'state_matched'}),step(3,'invoke','임시 저장',{execution:'command_returned',verification:'not_verified'})],{verification:'steps_matched'}),verbs);
  assert.deepEqual(done.steps.map(item=>item.result),['입력값 일치','이미 요청한 상태','실행함. 결과는 화면에서 확인']);
  assert.match(done.summary,/업무 결과는 별도로 확인/);
  const partial=batchView(batch('observed',[step(1,'set_value','메모',{value:'a',execution:'command_returned',verification:'value_matched'}),step(2,'toggle_on','긴급 처리',{execution:'not_started',verification:'not_verified'})],{verification:'steps_partial',stopped:{step:2,reason:'computer_target_changed'}}),verbs);
  assert.deepEqual(partial.steps.map(item=>item.result),['입력값 일치','실행하지 않음']);assert.match(partial.summary,/2번째 단계/);assert.match(partial.summary,/실행하지 않았습니다/);
  const mismatch=batchView(batch('attention',[step(1,'set_value','메모',{value:'a',execution:'command_returned',verification:'value_mismatch'}),step(2,'invoke','임시 저장',{execution:'not_started',verification:'not_verified'})],{verification:'steps_mismatch',stopped:{step:1,reason:'value_mismatch'}}),verbs);
  assert.deepEqual(mismatch.steps.map(item=>item.result),['입력값이 요청과 다름','실행하지 않음']);assert.match(mismatch.summary,/실제 앱을 확인/);
  const unknown=batchView(batch('attention',[step(1,'set_value','메모',{value:'a',execution:'unknown',verification:'not_verified'}),step(2,'invoke','임시 저장',{execution:'not_started'})],{error:'computer_outcome_unknown',stopped:{step:1,reason:'computer_outcome_unknown'}}),verbs);
  assert.match(batchView(batch('attention',[step(1,'set_value','메모',{value:'a',execution:'command_returned',verification:'value_matched'}),step(2,'toggle_on','긴급 처리',{execution:'command_returned',verification:'state_matched'})],{verification:'steps_matched',error:'computer_pointer_hide_failed'}),verbs).summary,/표시용 커서/);
  assert.equal(unknown.steps[0].result,'결과를 알 수 없음');assert.match(unknown.summary,/자동으로 반복하지 않습니다/);
});

test('a batch that did not run says why',()=>{
  const steps=[step(1,'set_value','메모',{value:'a',execution:'not_started'}),step(2,'invoke','임시 저장',{execution:'not_started'})];
  assert.match(batchView(batch('stale',steps,{error:'computer_approval_expired'}),verbs).summary,/승인 시간이 지나/);
  assert.match(batchView(batch('stale',steps,{error:'computer_target_changed'}),verbs).summary,/대상이 바뀌어/);
  assert.match(batchView(batch('stale',steps,{error:'wiki_evidence_stale'}),verbs).summary,/근거가 바뀌어/);
  assert.match(batchView(batch('stale',steps,{error:'computer_document_stale'}),verbs).summary,/문서 분석/);
  assert.match(batchView(batch('rejected',steps),verbs).summary,/실행하지 않았습니다/);
  assert.deepEqual(batchView(batch('rejected',steps),verbs).steps.map(item=>item.result),['',''],'steps of a batch that never started carry no result');
});

test('the card shows the steps and keeps them unfolded',async()=>{
  const source=await readFile(new URL('../ui/ComputerUse.jsx',import.meta.url),'utf8');
  assert.match(source,/action\.action==='batch'\)return <BatchCard/);
  const card=source.slice(source.indexOf('function BatchCard'),source.indexOf('function ResultReview'));
  assert.match(card,/view\.steps\.map/);assert.ok(!card.slice(0,card.indexOf('view.steps.map')).includes('<details'),'the steps are not folded away');
  assert.match(card,/decide\('approve'\)/);assert.match(card,/decide\('reject'\)/);assert.ok(!card.includes('pointerConsent'),'a batch never asks for mouse control');
});
