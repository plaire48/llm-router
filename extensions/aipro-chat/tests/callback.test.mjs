import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCallback} from '../callback.js';
import {ORIGIN, SSO_ORIGIN} from '../core.js';

const token = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const jwt = token({sub: 'synthetic-callback', exp: Math.floor(Date.now() / 1000) + 3600});
const anotherJwt = token({sub: 'lower-priority'});
const request = changes => ({url: 'http://localhost:51561/auth', method: 'GET', headers: {}, body: '', ...changes});
const message = response => JSON.parse(response.body);

test('callback accepts the router header/body/query transports and returns its JSON acknowledgment', () => {
  const cases = [
    [{headers: {JWT: jwt}}, 'jwt'],
    [{headers: {Token: `jwt=${jwt}`}}, 'token'],
    [{headers: {'Auth-JWT': jwt}}, 'auth-jwt'],
    [{headers: {Authorization: `Bearer ${jwt}`}}, 'authorization'],
    [{method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jwt})}, 'jwt'],
    [{method: 'PUT', headers: {'Content-Type': 'application/json; charset=utf-8'}, body: JSON.stringify({token: jwt})}, 'token'],
    [{method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({auth_jwt: jwt})}, 'auth_jwt'],
    [{method: 'POST', body: new URLSearchParams({jwt}).toString()}, 'jwt'],
    [{method: 'PUT', body: new URLSearchParams({auth_jwt: jwt}).toString()}, 'auth_jwt'],
    [{method: 'POST', body: `'Bearer ${jwt}'`}, 'body'],
    [{url: `http://localhost:51561/auth?jwt=${jwt}`}, 'jwt'],
    [{url: `http://127.0.0.1:51561/auth?token=${jwt}`}, 'token'],
    [{url: `http://[::1]:51561/callback?auth_jwt=${jwt}`}, 'auth_jwt'],
  ];
  for (const [changes, field] of cases) {
    const result = handleCallback(request(changes));
    assert.equal(result.status, 200, JSON.stringify({method: changes.method, field}));
    assert.deepEqual(message(result), {ok: true, message: 'AI Pro login completed'});
    assert.equal(result.credential.token, jwt);
    assert.equal(result.credential.mode, 'browser');
    assert.equal(result.field, field);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(Number(result.headers['Content-Length']), Buffer.byteLength(result.body));
    assert(!result.body.includes(jwt));
  }
});

test('callback precedence is JWT headers, body, then query without falling back from an invalid selected credential', () => {
  const base = request({method: 'POST', url: `http://localhost:51561/auth?jwt=${anotherJwt}`, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jwt})});
  assert.equal(handleCallback(base).credential.token, jwt);
  assert.equal(handleCallback({...base, headers: {...base.headers, Authorization: `Bearer ${anotherJwt}`}}).credential.token, anotherJwt);
  assert.equal(handleCallback({...base, headers: {...base.headers, jwt, token: anotherJwt, 'auth-jwt': anotherJwt}}).credential.token, jwt);
  assert.equal(handleCallback({...base, headers: {...base.headers, token: jwt, 'auth-jwt': anotherJwt}}).credential.token, jwt);
  const invalid = handleCallback({...base, headers: {...base.headers, jwt: 'invalid-header'}});
  assert.equal(invalid.status, 400);
  assert.equal(invalid.error, 'invalid_token');
  assert.equal(invalid.credential, undefined);
  assert.equal(handleCallback({...base, body: JSON.stringify({jwt: 'invalid-body'})}).error, 'invalid_token');
  assert.equal(handleCallback({...base, body: '{malformed-json'}).credential.token, anotherJwt);
  assert.equal(handleCallback({...base, body: JSON.stringify({unrelated: jwt})}).credential.token, anotherJwt);
  assert.equal(handleCallback({...base, method: 'GET'}).credential.token, anotherJwt);
});

test('allowed origins receive exact CORS responses while unrelated, empty and null origins are rejected', () => {
  for (const origin of [undefined, ORIGIN, `${ORIGIN}/`, 'HTTPS://AIPRO.SDSDEV.CO.KR///', SSO_ORIGIN, 'HTTPS://EPSSO.SAMSUNG.NET/']) {
    const result = handleCallback(request({headers: {...(origin === undefined ? {} : {Origin: origin}), JWT: jwt}}));
    assert.equal(result.status, 200);
    assert.equal(result.headers['Access-Control-Allow-Origin'], origin);
    assert.equal(result.headers['Access-Control-Allow-Credentials'], origin ? 'true' : undefined);
    assert.equal(result.headers.Vary, origin ? 'Origin' : undefined);
  }
  for (const origin of ['https://evil.example', `${ORIGIN}.evil.example`, `${ORIGIN}/path`, `${ORIGIN}:443`, `${SSO_ORIGIN}.evil.example`, `${SSO_ORIGIN}/path`, 'http://epsso.samsung.net', '', 'null']) {
    const result = handleCallback(request({headers: {origin, jwt}}));
    assert.equal(result.status, 403);
    assert.equal(result.error, 'origin_not_allowed');
    assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(result.credential, undefined);
    assert.deepEqual(message(result), {ok: false, message: 'origin not allowed'});
  }
});

