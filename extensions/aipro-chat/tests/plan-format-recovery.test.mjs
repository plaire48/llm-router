import test from 'node:test';
import assert from 'node:assert/strict';
import {zstdDecompressSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {planningFailure, PLAN_PROMPT} from '../task-plan.js';
import {parsePlanningResponse} from '../planning-response.js';
import {completeChat} from '../src/api.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {normalizeTrace} from '../agent-trace.js';
import {journalEvent} from '../trace-journal.js';
import {chatgptToken, responsesSSE} from './fixtures/chatgpt.mjs';
import {goalReviewPayload, acceptedReview} from './fixtures/goal-review.mjs';
import {cleanFabrixConnection, normalizeFabrixModels} from '../fabrix.js';
import {inspectModelList} from '../core.js';
import {connection, models, conversation, toolReply, messageReply, nativeResponse} from './fixtures/fabrix.mjs';

const skill = BUILTIN_SKILLS.find(item => item.id === 'browser-agent');
const tools = browserTools({}, skill, 'QWEN3.8-27B-FP8-256K');
const planningTools = tools.filter(tool => ['update_plan', 'ask_user'].includes(tool.function.name));
const steps = [{text: '현재 제목 확인', expected_outcome: '현재 페이지에서 제목 또는 확인한 범위를 기록', status: 'completed'},
  {text: '결과 보고', expected_outcome: '확인한 내용과 미확인 사항을 구분해 보고', status: 'completed'}];
const expected = steps.map((step, index) => ({...step, status: index ? 'pending' : 'in_progress'}));
const call = (name, args = {}) => ({id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}});
const fail = (value, reason) => assert.throws(() => parsePlanningResponse(value, planningTools), error => error.message === 'plan_failed' && error.planReason === reason);
const goal = '현재 페이지의 제목을 확인하고 못 찾으면 확인한 범위를 밝혀 줘. 저장하지 마.';

test('raw packaged plan and trace modules have a complete dependency graph without bare package imports', async () => {
  const root = new URL('../', import.meta.url);
  const packaging = await readFile(new URL('scripts/package.mjs', root), 'utf8');
  const copied = new Set([...packaging.matchAll(/copyFile\('([^']+)', 'dist\/[^']+'\)/g)].map(match => new URL(match[1], root).href));
  const pending = [new URL('task-plan.js', root), new URL('agent-trace.js', root)], seen = new Set();
  while (pending.length) {
    const file = pending.pop(); if (seen.has(file.href)) continue; seen.add(file.href);
    assert(copied.has(file.href), `Raw worker dependency is not packaged: ${file.pathname}`);
    const tree = parse(await readFile(file, 'utf8'), {ecmaVersion: 'latest', sourceType: 'module'});
    for (const node of tree.body.filter(item => ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(item.type) && item.source)) {
      assert.match(node.source.value, /^\.\//, `Bare package import cannot load in the raw worker: ${file.pathname}`);
      pending.push(new URL(node.source.value, file));
    }
  }
  assert(seen.has(new URL('user-question.js', root).href));
});

test('whole JSON and a single plan call share strict schema validation and reset initial completion claims', () => {
  assert.deepEqual(parsePlanningResponse({content: JSON.stringify({steps})}, planningTools), expected);
  assert.deepEqual(parsePlanningResponse({calls: [call('update_plan', {steps})]}, planningTools), expected);
  for (const content of [{steps, approval: true}, {steps: [{...steps[0], extra: 'value'}]}, {steps: [{text: '보기', status: 'unsupported'}]}, {steps: []}]) {
    fail({content: JSON.stringify(content)}, 'plan_arguments_invalid');
    fail({calls: [call('update_plan', content)]}, 'plan_arguments_invalid');
  }
  fail({content: 'prefix ' + JSON.stringify({steps})}, 'plan_json_invalid');
  fail({content: JSON.stringify({steps}), finishReason: 'length'}, 'plan_output_limit');
});

