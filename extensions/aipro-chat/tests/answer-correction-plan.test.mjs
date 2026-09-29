import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const plan = ['검색 화면 확인', '두 일반 결과 확인', '출처 확인'].map(text => ({text, status: 'completed', expected_outcome: `${text} 결과를 관찰함`}));
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const goal = '검색 결과 두 개와 출처를 알려줘.';

async function run({next, changedEvidence = false, correctionTarget = 'answer', steering = false}) {
  const actions = [], proposals = [], replies = [];
  let rounds = 0, reviews = 0, reads = 0, steered = false, feedback;
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], resumePlan: plan,
    tools, harness: true, signal: new AbortController().signal,
    takeInput: steering ? async () => {
      if (reviews !== 1 || steered) return null;
      steered = true; return {text: '추가로 다른 검색 조건도 확인해줘.'};
    } : undefined,
    complete: async wire => {
      assert(++rounds < 10, 'plan repair must not create a new loop');
      if (rounds === 1) return call('read_page');
      if (rounds === 2) return {content: '관찰한 결과입니다. 잘못 붙인 순위 표현.'};
      if (changedEvidence && reads === 1) return call('read_page', {query: '변경된 조건'});
      if (steering && !proposals.length) return call('update_plan', {steps: next});
      if (rounds === (changedEvidence ? 4 : 3)) return call('update_plan', {steps: next});
      const last = wire.findLast(message => message.role === 'tool');
      if (last) {try {feedback = JSON.parse(last.content);} catch {}}
      return {content: '두 결과의 정확한 제목과 출처를 정리했습니다. 순위를 주장하지 않습니다.'};
    },
    execute: async (name, args) => {
      actions.push(name);
      if (name === 'read_page') return {url: 'https://example.test/search', text: ++reads === 1 ? '일반 결과 A와 B의 제목 및 출처' : '실제 조건 변경으로 새 결과 C와 D를 관찰함'};
      assert.equal(name, 'update_plan'); proposals.push(structuredClone(args.steps)); return {ok: true, plan: args.steps};
    },
    reviewGoal: async ({phase, answer}) => {
      replies.push({phase, answer});
      if (phase === 'plan_step') return {status: 'complete'};
      if (++reviews === 1) return {status: 'revise', correctionTarget,
        checks: [{requirement: '답변의 근거 없는 순위 표현', status: 'unmet', evidence_ids: [1]}], next_step: '원래 요청에 맞게 전체 답변을 수정하세요.'};
      return {status: 'complete'};
    }});
  return {result, actions, proposals, replies, feedback, reviews, steered};
}

for (const [name, next] of [
  ['status downgrade', plan.map(step => ({...step, status: 'pending'}))],
  ['renamed replacement', plan.map(step => ({...step, text: `상위 순서 ${step.text}`, status: 'pending'}))],
  ['changed outcome', plan.map(step => ({...step, expected_outcome: '순위까지 다시 증명'}))],
  ['removed step', plan.slice(0, 2)],
]) test(`answer-only correction preserves verified work against ${name}`, async () => {
  const r = await run({next});
  assert.deepEqual(r.actions, ['read_page']);
  assert.equal(r.feedback.reason, 'completed_plan_preserved');
  assert.equal(r.proposals.length, 0); assert.equal(r.reviews, 2);
  assert(r.result.content.includes('두 결과')); assert(!r.result.awaitingUser);
});

test('new observed external state permits a targeted replan and requires step/final review again', async () => {
  const next = plan.map((step, i) => i === 1 ? {...step, status: 'pending'} : step);
  const r = await run({next, changedEvidence: true});
  assert.deepEqual(r.actions, ['read_page', 'read_page', 'update_plan', 'update_plan']);
  assert.equal(r.proposals[0][1].status, 'pending'); assert(r.proposals[1].every(step => step.status === 'completed'));
  assert(r.replies.some(reply => reply.phase === 'plan_step')); assert.equal(r.reviews, 2);
});

test('a final review of an external result does not lock completed steps as answer-only', async () => {
  const next = plan.map((step, i) => i === 1 ? {...step, status: 'pending'} : step);
  const r = await run({next, correctionTarget: 'external_result'});
  assert.deepEqual(r.actions, ['read_page', 'update_plan', 'update_plan']);
  assert(r.replies.some(reply => reply.phase === 'plan_step'));
});

test('new explicit user requirements release the answer-only plan guard', async () => {
  const next = plan.map((step, i) => i === 1 ? {...step, expected_outcome: '사용자가 추가한 검색 조건 확인', status: 'pending'} : step);
  const r = await run({next, steering: true});
  assert(r.steered); assert(r.proposals.some(steps => steps[1].status === 'pending'));
  assert(r.replies.some(reply => reply.phase === 'plan_step')); assert(!r.result.awaitingUser);
});
