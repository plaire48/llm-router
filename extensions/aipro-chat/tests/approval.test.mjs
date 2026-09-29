import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalTarget, approvalPresentation} from '../browser-approval.js';
import {questionAnswer, questionContext} from '../user-question.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
const node = (label, extra={}) => ({innerText:label,getAttribute:()=>null,closest(){return this;},matches:()=>false,...extra});
test('final controls require approval while draft saves and ordinary editor actions do not',()=>{
  for(const [label,action] of [['등록','등록'],['배포','배포'],['게시하기','게시'],['Send','발송'],['저장','저장'],['삭제','삭제']]) assert.equal(approvalTarget(node(label)).action,action);
  for(const label of ['임시 저장','초안 저장','Save draft','Preview','메일 쓰기','굵게']) assert.equal(approvalTarget(node(label)),null);
  assert.equal(approvalTarget(node('본문'),{method:'press',key:'ControlOrMeta+Enter'}).action,'제출');
  const link = label => node(label, {matches: selector => selector === 'a,[role="link"]'});
  for (const label of ['신청 내역 보기', '등록 화면 열기', '발송 목록', '신청서 작성', 'Open registration form']) assert.equal(approvalTarget(link(label)), null);
  for (const label of ['등록', '발송하기', '신청', '신청 내역 삭제', '발송 목록 삭제']) assert(approvalTarget(link(label)));
});
test('approval names reflect the actual action and keep preparation separate from final submission',()=>{
  for(const [label,action] of [['신청서 제출','제출'],['신청하기','신청'],['신청 내역 삭제','삭제'],['삭제 신청','신청'],['Submit','제출'],['Register','등록'],['Delete registration','삭제'],['보내기','발송']]) {
    const target=approvalTarget(node(label));assert.equal(target.action,action,label);
    assert.deepEqual(approvalPresentation(target),{buttonLabel:label,text:`${action}할까요?`});
  }
  for(const label of ['등록 화면 열기','신청 내역 보기','발송 목록','Open registration form'])assert.equal(approvalTarget(node(label)),null,label);
  for(const label of ['등록 화면 열기','신청 내역 보기'])assert(approvalTarget(node(label,{form:{},type:'submit'})),label);
  for(const label of ['초안 저장 후 게시','등록 후 목록 보기','제출하고 내역 보기'])assert(approvalTarget(node(label)),label);
  assert.deepEqual(approvalPresentation({label:'열기',action:'열기'}),{buttonLabel:'열기',text:'이 동작을 실행할까요?'});
  assert.equal(approvalPresentation({label:'매우 긴 대상 이름 '.repeat(10),action:'삭제'}).buttonLabel,'삭제');
  assert.deepEqual(approvalPresentation({label:'본문',action:'제출',operation:{method:'press',key:'ControlOrMeta+Enter'}}),{buttonLabel:'제출',text:'제출할까요?'});
  for(const label of ['등록 화면 열기','초안 저장','신청 내역 보기']) {
    assert.equal(approvalTarget(node(label),{method:'press',key:'ControlOrMeta+Enter'}).action,'제출');
    assert.equal(approvalTarget(node(label),{method:'press',key:'ControlOrMeta+S'}).action,'저장');
  }
});
test('approval choices are bound to the unanswered question and are not image choices',()=>{
  const question={id:'q',kind:'approval',text:'등록할까요?',action:'등록',preview:[{label:'제목',value:'안내'}],options:[{id:'approve'},{id:'reject'}]};
  assert.equal(questionAnswer(question,{questionId:'q',optionId:'approve'}),'등록을 승인합니다.');
  assert.match(questionContext({question}),/제목: 안내/);
  assert.throws(()=>questionAnswer(question,{questionId:'old',optionId:'approve'}));
  assert.throws(()=>questionAnswer({...question,answer:{text:'승인'}},{questionId:'q',optionId:'approve'}));
});
test('any guarded tool pauses the full agent loop before subsequent calls and goal review',async()=>{
  for(const name of ['request_approval','run_playwright']) {
    const executed=[],steps=[];let rounds=0;
    const result=await runAgent({messages:[{role:'user',content:'이 페이지에 안내 글을 작성해줘'}],tools:browserTools({},BUILTIN_SKILLS[0]),harness:true,signal:new AbortController().signal,onStep:s=>steps.push(s),
      complete:async()=>{rounds++;return{content:'',calls:[{id:'a',type:'function',function:{name,arguments:JSON.stringify(name==='request_approval'?{ref:'e1'}:{code:'await page.getByRole("button",{name:"등록"}).click();'})}},{id:'b',type:'function',function:{name:'run_playwright',arguments:JSON.stringify({code:'console.log("must not run")'})}}]};},
      execute:async name=>{executed.push(name);return{requiresUserInput:true,questionId:'q'};},reviewGoal:async()=>{throw Error('Must pause');}});
    assert.deepEqual(executed,[name]);assert.equal(rounds,1);assert.equal(result.awaitingUser,true);assert(steps.some(s=>s.status==='waiting'));
  }
});

