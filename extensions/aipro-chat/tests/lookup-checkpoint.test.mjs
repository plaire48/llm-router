import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

// Measured on two multi-source lookups: an intermediate review ran after every
// five page moves, four and five times per task, and the task ran out of time.
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});

async function run(goal, moves, tool = 'navigate_page') {
  let turn = 0; const phases = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => ++turn <= moves ? call(tool, tool === 'navigate_page' ? {url: `https://example.test/${turn}`} : {fields: [{field_id: 'f-1', value: String(turn)}]}) : {content: '세 기관의 운영시간을 비교했습니다.'},
    execute: async name => name === 'ask_user' ? {requiresUserInput: true}
      : name === 'verify_page' ? {ok: true, verified: true, checks: [{index: 0, kind: 'text_present', passed: true}], observation: {url: 'https://example.test/', frames: []}}
      : {ok: true, actionIssued: true, observation: {url: `https://example.test/${turn}`, frames: [{frame: 0, text: `본문 ${turn}`, elements: []}]}},
    reviewGoal: async ({phase = 'final'}) => {phases.push(phase); return phase === 'checkpoint' ? {status: 'revise', checks: [], next_step: '계속 조사하세요.'}
      : {status: 'complete', checks: [{requirement: '비교', status: 'met', evidence_ids: [1]}], next_step: ''};}}).catch(error => ({error: error.message}));
  return {result, phases};
}

test('a lookup reads twelve pages without an intermediate review', async () => {
  const {phases, result} = await run('세 도서관의 운영시간을 각각 조사해서 비교해 줘.', 12);
  assert.equal(phases.filter(phase => phase === 'checkpoint').length, 0, JSON.stringify(phases));
  assert.equal(result.content, '세 기관의 운영시간을 비교했습니다.');
});

test('a long lookup is still reviewed after fifteen page moves', async () => {
  const {phases} = await run('세 도서관의 운영시간을 각각 조사해서 비교해 줘.', 16);
  assert.equal(phases.filter(phase => phase === 'checkpoint').length, 1, JSON.stringify(phases));
});

test('a request that changes the page keeps the review after five actions', async () => {
  const {phases} = await run('신청서의 다섯 칸을 차례로 입력해 줘.', 6, 'fill_form');
  assert(phases.filter(phase => phase === 'checkpoint').length >= 1, JSON.stringify(phases));
});
