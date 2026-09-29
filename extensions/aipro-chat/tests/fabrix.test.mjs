import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanFabrixCredentials, cleanFabrixConnection, normalizeFabrixModels, fabrixModels, fabrixEndpoint, fabrixRequest, fabrixCompletion, fabrixToolMessage, fabrixUsage, testFabrixConnection} from '../fabrix.js';
import {completeChat, readCompletion, fetchModels} from '../src/api.js';
import {recordUsage, usageSummary} from '../usage-ledger.js';
import {inspectModelList} from '../core.js';
import {contextBudget} from '../context-manager.js';
import {BUILTIN_SKILLS, browserTools} from '../skills.js';
import {connection, models, protocol, conversation, toolReply, messageReply, probeReply, nativeResponse} from './fixtures/fabrix.mjs';

const tools = browserTools(null, BUILTIN_SKILLS[0], connection.modelId, {autoConnect: true, vision: false});
const request = extra => ({model: connection.modelId, messages: [{role: 'system', content: 'Keep task instructions.'}, {role: 'user', content: '페이지를 확인하세요.'}], max_tokens: 1024, ...extra});
const measure = {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120};
function install(t, fetchImpl, credential = {...cleanFabrixConnection(connection), provider: 'fabrix', receivedAt: 10}) {
  const old = {fetch: globalThis.fetch, chrome: globalThis.chrome};
  globalThis.fetch = fetchImpl;
  globalThis.chrome = {storage: {session: {get: async () => ({credential, catalog: {credentialReceivedAt: credential.receivedAt, models: inspectModelList(normalizeFabrixModels(models)).models}})}}};
  t.after(() => {globalThis.fetch = old.fetch; globalThis.chrome = old.chrome;});
  return credential;
}

