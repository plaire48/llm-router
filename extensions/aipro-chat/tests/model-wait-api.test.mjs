import test from 'node:test';
import assert from 'node:assert/strict';
import {completeChat} from '../src/api.js';

const flush = async () => {for (let i = 0; i < 40; i++) await Promise.resolve();};

test('a long active SSE response creates no wait rows; a real silent interval settles on the next delta', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  t.mock.timers.enable({apis: ['setTimeout']});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
  let stream, ready, requests = 0;
  const started = new Promise(resolve => {ready = resolve;});
  globalThis.fetch = async () => {
    requests++;
    return new Response(new ReadableStream({start(controller) {stream = controller; ready();}}), {headers: {'content-type': 'text/event-stream'}});
  };
  const steps = [], text = [];
  const request = {provider: 'aipro', credentialReceivedAt: 1, modelId: 'qwen3.8-27b', messages: [{role: 'user', content: '간단히 설명해 줘.'}]};
  const run = completeChat(request, new AbortController().signal, value => text.push(value), undefined, undefined, undefined, undefined, step => steps.push(step));
  await started; await flush();
  const send = payload => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
  for (let i = 0; i < 8; i++) {
    t.mock.timers.tick(10000);
    send({choices: [{delta: {content: '응답 '}}]});
    await flush();
  }
  assert.equal(steps.filter(step => step.tool === 'wait_model').length, 0);
  assert.equal(text.at(-1), '응답 '.repeat(8));
  t.mock.timers.tick(16000); await flush();
  assert.deepEqual(steps.filter(step => step.tool === 'wait_model').map(step => step.status), ['running']);
  send({choices: [{delta: {content: '계속'}}]}); await flush();
  assert.deepEqual(steps.filter(step => step.tool === 'wait_model').map(step => step.status), ['running', 'done']);
  assert.equal(steps[0].index, steps[1].index, 'The same actual wait is closed, not a new completed item');
  send({choices: [{delta: {}, finish_reason: 'stop'}]});
  stream.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); stream.close();
  assert.equal(await run, '응답 '.repeat(8) + '계속');
  assert.equal(requests, 1, 'Presentation changes must never increase model requests');
  assert.equal(steps.length, 2, 'Finish does not duplicate the already settled wait');
});
