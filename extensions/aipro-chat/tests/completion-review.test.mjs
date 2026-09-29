import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {completionReviewMessages, parseCompletionReview, COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {completeChat} from '../src/api.js';
import {evaluationTarget, sameEvaluationState} from '../scripts/evaluation-target.mjs';

const work = {decision: 'work', scope: 'browser', next_step: '현재 페이지를 읽고 본문 입력 후 확인하세요.'};
const reply = {decision: 'reply', scope: 'conversation', next_step: ''};
const done = {content: '본문을 입력하고 확인했습니다.', calls: null};
const call = (name, args = {}) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const options = () => ({messages: [{role: 'user', content: '현재 페이지 본문에 초안을 입력해줘. 등록하지 마.'}],
  tools: browserTools({}, BUILTIN_SKILLS.find(s => s.id === 'browser-agent')), signal: new AbortController().signal, harness: true});

test('completion intent cannot pass browser work as a conversation or fabricate a final review', () => {
  const result = value => ({content: JSON.stringify(value)});
  assert.deepEqual(parseCompletionReview(result(reply)), reply);
  for (const value of [null, {status: 'complete'}, {...reply, scope: 'browser'}, {...work, scope: 'conversation'}, {...work, next_step: ''}, {...reply, question: {question: '등록할까요?'}}]) {
    assert.throws(() => parseCompletionReview(result(value)), /goal_review_failed/);
  }
  assert.throws(() => parseCompletionReview({...result(work), calls: [{}]}), /goal_review_failed/);
  assert.throws(() => parseCompletionReview({...result(work), finishReason: 'length'}), /goal_review_failed/);
  const messages = completionReviewMessages({goal: '본문 입력', history: [{role: 'user', content: '등록하지 마. 최신 본문만 입력해.'}, {role: 'assistant', content: 'x'.repeat(50000)}], answer: done.content, inputBudget: 8000});
  assert.equal(messages[0].content, COMPLETION_REVIEW_PROMPT);
  assert(messages[1].content.includes('등록하지 마'));
  assert(!messages[1].content.includes('x'.repeat(50000)));
});

test('unsupported completion resumes observation, draft and verification without asking the user again', async () => {
  const executed = [], held = []; let turn = 0, assessments = 0, reviews = 0;
  const result = await runAgent({...options(), assessCompletion: async () => {assessments++; return work;},
    complete: async (messages, _, state) => {
      held.push(state.reviewPending);
      switch (turn++) {
        case 0: return done;
        case 1: assert.match(messages.at(-1).content, /No browser\/project evidence/); return call('browser_snapshot');
        case 2: return call('fill_form', {fields: [{field_id: 'body', value: '초안'}]});
        case 3: return call('verify_page', {checks: [{kind: 'field_value', ref: 'body', expected: '초안'}]});
        default: return done;
      }
    }, execute: async name => {executed.push(name); return {ok: true, verified: true, applied: 1, text: '초안'};},
    reviewGoal: async ({evidence}) => {reviews++; assert(evidence.at(-1).usable); return {status: 'complete'};},
  });
  assert.equal(result, done); assert.equal(assessments, 1); assert.equal(reviews, 1);
  assert.deepEqual(executed, ['browser_snapshot', 'fill_form', 'verify_page']); assert(held.every(Boolean));
});

test('plan-only and skill-only claims are not page proof, repeated refusal becomes one question', async () => {
  let turn = 0, assessments = 0; const executed = [];
  const result = await runAgent({...options(), assessCompletion: async () => {assessments++; return assessments === 1 ? work : reply;},
    tools: [...options().tools, {type: 'function', function: {name: 'find_skills', parameters: {type: 'object', properties: {query: {type: 'string'}}}}}],
    complete: async (_, selected) => {
      if (selected.length === 1 && selected[0].function.name === 'ask_user') return call('ask_user', {question: '어느 페이지의 본문을 편집할까요?'});
      switch (turn++) {
        case 0: return call('update_plan', {steps: [{text: '본문 확인', status: 'in_progress', expected_outcome: '본문 위치 확인'}]});
        case 1: return call('find_skills', {query: '본문'});
        default: return done;
      }
    }, execute: async (name, args) => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : {ok: true, ...(name === 'update_plan' ? {plan: args.steps} : {})};},
    reviewGoal: async () => assert.fail('Metadata cannot pass a result review'),
  });
  assert(result.awaitingUser); assert.equal(result.content, ''); assert.equal(assessments, 2);
  assert.equal(executed.filter(name => name === 'ask_user').length, 1); assert(!executed.includes('fill_form'));
});

test('ordinary conversation does not inspect pages, plan or record a task-result review', async () => {
  let assessments = 0;
  const result = await runAgent({...options(), messages: [{role: 'user', content: '안녕'}], complete: async () => ({content: '안녕하세요!', calls: null}),
    assessCompletion: async () => {assessments++; return reply;}, execute: async () => assert.fail('Unexpected page access'),
    preparePlan: async () => assert.fail('Unexpected plan'), reviewGoal: async () => assert.fail('Unexpected task-result review')});
  assert.equal(result.content, '안녕하세요!'); assert.equal(assessments, 1);
});

