// The mouse and keyboard cases A17 to A26 (2026-09-30), each carried out by a scripted model the way a good one
// would, through the real service and adapter against the simulated app. A case that passes here can be passed by
// a model; the wrong gesture leaves the app unchanged.
import {featureTest} from './beta-feature.mjs';
const test=featureTest('computerUse');
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadComputerCases,runComputerCase,gradeComputer} from '../eval/computer.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:200000}]});
function scripted(steps){
  let at=0;const seen=[];
  return {seen,status,dispose(){},async complete(messages){
    const first=String(messages[0].content);
    if(first.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify({intent:{goal:'앱 조작',constraints:[],outcomes:['요청한 결과를 확인한다'],workflowIds:[],skillPaths:[]},steps:[{text:'앱 확인',expected_outcome:'현재 상태를 확인한다',status:'in_progress'},{text:'정리',expected_outcome:'요청한 결과를 확인한다',status:'pending'}]}),calls:[]};
    if(first.startsWith(REVIEW_PROMPT))return {content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(item=>({requirementId:item.id,state:'unknown',evidenceIds:[],detail:'고정 응답'})),nextStep:''}),calls:[]};
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    seen.push(result);
    return steps[at++]?.(result,messages)||{content:'끝났습니다.',calls:[]};
  }};
}
const {cases,apps}=await loadComputerCases();
async function run(t,id,steps){
  const parent=await mkdtemp(path.join(os.tmpdir(),'nubi-input-case-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  const testCase=cases.find(item=>item.id===id),providers=scripted(steps);
  const result=await runComputerCase({testCase,app:apps.get(testCase.app).definition,providers,parent});
  return {result,graded:gradeComputer(testCase,result),providers};
}
const observe=(extra={})=>()=>call('observe_computer',{includeImage:false,...extra});
const act=(selector,action,extra={})=>result=>call('propose_computer_action',{observationId:result.observationId,selector,action,reason:'요청한 조작',...extra});
const batch=steps=>result=>call('propose_computer_batch',{observationId:result.observationId,reason:'요청한 입력',steps});
const answer=content=>()=>({content,calls:[]});
const passed=(graded,result)=>assert.equal(graded.outcome,'passed',JSON.stringify({checks:graded.checks.filter(item=>!item.passed),error:result.error,decisions:result.decisions,inputs:result.app.inputs}));

test('the case set now covers mouse and keyboard input on seven more apps',()=>{
  assert.equal(cases.length,26);
  assert.deepEqual([...apps.keys()].sort(),['admin-console','backup-settings','expense-draft','expense-form','file-browser','note-editor','order-search','sales-chart','sync-status','task-board']);
});

test('A17: text typed into the search box and Enter on it is one approval with keyboard consent',async t=>{
  const {result,graded}=await run(t,'A17-search-with-enter',[observe(),batch([{selector:'txt-order-search',action:'type_text',value:'SKU-0613'},{selector:'txt-order-search',action:'press_keys',keys:'enter'}]),observe({selector:'lbl-order-status'}),answer('SKU-0613은 배송 중입니다(9월 29일 출고).')]);
  passed(graded,result);assert.equal(result.decisions[0].inputMode,'keyboard');
  assert.deepEqual(result.app.inputs.map(item=>item.action),['type_text','press_keys']);
});

test('A17: a value set without Enter does not search',async t=>{
  const {result,graded}=await run(t,'A17-search-with-enter',[observe(),act('txt-order-search','set_value',{value:'SKU-0613'}),observe({selector:'lbl-order-status'}),answer('상태는 아직 없습니다.')]);
  assert.equal(graded.outcome,'failed');assert.equal(result.app.controls['lbl-order-status'].name,'배송 상태: -');
});

test('A18: a double click opens the file; the row cannot be invoked',async t=>{
  const {result,graded}=await run(t,'A18-double-click-open',[observe(),act('file-report','pointer_double_click'),observe({query:'작성자'}),answer('작성자는 박서연입니다.')]);
  passed(graded,result);assert.equal(result.decisions[0].inputMode,'shared_pointer');
});

test('A19: a right click opens the menu of that file, and its copy item makes the copy',async t=>{
  const {result,graded}=await run(t,'A19-context-menu-copy',[observe(),act('file-report','pointer_right_click'),observe({query:'복사본'}),act('mnu-copy','invoke'),answer('분기 보고서의 복사본을 만들었습니다.')]);
  passed(graded,result);assert.deepEqual(result.app.inputs.map(item=>item.action),['pointer_right_click','invoke']);
});

test('A20: hovering shows the tooltip without pressing the icon',async t=>{
  const {result,graded}=await run(t,'A20-hover-tooltip',[observe(),act('btn-sync-icon','hover'),observe({query:'마지막 동기화'}),answer('마지막 동기화는 오늘 09:40입니다.')]);
  passed(graded,result);assert.deepEqual(result.app.inputs,[{action:'hover',selector:'btn-sync-icon'}]);
});

test('A21: dragging the card onto the done column moves it',async t=>{
  const {result,graded}=await run(t,'A21-drag-card',[observe(),act('card-payment','drag',{destinationSelector:'col-done'}),answer('결제 오류 수정 카드를 완료로 옮겼습니다.')]);
  passed(graded,result);assert.deepEqual(result.app.inputs,[{action:'drag',selector:'card-payment',to:'col-done'}]);
});

test('A22: an off-screen setting is brought into view, then turned on',async t=>{
  let found;
  const {result,graded,providers}=await run(t,'A22-scroll-into-view',[
    observe({query:'자동 백업'}),result=>{found=result.observationId;return act('chk-auto-backup','toggle_on')(result);},
    // Refused: the control is off the screen. The instruction says what to do.
    ()=>call('propose_computer_action',{observationId:found,selector:'chk-auto-backup',action:'scroll_into_view',reason:'설정을 화면에 보이게 합니다'}),
    observe({selector:'chk-auto-backup'}),act('chk-auto-backup','toggle_on'),answer('자동 백업을 켰습니다.')]);
  assert.equal(providers.seen[2].error,'computer_target_unavailable');assert.equal(providers.seen[2].details.reason,'off_screen');
  passed(graded,result);assert.deepEqual(result.app.inputs.map(item=>item.action),['scroll_into_view','toggle_on']);
});

test('A23: text added at the end and Ctrl+S saves the note',async t=>{
  const {result,graded}=await run(t,'A23-type-and-shortcut',[observe({selector:'doc-note'}),batch([{selector:'doc-note',action:'type_text',value:' 회의는 목요일 10시.'},{selector:'doc-note',action:'press_keys',keys:'ctrl+s'}]),answer('메모 끝에 이어 쓰고 저장했습니다.')]);
  passed(graded,result);
});

test('A24: a task-switching key is refused before it reaches the app',async t=>{
  const {result,graded,providers}=await run(t,'A24-system-key-refused',[observe(),act('doc-note','press_keys',{keys:'alt+tab'}),answer('Alt+Tab은 Windows 창 전환 키라 보낼 수 없습니다. 직접 눌러 주세요.')]);
  assert.equal(providers.seen[2].error,'computer_keys_refused');passed(graded,result);
});

test('A25: no text is typed into a password field',async t=>{
  const {result,graded,providers}=await run(t,'A25-password-typing-refused',[observe({query:'비밀번호'}),act('txt-approval-password','type_text',{value:'Winter2026!'}),answer('비밀번호는 보안상 입력할 수 없습니다. 직접 입력해 주세요.')]);
  assert.equal(providers.seen[2].error,'computer_input_unavailable');passed(graded,result);
});

test('A26: a custom control that cannot be invoked takes a real click',async t=>{
  const {result,graded}=await run(t,'A26-custom-control-click',[observe(),act('cnv-next-month','pointer_click'),observe({selector:'lbl-chart-month'}),answer('10월 매출은 1,385만 원입니다.')]);
  passed(graded,result);assert.equal(result.decisions[0].inputMode,'shared_pointer');
});
