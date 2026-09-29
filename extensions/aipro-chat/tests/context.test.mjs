import test from 'node:test';
import assert from 'node:assert/strict';
import {compactHistory, contextBudget, contextTokens, createRunContext} from '../context-manager.js';
import {historyContext, normalizeSummary, taskReceipt, pauseTask, resumeMessage, normalizePlan} from '../context-state.js';
import {completeChat} from '../src/api.js';
import {contextUsage} from '../usage.js';
import {promptPreamble} from '../chat-contract.js';
import {responsesSSE, chatgptToken} from './fixtures/chatgpt.mjs';
import {zstdDecompressSync} from 'node:zlib';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {createHarness} from '../agent-harness.js';
import {analysisToolDefinitions} from '../analysis-agents.js';
import {progressTools} from '../agent-runtime.js';
const summary = {goal: '교육 안내 메일 초안', constraints: ['보내지 말 것', '제목은 9월 교육'], decisions: ['본문만 작성'], completed: ['편집기 열기 확인'], pending: ['본문 입력 후 확인'], references: []};
const signal = () => new AbortController().signal;
const model = {name: 'test', contextLength: 16000, maxInputTokens: 14000};
const turn = (id, content = 'old evidence '.repeat(1800)) => [{id: `u${id}`, role: 'user', content: `질문 ${id}`}, {id: `a${id}`, role: 'assistant', state: 'done', content}];
const summarize = async () => ({content: JSON.stringify(summary), finishReason: 'stop'});
const pair = (id, text) => [{role: 'assistant', content: '', tool_calls: [{id, type: 'function', function: {name: 'read_page', arguments: '{}'}}]}, {role: 'tool', tool_call_id: id, content: text}];
test('16k browser schemas leave room for actual compacted history and the latest no-send correction', async () => {
  const skill = BUILTIN_SKILLS.find(item => item.id === 'browser-agent');
  const granted = browserTools(null, skill, 'GLM-5.2-NVFP4', {autoConnect: true});
  // The host passes the model's input window; a 16k model keeps the lean catalog.
  const advertised = createHarness(progressTools([...granted, ...analysisToolDefinitions()], true), {inputBudget: contextBudget(model).input}).advertised();
  const messages = Array.from({length: 6}, (_, index) => ({id: `m${index}`, role: index % 2 ? 'assistant' : 'user',
    content: index < 4 ? index % 2 ? 'old evidence '.repeat(1800) : `old question ${index}` : index % 2 ? '최근 답' : '최근 질문'}));
  const latest = '초안 조건으로 기억해줘. 제목은 9월 교육이고 보내면 안 돼.';
  messages.push({id: 'latest', role: 'user', content: latest});
  const original = structuredClone(messages);
  // Use the real public prompt and initial deferred-tool catalog. Explicit
  // selection retains its complete skill instructions and is the larger case.
  for (const autoConnect of [true, false]) {
    const preamble = promptPreamble('GLM-5.2-NVFP4', undefined, {skill, tools: granted, autoConnect});
    const result = await compactHistory({messages, model, preamble, tools: advertised, signal: signal(), invoke: summarize});
    assert(contextTokens([...preamble, ...result.messages], advertised) <= contextBudget(model).input);
    assert(result.messages.some(message => message.content === latest));
    assert(result.messages.some(message => message.content.includes('보내지 말 것')));
    assert.equal(result.memory.throughId, 'm3');
  }
  assert.deepEqual(messages, original);
  assert.equal(contextBudget(model).input, 13600);
});
test('run budget follows the currently advertised schemas and rechecks newly enabled groups', async () => {
  const wire = [{role: 'system', content: 'Preserve instructions'}, {role: 'user', content: 'Read this page'}];
  const largeCatalog = [{type: 'function', function: {name: 'large_tool', description: 'schema '.repeat(14000), parameters: {type: 'object'}}}];
  const context = createRunContext({model, tools: largeCatalog, signal: signal(), invoke: () => assert.fail('no older history to compact')});
  assert.deepEqual(await context.prepare(wire, false, []), wire);
  await assert.rejects(context.prepare(wire, false, largeCatalog), /context_input_too_large/);
  assert.deepEqual(await context.prepare(wire, false, []), wire);
});
function validPairs(wire) {for (const [i, m] of wire.entries()) if (m.role === 'tool') assert(wire.slice(0, i).some(a => a.tool_calls?.some(c => c.id === m.tool_call_id)));}