test('mixed, unsupported or duplicate calls cannot supply a plan or a question', () => {
  fail({calls: [call('update_plan', {steps}), call('fill_form', {fields: []})]}, 'plan_tool_calls');
  fail({calls: [call('ask_user', {question: '어느 팀인가요?'}), call('ask_user', {question: '어느 날짜인가요?'})]}, 'plan_tool_calls');
  fail({calls: [call('read_page')]}, 'plan_tool_calls');
  fail({calls: [call('update_plan', {steps: steps.map(step => ({...step, status: 'in_progress'}))})]}, 'plan_steps_invalid');
  fail({calls: [{function: {name: 'update_plan', arguments: '{'}}]}, 'plan_json_invalid');
  fail({calls: [call('ask_user', {question: '선택', choices: [{label: '같음'}, {label: '같음'}]})]}, 'plan_question_invalid');
  assert.deepEqual(parsePlanningResponse({calls: [call('ask_user', {question: '어느 팀인가요?'})]}, planningTools), {question: {question: '어느 팀인가요?'}});
});

test('only fixed planning failure codes survive the model-recovery presentation journal', () => {
  const id = crypto.randomUUID();
  const step = {id, tool: 'recover_model', status: 'error', label: '계획 형식 확인', reason: 'plan_json_invalid', raw: 'PRIVATE'};
  assert.equal(journalEvent(step).reason, 'plan_json_invalid');
  assert(!JSON.stringify(journalEvent(step)).includes('PRIVATE'));
  assert.equal(normalizeTrace([{...step, reason: 'PRIVATE'}])[0].reason, undefined);
  assert.equal(normalizeTrace([{...step, tool: 'fill_form'}])[0].reason, undefined);
  assert.equal(planningFailure('PRIVATE').planReason, 'plan_arguments_invalid');
});

function install(t, provider, respond) {
  const old = {fetch: globalThis.fetch, chrome: globalThis.chrome};
  t.after(() => Object.assign(globalThis, old));
  const credential = provider === 'fabrix' ? {...cleanFabrixConnection(connection), provider, receivedAt: 1}
    : {provider, mode: 'browser', receivedAt: 1, token: provider === 'chatgpt' ? chatgptToken() : 'synthetic'};
  globalThis.chrome = {runtime: {sendMessage: async () => ({ok: true})}, storage: {session: {get: async () => ({credential,
    ...(provider === 'fabrix' ? {catalog: {credentialReceivedAt: 1, models: inspectModelList(normalizeFabrixModels(models)).models}} : {})})}}};
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(typeof options.body === 'string' ? options.body : zstdDecompressSync(options.body).toString());
    const messages = provider === 'chatgpt' ? [{role: 'system', content: body.instructions}, ...body.input.filter(item => item.role === 'user').map(item => ({role: 'user', content: item.content[0].text}))]
      : provider === 'fabrix' ? [{role: 'system', content: body.systemPrompt}, ...conversation(body)] : body.messages;
    const value = respond({body, messages, options});
    if (value instanceof Response) return value;
    if (provider === 'chatgpt') return new Response(responsesSSE(value), {headers: {'content-type': 'text/event-stream'}});
    if (provider === 'fabrix') return nativeResponse(value.tool ? toolReply(body, value.tool.name, value.tool.arguments)
      : body.systemPrompt.includes('Transport response contract') ? messageReply(body, value.text) : value.text, {stream: true});
    return Response.json({choices: [{message: value.tool ? {tool_calls: [call(value.tool.name, value.tool.arguments)]} : {content: value.text}, finish_reason: value.tool ? 'tool_calls' : 'stop'}]});
  };
}
const request = provider => ({provider, credentialReceivedAt: 1,
  modelId: provider === 'chatgpt' ? 'gpt-5.6-luna' : provider === 'fabrix' ? connection.modelId : 'QWEN3.8-27B-FP8-256K',
  messages: [{role: 'user', content: goal}], tools, skill});

