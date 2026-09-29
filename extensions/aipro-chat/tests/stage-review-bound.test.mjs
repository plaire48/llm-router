import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

// Measured on a filter-and-sort request: one plan stage was reviewed nine
// times, each time with a fresh observation, until the caller gave up.
const goal = '검색 필터에서 동영상을 선택하고 업로드 날짜순으로 정렬해 줘.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const plan = [{text: '필터와 정렬 적용', status: 'in_progress', expected_outcome: '동영상 필터와 날짜순 정렬이 적용됨'}, {text: '결과 정리', status: 'pending', expected_outcome: '상위 3개 정리'}];

async function run(review) {
  let turn = 0, reviews = 0; const executed = [], questions = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => {
      turn++;
      if (turn === 1) return call('update_plan', {steps: plan});
      return turn % 2 === 0 ? call('browser_snapshot') : {content: `필터를 적용했습니다 ${turn}`};
    },
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'update_plan') return {ok: true, plan: args.steps};
      if (name === 'ask_user') {questions.push(args.question); return {requiresUserInput: true};}
      return {url: 'https://example.test/results', frames: [{frame: 0, text: `관찰 ${executed.length}`, elements: []}]};
    },
    reviewGoal: async payload => review(++reviews, payload)}).catch(error => ({error: error.message}));
  return {result, reviews, executed, questions};
}
const revise = {status: 'revise', checks: [{requirement: '정렬 적용 상태 확인', status: 'unknown', evidence_ids: []}], next_step: '정렬 상태를 다시 확인하세요.'};

test('a stage whose review keeps asking for more is handed to the user after four reviews', async () => {
  const {result, reviews, questions, executed} = await run(() => revise);
  assert.equal(reviews, 4); assert.equal(result.awaitingUser, true);
  assert.equal(questions.length, 1);
  assert.match(questions[0], /^다음 단계를 4번 확인했지만 결과를 검증하지 못했습니다: 필터와 정렬 적용\. 계속 확인할까요\?$/);
  assert.equal(result.reviewLimited, undefined);
  assert.equal(executed.at(-1), 'ask_user');
});

test('a stage that passes within the limit continues to the next stage', async () => {
  const {reviews, questions} = await run((index, payload) => index < 3 ? revise
    : {status: 'complete', checks: [{requirement: '확인', status: 'met', evidence_ids: [1]}], next_step: ''});
  assert(reviews >= 3); assert.equal(questions.length, 0);
});

test('moving the plan back to an earlier stage does not start the count again', async () => {
  // The model rewrites the plan between reviews, so the pending stage alternates.
  let turn = 0, reviews = 0; const questions = [], executed = [];
  // No stage is closed by these rewrites: the pending stage only gets another wording.
  const rewound = [{...plan[0], status: 'in_progress'}, {...plan[1], status: 'pending'}];
  const forward = [{...plan[0], text: '필터와 정렬 다시 적용', status: 'in_progress'}, {...plan[1], status: 'pending'}];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => {
      turn++;
      if (turn === 1) return call('update_plan', {steps: plan});
      if (turn % 3 === 2) return call('update_plan', {steps: turn % 2 ? rewound : forward});
      return turn % 3 === 0 ? call('browser_snapshot') : {content: `적용했습니다 ${turn}`};
    },
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'update_plan') return {ok: true, plan: args.steps};
      if (name === 'ask_user') {questions.push(args.question); return {requiresUserInput: true};}
      return {url: 'https://example.test/results', frames: [{frame: 0, text: `관찰 ${executed.length}`, elements: []}]};
    },
    reviewGoal: async () => {reviews++; return revise;}}).catch(error => ({error: error.message}));
  assert(reviews <= 4, String(reviews)); assert.equal(result.awaitingUser, true); assert.equal(questions.length, 1);
  assert.match(questions[0], /4번 확인했지만 결과를 검증하지 못했습니다/);
});