test('compaction uses real input/output limits and a fallback only for unknown models', () => {
  assert.equal(contextBudget({contextLength: 524288, maxInputTokens: 460800}).input, 460800);
  assert.equal(contextBudget({contextLength: 128000, maxInputTokens: 98304}).input, 98304);
  assert.equal(contextBudget({}).input, 120000);
  assert(contextBudget(model).input + contextBudget(model).output <= model.contextLength);
  assert.equal(contextBudget(model).trigger, Math.floor(contextBudget(model).input * .75));
});
test('summary validation rejects malformed output and strips token-shaped credentials', () => {
  assert.deepEqual(normalizeSummary('```json\n' + JSON.stringify(summary) + '\n```'), summary);
  for (const value of ['not json', {goal: 'x'}, {...summary, pending: 'text'}, {...summary, goal: 'x'.repeat(1201)}]) assert.equal(normalizeSummary(value), null);
  assert(!JSON.stringify(normalizeSummary({...summary, references: ['Bearer synthetic-secret', 'eyJabc.def.ghi']})).includes('synthetic-secret'));
  assert.equal(normalizePlan([{text: 'a', status: 'in_progress'}, {text: 'b', status: 'in_progress'}]), null);
});
test('old history compacts at whole turns, preserves original messages and newest corrections, and restores on reload', async () => {
  const messages = [...turn(0), ...turn(1), ...turn(2, '최근 답'), {id: 'u3', role: 'user', content: '제목은 9월 교육으로 고치고 보내지 마세요'}];
  const original = structuredClone(messages), saved = [], calls = [];
  const result = await compactHistory({messages, model, signal: signal(), invoke: async (...args) => {calls.push(args); return summarize();}, save: value => saved.push(value)});
  assert.deepEqual(messages, original); assert.equal(saved.length, 1); assert.equal(saved[0].memory.throughId, 'a1');
  assert(result.messages[0].content.includes('context_summary')); assert.equal(result.messages.at(-1).content, messages.at(-1).content);
  assert.equal(result.messages.some(m => m.content === original[1].content), false);
  assert(calls.every(([, options]) => options.summary && options.maxTokens === 2048));
  const again = await compactHistory({messages, memory: result.memory, model, signal: signal(), invoke: () => assert.fail('should reuse summary')});
  assert.deepEqual(again.messages, result.messages);
  assert(contextUsage(messages, '초안', model, false, '', {memory: result.memory}).used < contextUsage(messages, '초안', model).used);
});
test('lossy summaries cannot erase earlier literal user restrictions, including after reload and a second compaction', async () => {
  const messages = [...turn(0), {id: 'failed', role: 'assistant', state: 'error', content: 'not a visible completed turn'}, ...turn(1), ...turn(2, 'recent'), ...turn(3, 'latest')];
  messages[0].content = '검토용 초안만 작성하고 전송하지 마세요. 금액은 42원입니다.';
  const lossy = async () => ({content: JSON.stringify({...summary, constraints: [], goal: '페이지 작업'}), finishReason: 'stop'});
  const first = await compactHistory({messages, model, signal: signal(), invoke: lossy});
  assert(first.anchors[0].content.includes(messages[0].content));
  const restored = await compactHistory({messages, memory: first.memory, model, signal: signal(), invoke: () => assert.fail('reuse saved memory')});
  assert.deepEqual(restored.anchors, first.anchors);
  const run = createRunContext({model, tools: [], protectedMessages: restored.anchors, signal: signal(), invoke: lossy});
  const wire = [...restored.messages, ...pair('one', 'x'.repeat(28000)), ...pair('two', 'x'.repeat(28000)), ...pair('last', 'fresh')];
  const compacted = await run.prepare(wire);
  assert(compacted.some(m => m.content?.includes(messages[0].content))); validPairs(compacted);
  assert.equal(compacted.filter(m => m.content?.startsWith('<earlier_user_requests>')).length, 1);
});
test('verbatim anchors omit oversized whole requests and attached source text instead of cutting restrictions', async () => {
  const messages = [...turn(0), ...turn(1), ...turn(2, 'recent'), ...turn(3, 'latest')];
  messages[0].content = 'long requirement '.repeat(1800) + '절대 보내지 마세요';
  messages[2].content = [{type: 'text', text: '가격은 42원'}, {type: 'text', text: 'ATTACHED_SOURCE_NOT_A_REQUEST'}];
  const result = await compactHistory({messages, model, signal: signal(), invoke: summarize});
  const anchor = result.anchors[0].content;
  assert(anchor.includes('가격은 42원')); assert(anchor.includes('"omitted":1'));
  assert(!anchor.includes('long requirement')); assert(!anchor.includes('ATTACHED_SOURCE_NOT_A_REQUEST'));
  assert(contextTokens(result.anchors) <= Math.min(2048, Math.floor(contextBudget(model).input * .08)));
});
test('manual compaction extends the saved boundary without dropping previous memory or the latest turn', async () => {
  const messages = [...turn(0, 'old'), ...turn(1, 'recent'), ...turn(2, 'new')];
  const memory = {version: 1, throughId: 'a0', summary};
  let source;
  const result = await compactHistory({messages, memory, model, force: true, signal: signal(), invoke: async m => {source = JSON.stringify(m); return summarize();}});
  assert(source.includes('보내지 말 것')); assert.equal(result.memory.throughId, 'a1');
  assert.equal(result.messages.at(-1).content, 'new');
  assert.equal(historyContext(messages, {...memory, throughId: 'missing'}).summary, null);
  assert.equal(historyContext([...messages, {role: 'user', content: '/compact', contextOnly: true}], memory).messages.length, 4);
});
test('invalid, cancelled or oversized compaction does not advance durable memory', async () => {
  for (const mode of ['invalid', 'cancel', 'large']) {
    const saved = [], controller = new AbortController();
    const messages = [...turn(0), ...turn(1, mode === 'large' ? 'z'.repeat(120000) : 'recent')];
    await assert.rejects(compactHistory({messages, model, force: true, signal: controller.signal, invoke: async () => {
      if (mode === 'cancel') {controller.abort(); throw new Error('cancelled');}
      return mode === 'invalid' ? {content: '{}'} : summarize();
    }, save: value => saved.push(value)}));
    assert.equal(saved.length, 0);
  }
});
test('tool compaction keeps call/result batches paired and reuses its original transcript on overflow retry', async () => {
  const original = [{role: 'system', content: 'instructions'}, {role: 'user', content: summary.goal}, ...pair('a', 'a'.repeat(24000)), ...pair('b', 'b'.repeat(24000)), ...pair('c', 'latest'), ...pair('d', 'latest2')];
  const untouched = structuredClone(original), saved = [];
  const context = createRunContext({model, tools: [], goal: summary.goal, invoke: summarize, signal: signal(), save: value => saved.push(value)});
  const packed = await context.prepare(original);
  assert(contextTokens(packed) < contextTokens(original)); validPairs(packed); assert.deepEqual(original, untouched);
  assert(packed.some(m => m.content === summary.goal)); assert.equal(saved.length, 1);
  const continued = [...original, ...pair('e', 'fresh')];
  const next = await context.prepare(continued); validPairs(next);
  const withLivePlan = next.map(m => m.role === 'system' ? {...m, content: `${m.content}\nCurrent plan: verify the draft, final send still requires approval.`} : m);
  const forced = await context.prepare(withLivePlan, true); validPairs(forced);
  assert(forced[0].content.includes('Current plan: verify the draft, final send still requires approval.'));
  assert(forced.some(m => m.tool_call_id === 'd')); assert(forced.some(m => m.tool_call_id === 'e'));
  assert(!forced.some(m => m.tool_call_id === 'a'));
});
test('checkpoint marks an interrupted write unknown, bounds receipts, and excludes action arguments', () => {
  let task = {goal: summary.goal, steps: [], plan: [{text: '초안 확인', status: 'pending'}]};
  task = taskReceipt(task, 'fill_form', 'start');
  task = taskReceipt(task, 'fill_form', 'end', {applied: 1, verified: true, script: 'private code'}, {url: 'https://mail.example.test/draft?secret=x', title: '메일'});
  task = taskReceipt(task, 'click_element', 'start');
  task = pauseTask(task);
  assert.equal(task.steps[0].verified, true); assert.equal(task.steps[1].status, 'unknown');
  const prompt = resumeMessage(task).content;
  assert(prompt.includes('verify it instead of replaying')); assert(!prompt.includes('private code')); assert(!prompt.includes('secret=x'));
});
function provider(t, fetchImpl, type = 'aipro') {
  const before = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  t.after(() => Object.assign(globalThis, before));
  globalThis.chrome = {runtime: {sendMessage: async () => ({ok: true})}, storage: {session: {get: async () => ({credential: {receivedAt: 1, token: type === 'chatgpt' ? chatgptToken() : 'synthetic', mode: 'browser', provider: type}})}}};
  globalThis.fetch = fetchImpl;
}
const answer = (content, calls) => Response.json({choices: [{message: {content, ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}});
test('auto compaction uses the selected provider and records summary usage independently from the answer', async t => {
  const calls = [], usage = [], saved = [];
  provider(t, async (_, options) => {const body = JSON.parse(options.body); calls.push(body); return answer(body.messages[0].content.startsWith('Summarize conversation') ? JSON.stringify(summary) : '완료');});
  const text = await completeChat({modelId: model.name, model, credentialReceivedAt: 1, messages: [...turn(0), ...turn(1), ...turn(2, 'recent'), {role: 'user', id: 'u3', content: '다음'}]}, signal(), undefined, undefined, undefined, undefined, undefined, undefined, event => usage.push(event), event => saved.push(event));
  assert.equal(text, '완료'); assert(calls.length >= 2); assert.equal(saved.length, 1);
  assert.equal(calls[0].tools, undefined); assert.equal(calls[0].max_tokens, 2048);
  assert(calls.at(-1).messages.some(m => m.content.includes?.('context_summary')));
  assert.equal(usage.filter(e => e.phase === 'report').length, calls.length);
});
test('an explicit context overflow retries only the model request, never a completed browser write', async t => {
  let normal = 0, writes = 0, summaries = 0;
  provider(t, async (_, options) => {const body = JSON.parse(options.body);
    if (body.messages[0].content.startsWith('Summarize conversation')) {summaries++; return answer(JSON.stringify(summary));}
    normal++;
    if (normal === 1) return answer('', [{id: 'write', type: 'function', function: {name: 'fill_form', arguments: '{}'}}]);
    if (normal === 2) return Response.json({error: {code: 'context_length_exceeded'}}, {status: 400});
    validPairs(body.messages); return answer('초안 확인');
  });
  const tools = [{type: 'function', function: {name: 'fill_form', parameters: {type: 'object', properties: {}}}}];
  assert.equal(await completeChat({modelId: 'test', model: {...model, contextLength: 128000}, credentialReceivedAt: 1, messages: [...turn(0, 'z'.repeat(8000)), {role: 'user', content: summary.goal}], tools}, signal(), undefined, undefined, undefined, undefined, async () => {writes++; return {applied: 1, verified: true};}), '초안 확인');
  assert.equal(writes, 1); assert.equal(summaries, 1); assert.equal(normal, 3);
});

test('first mid-run compaction preserves early browser requests without a prior history summary', async t => {
  const requests = ['초안만 작성하고 발송하지 마세요.', '가격은 42원입니다.', '받는 사람은 검토팀입니다.', '표의 날짜를 보존하세요.', '계속 진행해주세요.'];
  const missing = [];
  let normal = 0, summaries = 0;
  provider(t, async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.messages[0].content.startsWith('Summarize conversation')) {summaries++; return answer(JSON.stringify({...summary, constraints: [], goal: '계속 진행'}));}
    normal++;
    if (normal === 1) return answer('', [{id: 'read', type: 'function', function: {name: 'read_page', arguments: '{}'}}]);
    if (normal === 2) return Response.json({error: {code: 'context_length_exceeded'}}, {status: 400});
    assert(summaries > 0);
    for (const request of requests) if (!JSON.stringify(body.messages).includes(request)) missing.push(request);
    validPairs(body.messages);
    return answer('초안 조건 확인');
  });
  const tools = [{type: 'function', function: {name: 'read_page', parameters: {type: 'object', properties: {}}}}];
  const messages = requests.flatMap((content, i) => [{id: `u${i}`, role: 'user', content}, {id: `a${i}`, role: 'assistant', state: 'done', content: '확인했습니다. ' + 'background '.repeat(200)}]);
  messages.pop();
  const result = await completeChat({modelId: 'test', model: {...model, contextLength: 128000, maxInputTokens: 98304}, credentialReceivedAt: 1, messages, tools}, signal(), undefined, undefined, undefined, undefined, async () => ({text: 'source '.repeat(2500)}));
  assert.equal(result, '초안 조건 확인'); assert.equal(normal, 3); assert.equal(summaries, 1);
  assert.deepEqual(missing, []);
});
test('resume observes before the first model request and does not replay checkpointed actions', async t => {
  let inspected = false;
  provider(t, async (_, options) => {assert(inspected); const wire = JSON.parse(options.body).messages; assert(wire.some(m => m.content.includes?.('task_checkpoint'))); assert(wire.some(m => m.content.includes?.('Fresh browser observation'))); return answer('초안이 남아 있습니다.');});
  const tools = [{type: 'function', function: {name: 'browser_snapshot', parameters: {type: 'object', properties: {}}}}];
  await completeChat({modelId: 'test', credentialReceivedAt: 1, messages: [{role: 'user', content: summary.goal}], resumeTask: {goal: summary.goal, steps: [{tool: 'fill_form', status: 'done'}]}, tools}, signal(), undefined, undefined, undefined, undefined, async name => {assert.equal(name, 'browser_snapshot'); inspected = true; return {title: '메일 초안', text: '저장됨'};});
});
test('ChatGPT compaction stays on Responses with no tools and uses its own summary in the next request', async t => {
  const calls = [];
  provider(t, async (_, options) => {
    const body = JSON.parse(typeof options.body === 'string' ? options.body : zstdDecompressSync(options.body).toString()); calls.push(body);
    return new Response(responsesSSE({text: body.instructions.startsWith('Summarize conversation') ? JSON.stringify(summary) : 'ChatGPT 작업 완료'}), {headers: {'content-type': 'text/event-stream'}});
  }, 'chatgpt');
  const result = await completeChat({provider: 'chatgpt', modelId: 'gpt-5.6-sol', model, credentialReceivedAt: 1, messages: [...turn(0), ...turn(1), ...turn(2, 'recent'), {role: 'user', id: 'u3', content: '다음'}]}, signal());
  assert.equal(result, 'ChatGPT 작업 완료'); assert(calls.length >= 2); assert.equal(calls[0].tools, undefined);
  assert(JSON.stringify(calls.at(-1).input).includes('context_summary'));
});
test('a late summary after cancellation never persists or exposes a partial summary as the answer', async () => {
  const controller = new AbortController(), saved = [];
  await assert.rejects(compactHistory({messages: [...turn(0), ...turn(1)], model, force: true, signal: controller.signal, invoke: async () => {controller.abort(); return summarize();}, save: value => saved.push(value)}), /cancelled/);
  assert.equal(saved.length, 0);
  await assert.rejects(compactHistory({messages: [...turn(0), ...turn(1)], model, force: true, signal: signal(), invoke: async () => {throw Object.assign(new Error('network'), {partial: 'internal unfinished summary'});}}), error => error.message === 'network' && error.partial === undefined);
});