for (const provider of ['chatgpt', 'aipro', 'fabrix']) {
  test(`${provider}: invalid planner text gets typed feedback once and preserves the original goal before any browser work`, async t => {
    let count = 0, plans = 0; const executed = [], trace = [];
    install(t, provider, ({body, messages}) => {
      count++;
      if (count === 1) return {tool: {name: 'read_page', arguments: {}}};
      if (messages[0].content.startsWith(PLAN_PROMPT)) {
        plans++; assert.equal(executed.length, 0);
        assert(JSON.stringify(messages).includes(goal));
        if (plans === 1) return {text: 'PRIVATE_INVALID_RESPONSE'};
        assert.match(messages[0].content, /plan_json_invalid/);
        assert(!JSON.stringify(messages).includes('PRIVATE_INVALID_RESPONSE'));
        if (provider !== 'fabrix') assert.equal(body.tool_choice, 'required');
        return {tool: {name: 'update_plan', arguments: {steps}}};
      }
      if (provider !== 'fabrix') assert.notEqual(body.tool_choice, 'required');
      const payload = goalReviewPayload(messages);
      return {text: payload ? JSON.stringify(acceptedReview(payload)) : '현재 제목을 확인했습니다.'};
    });
    const result = await completeChat(request(provider), new AbortController().signal, undefined, undefined, undefined, undefined,
      async (name, args) => {
        executed.push(name);
        if (name === 'update_plan') {const closed = executed.filter(tool=>tool==='update_plan').length-1; assert.deepEqual(args.steps, closed ? expected.map(step=>({...step,status:'completed'})) : expected); return {ok: true, plan: args.steps};}
        assert.equal(name, 'read_page'); return {text: '현재 제목'};
      }, step => trace.push(step));
    assert.equal(result, '현재 제목을 확인했습니다.'); assert.equal(count, 5); assert.equal(plans, 2);
    // A lookup closes its plan once and is judged by one final review.
    assert.deepEqual(executed, ['update_plan', 'read_page', 'update_plan']);
    assert(trace.some(step => step.tool === 'recover_model' && step.reason === 'plan_json_invalid'));
    assert(trace.some(step => step.tool === 'recover_model' && step.status === 'done'));
  });
}

test('ChatGPT complete JSON plan is accepted without a blind second planner request', async t => {
  let count = 0, plans = 0; const executed = [];
  install(t, 'chatgpt', ({messages}) => {
    count++;
    if (count === 1) return {tool: {name: 'read_page', arguments: {}}};
    if (messages[0].content.startsWith(PLAN_PROMPT)) {plans++; return {text: JSON.stringify({steps})};}
    const payload = goalReviewPayload(messages);
    return {text: payload ? JSON.stringify(acceptedReview(payload)) : '현재 제목을 확인했습니다.'};
  });
  await completeChat(request('chatgpt'), new AbortController().signal, undefined, undefined, undefined, undefined,
    async (name, args) => {executed.push(name); return name === 'update_plan' ? {ok: true, plan: args.steps} : {text: '현재 제목'};});
  assert.equal(plans, 1); assert.equal(count, 4); assert.deepEqual(executed, ['update_plan', 'read_page', 'update_plan']);
});

test('API planner receives original long and typed user requirements independently of recent context', async t => {
  const original = '자료 설명 '.repeat(350) + '초안만 만들고 제출하지 마.';
  const latest = [{type: 'text', text: '앞에서 정한 조건대로 계속해 줘.'}, {type: 'text', text: '접근 불가한 자료는 범위를 밝혀 줘.'}];
  let first = true, planned = false;
  install(t, 'aipro', ({body, messages}) => {
    if (first) {first = false; return {tool: {name: 'read_page', arguments: {}}};}
    if (messages[0].content.startsWith(PLAN_PROMPT)) {
      planned = true;
      const input = JSON.parse(messages[1].content);
      assert.equal(input.user_requests[0], original);
      assert.equal(input.user_requests.at(-1), latest.map(part => part.text).join('\n'));
      assert.equal(input.goal, latest.map(part => part.text).join('\n'));
      const schema = body.tools.find(tool => tool.function.name === 'update_plan').function.parameters.properties.steps.items;
      assert(schema.required.includes('expected_outcome'));
      return {tool: {name: 'update_plan', arguments: {steps}}};
    }
    const input = goalReviewPayload(messages);
    return {text: input ? JSON.stringify(acceptedReview(input)) : '확인한 제목입니다.'};
  });
  const input = {...request('aipro'), messages: [{role: 'user', content: original},
    ...Array.from({length: 8}, (_, i) => ({role: i % 2 ? 'user' : 'assistant', content: `중간 대화 ${i}`})), {role: 'user', content: latest}]};
  await completeChat(input, new AbortController().signal, undefined, undefined, undefined, undefined,
    async (name, args) => name === 'update_plan' ? {ok: true, plan: args.steps} : {text: '현재 제목'});
  assert(planned);
  assert(!planningTools.find(tool => tool.function.name === 'update_plan').function.parameters.properties.steps.items.required.includes('expected_outcome'), 'Do not mutate the shared update schema');
});