async function report(review) {
  let turn = 0; const phases = [], executed = [], events = [];
  const steps = [{text: '필터 적용', status: 'in_progress', expected_outcome: '동영상 필터가 적용됨'}, {text: '결과 정리', status: 'pending', expected_outcome: '상위 3개 제목과 채널 정리'}];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => {
      turn++;
      if (turn === 1) return call('update_plan', {steps});
      if (turn === 2) return call('click_element', {ref: 'c-1'});
      if (turn === 3) return call('verify_page', {checks: [{kind: 'text_present', expected: '동영상'}]});
      if (turn === 4) return {content: '필터를 적용했습니다.'};
      if (turn === 5) return call('browser_snapshot');
      return {content: `상위 3개는 A, B, C입니다. ${turn}`};
    },
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'update_plan') {events.push(`plan:${args.steps.map(step => step.status).join(',')}`); return {ok: true, plan: args.steps};}
      if (name === 'ask_user') return {requiresUserInput: true};
      if (name === 'click_element') return {ok: true, actionIssued: true, observation: {url: 'https://example.test/results', frames: [{frame: 0, text: '동영상', elements: []}]}};
      if (name === 'verify_page') return {ok: true, verified: true, checks: [{index: 0, kind: 'text_present', passed: true}], observation: {url: 'https://example.test/results', frames: [{frame: 0, text: '동영상', elements: []}]}};
      return {url: 'https://example.test/results', frames: [{frame: 0, text: `결과 ${executed.length}`, elements: []}]};
    },
    reviewGoal: async ({phase = 'final', stepOutcomes}) => {
      const name = phase === 'plan_step' ? `plan_step:${stepOutcomes[0].text}` : phase; phases.push(name); events.push(name);
      return review(name, phases.filter(item => item === name).length);
    }}).catch(error => ({error: error.message}));
  return {result, phases, executed, events};
}
const passed = {status: 'complete', checks: [{requirement: '확인', status: 'met', evidence_ids: [1]}], next_step: ''};

test('a last stage that only read and reported keeps its stage review', async () => {
  const {result, phases} = await report(() => passed);
  assert.deepEqual(phases, ['plan_step:필터 적용', 'plan_step:결과 정리', 'final'], JSON.stringify(phases));
  assert.match(result.content, /^상위 3개는 A, B, C입니다/);
});

test('a reporting stage whose review asked for more is judged by the final review, not by the same review again', async () => {
  // Measured: nine stage reviews in a row asked for the form of the final answer.
  const {result, phases, executed, events} = await report(name => name === 'plan_step:결과 정리' ? revise : passed);
  assert.deepEqual(phases, ['plan_step:필터 적용', 'plan_step:결과 정리', 'final'], JSON.stringify(phases));
  assert.match(result.content, /^상위 3개는 A, B, C입니다/); assert.equal(result.awaitingUser, undefined);
  assert(!executed.includes('ask_user'));
  // The stage is saved as done only after the final review passed.
  assert.deepEqual(events.slice(events.indexOf('final') - 1), ['plan_step:결과 정리', 'final', 'plan:completed,completed'], JSON.stringify(events));
});

test('a reporting stage that the final review also rejects stays open in the saved plan', async () => {
  const {phases, events, result} = await report(name => name === 'plan_step:필터 적용' ? passed : revise);
  assert.equal(phases.filter(name => name === 'plan_step:결과 정리').length, 1, JSON.stringify(phases));
  assert(phases.filter(name => name === 'final').length >= 1);
  assert(!events.includes('plan:completed,completed'), JSON.stringify(events));
  assert.notEqual(result.reviewLimited, true, 'a request that changes the page is never released unverified');
});

test('a last stage that acted on the page keeps its stage review', async () => {
  let turn = 0; const phases = [];
  const steps = [{text: '화면 확인', status: 'in_progress', expected_outcome: '입력란 확인'}, {text: '초안 입력', status: 'pending', expected_outcome: '제목이 입력됨'}];
  await runAgent({goal: '제목에 가을 교육을 입력해 줘.', messages: [{role: 'user', content: '제목에 가을 교육을 입력해 줘.'}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => {
      turn++;
      if (turn === 1) return call('update_plan', {steps});
      if (turn === 2) return call('browser_snapshot');
      if (turn === 3) return {content: '입력란을 확인했습니다.'};
      if (turn === 4) return call('fill_form', {fields: [{field_id: 'f-1', value: '가을 교육'}]});
      if (turn === 5) return call('verify_page', {checks: [{kind: 'field_value', ref: 'f-1', expected: '가을 교육'}]});
      return {content: '제목을 입력했습니다.'};
    },
    execute: async (name, args) => {
      if (name === 'update_plan') return {ok: true, plan: args.steps};
      if (name === 'fill_form') return {ok: true, applied: 1, actionIssued: true, verified: false, observation: {frames: []}};
      if (name === 'verify_page') return {ok: true, verified: true, checks: [{index: 0, kind: 'field_value', passed: true}], observation: {frames: []}};
      return {url: 'https://example.test/form', frames: [{frame: 0, text: '양식', elements: []}]};
    },
    reviewGoal: async ({phase = 'final', stepOutcomes}) => {phases.push(phase === 'plan_step' ? `plan_step:${stepOutcomes[0].text}` : phase);
      return {status: 'complete', checks: [{requirement: '확인', status: 'met', evidence_ids: [1]}], next_step: ''};}}).catch(error => ({error: error.message}));
  assert(phases.includes('plan_step:초안 입력'), JSON.stringify(phases));
});
