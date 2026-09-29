import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanCredential, callbackMatches, endpoint, cleanSettings} from '../core.js';
import {readCompletion} from '../src/api.js';

const now = 1800000000000;
const jwt = (expiry) => `header.${Buffer.from(JSON.stringify({exp: expiry, sub: 'synthetic'})).toString('base64url')}.signature`;
test('the extension migrates the saved VS Code login route to CLI while preserving model and credential mode', () => {
  assert.deepEqual(cleanSettings({loginRoute:'vscode',mode:'apiKey',modelId:'saved-model'}), {loginRoute:'cli',mode:'apiKey',modelId:'saved-model'});
  assert.equal(cleanSettings().loginRoute, 'cli');
});
test('callback URLs are loopback only and secrets match the selected credential type', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert(callbackMatches(`http://${host}:50000/auth`, 50000));
  for (const url of ['https://localhost:50000/', 'http://localhost:50001/', 'http://user@localhost:50000/', 'http://localhost.evil:50000/']) assert(!callbackMatches(url, 50000));
  assert.throws(() => cleanCredential('opaque-test-key', 'browser', now), /invalid_token/);
  assert.throws(() => cleanCredential(jwt(now / 1000 - 1), 'browser', now), /expired_token/);
  assert.throws(() => cleanCredential(jwt(0), 'browser', now), /expired_token/);
  assert.throws(() => cleanCredential('key\nwithheader', 'apiKey', now), /invalid_token/);
  assert.equal(cleanCredential(`jwt=${jwt(now / 1000 + 60)}`, 'browser', now).token, jwt(now / 1000 + 60));
  assert.equal(cleanCredential('Bearer opaque-test-key', 'apiKey', now).token, 'opaque-test-key');
  assert.equal(endpoint('browser'), 'https://aipro.sdsdev.co.kr/api/v1/chat/completions');
  assert.equal(endpoint('apiKey'), 'https://aipro.sdsdev.co.kr/open/api/v1/chat/completions');
});
test('SSE parser survives arbitrary UTF-8 and CRLF chunk boundaries', async () => {
  const text = ':keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"안녕하세요"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" 세계"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const encoded = new TextEncoder().encode(text);
  for (const size of [1, 2, 3, 7, 32, 1024]) {
    const body = new ReadableStream({start(controller) {for (let offset = 0; offset < encoded.length; offset += size) controller.enqueue(encoded.slice(offset, offset + size)); controller.close();}});
    assert.equal(await readCompletion(new Response(body, {headers: {'content-type': 'text/event-stream'}})), '안녕하세요 세계');
  }
});
test('truncated and error streams remain errors; JSON responses are supported', async () => {
  const sse = (body) => new Response(body, {headers: {'content-type': 'text/event-stream'}});
  await assert.rejects(readCompletion(sse('data: {"choices":[{"delta":{"content":"부분 응답"}}]}\n\n')), error => error.message === 'model_stream_incomplete' && error.partial === '부분 응답');
  await assert.rejects(readCompletion(sse('data: {"error":{"message":"upstream failure"}}\n\n')), /upstream/);
  await assert.rejects(readCompletion(new Response('private error body', {status: 401})), /unauthorized/);
  assert.equal(await readCompletion(new Response(JSON.stringify({choices: [{message: {content: 'JSON 답변'}}]}))), 'JSON 답변');
});

test('model catalog preserves all classifications and separates display names from request names', async () => {
  const {parseModelList} = await import('../core.js');
  const rows = parseModelList({modelList:[
    {id:42,name:'GLM-5.2-NVFP4',display_name:'GLM_5.2-512K',sort_seq:2,target:'chat',is_agent:false,max_input_tokens:460800,context_length:525288},
    {id:43,name:'another-model',display_name:'Another',sort_seq:1,target:'chat',is_agent:false},
    {name:'agent',target:'chat',is_agent:true}, {name:'embedding',target:'embedding'},
    {id:99,target:'chat'}, null, {name:'another-model',target:'chat'},
  ]});
  assert.deepEqual(rows.map(m => m.name), ['another-model','GLM-5.2-NVFP4','agent','embedding']);
  assert.equal(rows[1].displayName, 'GLM_5.2-512K');
  assert.equal(rows[1].maxInputTokens, 460800);
  assert.equal(rows[1].contextLength, 525288);
  assert.equal(rows[0].contextLength, null);
  assert.throws(() => parseModelList({data:[]}), /models_invalid/);
  assert.deepEqual(parseModelList({modelList:[]}), []);
  assert.equal(parseModelList({modelList:[{name:'model',target:'chat',display_name:''} ]})[0].displayName, 'model');
});


