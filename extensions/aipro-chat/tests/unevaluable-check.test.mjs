import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

// Measured on a three-source comparison lookup: verify_page carried a
// control_state check on a control without state, failed the same way 17
// times in a row, and the run ended at its time limit without an answer.
const goal = '경기 결과를 세 화면에서 대조해서 알려줘.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const checks = [{kind: 'control_state', ref: 'c-1', expected: 'true'}, {kind: 'text_present', expected: '45-31'}, {kind: 'url_page_is', expected: 'https://example.test/card'}];
const failed = (extra = {}) => ({ok: false, verified: false, error: 'verification_failed', checks: [
  {index: 0, kind: 'control_state', reason: 'check_target_incompatible', exposedStates: [], passed: false, ...extra},
  {index: 1, kind: 'text_present', passed: true}, {index: 2, kind: 'url_page_is', passed: true}], observation: {url: 'https://example.test/card', frames: []}});

async function run({request = goal, first = 'read_page', result = failed(), second} = {}) {
  let turn = 0; const verified = [], seen = [];
  const answer = await runAgent({goal: request, messages: [{role: 'user', content: request}], tools, harness: true, signal: new AbortController().signal,
    complete: async wire => {
      turn++;
      if (turn === 1) return call(first, first === 'fill_form' ? {fields: [{field_id: 'f-1', value: 'x'}]} : {});
      if (turn === 2) return call('verify_page', {checks});
      seen.push(JSON.parse(wire.findLast(message => message.role === 'tool').content));
      return {content: '세 화면 모두 45-31입니다.'};
    },
    execute: async (name, args) => {
      if (name === 'verify_page') {
        verified.push(args.checks.map(check => check.kind));
        return verified.length === 1 ? result : second || {ok: true, verified: true, checks: args.checks.map((check, index) => ({index, kind: check.kind, passed: true})), observation: {url: 'https://example.test/card', frames: []}};
      }
      return name === 'fill_form' ? {ok: true, actionIssued: true, observation: {frames: []}} : {text: '본문'};
    },
    reviewGoal: async () => ({status: 'complete', checks: [{requirement: '대조', status: 'met', evidence_ids: [1]}], next_step: ''})}).catch(error => ({error: error.message}));
  return {answer, verified, result: seen[0]};
}

test('a lookup verifies the evaluable checks once more and names the check that was left out', async () => {
  const {verified, result} = await run();
  assert.deepEqual(verified, [['control_state', 'text_present', 'url_page_is'], ['text_present', 'url_page_is']]);
  assert.equal(result.verified, true);
  assert.deepEqual(result.notEvaluated, [{index: 0, kind: 'control_state', reason: 'check_target_incompatible', exposedStates: []}]);
  assert.match(result.scope, /not verified/);
  assert.deepEqual(result.checks.map(check => check.kind), ['text_present', 'url_page_is']);
  // Positions are those of the original request, so a result is never paired with the check that was left out.
  assert.deepEqual(result.checks.map(check => check.index), [1, 2]);
});

test('the failed result is kept when another check failed, the second pass fails, or nothing else was checked', async () => {
  const mixed = failed(); mixed.checks[1].passed = false;
  for (const options of [{result: mixed}, {second: {ok: false, verified: false, error: 'verification_failed', checks: [{index: 0, kind: 'text_present', passed: false}]}},
    {result: {...failed(), checks: [failed().checks[0], {index: 1, kind: 'field_contains', reason: 'check_target_incompatible', passed: false}, failed().checks[2]]}}]) {
    const {result} = await run(options);
    assert.equal(result.verified, false); assert.equal(result.notEvaluated, undefined);
  }
});

test('a request that changes the page never has a check left out', async () => {
  for (const options of [{request: '신청서에 이름을 입력해줘.', first: 'fill_form'}, {request: '신청서에 이름을 입력해줘.'}]) {
    const {verified, result} = await run(options);
    assert.equal(verified.length >= 1, true); assert.deepEqual(verified[0], ['control_state', 'text_present', 'url_page_is']);
    assert(verified.every(kinds => kinds.length === 3)); assert.equal(result.notEvaluated, undefined);
  }
});