test('malformed or truncated summaries are repaired from the original source before saving', async () => {
  for (const first of [{content: '{}'}, {content: JSON.stringify(summary), finishReason: 'length'}]) {
    const calls = [], saved = [];
    await compactHistory({messages: [...turn(0), ...turn(1, 'recent')], model, force: true, signal: signal(),
      invoke: async (input, options) => {calls.push({input, options}); return calls.length === 1 ? first : summarize();}, save: value => saved.push(value)});
    assert.equal(calls.length, 2); assert.equal(saved.length, 1);
    assert.deepEqual(calls[0].input.slice(1), calls[1].input.slice(1));
    assert(calls[1].options.maxTokens > calls[0].options.maxTokens);
    assert.deepEqual(saved[0].memory.summary, summary);
  }
});
test('failed automatic history compaction preserves the original while it fits; manual and oversized requests still report failure', async () => {
  const messages = [...turn(0, 'x'.repeat(44000)), ...turn(1, 'recent'), ...turn(2, 'latest')], original = structuredClone(messages);
  const before = contextTokens(messages); assert(before > contextBudget(model).trigger && before < contextBudget(model).input);
  let saved = 0;
  const options = {messages, model, signal: signal(), invoke: async () => ({content: 'not JSON'}), save: () => saved++};
  const result = await compactHistory(options);
  assert.deepEqual(result.messages, messages.map(({role, content}) => ({role, content}))); assert.equal(result.memory, null);
  assert.deepEqual(messages, original); assert.equal(saved, 0);
  await assert.rejects(compactHistory({...options, force: true}), /context_compaction_failed/);
  await assert.rejects(compactHistory({...options, messages: [...turn(0, 'x'.repeat(70000)), ...turn(1, 'recent'), ...turn(2, 'latest')]}), /context_compaction_failed/);
  assert.equal(saved, 0);
});
test('in-run summary failure defers redundant retries without dropping tool pairs or ignoring the input limit', async () => {
  const wire = [{role: 'system', content: 'system'}, {role: 'user', content: summary.goal}, ...pair('old', 'x'.repeat(44000)), ...pair('recent', 'latest'), ...pair('last', 'last')];
  let calls = 0;
  const context = createRunContext({model, tools: [], goal: summary.goal, signal: signal(), invoke: async () => {calls++; return {content: '{}'};}, save: () => assert.fail('must not save')});
  assert.deepEqual(await context.prepare(wire), wire); assert.equal(calls, 2);
  const continued = [...wire, ...pair('next', 'small')];
  assert.deepEqual(await context.prepare(continued), continued); assert.equal(calls, 2);
  await assert.rejects(context.prepare([...continued, ...pair('huge', 'x'.repeat(20000))]), /context_compaction_failed/);
  assert.equal(calls, 4);
});
test('long tasks compact repeatedly beyond the former six-summary cap', async () => {
  const wire = [{role: 'system', content: 'system'}, {role: 'user', content: summary.goal}], saved = [];
  const context = createRunContext({model, tools: [], goal: summary.goal, signal: signal(), invoke: summarize, save: value => saved.push(value)});
  for (let i = 0; i < 10; i++) {
    wire.push(...pair(`large-${i}`, 'x'.repeat(44000)), ...pair(`small-${i}`, 'fresh'), ...pair(`new-${i}`, 'new'));
    const result = await context.prepare(wire); validPairs(result);
    assert(result.some(message => message.tool_call_id === `new-${i}`));
    assert(contextTokens(result) < contextBudget(model).input);
  }
  assert.equal(saved.length, 10);
});
test('failed checkpoint persistence leaves the live cursor unchanged for the next preparation', async () => {
  const wire = [{role: 'user', content: summary.goal}, ...pair('old', 'x'.repeat(44000)), ...pair('recent', 'recent'), ...pair('new', 'new')];
  let saves = 0, summaries = 0;
  const context = createRunContext({model, tools: [], goal: summary.goal, signal: signal(), invoke: async () => {summaries++; return summarize();}, save: () => {if (++saves === 1) throw new Error('storage_failed');}});
  await assert.rejects(context.prepare(wire), /storage_failed/);
  const firstCalls = summaries;
  const result = await context.prepare(wire); validPairs(result);
  assert.equal(summaries, firstCalls * 2); assert.equal(saves, 2);
});
test('provider calls and usage continue past sixty-four model requests', async t => {
  let count = 0, actions = 0;
  const reports = [];
  provider(t, async () => {
    count++;
    return count <= 70 ? answer('', [{id: `call-${count}`, type: 'function', function: {name: 'read_page', arguments: '{}'}}]) : answer('완료');
  });
  const tools = [{type: 'function', function: {name: 'read_page', parameters: {type: 'object', properties: {}}}}];
  const result = await completeChat({modelId: 'test', model: {...model, contextLength: 128000, maxInputTokens: 98304}, credentialReceivedAt: 1, messages: [{role: 'user', content: '계속 확인'}], tools}, signal(), undefined, undefined, undefined, undefined, async () => ({revision: ++actions}), undefined, event => reports.push(event));
  assert.equal(result, '완료'); assert.equal(actions, 70);
  assert.equal(reports.filter(event => event.phase === 'report').length, 71);
  assert.equal(reports.at(-1).round, 71);
});
test('an invalid auto-summary still allows the provider answer without immediately repeating the failed summary', async t => {
  let summaries = 0, answers = 0;
  // Exercise the interval between auto-compaction and the hard input limit,
  // independently of changes to the shared browser instructions.
  const tail = [...turn(1, 'recent'), ...turn(2, 'latest'), {role: 'user', content: '계속'}];
  const preamble = promptPreamble(model.name), budget = contextBudget(model);
  const room = Math.floor(budget.input * .875) - contextTokens([...preamble, ...turn(0, ''), ...tail]);
  assert(room > 0);
  const history = 'x'.repeat(room * 4), messages = [...turn(0, history), ...tail];
  const input = contextTokens([...preamble, ...messages]);
  assert(input > budget.trigger && input < budget.input);
  provider(t, async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.messages[0].content.startsWith('Summarize conversation')) {summaries++; return answer('{}');}
    answers++; assert(body.messages.some(message => message.content === history)); return answer('계속 진행합니다');
  });
  const result = await completeChat({modelId: model.name, model, credentialReceivedAt: 1, messages}, signal());
  assert.equal(result, '계속 진행합니다'); assert.equal(summaries, 2); assert.equal(answers, 1);
});

