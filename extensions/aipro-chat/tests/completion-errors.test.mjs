import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCompletionError, completionDiagnostic, readCompletionError} from '../completion-errors.js';
import {completeChat} from '../src/api.js';
import {readCompletion} from '../completion-reader.js';
import {retryableModelError, recoverModel} from '../model-recovery.js';

test('HTTP 200 error envelopes distinguish recoverable stream failures from permanent rejections', async () => {
  for (const [code, message, retryable] of [
    ['server_error', 'upstream', true], ['rate_limit_exceeded', 'rate_limited', true],
    ['invalid_api_key', 'unauthorized', false], ['insufficient_quota', 'rate_limited', false],
    ['context_length_exceeded', 'context_overflow', false], ['model_not_found', 'invalid_model', false],
    ['invalid_request_error', 'request_rejected', false], ['unrecognized_code', 'upstream', false],
  ]) for (const streaming of [true, false]) {
    const payload = {error: {code, type: 'server_error', message: 'PRIVATE body and credentials'}};
    const headers = {'content-type': streaming ? 'text/event-stream' : 'application/json', 'Retry-After': '7'};
    const response = new Response(streaming ? `data: ${JSON.stringify(payload)}\n\n` : JSON.stringify(payload), {headers});
    await assert.rejects(readCompletion(response), error => {
      assert.equal(error.message, message); assert.equal(retryableModelError(error), retryable);
      assert.equal(error.status, undefined, 'An API code is not a fabricated HTTP status');
      assert.equal(error.retryAfterMs, retryable ? 7000 : undefined);
      assert(!JSON.stringify(error).includes('PRIVATE')); return true;
    });
  }
});

test('named SSE error events without a JSON type preserve permanent failures and measured usage', async () => {
  const measured = [], tools = [];
  const body = 'event: error\ndata: {"code":"invalid_api_key","message":"PRIVATE","usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n';
  await assert.rejects(readCompletion(new Response(body, {headers: {'content-type': 'text/event-stream'}}), undefined, undefined, undefined, undefined,
    value => tools.push(value), value => measured.push(value)), error => error.message === 'unauthorized' && !retryableModelError(error));
  assert.equal(measured[0].total_tokens, 12); assert.equal(tools.length, 0);
});

test('an error after streamed tool arguments discards them and a subsequent inference can recover', async () => {
  let attempts = 0, calls = 0;
  const result = await recoverModel(async () => {
    attempts++;
    const body = attempts === 1
      ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"pending","function":{"name":"fill_form","arguments":"{}"}}]}}]}\n\ndata: {"error":{"code":"server_error"}}\n\n'
      : 'data: {"choices":[{"delta":{"content":"recovered"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return readCompletion(new Response(body, {headers: {'content-type': 'text/event-stream'}}), undefined, undefined, undefined, undefined, () => calls++);
  }, {signal: new AbortController().signal, minTimeout: 0});
  assert.equal(result, 'recovered'); assert.equal(attempts, 2); assert.equal(calls, 0);
});

test('request rejections distinguish Qwen templates, models, context and media without copying provider text', () => {
  const cases = [
    [400, {error: {message: 'System message must be at the beginning. private-value'}}, 'request_format', 'system_messages'],
    [400, {error: {message: "Missing tool_call_id for private-tool"}}, 'request_format', 'tool_messages'],
    [422, {error: {param: 'tools.0.function.parameters', message: 'private-schema'}}, 'request_format', 'tool_schema'],
    [422, {detail: [{loc: ['body', 'stream_options', 'include_usage'], input: 'private-input'}]}, 'request_format', 'stream_options'],
    [404, {error: {code: 'model_not_found', message: 'private-model'}}, 'invalid_model', 'model_unavailable'],
    [400, {error: {code: 'context_length_exceeded', message: 'private-input'}}, 'context_overflow', 'context_limit'],
    [400, {error: {message: 'This model maximum context length is exceeded by private-prompt'}}, 'context_overflow', 'context_limit'],
    [400, {error: {message: 'Image input is not supported by private-model'}}, 'request_image', 'image_input'],
    [400, {error: {message: 'private-token-and-prompt'}}, 'request_rejected', 'request_body'],
    [404, '<html>private-server</html>', 'request_endpoint', 'endpoint'],
    [413, null, 'context_overflow', 'context_limit'],
    [401, {error: {code: 'invalid_model', param: 'model'}}, 'unauthorized', 'http'],
    [403, null, 'forbidden', 'http'], [429, null, 'rate_limited', 'http'], [503, null, 'upstream', 'http'],
  ];
  for (const [status, payload, error, reason] of cases) {
    assert.deepEqual(classifyCompletionError(status, payload), {error, reason, status});
    assert(!JSON.stringify(classifyCompletionError(status, payload)).includes('private'));
  }
});