test('model diagnostics distinguish an empty response from invalid or duplicate model names without copying values', async () => {
  const {inspectModelList} = await import('../core.js');
  const empty = inspectModelList({modelList: []});
  assert.deepEqual(empty.summary, {received: 0, usable: 0, excluded: {target: 0, agent: 0, name: 0, duplicate: 0}});
  const filtered = inspectModelList({modelList: [
    {name: 'private-model-name', target: 'private-target'},
    {name: 'private-agent-name', target: 'chat', is_agent: true},
    {target: 'chat'},
    {name: 'valid-model', target: 'chat'},
    {name: 'valid-model', target: 'chat'},
  ]});
  assert.deepEqual(filtered.summary, {received: 5, usable: 3, excluded: {target: 0, agent: 0, name: 1, duplicate: 1}});
  assert(!JSON.stringify(filtered.summary).includes('private'));
  for (const payload of [{ok: false, modelList: []}, {success: false, modelList: []}]) {
    assert.throws(() => inspectModelList(payload), /models_invalid/);
  }
});

test('model fetch reports the real HTTP status and never exposes a non-JSON error body', async t => {
  const {fetchModels} = await import('../src/api.js');
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  const credential = {token: jwt(Date.now() / 1000 + 3600), mode: 'browser', receivedAt: 123};
  globalThis.chrome = {storage: {session: {get: async () => ({credential})}}};
  t.after(() => {globalThis.chrome = previousChrome; globalThis.fetch = previousFetch;});
  globalThis.fetch = async () => Response.json({modelList: []});
  assert.deepEqual(await fetchModels(123), {payload: {modelList: []}, status: 200});
  globalThis.fetch = async () => new Response('private body', {status: 403});
  await assert.rejects(fetchModels(123), {message: 'forbidden', status: 403});
  globalThis.fetch = async () => new Response('<html>private body</html>', {status: 200});
  await assert.rejects(fetchModels(123), {message: 'models_invalid', status: 200});
});

test('the user-provided catalog retains all ten models and defaults to Qwen without changing saved choices', async () => {
  const {readFile} = await import('node:fs/promises');
  const {inspectModelList, DEFAULT_SETTINGS} = await import('../core.js');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/aipro-models.json', import.meta.url), 'utf8'));
  const {models, summary} = inspectModelList(fixture);
  assert.equal(summary.received, 10);
  assert.equal(summary.usable, 10);
  assert.deepEqual(new Set(models.map(m => m.name)), new Set(fixture.modelList.map(m => m.name)));
  assert.equal(summary.excluded.target, 0);
  assert.equal(summary.excluded.agent, 0);
  const qwen = models.find(m => m.name === DEFAULT_SETTINGS.modelId);
  assert.equal(qwen.displayName, 'QWEN3.8-27B-256K');
  assert.equal(qwen.contextLength, 262144);
  assert.equal(qwen.maxInputTokens, 221184);
  assert.equal(cleanSettings().modelId, qwen.name);
  assert.equal(cleanSettings({modelId: 'GLM-5.2-NVFP4'}).modelId, 'GLM-5.2-NVFP4');
  const glm = models.find(m => m.name === 'GLM-5.2-NVFP4');
  assert.equal(glm.displayName, 'GLM-5.2-512K');
  assert.equal(glm.contextLength, 524288);
  assert.equal(glm.maxInputTokens, 460800);
});

test('model retrieval always uses Bearer for browser JWT and manual API keys', async t => {
  const {fetchModels} = await import('../src/api.js');
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  for (const mode of ['browser', 'apiKey']) {
    const token = mode === 'browser' ? jwt(Date.now() / 1000 + 3600) : 'synthetic-api-key';
    globalThis.chrome = {storage: {session: {get: async () => ({credential: {mode, token, receivedAt: 123}})}}};
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'https://aipro.sdsdev.co.kr/api/models');
      assert.equal(options.method || 'GET', 'GET');
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers['User-Agent'], undefined);
      return Response.json({modelList: []});
    };
    await fetchModels(123);
    assert.equal(calls, 1);
  }
});


test('five named models remain available without a chat classification', async () => {
  const {inspectModelList} = await import('../core.js');
  const modelList = [
    {name: 'general-model', target: 'general'},
    {name: 'rag-model', target: 'rag'},
    {name: 'api-model', target: 'open_api'},
    {name: 'agent-model', target: 'pull', is_agent: true},
    {name: 'unclassified-model'},
  ];
  const {models, summary} = inspectModelList({modelList});
  assert.deepEqual(new Set(models.map(model => model.name)), new Set(modelList.map(model => model.name)));
  assert.deepEqual(summary, {received: 5, usable: 5, excluded: {target: 0, agent: 0, name: 0, duplicate: 0}});
});
