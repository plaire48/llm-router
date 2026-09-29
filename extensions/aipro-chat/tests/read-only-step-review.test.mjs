import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const goal = '이 화면의 현재 기온을 알려줘.';
const steps = status => [{text: '현재 기온 확인', status, expected_outcome: '현재 기온을 화면에서 읽음'}];

async function run(action) {
  const phases = [], executed = []; let rounds = 0;
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => {
      assert(++rounds < 10);
      if (rounds === 1) return call('update_plan', {steps: steps('in_progress')});
      if (rounds === 2) return call(action, action === 'click_element' ? {ref: 'c-1'} : {});
      if (rounds === 3 && action === 'click_element') return call('verify_page', {checks: [{kind: 'text_present', text: '23'}]});
      if (rounds === (action === 'click_element' ? 4 : 3)) return call('update_plan', {steps: steps('completed')});
      return {content: '현재 기온은 23도입니다. 출처: https://example.test/weather'};
    },
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'update_plan') return {ok: true, plan: args.steps};
      if (name === 'click_element') return {ok: true, actionIssued: true, actionTargetReceipt: {status: 'observed', outcome: 'returned', actionIssued: true, target: {name: '오늘'}}, observation: {url: 'https://example.test/weather', frames: [{frame: 0, text: '현재 23도'}]}};
      if (name === 'verify_page') return {ok: true, verified: true, checks: [{kind: 'text_present', passed: true}], observation: {url: 'https://example.test/weather', frames: [{frame: 0, text: '현재 23도'}]}};
      return {url: 'https://example.test/weather', text: '서울 현재 23도 최고 26도 최저 18도'};
    },
    reviewGoal: async ({phase}) => {phases.push(phase || 'final'); return {status: 'complete', checks: [{requirement: '현재 기온', status: 'met', evidence_ids: [1]}], next_step: ''};}});
  return {result, phases, executed};
}

test('a lookup that issued no page interaction gets the final review only', async () => {
  const {result, phases, executed} = await run('read_page');
  assert.match(result.content, /23도/);
  assert.deepEqual(phases, ['final']);
  assert.deepEqual(executed.filter(name => name !== 'update_plan'), ['read_page']);
});

test('a resumed run whose start was not observed keeps its step review', async () => {
  const phases = []; let rounds = 0;
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    resumePlan: steps('in_progress'),
    complete: async () => ++rounds === 1 ? call('read_page') : rounds === 2 ? call('update_plan', {steps: steps('completed')}) : {content: '현재 기온은 23도입니다.'},
    execute: async (name, args) => name === 'update_plan' ? {ok: true, plan: args.steps} : {url: 'https://example.test/weather', text: '서울 현재 23도'},
    reviewGoal: async ({phase}) => {phases.push(phase || 'final'); return {status: 'complete', checks: [{requirement: '현재 기온', status: 'met', evidence_ids: [1]}], next_step: ''};}});
  assert.match(result.content, /23도/);
  assert.deepEqual(phases, ['plan_step', 'final']);
});

test('an answered lookup with unfinished plan stages closes the plan once and gets one final review', async () => {
  const phases = [], saved = []; let rounds = 0;
  const three = ['검색 결과 열기', '일반 결과 확인', '출처 정리'].map((text, index) => ({text, status: index ? 'pending' : 'in_progress', expected_outcome: `${text} 완료`}));
  const search = '검색창에 박물관 관람시간을 검색하고 일반 결과 2개 제목과 링크를 알려줘.';
  const result = await runAgent({goal: search, messages: [{role: 'user', content: search}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => {
      assert(++rounds < 8);
      if (rounds === 1) return call('update_plan', {steps: three});
      if (rounds === 2) return call('read_page');
      return {content: '1. 결과 A https://example.test/a\n2. 결과 B https://example.test/b'};
    },
    execute: async (name, args) => {
      if (name === 'update_plan') {saved.push(structuredClone(args.steps)); return {ok: true, plan: args.steps};}
      return {url: 'https://example.test/search', text: '결과 A https://example.test/a 결과 B https://example.test/b'};
    },
    reviewGoal: async ({phase}) => {phases.push(phase || 'final'); return {status: 'complete', checks: [{requirement: '일반 결과 2개', status: 'met', evidence_ids: [1]}], next_step: ''};}});
  assert.match(result.content, /결과 A/);
  assert.deepEqual(phases, ['final']);
  assert(saved.at(-1).every(step => step.status === 'completed'));
  assert.deepEqual(saved.at(-1).map(step => step.expected_outcome), three.map(step => step.expected_outcome));
});
