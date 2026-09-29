import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeCode} from '../exchange.js';

const jwt = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const token = jwt({sub: 'synthetic-exchange', exp: Math.floor(Date.now() / 1000) + 3600});

test('exchange posts the URL-encoded code to the confirmed endpoint and reads root token', async () => {
  let calls = 0;
  const code = 'synthetic+/_=&?';
  const result = await exchangeCode(code, {fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, 'https://aipro.sdsdev.co.kr/auth/exchange');
    assert.equal(request.method, 'POST');
    assert.equal(request.body, new URLSearchParams({code}).toString());
    assert.deepEqual(request.headers, {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'});
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
    return Response.json({token}, {headers: {'x-custom-email': 'synthetic@example.test'}});
  }});
  assert.equal(calls, 1);
  assert.equal(result.credential.token, token);
  assert.equal(result.credential.mode, 'browser');
  assert.equal(result.field, 'token');
  assert(!JSON.stringify(result).includes('synthetic@example.test'));
  assert(!JSON.stringify(result).includes(code));
});

test('exchange rejects invalid, ambiguous or expired token responses', async () => {
  for (const payload of [null, [], {jwt: token}, {access_token: token}, {data: {token}}, {token: 'opaque-code'}, {token: jwt({})}, {token: jwt([])}, {token, ok: false}, {token, success: false}]) {
    await assert.rejects(exchangeCode('synthetic-code', {fetchImpl: async () => Response.json(payload)}), {message: 'exchange_invalid_response'});
  }
  await assert.rejects(exchangeCode('synthetic-code', {fetchImpl: async () => new Response('<html>private</html>')}), {message: 'exchange_invalid_response'});
  await assert.rejects(exchangeCode('synthetic-code', {fetchImpl: async () => Response.json({token: jwt({exp: 1})})}), {message: 'expired_token'});
});

test('HTTP and network failures are sanitized and never retry a single-use code', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(exchangeCode('synthetic-code', {fetchImpl: async () => {calls++; return new Response('private-server-body', {status});}}), {message: 'exchange_rejected', status});
    assert.equal(calls, 1);
  }
  await assert.rejects(exchangeCode('synthetic-code', {fetchImpl: async () => {throw new Error('private-url-or-code');}}), {message: 'exchange_network'});
});

test('timeouts and explicit cancellation abort the request with distinct safe errors', async () => {
  const pending = (_, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('private-abort-detail')), {once: true}));
  await assert.rejects(exchangeCode('synthetic-code', {fetchImpl: pending, timeoutMs: 5}), {message: 'exchange_timeout'});
  const controller = new AbortController();
  const promise = exchangeCode('synthetic-code', {signal: controller.signal, fetchImpl: pending});
  controller.abort();
  await assert.rejects(promise, {message: 'exchange_interrupted'});
  let calls = 0;
  await assert.rejects(exchangeCode('synthetic-code', {signal: controller.signal, fetchImpl: async () => {calls++;}}), {message: 'exchange_interrupted'});
  assert.equal(calls, 0);
});

test('bounded response reading rejects oversized declared or streamed responses', async () => {
  for (const response of [new Response('x', {headers: {'content-length': '131073'}}), new Response('x'.repeat(131073)), new Response(null)]) {
    await assert.rejects(exchangeCode('synthetic-code', {fetchImpl: async () => response}), {message: 'exchange_invalid_response'});
  }
});

test('invalid callback codes never leave the extension', async () => {
  for (const code of ['', null, 'two words', 'a\nb', 'a'.repeat(16385)]) {
    let calls = 0;
    await assert.rejects(exchangeCode(code, {fetchImpl: async () => {calls++;}}), {message: 'callback_code_invalid'});
    assert.equal(calls, 0);
  }
});
