import test from 'node:test';
import assert from 'node:assert/strict';
import {authRequestAddress, authFieldNames, createAuthTrace} from '../auth-trace.js';

const origin = 'https://aipro.sdsdev.co.kr';
const secret = 'PRIVATE_SENTINEL_123456789';
const request = (path, requestId = '1', extra = {}) => ({requestId, type: 'Fetch', request: {url: origin + path, method: 'POST', headers: {}, ...extra}});

test('auth addresses and field schemas export allowlisted names only', () => {
  assert.deepEqual(authRequestAddress(`${origin}/auth/vscode/${secret}?code=${secret}&${secret}=value#${secret}`), {path: '/auth/vscode/[redacted]', queryFields: ['code']});
  for (const url of [`https://external.example/auth?code=${secret}`, `http://localhost:1234/auth?code=${secret}`, `${origin}/api/models`, `${origin}/chat`, `${origin.replace('https://', 'https://user@')}/auth`]) assert.equal(authRequestAddress(url), null);
  const fields = authFieldNames(JSON.stringify({code: secret, data: {access_token: secret, refreshToken: secret, [secret]: {jwt: secret}}, [secret]: secret}));
  assert.deepEqual(fields, ['code', 'data.access_token', 'data.refreshToken']);
  assert.deepEqual(authFieldNames(`code=${secret}&${secret}=token`, true), ['code']);
  assert.deepEqual(authFieldNames('invalid-json'), []);
  assert(!JSON.stringify(fields).includes(secret));
});

test('redirects and JSON responses preserve status and field names without headers or values', async () => {
  const changes = [], trace = createAuthTrace(value => changes.push(value));
  await trace.observe('Network.requestWillBeSent', request('/auth/vscode/login?port=1234'));
  await trace.observe('Network.requestWillBeSent', {...request('/auth/vscode/callback?code=' + secret), redirectResponse: {status: 302, mimeType: 'text/html', headers: {'set-cookie': secret}}});
  await trace.observe('Network.responseReceived', {requestId: '1', response: {status: 200, mimeType: 'text/html'}});
  await trace.observe('Network.loadingFinished', {requestId: '1', encodedDataLength: 30}, () => {throw new Error('HTML must not be read');});
  await trace.observe('Network.requestWillBeSent', request('/api/auth/token?code=' + secret, '2', {headers: {authorization: secret, cookie: secret, 'content-type': 'application/json'}, postData: JSON.stringify({code: secret, grant_type: secret})}));
  await trace.observe('Network.responseReceived', {requestId: '2', response: {status: 200, mimeType: 'application/json', headers: {'set-cookie': secret}}});
  await trace.observe('Network.loadingFinished', {requestId: '2', encodedDataLength: 60}, async () => ({body: JSON.stringify({data: {jwt: secret, expires_in: 1234}, [secret]: secret})}));
  const data = trace.snapshot();
  assert.equal(data.scope, 'login_tab_browser_only');
  assert.equal(data.requests[0].status, 302);
  assert.equal(data.requests[1].body, 'not_json');
  assert.deepEqual(data.requests[2].requestFields, ['code', 'grant_type']);
  assert.deepEqual(data.requests[2].responseFields, ['data.expires_in', 'data.jwt']);
  assert(!JSON.stringify(changes).includes(secret));
  assert(!JSON.stringify(data).includes('1234'));
});

test('response failures, sizes and request counts are bounded and sanitized', async () => {
  const trace = createAuthTrace(() => {});
  let reads = 0;
  for (let i = 0; i < 45; i++) {
    await trace.observe('Network.requestWillBeSent', request('/api/auth/token', String(i)));
    await trace.observe('Network.responseReceived', {requestId: String(i), response: {status: 500, mimeType: 'application/json'}});
    await trace.observe('Network.loadingFinished', {requestId: String(i), encodedDataLength: i === 0 ? 300000 : 60}, async () => {reads++; throw new Error(secret);});
  }
  const data = trace.snapshot();
  assert.equal(data.requests.length, 40);
  assert.equal(data.dropped, 5);
  assert.equal(reads, 8);
  assert.equal(data.requests[0].body, 'skipped_size');
  assert.equal(data.requests[1].body, 'unavailable');
  assert.equal(data.requests[9].body, 'skipped_limit');
  assert(!JSON.stringify(data).includes(secret));
});

test('stopping a login prevents late response inspection from updating its diagnostic', async () => {
  let release;
  const changes = [], trace = createAuthTrace(value => changes.push(value));
  await trace.observe('Network.requestWillBeSent', request('/api/auth/token'));
  await trace.observe('Network.responseReceived', {requestId: '1', response: {status: 200, mimeType: 'application/json'}});
  const waiting = trace.observe('Network.loadingFinished', {requestId: '1', encodedDataLength: 20}, () => new Promise(resolve => {release = resolve;}));
  trace.stop();
  const count = changes.length;
  release({body: JSON.stringify({jwt: secret})});
  await waiting;
  await trace.observe('Network.requestWillBeSent', request('/auth/session', '2'));
  assert.equal(changes.length, count);
  assert.equal(trace.snapshot().requests.length, 1);
  assert(!JSON.stringify(changes).includes(secret));
});
