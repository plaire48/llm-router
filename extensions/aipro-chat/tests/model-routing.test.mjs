import test from 'node:test';
import assert from 'node:assert/strict';
import {visionModelFor, routeImageRequest} from '../model-routing.js';
import {contextBudget, routingContextModel} from '../context-manager.js';
import {completeChat} from '../src/api.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {usageSummary, recordUsage} from '../usage-ledger.js';

const text = {name: 'GLM-5.2-NVFP4', contextLength: 524288, maxInputTokens: 460800};
const vision = {name: 'QWEN3.8-27B-FP8-256K', displayName: 'Qwen3.8', contextLength: 262144, maxInputTokens: 221184};
const image = [{role: 'user', content: [{type: 'image_url', image_url: {url: 'data:image/png;base64,aGVsbG8='}}]}];

test('vision routing uses the current catalog, prefers Qwen and preserves normal text selection', () => {
  assert.equal(visionModelFor('aipro', text, [text]), null);
  assert.equal(visionModelFor('aipro', text, null), null);
  assert.equal(visionModelFor('aipro', text, [{name: 'qwen3.8-27b'}, vision]), vision);
  assert.equal(visionModelFor('fabrix', text, [vision]), null);
  assert.equal(visionModelFor('chatgpt', text, [vision]), null);
  assert.equal(routeImageRequest('aipro', text, vision, [{role: 'user', content: 'hello'}]), text);
  assert.equal(routeImageRequest('aipro', text, vision, image), vision);
  assert.throws(() => routeImageRequest('aipro', text, null, image), /attachment_vision/);
  const budget = contextBudget(routingContextModel(text, vision));
  assert(budget.input <= contextBudget(vision).input);
  assert(budget.output <= contextBudget(vision).output);
  const tools = browserTools({}, BUILTIN_SKILLS[0], text.name, {visionModel: vision});
  assert(tools.some(tool => tool.function.name === 'capture_page'));
  assert(tools.some(tool => tool.function.name === 'click_at'));
});

test('a captured image switches the next request without replaying tools or losing context and usage', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', mode: 'browser', receivedAt: 7, token: 'synthetic'}, catalog: {credentialReceivedAt: 7, models: [text, vision]}})}}};
  const requests = [], steps = []; let captures = 0, ledger;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    assert.equal(init.headers.Authorization, 'Bearer synthetic');
    assert.equal(url, 'https://aipro.sdsdev.co.kr/api/v1/chat/completions');
    if (requests.length === 1) {
      assert.equal(body.model, text.name);
      return Response.json({choices: [{message: {content: '', tool_calls: [{id: 'capture-1', type: 'function', function: {name: 'capture_page', arguments: '{}'}}]}, finish_reason: 'tool_calls'}], usage: {prompt_tokens: 50, completion_tokens: 10, total_tokens: 60}});
    }
    assert.equal(body.model, vision.name);
    assert(body.messages.some(message => message.content === '현재 화면을 확인해줘'));
    assert(body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'capture-1'));
    assert(body.messages.some(message => message.content?.some?.(part => part.type === 'image_url')));
    return Response.json({choices: [{message: {content: '화면을 확인했습니다.'}, finish_reason: 'stop'}], usage: {prompt_tokens: 80, completion_tokens: 20, total_tokens: 100}});
  };
  const request = {provider: 'aipro', credentialReceivedAt: 7, modelId: text.name, model: text, messages: [{role: 'user', content: '현재 화면을 확인해줘'}], tools: [{type: 'function', function: {name: 'capture_page', description: 'capture', parameters: {type: 'object', properties: {}}}}]};
  const result = await completeChat(request, new AbortController().signal, undefined, undefined, undefined, undefined,
    async () => {captures++; return {screenshot_id: 'observed-1', image: {data: 'aGVsbG8=', mimeType: 'image/png'}};},
    step => steps.push(step), event => {ledger = recordUsage(ledger, {...event, requestId: 'route-run', provider: 'aipro'});});
  assert.equal(result, '화면을 확인했습니다.'); assert.equal(captures, 1); assert.equal(requests.length, 2);
  assert.equal(request.modelId, text.name);
  assert(steps.some(step => step.tool === 'image_model' && step.status === 'done'));
  assert.equal(usageSummary(ledger).total.aipro.total, 160);
});

test('a stale catalog never supplies an automatic image route', async t => {
  const previous = globalThis.chrome, fetch = globalThis.fetch; let sent = false;
  t.after(() => {globalThis.chrome = previous; globalThis.fetch = fetch;});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {mode: 'browser', receivedAt: 8}, catalog: {credentialReceivedAt: 7, models: [vision]}})}}};
  globalThis.fetch = async () => {sent = true; throw new Error('must not send');};
  await assert.rejects(completeChat({provider: 'aipro', credentialReceivedAt: 8, modelId: text.name, model: text, messages: image}, new AbortController().signal), /attachment_vision/);
  assert.equal(sent, false);
});