test('missing user choice uses the existing question form before any action', async () => {
  const asked = [];
  const result = await runAgent({...options(), complete: async () => done,
    assessCompletion: async () => ({decision: 'question', scope: 'browser', next_step: '어떤 본문을 작성할까요?', question: {question: '어떤 본문을 작성할까요?', input_mode: 'long_text'}}),
    execute: async (name, args) => {assert.equal(name, 'ask_user'); asked.push(args); return {requiresUserInput: true};},
  });
  assert(result.awaitingUser); assert.equal(asked.length, 1); assert.equal(asked[0].input_mode, 'long_text');
});

test('review cancellation and review errors never expose unsupported candidate text', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    await assert.rejects(runAgent({...options(), signal: controller.signal, complete: async () => done,
      assessCompletion: async () => {if (cancel) {controller.abort(); return work;} throw new Error('network');},
      execute: async () => assert.fail('Must not act after review error/cancel'),
    }), error => error.suppressPartial === true && error.message === (cancel ? 'cancelled' : 'network'));
  }
});

test('provider transport retries invalid intent JSON only twice and suppresses fake completion', async () => {
  const oldFetch = globalThis.fetch, oldChrome = globalThis.chrome; let calls = 0, checks = 0;
  const texts = [], usage = [];
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', receivedAt: 5, token: 'synthetic'}})}}};
  globalThis.fetch = async (_, options) => {
    calls++; const body = JSON.parse(options.body);
    const review = body.messages[0].content.startsWith(COMPLETION_REVIEW_PROMPT);
    if (review) {checks++; if(checks===1)assert(!body.tools?.length);else assert.deepEqual(body.tools?.map(t=>t.function.name),['report_completion_intent']); assert.equal(body.model, 'QWEN3.8-27B-FP8-256K');}
    return new Response(JSON.stringify({choices: [{message: {content: review ? 'invalid' : done.content}, finish_reason: 'stop'}], usage: {prompt_tokens: 20, completion_tokens: 10, total_tokens: 30}}), {headers: {'Content-Type': 'application/json'}});
  };
  try {
    let questions=0;
    assert.equal(await completeChat({provider: 'aipro', credentialReceivedAt: 5, modelId: 'QWEN3.8-27B-FP8-256K', messages: options().messages, skill: BUILTIN_SKILLS.find(s => s.id === 'browser-agent'), tools: options().tools},
      new AbortController().signal, text => texts.push(text), undefined, undefined, undefined, async (name,args) => {
        assert.equal(name,'ask_user');questions++;
        assert.deepEqual(args.choices?.map(choice=>choice.label),['다시 확인','중지']);
        assert.doesNotMatch(args.question,/대상이나 원하는 결과|알려주세요/);
        assert.match(args.question,/요청.*유지/);
        return {requiresUserInput:true};
      }, undefined, entry => usage.push(entry)), '');
    assert.equal(questions,1);
    assert.equal(calls, 3); assert.equal(checks, 2); assert(!texts.some(text => text.includes(done.content))); assert(usage.some(entry => entry.phase === 'report'));
  } finally {globalThis.fetch = oldFetch; globalThis.chrome = oldChrome;}
});

test('evaluation selects credential-bound current work and rejects stale or unrelated targets', () => {
  const binding = {conversationId: 'session', sourceTabId: 1, mode: 'window'};
  const credential = {provider: 'aipro', receivedAt: 10};
  const workspace = {id: 'work', conversationId: 'session', sourceTabId: 1, provider: 'aipro', credentialReceivedAt: 10, windowId: 3, tabId: 2, tabIds: [2, 4]};
  const record = {provider: 'aipro', credentialReceivedAt: 10, context: {tabId: 4, workspace}};
  assert.deepEqual(evaluationTarget({credential, workspace, record}, binding), {tabId: 4, windowId: 3, kind: 'workspace', observed: true});
  for (const change of [{closed: true}, {credentialReceivedAt: 9}, {conversationId: 'other'}, {sourceTabId: 8}, {tabIds: [2]}]) assert.throws(() => evaluationTarget({credential, workspace: {...workspace, ...change}, record}, binding), /evaluation_binding/);
  assert.throws(() => evaluationTarget({credential, workspace: {...workspace, sourceTabId: 8}, record}, binding), error => error.message === 'evaluation_binding' && error.reason === 'workspace_source_mismatch');
  assert.deepEqual(evaluationTarget({credential}, binding), {tabId: 1, kind: 'source', observed: false});
  const current = {provider: 'aipro', credentialReceivedAt: 10, context: {tabId: 5, openers: [[5, 1]]}};
  assert.equal(evaluationTarget({credential, record: current}, {...binding, mode: 'current'}).tabId, 5);
  assert.throws(() => evaluationTarget({credential, record: {...current, context: {tabId: 5, openers: [[5, 5]]}}}, {...binding, mode: 'current'}), /evaluation_binding/);
  assert(!sameEvaluationState({body: '', writes: 0}, {body: 'accidental', writes: 1}));
});
