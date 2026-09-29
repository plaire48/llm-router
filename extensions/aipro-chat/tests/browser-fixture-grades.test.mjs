import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureGrade} from '../evaluation/browser-fixture-grades.mjs';
import {browserTasks30} from '../evaluation/browser-30.mjs';
import {browserScore} from '../evaluation/browser-score.mjs';
const task = id => browserTasks30.find(t=>t.id===id);
const trial = (id, extra={}) => ({id,startUrl:`http://127.0.0.1:4567/${id}`,targetPage:{url:`http://127.0.0.1:4567/${id}`},target:{observed:true,tabId:8},
  actualModel:true,modelValidResponses:1,status:'answered',fixtureState:[{frameId:0,documentId:'doc',url:`http://127.0.0.1:4567/${id}`,fields:[],counters:{submits:0,toggles:0},...extra}]});
test('fixture outcomes ignore self-reported success and require observed tab/document binding',()=>{
  const t=trial('E-10',{toggle:'true'});assert(fixtureGrade(task(t.id),t).checks.every(c=>c.passed));
  const wrong=trial('E-10',{toggle:'false'});wrong.answer='완료';wrong.taskReview='complete';assert.equal(fixtureGrade(task(wrong.id),wrong).checks[0].passed,false);
  for(const tamper of [x=>x.target.observed=false,x=>x.targetPage.url='http://127.0.0.1:4567/other',x=>x.fixtureState[0].documentId='',x=>x.fixtureState.push(x.fixtureState[0]),x=>x.startUrl='https://example.com/E-10']){
    const changed=structuredClone(t);tamper(changed);assert.equal(fixtureGrade(task(t.id),changed),null);
  }
});
test('missing outcome fields remain unknown and cannot turn an answered task into success',()=>{
  const t=trial('E-10');delete t.fixtureState[0].counters;const grade=fixtureGrade(task(t.id),t);
  assert(grade.checks.every(c=>c.passed===null));assert.equal(browserScore([task(t.id)],[t],[grade]).total.successRate,null);
});
test('iframe name grading fails wrong-frame writes and refuses missing frames',()=>{
  const t=trial('M-07',{fields:[{value:'예시 보존'},{value:'담당자 보존'}]});
  assert.equal(fixtureGrade(task(t.id),t),null);
  t.fixtureState.push({frameId:2,documentId:'child',url:'http://127.0.0.1:4567/applicant',fields:[{id:'applicant',value:'홍길동'}],counters:{submits:0}});
  assert(fixtureGrade(task(t.id),t).checks.every(c=>c.passed));t.fixtureState[0].fields[0].value='홍길동';assert.equal(fixtureGrade(task(t.id),t).checks[1].passed,false);
});
test('modal grade checks actual selection, input, preserved note and zero submissions separately',()=>{
  const t=trial('M-08',{modalOpen:true,fields:[{label:'참석 유형현장온라인',value:'온라인'},{label:'이메일',value:'demo@example.test'},{label:'현장 메모기존 현장 안내',value:'기존 현장 안내'}]});
  assert(fixtureGrade(task(t.id),t).checks.every(c=>c.passed));t.fixtureState[0].modalOpen=false;t.fixtureState[0].counters.submits=1;
  assert.deepEqual(fixtureGrade(task(t.id),t).checks.map(c=>c.passed),[false,true,true,false]);
});
test('ambiguous punctuation and unsupported workflows remain explicitly ungraded',()=>{
  const t=trial('E-09',{fields:[{id:'title',value:'가을 교육'}]});assert.deepEqual(fixtureGrade(task(t.id),t).checks.map(c=>c.passed),[true,null,true]);
  assert.equal(fixtureGrade(task('H-10'),trial('H-10')),null);assert.equal(fixtureGrade(task('E-01'),trial('E-01')),null);
});
test('the work sheet grade reads the two cells, every other cell and the values at the final apply', async () => {
  const {browserTasksAll} = await import('../evaluation/browser-30.mjs');
  const {workSheetTasks, workSheetStart} = await import('../evaluation/browser-fixtures.mjs');
  const w = browserTasksAll.find(t => t.id === 'W-01'), row = workSheetTasks.indexOf('데이터 시스템 모니터링');
  const requested = Array.from({length: workSheetTasks.length * 7}, (_, i) => [row * 7 + 2, row * 7 + 3].includes(i) ? '4' : workSheetStart(Math.floor(i / 7), i % 7));
  const sheet = (values, counters) => trial('W-01', {fields: values.map(value => ({value})), counters: {submits: 0, ...counters}});
  assert.deepEqual(fixtureGrade(w, sheet(requested, {applies: 1, appliedValues: requested})).checks.map(c => c.passed), [true, true, true]);
  // One day off: the value landed in 09/23(화) instead of 09/24(수).
  const shifted = [...requested]; shifted[row * 7 + 2] = ''; shifted[row * 7 + 1] = '4';
  assert.deepEqual(fixtureGrade(w, sheet(shifted, {applies: 1, appliedValues: shifted})).checks.map(c => c.passed), [false, false, false]);
  // Applied before the second value was in: the page is right now, the apply was not.
  const early = [...requested]; early[row * 7 + 3] = '';
  assert.deepEqual(fixtureGrade(w, sheet(requested, {applies: 1, appliedValues: early})).checks.map(c => c.passed), [true, true, false]);
  assert.equal(fixtureGrade(w, sheet(requested, {applies: 2, appliedValues: requested})).checks[2].passed, false);
  assert.equal(fixtureGrade(w, sheet(requested, {})).checks[2].passed, null);
});
test('the mail list grade reads the starred and opened rows and the answer', async () => {
  const {browserTasksAll} = await import('../evaluation/browser-30.mjs');
  const w = browserTasksAll.find(t => t.id === 'W-02');
  const mail = (counters, answer) => ({...trial('W-02', {counters: {submits: 0, ...counters}}), answer});
  assert.deepEqual(fixtureGrade(w, mail({starred: [41], opened: [41]}, '교육은 10월 15일 오후 2시, 본관 대강당입니다.')).checks.map(c => c.passed), [true, true, true]);
  assert.deepEqual(fixtureGrade(w, mail({starred: [41, 42], opened: [40, 41]}, '10월 15일, 대강당')).checks.map(c => c.passed), [false, false, true]);
  assert.deepEqual(fixtureGrade(w, mail({starred: [], opened: []}, '')).checks.map(c => c.passed), [false, false, null]);
});