test('FabriX matches the router endpoint, headers and body without sending credentials in prompts', async () => {
  const c = cleanFabrixConnection({...connection, token: 'Bearer synthetic-token'});
  assert.equal(c.token, connection.token);
  assert.equal(c.endpoint, 'https://fabrix.example.test/openapi/chat/v1/messages');
  assert.equal(fabrixEndpoint(c.endpoint + '/'), c.endpoint);
  assert.equal(fabrixEndpoint('https://fabrix.example.test/base/'), 'https://fabrix.example.test/base/chat/v1/messages');
  const response = await fabrixCompletion(request({temperature: .2, top_p: .9}), c, {fetchImpl: async (url, options) => {
    assert.equal(url, c.endpoint); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, {'Content-Type': 'application/json', Accept: 'application/json', 'x-fabrix-client': connection.clientKey, 'x-openapi-token': `Bearer ${connection.token}`});
    assert.deepEqual(JSON.parse(options.body), {modelIds: [c.modelId], contents: ['페이지를 확인하세요.'], isStream: false, systemPrompt: 'Keep task instructions.', llmConfig: {max_new_tokens: 1024, temperature: .2, top_p: .9}});
    assert(!options.body.includes(connection.token));
    return nativeResponse('확인했습니다.', {usage: measure});
  }});
  assert.equal(await readCompletion(response), '확인했습니다.');
});
test('FabriX validates endpoints and refuses unsupported media and tool choice before fetching', async () => {
  for (const endpoint of ['http://example.test', 'https://u:p@example.test', 'https://example.test?q=key', 'https://example.test/#key', 'file:///etc/passwd']) assert.throws(() => cleanFabrixConnection({...connection, endpoint}), /fabrix_endpoint/);
  assert.throws(() => cleanFabrixConnection({...connection, clientKey: 'x\r\nkey'}), /fabrix_credentials/);
  assert.throws(() => cleanFabrixConnection({...connection, maxOutputTokens: 2}), /fabrix_model_limits/);
  let fetched = false;
  for (const extra of [{model: 'other'}, {tool_choice: 'required'}, {messages: [{role: 'user', content: [{type: 'image_url', image_url: {url: 'data:image/png;base64,x'}}]}]}]) {
    await assert.rejects(fabrixCompletion(request(extra), connection, {fetchImpl: async () => {fetched = true;}}));
  }
  assert.equal(fetched, false);
});
test('tool envelopes preserve system instructions and role-linked results but cannot invoke undeclared calls', () => {
  const body = fabrixRequest(request({tools, messages: [{role: 'system', content: 'Do not send.'}, {role: 'user', content: 'Compose.'}, {role: 'assistant', content: null, tool_calls: [{id: 'c1', type: 'function', function: {name: 'inspect_dom', arguments: '{}'}}]}, {role: 'tool', tool_call_id: 'c1', content: '{"fields":[]}'}]}), connection, 'nonce');
  assert(body.systemPrompt.startsWith('Do not send.'));
  assert.deepEqual(conversation(body).at(-1), {role: 'tool', content: '{"fields":[]}', tool_call_id: 'c1'});
  const valid = {protocol, request_id: 'nonce', type: 'tool_calls', tool_calls: [{name: 'inspect_dom', arguments: {}}]};
  assert.equal(fabrixToolMessage(JSON.stringify(valid), 'nonce', tools).tool_calls[0].function.name, 'inspect_dom');
  for (const value of [{...valid, request_id: 'stale'}, {...valid, tool_calls: [{name: 'arbitrary_function', arguments: {}}]}, {...valid, tool_calls: [{name: 'inspect_dom', arguments: 'code()'}]}, {...valid, tool_calls: Array(9).fill(valid.tool_calls[0])}]) assert.throws(() => fabrixToolMessage(JSON.stringify(value), 'nonce', tools), /fabrix_tool_protocol/);
  assert.throws(() => fabrixToolMessage('Example: ' + JSON.stringify(valid), 'nonce', tools), /fabrix_tool_protocol/);
});
test('byte-split CRLF SSE preserves Korean, excludes THINK and ends on DONE without waiting for EOF', async () => {
  const raw = (await nativeResponse('한글 응답', {stream: true, usage: measure}).text()).replaceAll('\n', '\r\n');
  let cancelled = false, measured;
  const body = new ReadableStream({start(c) {for (const byte of new TextEncoder().encode(raw)) c.enqueue(Uint8Array.of(byte));}, cancel() {cancelled = true;}});
  const response = await fabrixCompletion(request({stream: true}), connection, {fetchImpl: async () => new Response(body, {headers: {'Content-Type': 'text/event-stream'}}), onMeasurement: value => {measured = value;}});
  assert.equal(await readCompletion(response), '한글 응답'); assert.equal(cancelled, true); assert.deepEqual(measured, measure);
});
test('filtering, incomplete streams, truncation and HTTP errors never yield executable tools', async () => {
  const cases = [
    [() => Response.json({status: 'SUCCESS', content: 'x', filterBlockReason: {resultCode: 'FR-999'}}), 'response_filtered'],
    [() => Response.json({status: 'ERROR', content: 'private'}), 'upstream'],
    [() => new Response('data: {"eventStatus":"CHUNK","content":"x"}\n\n', {headers: {'Content-Type': 'text/event-stream'}}), 'model_stream_incomplete'],
    [body => nativeResponse(toolReply(body, 'inspect_dom'), {stream: true, finish: 'length'}), 'output_limit'],
    [() => new Response('private', {status: 413}), 'context_overflow'],
    [() => new Response('private', {status: 401}), 'unauthorized'],
  ];
  for (const [reply, expected] of cases) await assert.rejects(fabrixCompletion(request({tools, stream: true}), connection, {fetchImpl: async (_, opts) => reply(JSON.parse(opts.body))}), error => error.message === expected, expected);
});
test('FabriX preserves Retry-After without retrying inside its protocol adapter', async () => {
  let requests = 0;
  await assert.rejects(fabrixCompletion(request({tools, stream: true}), connection, {fetchImpl: async () => {
    requests++; return new Response('PRIVATE', {status: 429, headers: {'Retry-After': '8'}});
  }}), error => error.status === 429 && error.retryAfterMs === 8000 && !JSON.stringify(error).includes('PRIVATE'));
  assert.equal(requests, 1);
});
test('cancellation interrupts a pending stream and optional measurement failures do not break answers', async () => {
  const controller = new AbortController(); let entered, cancelled = false;
  const ready = new Promise(resolve => {entered = resolve;});
  const pending = fabrixCompletion(request({stream: true}), connection, {signal: controller.signal, fetchImpl: async () => new Response(new ReadableStream({start() {entered();}, cancel() {cancelled = true;}}), {headers: {'Content-Type': 'text/event-stream'}})});
  await ready; controller.abort(); await assert.rejects(pending, /cancelled/); assert(cancelled);
  const response = await fabrixCompletion(request(), connection, {fetchImpl: async () => nativeResponse('완료', {usage: measure}), onMeasurement: () => {throw new Error('storage');}});
  assert.equal(await readCompletion(response), '완료');
});
test('usage remains unknown unless reported, and legacy ledgers add FabriX without losing existing totals', () => {
  assert.equal(fabrixUsage({content: 'text', tokenCount: 20}), null);
  assert.deepEqual(fabrixUsage({tokenUsage: {inputTokens: 100, outputTokens: 20}}), measure);
  let ledger = recordUsage(null, {provider: 'aipro', requestId: 'old', round: 1, phase: 'report', usage: measure});
  delete ledger.total.fabrix; for (const day of Object.values(ledger.days)) delete day.fabrix;
  assert.equal(usageSummary(ledger).total.fabrix.total, 0);
  ledger = recordUsage(ledger, {provider: 'fabrix', requestId: 'new', round: 1, phase: 'report', usage: measure});
  assert.equal(usageSummary(ledger).total.aipro.total, 120); assert.equal(usageSummary(ledger).total.fabrix.total, 120);
});
test('connection test checks both a nonce tool call and the tool-result follow-up, not merely HTTP 200', async () => {
  const requests = [], usage = [];
  assert.deepEqual(await testFabrixConnection(connection, {fetchImpl: async (_, opts) => {const body = JSON.parse(opts.body); requests.push(body); return nativeResponse(probeReply(body), {stream: body.isStream, usage: measure});}, onUsage: (round, value) => usage.push({round, value})}), {response: true, tools: true, status: 200});
  assert.deepEqual(requests.map(body => body.isStream), [false, true]); assert.deepEqual(usage.map(value => value.round), [1, 2]);
  await assert.rejects(testFabrixConnection(connection, {fetchImpl: async (_, opts) => nativeResponse(messageReply(JSON.parse(opts.body), 'Hello'))}), /fabrix_tool_test/);
  await assert.rejects(testFabrixConnection(connection, {fetchImpl: async (_, opts) => {const body = JSON.parse(opts.body); return nativeResponse(body.isStream ? messageReply(body, 'wrong value') : probeReply(body));}}), /fabrix_tool_test/);
});
test('FabriX uses the same Pi loop, validates arguments, keeps tool results and counts each round once', async t => {
  let round = 0, ledger; const executed = [];
  install(t, async (_, opts) => {
    const body = JSON.parse(opts.body), messages = conversation(body); round++;
    assert.equal(body.llmConfig.max_new_tokens, 4096);
    let text;
    if (round === 1) text = toolReply(body, 'read_page_storage', {area: 'cookies', keys: []});
    else if (round === 2) {assert.equal(JSON.parse(messages.at(-1).content).error, 'tool_arguments_invalid'); text = toolReply(body, 'inspect_dom');}
    else if (round === 3) {assert.deepEqual(JSON.parse(messages.at(-1).content), {fields: [{id: 'f1'}], analysis_evidence_id: 'ev_1'}); text = toolReply(body, 'fill_form', {fields: [{field_id: 'f1', value: '테스트'}]});}
    else {assert.equal(JSON.parse(messages.at(-1).content).verified, true); text = messageReply(body, '입력을 확인했습니다.');}
    return nativeResponse(text, {stream: true, usage: measure});
  });
  const result = await completeChat({provider: 'fabrix', credentialReceivedAt: 10, modelId: connection.modelId, model: {name: connection.modelId, maxOutputTokens: 4096}, messages: [{role: 'user', content: '입력해줘'}], tools}, new AbortController().signal, undefined, undefined, undefined, undefined,
    async name => {executed.push(name); return name === 'inspect_dom' ? {fields: [{id: 'f1'}]} : {verified: true};}, undefined,
    event => {ledger = recordUsage(ledger, {...event, provider: 'fabrix', requestId: 'run'});});
  assert.equal(result, '입력을 확인했습니다.'); assert.deepEqual(executed, ['inspect_dom', 'fill_form']);
  assert.equal(usageSummary(ledger).total.fabrix.calls, 4); assert.equal(usageSummary(ledger).total.fabrix.total, 480); assert.equal(usageSummary(ledger).total.aipro.total, 0);
});
test('model discovery uses authenticated GET, Korean labels and original IDs without generating tokens', async t => {
  install(t, async (url, options) => {
    assert.equal(url, 'https://fabrix.example.test/openapi/chat/v1/models');
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, {Accept: 'application/json', 'x-fabrix-client': connection.clientKey, 'x-openapi-token': `Bearer ${connection.token}`});
    return Response.json(models);
  });
  const catalog = await fetchModels(10), model = inspectModelList(catalog.payload).models[0];
  assert.equal(catalog.status, 200); assert.equal(model.name, connection.modelId); assert.equal(model.displayName, '테스트 모델');
  assert.equal(model.contextLength, 131072); assert.equal(contextBudget(model).output, 4096);
  assert(tools.some(tool => tool.function.name === 'run_playwright'));
  assert(!tools.some(tool => ['capture_page', 'click_at'].includes(tool.function.name)));
  await assert.rejects(fetchModels(11), /no_credential/);
  assert.equal(cleanFabrixCredentials({...connection, modelId: undefined}).endpoint, fabrixEndpoint(connection.endpoint));
});
test('model discovery handles the supplied multilingual catalog, missing metadata and invalid responses', async () => {
  const {readFile} = await import('node:fs/promises');
  const supplied = JSON.parse(await readFile(new URL('./fixtures/fabrix-models.json', import.meta.url), 'utf8'));
  const catalog = normalizeFabrixModels(supplied).modelList;
  assert.equal(catalog.length, 8); assert.equal(catalog[0].display_name, 'Samsung 2.3 37B');
  assert.equal(catalog[0].name, supplied[0].modelId); assert.equal(catalog[3].context_length, 409600);
  const fallback = normalizeFabrixModels([{modelId: 'en', name: [{languageCode: 'en', content: 'English'}]}, ...models, models[0]]).modelList;
  assert.equal(fallback.length, 3); assert.equal(fallback[0].context_length, null);
  assert.throws(() => normalizeFabrixModels([{modelId: 'x'.repeat(201), name: 'Invalid'}]), /models_invalid/);
  assert.deepEqual(normalizeFabrixModels([]), {modelList: []});
  for (const payload of [{data: models}, [{modelId: 'id'}], null]) assert.throws(() => normalizeFabrixModels(payload), /models_invalid/);
  for (const response of [Response.json({}, {status: 401}), Response.json({}, {status: 403}), Response.json({}), new Response('<html>login</html>')]) {
    await assert.rejects(fabrixModels(connection, {fetchImpl: async () => response}), /unauthorized|forbidden|models_invalid/);
  }
  for (const endpoint of ['https://fabrix.example.test/openapi', 'https://fabrix.example.test/openapi/chat/v1', 'https://fabrix.example.test/openapi/chat/v1/models']) assert.equal(fabrixEndpoint(endpoint), fabrixEndpoint(connection.endpoint));
});
test('the selected discovered ID reaches FabriX and unknown IDs are rejected before an HTTP call', async t => {
  let calls = 0;
  install(t, async (_, opts) => {calls++; assert.deepEqual(JSON.parse(opts.body).modelIds, ['second-model-id']); return nativeResponse('완료');});
  const run = modelId => completeChat({provider: 'fabrix', credentialReceivedAt: 10, modelId, model: {maxOutputTokens: 4096}, messages: [{role: 'user', content: '테스트'}]}, new AbortController().signal);
  assert.equal(await run('second-model-id'), '완료'); assert.equal(calls, 1);
  await assert.rejects(run('unlisted'), /invalid_model/); assert.equal(calls, 1);
});
test('FabriX context compaction shares the existing summary contract and preserves original messages', async t => {
  const summary = {goal: '초안 작성', constraints: ['보내지 말 것'], decisions: [], completed: [], pending: ['본문 입력'], references: []}, saved = [];
  const messages = Array.from({length: 3}, (_, i) => [{id: `u${i}`, role: 'user', content: `질문 ${i}`}, {id: `a${i}`, role: 'assistant', state: 'done', content: `답변 ${i}`}]).flat(), original = structuredClone(messages);
  install(t, async (_, opts) => {const body = JSON.parse(opts.body); assert(!body.systemPrompt?.includes(protocol)); return nativeResponse(JSON.stringify(summary), {stream: true});});
  await completeChat({provider: 'fabrix', credentialReceivedAt: 10, modelId: connection.modelId, model: {maxOutputTokens: 4096}, compact: true, messages, tools}, new AbortController().signal, undefined, undefined, undefined, undefined, undefined, undefined, undefined, value => saved.push(value));
  assert.deepEqual(messages, original); assert.equal(saved.length, 1); assert.deepEqual(saved[0].memory.summary, summary);
});
