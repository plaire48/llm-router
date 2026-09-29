import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const goal = '선수의 종목과 소속을 찾아 알려줘.';
const step = status => [{text: '종목과 소속 확인', status, expected_outcome: '종목과 소속을 출처와 함께 제시'}];
const gap = {status: 'revise', correctionTarget: 'answer', checks: [
  {requirement: '종목 제시', status: 'met', evidence_ids: [1]}, {requirement: '소속 제시', status: 'met', evidence_ids: [1]},
  {requirement: '9월 30일 보도 확인 주장', status: 'unmet', evidence_ids: []}], next_step: '근거 없는 날짜 주장을 고치세요.'};
const complete = {status: 'complete', checks: [{requirement: '원래 요청 전체', status: 'met', evidence_ids: [1]}], next_step: ''};

async function run(reviews) {
  let rounds = 0, reviewed = 0; const executed = [], removalRounds = [], toolCounts = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async (wire, selected) => {
      assert(++rounds < 12);
      if (rounds === 1) return call('update_plan', {steps: step('in_progress')});
      if (rounds === 2) return call('read_page');
      toolCounts.push(selected.length);
      if (JSON.stringify(wire.at(-1)).includes('DELETE every statement')) removalRounds.push(rounds);
      return {content: removalRounds.length ? '종목은 사브르, 소속은 대전광역시청입니다. 확인하지 못한 부분: 최근 보도 날짜.' : `종목은 사브르, 소속은 대전광역시청입니다. 9월 30일 보도로 확인했습니다. ${rounds}`};
    },
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'update_plan') return {ok: true, plan: args.steps};
      if (name === 'ask_user') return {requiresUserInput: true};
      return {url: 'https://example.test/profile', text: '오상욱 펜싱 사브르 대전광역시청'};
    },
    reviewGoal: async () => reviews[Math.min(reviewed++, reviews.length - 1)]});
  return {result, reviewed, executed, removalRounds, toolCounts};
}

test('after rewording fails, one tool-free pass deletes the unsupported statement and is reviewed again', async () => {
  const run1 = await run([gap, gap, gap, complete]);
  assert.equal(run1.removalRounds.length, 1);
  assert.equal(run1.toolCounts.at(-1), 0);
  assert.equal(run1.reviewed, 4);
  assert(!run1.result.awaitingUser);
  assert.match(run1.result.content, /확인하지 못한 부분/); assert(!/9월 30일 보도로 확인/.test(run1.result.content));
  assert(!run1.executed.includes('ask_user'));
});

test('the deletion pass is granted once; a lookup that still has a gap is released with the gap stated', async () => {
  const run2 = await run([gap]);
  assert.equal(run2.removalRounds.length, 1);
  assert(!run2.result.awaitingUser); assert.equal(run2.result.reviewLimited, true);
  // The latest candidate is released: the one without the unsupported statement.
  assert.match(run2.result.content, /^종목은 사브르, 소속은 대전광역시청입니다\. 확인하지 못한 부분: 최근 보도 날짜\./);
  assert(!/9월 30일 보도로 확인했습니다/.test(run2.result.content));
  assert.match(run2.result.content, /검증 완료가 아닙니다/); assert.match(run2.result.content, /- \(충족되지 않음\) 9월 30일 보도 확인 주장/);
  assert(!run2.executed.includes('ask_user'));
});