test('EP SSO code callback acknowledges receipt without treating the code as a credential', () => {
  const input = request({url: 'http://localhost:51561/auth?code=synthetic-code&status=00', headers: {origin: SSO_ORIGIN, 'content-type': 'application/x-www-form-urlencoded'}});
  const result = handleCallback(input);
  assert.equal(result.status, 200);
  assert.equal(result.exchangeCode, 'synthetic-code');
  assert.equal(result.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(Number(result.headers['Content-Length']), Buffer.byteLength(result.body));
  assert.equal(result.headers['Access-Control-Allow-Origin'], SSO_ORIGIN);
  assert.equal(result.credential, undefined);
  const preflight = handleCallback({...input, method: 'OPTIONS'});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], SSO_ORIGIN);
  assert(!result.body.includes('synthetic-code'));
});

test('OPTIONS responds with CORS and private-network permission before reading credentials', () => {
  const result = handleCallback(request({method: 'OPTIONS', headers: {Origin: ORIGIN, 'Access-Control-Request-Private-Network': 'true'}}));
  assert.equal(result.status, 204);
  assert.equal(result.body, '');
  assert.equal(result.credential, undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.headers['Content-Length'], '0');
  assert.equal(result.headers['Access-Control-Allow-Methods'], 'GET, POST, PUT, OPTIONS');
  assert.equal(result.headers['Access-Control-Allow-Headers'], 'authorization, content-type, jwt, token, auth-jwt');
  assert.equal(result.headers['Access-Control-Allow-Private-Network'], 'true');
  assert.equal(result.headers['Access-Control-Max-Age'], '600');
  assert.equal(handleCallback(request({method: 'OPTIONS'})).headers['Access-Control-Allow-Private-Network'], undefined);
  assert.equal(handleCallback(request({method: 'OPTIONS', headers: {origin: 'null'}})).status, 403);
});

test('unsupported methods produce an HTTP 405 JSON response and never authenticate', () => {
  for (const method of ['DELETE', 'PATCH', 'HEAD', 'TRACE']) {
    const result = handleCallback(request({method, headers: {jwt}}));
    assert.equal(result.status, 405);
    assert.equal(result.error, 'method_not_allowed');
    assert.equal(result.credential, undefined);
    assert.deepEqual(message(result), {ok: false, message: 'method not allowed'});
  }
});

test('code/status is transient exchange input and never appears in the HTTP response', () => {
  const secret = 'synthetic-opaque-code';
  for (const code of [secret, jwt]) {
    for (const mode of ['browser', 'apiKey']) {
      const result = handleCallback(request({url: `http://localhost:51561/auth?code=${code}&status=00`}), mode);
      assert.equal(result.status, 200);
      assert.equal(result.exchangeCode, code);
      assert.equal(result.hasCode, true);
      assert.equal(result.credential, undefined);
      assert(!result.body.includes(code));
      assert(!result.body.includes('localhost'));
    }
  }
  const success = handleCallback(request({url: `http://localhost:51561/auth?code=${secret}&status=01`, headers: {jwt}}));
  assert.equal(success.status, 200);
  assert.equal(success.hasCode, true);
  assert(!JSON.stringify(success).includes(secret));
});

test('invalid and empty JWT claims are rejected in all SSO modes and expiry remains distinct', () => {
  for (const value of ['opaque-api-key', token({}), token([]), token(null), 'header.invalid.signature']) {
    for (const mode of ['browser', 'apiKey']) {
      const result = handleCallback(request({headers: {jwt: value}}), mode);
      assert.equal(result.status, 400);
      assert.equal(result.error, 'invalid_token');
      assert.equal(result.credential, undefined);
      assert(!JSON.stringify(result).includes(value));
    }
  }
  const expired = handleCallback(request({headers: {jwt: token({sub: 'synthetic', exp: 1})}}));
  assert.equal(expired.status, 400);
  assert.equal(expired.error, 'expired_token');
  assert.deepEqual(message(expired), {ok: false, message: 'valid jwt is required'});
  assert.equal(handleCallback(request({headers: {jwt}}), 'apiKey').credential.mode, 'browser');
});

test('query duplicates skip blank values and callback field support matches the router', () => {
  assert.equal(handleCallback(request({url: `http://localhost:51561/auth?jwt=&jwt=${jwt}`})).credential.token, jwt);
  for (const field of ['access_token', 'api_key', 'apiKey']) {
    const result = handleCallback(request({url: `http://localhost:51561/auth?${field}=${jwt}`}));
    assert.equal(result.status, 400);
    assert.equal(result.credential, undefined);
  }
});


test('code exchange requires one nonempty code and one successful status', () => {
  for (const query of ['code=&status=00', 'code=x', 'code=x&status=01', 'code=x&status=00&status=00', 'code=x&code=y&status=00', 'code=a%20b&status=00', 'code=%00&status=00']) {
    const result = handleCallback(request({url: `http://localhost:51561/auth?${query}`}));
    assert.equal(result.status, 400, query);
    assert.equal(result.exchangeCode, undefined);
    assert.equal(result.credential, undefined);
  }
});