test('error bodies are bounded, cancelled and reduced to fixed diagnostics', async () => {
  assert.equal((await readCompletionError(Response.json({error: {message: 'System message must be at the beginning.'}}, {status: 400}))).reason, 'system_messages');
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream({pull(controller) {pulls++; controller.enqueue(new Uint8Array(65537));}, cancel() {cancelled = true;}});
  assert.equal((await readCompletionError(new Response(stream, {status: 422}))).reason, 'request_body');
  assert(cancelled); assert(pulls <= 2);
  assert.equal((await readCompletionError(new Response('<html>private</html>', {status: 400}))).error, 'request_rejected');
  assert.deepEqual(completionDiagnostic({phase: 'rejected', reason: 'system_messages', status: 400, attempt: 1, body: 'private'}), {phase: 'rejected', reason: 'system_messages', status: 400, attempt: 1});
  for (const patch of [{reason: 'private'}, {status: '400'}, {phase: 'private'}, {attempt: 3}]) {
    assert.equal(completionDiagnostic({phase: 'rejected', reason: 'request_body', status: 400, attempt: 1, ...patch}), null);
  }
});

const tool = {type: 'function', function: {name: 'fill_form', description: 'Fill observed text', parameters: {type: 'object', properties: {value: {type: 'string'}}, required: ['value']}}};
const request = {provider: 'aipro', modelId: 'qwen3.8-27b', model: {contextLength: 262144}, credentialReceivedAt: 5, messages: [{role: 'user', content: '초안을 작성해줘'}], tools: [tool]};
const success = calls => Response.json({choices: [{message: {content: calls ? '' : '초안을 반영했습니다.', ...(calls ? {tool_calls: calls} : {})}, finish_reason: calls ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 20, completion_tokens: 10, total_tokens: 30}});
function install(t, fetcher) {
  const previous = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  t.after(() => Object.assign(globalThis, previous));
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 5}})}}};
  globalThis.fetch = fetcher;
}

test('an explicit optional-field repair continues after the existing tool receipt without replaying the write', async t => {
  const requests = [], diagnostics = [], steps = [], usage = []; let writes = 0;
  install(t, async (_, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (requests.length === 1) return success([{id: 'written', type: 'function', function: {name: 'fill_form', arguments: '{"value":"초안"}'}}]);
    assert.equal(body.model, request.modelId);
    assert(body.messages.some(message => message.tool_call_id === 'written'));
    if (requests.length === 2) return Response.json({error: {param: 'stream_options', message: 'private-body'}}, {status: 400});
    assert(!Object.hasOwn(body, 'stream_options'));
    const {stream_options, ...original} = requests[1];
    assert.deepEqual(body, original);
    return success();
  });
  const result = await completeChat(request, new AbortController().signal, undefined, undefined, undefined, undefined,
    async () => {writes++; return {applied: 1};}, step => steps.push(step), event => usage.push(event), undefined, event => diagnostics.push(completionDiagnostic(event)));
  assert.equal(result, '초안을 반영했습니다.'); assert.equal(writes, 1); assert.equal(requests.length, 3);
  assert.deepEqual(diagnostics.map(item => item.phase), ['rejected', 'recovered']);
  assert(!JSON.stringify(diagnostics).includes('private'));
  assert.deepEqual(steps.filter(step => step.tool === 'recover_model').map(step => step.status), ['running', 'done']);
  assert.equal(usage.filter(event => event.phase === 'start').length, 3);
  assert.equal(usage.filter(event => event.phase === 'report').length, 2);
});

test('unknown rejections and denied models are never blindly retried or changed', async t => {
  let calls = 0, writes = 0, status = 400, payload = {error: {message: 'private'}};
  const diagnostics = [];
  install(t, async () => {calls++; return Response.json(payload, {status});});
  const run = () => completeChat(request, new AbortController().signal, undefined, undefined, undefined, undefined, async () => writes++, undefined, undefined, undefined,
    event => {diagnostics.push(completionDiagnostic(event)); throw new Error('diagnostic failed');});
  await assert.rejects(run(), {message: 'request_rejected', status: 400}); assert.equal(calls, 1);
  calls = 0; status = 404; payload = {error: {code: 'model_not_found'}};
  await assert.rejects(run(), {message: 'invalid_model', status: 404}); assert.equal(calls, 1); assert.equal(writes, 0);
  calls = 0; status = 400; payload = {error: {param: 'stream_options'}};
  await assert.rejects(run(), {message: 'request_format', status: 400}); assert.equal(calls, 2);
  assert(!JSON.stringify(diagnostics).includes('private'));
});

