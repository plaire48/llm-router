import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

// Measured on a product comparison lookup: every revision read the page again,
// the review named another gap each time, and nine final reviews later the
// caller timed out without an answer.
const goal = '조건에 맞는 상품 3개를 비교해서 표로 알려줘.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const check = (requirement, status) => ({requirement, status, evidence_ids: []});
const verdict = (states, next_step) => ({status: 'revise', next_step,
  checks: ['상품 3개 비교', '가격과 배송비 제시', '출처 URL 제시', '구매하지 않기'].map((text, index) => check(text, states[index]))});

// Every model turn alternates a fresh page read and a new candidate answer.
function lookup(reviews, {first = 'read_page', extra = {}} = {}) {
  let turn = 0, reviewed = 0; const executed = [], answers = [];
  const run = runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => {
      if (turn++ % 2 === 0) return call(turn === 1 ? first : 'read_page', turn === 1 && first === 'click_element' ? {ref: 'c-1'} : {});
      const content = `후보 답변 ${answers.length + 1}`; answers.push(content); return {content};
    },
    execute: async name => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} :
      name === 'click_element' ? {ok: true, actionIssued: true, observation: {frames: []}} : {text: `본문 ${executed.length}`, content_hash: `hash-${executed.length}`};},
    reviewGoal: async () => reviews[Math.min(reviewed++, reviews.length - 1)], ...extra});
  return {run, executed, answers, reviewed: () => reviewed};
}

test('a lookup whose review stops improving releases the best reviewed candidate with every open check', async () => {
  const s = lookup([verdict(['met', 'unknown', 'unmet', 'met'], '출처를 구분하세요.'), verdict(['unmet', 'met', 'met', 'met'], '두 상품은 조건이 확인되지 않았습니다.'),
    verdict(['unmet', 'unmet', 'met', 'met'], '3개를 다시 고르세요.'), verdict(['unmet', 'unmet', 'met', 'met'], '3개를 다시 고르세요.')]);
  const result = await s.run;
  assert.equal(s.reviewed(), 4);
  assert.notEqual(result.awaitingUser, true); assert.equal(result.reviewLimited, true);
  assert.match(result.content, /^후보 답변 2\n/);
  assert.match(result.content, /검증 완료가 아닙니다\. 독립 검토를 4회 거쳤지만/);
  assert.match(result.content, /- \(충족되지 않음\) 상품 3개 비교/);
  assert.match(result.content, /검토 의견: 두 상품은 조건이 확인되지 않았습니다\./);
  assert(!/가격과 배송비 제시/.test(result.content));
  assert(!s.executed.includes('ask_user'));
});

test('a lookup that keeps improving is reviewed until it passes', async () => {
  const s = lookup([verdict(['unmet', 'unknown', 'unmet', 'met'], 'a'), verdict(['met', 'unknown', 'unmet', 'met'], 'b'), verdict(['met', 'met', 'unmet', 'met'], 'c'),
    {status: 'complete', next_step: '', checks: verdict(['met', 'met', 'met', 'met']).checks}]);
  const result = await s.run;
  assert.equal(s.reviewed(), 4); assert.equal(result.content, '후보 답변 4'); assert.equal(result.reviewLimited, undefined);
});

const names = ['상품 3개 비교', '가격 제시', '배송비 제시', '용량 제시', '출력 제시', '제품명 제시', '출처 URL 제시', '구매하지 않기'];
const round = met => ({status: 'revise', next_step: '출처를 확인하세요.', checks: names.map((text, index) => check(text, index < met ? 'met' : 'unknown'))});

test('four final reviews are the limit even when each one is slightly better', async () => {
  // Every round meets most of the request (the host settles the no-purchase
  // conduct), so each one is a correction.
  const s = lookup([4, 5, 5, 6, 6].map(round));
  const result = await s.run;
  assert.equal(s.reviewed(), 4); assert.equal(result.reviewLimited, true);
  assert.match(result.content, /^후보 답변 4\n/); assert.match(result.content, /독립 검토를 4회/);
  assert.match(result.content, /- \(확인하지 못함\) 출처 URL 제시/);
});

test('without a majority of met checks the user is asked instead of receiving the candidate', async () => {
  const s = lookup([verdict(['unmet', 'unmet', 'unknown', 'met'], 'a')]);
  const result = await s.run;
  assert.equal(s.reviewed(), 3); assert.equal(result.reviewLimited, undefined);
  assert.equal(result.awaitingUser, true); assert(s.executed.includes('ask_user'));
  assert(!/검증 완료가 아닙니다/.test(result.content || ''));
});

test('a run that changed the page is never released by the round limit', async () => {
  const change = '장바구니에 상품을 담아줘.';
  const s = lookup([verdict(['met', 'met', 'unmet', 'met'], 'a')], {first: 'click_element', extra: {goal: change, messages: [{role: 'user', content: change}]}});
  const guard = setTimeout(() => {}, 0);
  const result = await Promise.race([s.run.catch(error => ({error: error.message})), new Promise(done => setTimeout(() => done({stopped: true}), 4000))]);
  clearTimeout(guard);
  assert.equal(result.reviewLimited, undefined);
  assert(!/검증 완료가 아닙니다/.test(result.content || ''));
});

// Measured on a comparison of two sources: rounds met 1, 4, 1 and 5 requirements.
// The rounds with one requirement met judged a text written in the middle of the
// work, not an answer. At the fourth review the limit released the best candidate
// "unverified", while its only open point was one unsupported figure.
const finished = {status: 'complete', next_step: '', checks: names.map(text => ({requirement: text, status: 'met', evidence_ids: [1]}))};

test('a text that is not yet an answer does not use up a correction', async () => {
  const s = lookup([round(1), round(4), round(1), round(5), finished]);
  const result = await s.run;
  assert.equal(s.reviewed(), 5); assert.equal(result.reviewLimited, undefined);
  assert.equal(result.content, '후보 답변 5');
});

test('six reviews are the limit however many of them judged no answer', async () => {
  const s = lookup([round(1), round(4), round(1), round(5), round(1), round(6), finished]);
  const result = await s.run;
  assert.equal(s.reviewed(), 6); assert.equal(result.reviewLimited, true);
  assert.match(result.content, /^후보 답변 6\n/); assert.match(result.content, /독립 검토를 6회/);
});

test('a run that keeps writing no answer still stops after two rounds without improvement', async () => {
  const s = lookup([round(1), round(1), round(1), round(1)]);
  const result = await s.run;
  assert.equal(s.reviewed(), 3); assert.equal(result.reviewLimited, undefined); assert.equal(result.awaitingUser, true);
});