test('Qwen request continuation after in-run compaction preserves the literal restriction and never replays the applied draft', async t => {
  let stage = 0, summaries = 0, writes = 0, sawReceipt = false;
  const tools = ['fill_form', 'read_page', 'verify_page'].map(name => ({type: 'function', function: {name, parameters: {type: 'object', properties: {}}}}));
  provider(t, async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages.filter(m => m.role === 'system').length, 1);
    if (body.messages[0].content.startsWith('Summarize conversation')) {summaries++; return answer(JSON.stringify({...summary, constraints: []}));}
    if (summaries) {
      assert(body.messages.some(m => m.content === '검토용 초안만 작성하고 보내지 마세요.'));
      const receipt = body.messages.find(m => m.content?.includes?.('<continuity_evidence>'));
      assert(receipt?.content.includes('fill_form')); assert(receipt.content.includes('"applied":1')); sawReceipt = true;
    }
    const tool = ['fill_form', 'read_page', 'read_page', 'verify_page'][stage++];
    return tool ? answer('', [{id: `stage-${stage}`, type: 'function', function: {name: tool, arguments: '{}'}}]) : answer('초안만 반영하고 확인했습니다.');
  });
  const result = await completeChat({modelId: 'QWEN3.8-27B-FP8-256K', model: {...model, contextLength: 32000, maxInputTokens: 28000}, credentialReceivedAt: 1, tools,
    messages: [{role: 'user', content: '검토용 초안만 작성하고 보내지 마세요.'}, {role: 'assistant', content: '확인하겠습니다.'}, {role: 'user', content: '계속 진행해주세요.'}]},
    signal(), undefined, undefined, undefined, undefined, async name => {
      if (name === 'fill_form') {writes++; return {ok: true, applied: 1, verified: false};}
      if (name === 'read_page') return {text: `read ${stage}: ` + 'evidence '.repeat(3800)};
      return {ok: true, verified: true};
    });
  assert.equal(result, '초안만 반영하고 확인했습니다.'); assert.equal(writes, 1); assert(summaries > 0); assert(sawReceipt);
});
test('steered goal and earlier literal restrictions both survive already-compacted tool history',async()=>{
 let goal='초안을 작성하세요';const restriction='검토용 초안만 작성하고 보내지 마세요.';
 const context=createRunContext({model,tools:[],goal,getGoal:()=>goal,requirements:[restriction,'계속 진행해주세요.'],signal:signal(),invoke:summarize});
 const wire=[{role:'system',content:'instructions'},{role:'user',content:restriction},...pair('a','a'.repeat(24000)),...pair('b','b'.repeat(24000)),...pair('c','recent'),...pair('d','latest')];
 await context.prepare(wire);goal+='\n사용자 변경 요청: 본문을 짧게 바꾸세요.';
 const next=await context.prepare([...wire,{role:'user',content:'본문을 짧게 바꾸세요.'}]);
 assert(next.some(m=>m.content===goal));assert(next.some(m=>m.content===restriction));validPairs(next);
});

test('durable receipts never mark explicit failed or unverified checks as done',()=>{
 for(const [tool,result] of [['fill_form',{ok:false}],['verify_page',{ok:true,verified:false}],['verify_page',{ok:false,verified:false}]]) {
  const started=taskReceipt({steps:[]},tool,'start');const ended=taskReceipt(started,tool,'end',result);
  assert.equal(ended.steps[0].status,'error',JSON.stringify(result));
 }
 const cancelled=taskReceipt(taskReceipt({steps:[]},'fill_form','start'),'fill_form','end',{cancelled:true,ok:false});assert.equal(cancelled.steps[0].status,'unknown');
});