test('cancellation prevents even the optional-field repair request', async t => {
  let calls = 0; const controller = new AbortController();
  install(t, async () => {calls++; return Response.json({error: {param: 'stream_options'}}, {status: 422});});
  await assert.rejects(completeChat(request, controller.signal, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, () => controller.abort()), /cancelled/);
  assert.equal(calls, 1);
});

test('a disconnected response retries only inference and discards incomplete executable calls', async t => {
  const usage = [], emitted = [], starts = []; let calls = 0, writes = 0;
  install(t, async (_, options) => {
    const body = JSON.parse(options.body); calls++;
    if (calls === 1) return success([{id: 'written', type: 'function', function: {name: 'fill_form', arguments: '{"value":"초안"}'}}]);
    assert.equal(body.messages.filter(message => message.role === 'system').length, 1);
    assert(body.messages.some(message => message.tool_call_id === 'written'));
    if (calls === 2) {
      starts.push(performance.now());
      return new Response('PRIVATE upstream details', {status: 429, headers: {'Retry-After': '1'}});
    }
    assert(performance.now() - starts[0] >= 980);
    if (calls === 3) return new Response('data: ' + JSON.stringify({choices: [{delta: {content: 'DISCARDED_PARTIAL', tool_calls: [{index: 0, id: 'incomplete', type: 'function', function: {name: 'fill_form', arguments: '{"value":"DO_NOT_WRITE"}'}}]}}]}) + '\n\n', {headers: {'content-type': 'text/event-stream'}});
    assert.equal(calls, 4); return success();
  });
  const result = await completeChat(request, new AbortController().signal, value => emitted.push(value), undefined, undefined, undefined,
    async () => {writes++; return {applied: 1};}, undefined, value => usage.push(value));
  assert.equal(result, '초안을 반영했습니다.'); assert.equal(writes, 1);
  assert.equal(usage.filter(event => event.phase === 'start').length, 4);
  assert.equal(usage.filter(event => event.phase === 'finish').length, 4);
  assert.equal(usage.filter(event => event.phase === 'report').length, 2);
  const partial = emitted.indexOf('DISCARDED_PARTIAL'); assert(partial >= 0); assert(emitted.slice(partial + 1).includes(''));
});

test('AI Pro long rate limits preserve HTTP metadata and do not send an early retry', async t => {
  let calls = 0;
  install(t, async () => {calls++; return new Response('PRIVATE', {status: 429, headers: {'Retry-After': '3600'}});});
  await assert.rejects(completeChat(request, new AbortController().signal), error => error.status === 429 && error.retryAfterMs === 3600000 && !JSON.stringify(error).includes('PRIVATE'));
  assert.equal(calls, 1);
});

test('AI Pro resumes after an in-band server error without replaying a completed write', async t => {
  let requests = 0, writes = 0; const usage = [];
  install(t, async (_, options) => {
    requests++;
    if (requests === 1) return success([{id: 'written', type: 'function', function: {name: 'fill_form', arguments: '{"value":"초안"}'}}]);
    assert(JSON.parse(options.body).messages.some(message => message.tool_call_id === 'written'));
    if (requests === 2) return new Response('data: {"error":{"code":"server_error","message":"PRIVATE"}}\n\n', {headers: {'content-type': 'text/event-stream'}});
    return success();
  });
  assert.equal(await completeChat(request, new AbortController().signal, undefined, undefined, undefined, undefined,
    async () => {writes++; return {applied: 1};}, undefined, event => usage.push(event)), '초안을 반영했습니다.');
  assert.equal(writes, 1); assert.equal(requests, 3);
  assert.equal(usage.filter(event => event.phase === 'start').length, 3);
  assert.equal(usage.filter(event => event.phase === 'report').length, 2);
});

test('in-band permanent and long rate-limit failures do not trigger early inference retries', async t => {
  let count = 0, code = 'insufficient_quota';
  install(t, async () => {count++; return new Response(`data: ${JSON.stringify({error: {code, type: 'server_error', message: 'PRIVATE'}})}\n\n`, {headers: {'content-type': 'text/event-stream', 'Retry-After': '3600'}});});
  await assert.rejects(completeChat(request, new AbortController().signal), {message: 'rate_limited', retryable: false, status: 200});
  assert.equal(count, 1); count = 0; code = 'rate_limit_exceeded';
  await assert.rejects(completeChat(request, new AbortController().signal), {message: 'rate_limited', retryable: true, status: 200, retryAfterMs: 3600000});
  assert.equal(count, 1);
});