test('oversized original requirements cannot silently become a truncated plan or execute page work', async t => {
  let calls = 0;
  install(t, 'aipro', () => {calls++; return {tool: {name: 'read_page', arguments: {}}};});
  const input = {...request('aipro'), messages: [{id: 'old-request', role: 'user', content: '자료 '.repeat(180000) + '절대 제출하지 마.'},
    {id: 'latest-request', role: 'user', content: '앞의 조건대로 제목을 확인해 줘.'}],
    memory: {version: 1, throughId: 'old-request', summary: {goal: '제목 확인', constraints: ['초안만'], decisions: [], completed: [], pending: [], references: []}}};
  await assert.rejects(completeChat(input, new AbortController().signal, undefined, undefined, undefined, undefined,
    () => assert.fail('No page work with incomplete planning requirements')), /context_input_too_large/);
  assert.equal(calls, 1, 'Stop before the oversized planner inference; do not retry unchanged input');
});

test('two invalid planning responses fall back to one step whose criterion is the verbatim request', async t => {
  let count = 0; const trace = [], saved = [];
  install(t, 'chatgpt', () => ++count === 1 ? {tool: {name: 'read_page', arguments: {}}} : count < 4 ? {text: JSON.stringify({steps, private: 'PRIVATE'})} : {text: '제목은 현재 제목입니다.'});
  await completeChat(request('chatgpt'), new AbortController().signal, undefined, undefined, undefined, undefined,
    async (name, args) => {if (name === 'update_plan') {saved.push(structuredClone(args.steps)); return {ok: true, plan: args.steps};} return {text: '현재 제목'};}, step => trace.push(step)).catch(() => {});
  assert.equal(trace.filter(step => step.reason === 'plan_arguments_invalid' && step.status === 'error').length, 2);
  assert(trace.some(step => step.label === '기본 계획 사용'));
  assert.deepEqual(saved[0], [{text: '요청한 결과 확인', status: 'in_progress', expected_outcome: goal}]);
  assert(!JSON.stringify(saved).includes('PRIVATE'));
});

test('a request too long for one criterion still fails planning and performs no operation', async t => {
  let count = 0;
  install(t, 'chatgpt', () => ++count === 1 ? {tool: {name: 'read_page', arguments: {}}} : {text: JSON.stringify({steps, private: 'PRIVATE'})});
  const long = `${goal} ${'추가 조건을 지켜 줘. '.repeat(30)}`;
  await assert.rejects(completeChat({...request('chatgpt'), messages: [{id: 'long', role: 'user', content: long}]}, new AbortController().signal, undefined, undefined, undefined, undefined,
    () => assert.fail('Invalid planning must perform no operation')), error => error.message === 'plan_failed' && error.planReason === 'plan_arguments_invalid' && !JSON.stringify(error).includes('PRIVATE'));
  assert.equal(count, 3);
});

for (const kind of ['authentication', 'cancellation']) {
  test(`planner ${kind} immediately propagates without another planning attempt or browser operation`, async t => {
    let count = 0; const controller = new AbortController();
    install(t, 'chatgpt', () => {
      if (++count === 1) return {tool: {name: 'read_page', arguments: {}}};
      if (kind === 'authentication') return new Response('PRIVATE', {status: 401});
      controller.abort(); return {text: JSON.stringify({steps})};
    });
    await assert.rejects(completeChat(request('chatgpt'), controller.signal, undefined, undefined, undefined, undefined,
      () => assert.fail('No operation after auth/cancellation')), error => error.message === (kind === 'authentication' ? 'unauthorized' : 'cancelled'));
    assert.equal(count, 2);
  });
  test(`planner repair ${kind} closes its real progress event before propagating the failure`, async t => {
    let count = 0; const controller = new AbortController(), trace = [];
    install(t, 'chatgpt', () => {
      if (++count === 1) return {tool: {name: 'read_page', arguments: {}}};
      if (count === 2) return {text: 'INVALID'};
      if (kind === 'authentication') return new Response('PRIVATE', {status: 401});
      controller.abort(); return {text: JSON.stringify({steps})};
    });
    await assert.rejects(completeChat(request('chatgpt'), controller.signal, undefined, undefined, undefined, undefined,
      () => assert.fail('No operation after failed repair'), step => trace.push(step)), error => error.message === (kind === 'authentication' ? 'unauthorized' : 'cancelled'));
    assert.equal(count, 3);
    const repair = trace.filter(step => step.tool === 'recover_model' && step.label.startsWith('계획 형식'));
    assert.deepEqual(repair.map(step => step.status), ['error', 'running', kind === 'authentication' ? 'error' : 'cancelled']);
  });
}