test('informational payment links do not request payment but real commits stay guarded', () => {
  const link = label => node(label, {matches: selector => selector === 'a,[role="link"]'});
  for (const label of ['추가요금 결제 안내', '구매 안내 보기', '신청 안내 열기']) {
    assert.equal(approvalTarget(link(label)), null);
    assert(approvalTarget({...link(label), form: {}, type: 'submit'}));
    assert.equal(approvalTarget(link(label), {method:'press', key:'ControlOrMeta+Enter'}).action, '제출');
  }
  for (const label of ['결제', '결제하기', '결제하고 안내', '구매 후 안내', '신청 및 안내', '안내 발송']) assert(approvalTarget(link(label)), label);
  assert(approvalTarget(node('결제 안내')), 'Ambiguous non-link controls retain approval');
});


test('application settings is preparation, while form submission and combined actions still require approval',()=>{
 assert.equal(approvalTarget(node('신청 설정')),null);
 assert(approvalTarget({...node('신청 설정'),form:{},type:'submit'}));
 assert(approvalTarget(node('신청하고 설정')));
 assert(approvalTarget(node('설정 저장')));
});

// Reported from a company work system: its "최종 반영" button commits the week's
// time sheet, and it was not treated as a final action.
test('commit verbs of company work systems require approval, their menus do not', () => {
  for (const [label, action] of [['최종 반영', '반영'], ['반영하기', '반영'], ['일괄 승인', '승인'], ['승인', '승인'], ['Approve', '승인'], ['확정', '확정'], ['결재', '결재'], ['결재 상신', '상신'], ['승인 요청', '상신']])
    assert.equal(approvalTarget(node(label))?.action, action, label);
  for (const label of ['승인 현황', '반영 이력', '결재 문서함', '확정 내역 보기', '승인 대기 목록']) assert.equal(approvalTarget(node(label)), null, label);
  assert.deepEqual(approvalPresentation(approvalTarget(node('최종 반영'))), {buttonLabel: '최종 반영', text: '반영할까요?'});
});

// Measured on a mail app: opening a mail whose subject held an action word was
// held for approval, and so was every retry with Enter.
test('a link or a clickable row is an action only when its short caption ends with the verb', () => {
  const as = selector => label => node(label, {matches: value => value.split(',').includes(selector)});
  const link = as('a'), row = as('div'), item = as('li'), button = as('button');
  for (const label of ['[인사] 10월 교육 신청 안내', '휴가 신청서 제출 요청 드립니다', '보낸사람41 업무 메일 제목 41 09/28', '회의실 예약 등록 확인 메일']) {
    assert.equal(approvalTarget(link(label)), null, label); assert.equal(approvalTarget(row(label)), null, label); assert.equal(approvalTarget(item(label)), null, label);
    assert.equal(approvalTarget(link(label), {method: 'press', key: 'Enter'}), null, `Enter on ${label}`);
  }
  for (const [label, action] of [['삭제', '삭제'], ['신청하기', '신청'], ['신청 내역 삭제', '삭제'], ['최종 반영', '반영']]) {
    assert.equal(approvalTarget(link(label))?.action, action, label); assert.equal(approvalTarget(row(label))?.action, action, label);
  }
  // A long row caption that ends with a verb still describes the row.
  assert.equal(approvalTarget(row('9월 22일 인사팀 공지 교육 참가자 명단 등록')), null);
  // Buttons keep the full rule.
  for (const label of ['초안 저장 후 게시', '휴가 신청서 제출', '등록 후 목록 보기']) assert(approvalTarget(button(label)), label);
});
