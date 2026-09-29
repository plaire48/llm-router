import test from 'node:test';
import assert from 'node:assert/strict';
import {completeChat, readCompletion} from '../src/api.js';
import {chatMessages, SYSTEM_PROMPT, MAX_OUTPUT_TOKENS} from '../chat-contract.js';
import {normalizeUsage, contextUsage, estimateTokens} from '../usage.js';

// Valid synthetic frames matching the supplied sample's structure. The pasted
// sample itself has damaged JSON punctuation and is not a wire-format fixture.
const usage = {prompt_tokens: 23175, total_tokens: 23223, completion_tokens: 48, completion_tokens_details: {reasoning_tokens: 30}};
const data = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
const choice = (delta, finish_reason = null) => ({choices: [{index: 0, delta, finish_reason}]});
const sse = body => new Response(body, {headers: {'content-type': 'text/event-stream'}});

test('chat requests use confirmed Bearer auth, output budget and one browser-specific preamble per turn', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  const history = [{role: 'user', content: '테스트'}, {role: 'assistant', content: '첫 답변'}, {role: 'user', content: '다음 질문'}];
  for (const mode of ['browser', 'apiKey']) {
    globalThis.chrome = {storage: {session: {get: async () => ({credential: {mode, receivedAt: 7, token: 'synthetic-only'}})}}};
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, `https://aipro.sdsdev.co.kr/${mode === 'apiKey' ? 'open/' : ''}api/v1/chat/completions`);
      assert.equal(init.headers.Authorization, 'Bearer synthetic-only');
      assert.equal(init.headers['User-Agent'], undefined);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      const request = JSON.parse(init.body);
      assert.equal(request.model, 'QWEN3.8-27B-FP8-256K');
      assert.equal(request.max_tokens, 24576);
      assert.equal(request.max_tokens, MAX_OUTPUT_TOKENS);
      assert.equal(request.stream, true);
      assert.deepEqual(request.stream_options, {include_usage: true});
      assert(request.messages[0].content.startsWith(SYSTEM_PROMPT));
      assert.match(request.messages[0].content, /<nubi_computer_time>/);
      assert.match(request.messages[1].content, /Nubi browser agent extension/);
      assert.deepEqual(request.messages.slice(2), history);
      assert.equal(request.tools, undefined);
      assert.equal(request.tool_choice, undefined);
      return sse(data(choice({content: '답변'}, 'stop')) + data({choices: [], usage}) + 'data: [DONE]\n\n');
    };
    for (let turn = 0; turn < 2; turn++) assert.equal(await completeChat({credentialReceivedAt: 7, modelId: 'QWEN3.8-27B-FP8-256K', messages: history}, new AbortController().signal), '답변');
    assert.equal(calls, 2);
    assert.equal(history.length, 3);
  }
  const preamble = chatMessages([], 'glm', new Date('2026-09-18T06:00:00Z'));
  assert.match(preamble[0].content, /2026-09-18/);
  assert(!JSON.stringify(preamble).includes('C:\\Users'));
});

test('reasoning is a phase only; content and final usage survive fragmented Korean SSE and DONE without EOF', async () => {
  for (const size of [1, 7, 1024]) {
    const phases = [], texts = [], usages = [], finishes = [];
    let cancelled = false;
    const wire = data(choice({role: 'assistant', content: ''})) + data(choice({reasoning: 'synthetic-private-thought'})) + data(choice({reasoning: 'more'})) + data(choice({content: '안녕하세요!'})) + data(choice({content: ' 테스트가 전달되었습니다.'})) + data(choice({}, 'stop')) + data({choices: [], usage}) + 'data: [DONE]\r\n\r\n';
    const bytes = new TextEncoder().encode(wire);
    const stream = new ReadableStream({start(controller) {for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));}, cancel() {cancelled = true;}});
    const result = await readCompletion(sse(stream), value => texts.push(value), value => usages.push(value), value => phases.push(value), value => finishes.push(value));
    assert.equal(result, '안녕하세요! 테스트가 전달되었습니다.');
    assert.deepEqual(phases, ['thinking', 'responding']);
    assert.deepEqual(usages, [usage]);
    assert.deepEqual(finishes, ['stop']);
    assert(!JSON.stringify(texts).includes('synthetic-private-thought'));
    assert(cancelled);
  }
});

test('reasoning is included in completion tokens, never added twice, and prompt overhead is estimated', () => {
  assert.deepEqual(normalizeUsage(usage), usage);
  const invalid = normalizeUsage({...usage, completion_tokens_details: {reasoning_tokens: 49}});
  assert.equal(invalid.completion_tokens_details, undefined);
  const model = {name: 'qwen', contextLength: 262144};
  const messages = [{role: 'user', content: '테스트'}, {role: 'assistant', state: 'done', modelId: 'qwen', content: '안녕하세요', usage}];
  assert.equal(contextUsage(messages, '', model).used, 23223);
  assert(contextUsage([messages[0]], '', model).used > estimateTokens(SYSTEM_PROMPT));
});

test('length preserves visible content and usage, while absent content or unsupported tools cannot masquerade as success', async () => {
  let finish;
  assert.equal(await readCompletion(sse(data(choice({content: '아직 이어지는 답변'}, 'length')) + data({choices: [], usage}) + 'data: [DONE]\n\n'), undefined, undefined, undefined, value => {finish = value;}), '아직 이어지는 답변');
  assert.equal(finish, 'length');
  await assert.rejects(readCompletion(sse(data(choice({reasoning: 'synthetic'}, 'length')) + 'data: [DONE]\n\n')), /output_limit/);
  for (const [reason, code] of [['tool_calls', 'tools_unavailable'], ['function_call', 'tools_unavailable'], ['content_filter', 'response_filtered'], ['unknown', 'response_invalid']]) {
    await assert.rejects(readCompletion(sse(data(choice({}, reason)))), {message: code});
    await assert.rejects(readCompletion(Response.json({choices: [{message: {content: ''}, finish_reason: reason}]})), {message: code});
  }
  await assert.rejects(readCompletion(sse(data(choice({tool_calls: [{index: 0, function: {name: 'Bash'}}]})))), /tools_unavailable/);
});

test('malformed and oversized frames remain errors and retain only visible partial output', async () => {
  const wire = data(choice({reasoning: 'do-not-copy'})) + data(choice({content: '앞부분'})) + 'data: {"choices":[{"logprobs","finish_reason"}]}\n\n';
  await assert.rejects(readCompletion(sse(wire)), error => error.message === 'response_invalid' && error.partial === '앞부분');
  await assert.rejects(readCompletion(sse('data: ' + 'x'.repeat(1048577))), /too_long/);
  await assert.rejects(readCompletion(sse('data: ' + 'x'.repeat(1048577) + '\n\n')), /too_long/);
});
