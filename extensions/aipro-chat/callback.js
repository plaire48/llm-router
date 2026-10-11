import {cleanCredential, callbackOriginKind} from './core.js';

const TOKEN_FIELDS = ['jwt', 'token', 'auth_jwt'];
const MAX_BODY_BYTES = 1024 * 1024;

function normalize(value) {
  if (typeof value !== 'string') return null;
  return value.trim().replace(/^['"]+|['"]+$/g, '')
    .replace(/^(?:jwt=|token=|jwt\s|bearer\s)/i, '').trim()
    .replace(/^['"]+|['"]+$/g, '') || null;
}

function headerToken(incoming) {
  for (const field of ['jwt', 'token', 'auth-jwt']) {
    if (incoming[field]) return {value: incoming[field], field};
  }
  const authorization = normalize(incoming.authorization);
  return authorization ? {value: authorization, field: 'authorization'} : null;
}

export function hasCallbackHeader(headers = {}) {
  return !!headerToken(Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])));
}

function parameterToken(parameters) {
  for (const field of TOKEN_FIELDS) {
    const value = parameters.getAll(field).find(value => value !== '');
    if (value) return {value, field};
  }
  return null;
}

function bodyToken(body, contentType) {
  if (typeof body !== 'string' || !body) return null;
  const bytes = new TextEncoder().encode(body);
  if (bytes.length > MAX_BODY_BYTES) body = new TextDecoder().decode(bytes.subarray(0, MAX_BODY_BYTES));
  if (contentType.toLowerCase().includes('application/json')) {
    let payload;
    try { payload = JSON.parse(body); } catch { return null; }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const field of TOKEN_FIELDS) {
        if (typeof payload[field] === 'string' && payload[field]) {
          const value = normalize(payload[field]);
          return value ? {value, field} : null;
        }
      }
      return null;
    }
  }
  const parsed = parameterToken(new URLSearchParams(body));
  const value = normalize(parsed?.value || body);
  return value ? {value, field: parsed?.field || 'body'} : null;
}

// The caller must first bind the request to the active login tab and loopback port.
// A callback code is transient exchange input, never a credential or diagnostic.
export function handleCallback(request, _mode = 'browser') {
  const incoming = Object.fromEntries(Object.entries(request.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const origin = incoming.origin;
  const originAllowed = callbackOriginKind(origin) !== 'other';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, jwt, token, auth-jwt',
    'Access-Control-Max-Age': '600',
  };
  if (origin && originAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  if (incoming['access-control-request-private-network'] === 'true') headers['Access-Control-Allow-Private-Network'] = 'true';
  let query;
  try { query = new URL(request.url).searchParams; } catch { query = new URLSearchParams(); }
  const hasCode = query.has('code');
  function respond(status, message, extra = {}) {
    const body = JSON.stringify({ok: status < 400, message});
    return {
      status,
      headers: {...headers, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(new TextEncoder().encode(body).length)},
      body, hasCode, ...extra,
    };
  }
  if (!originAllowed) return respond(403, 'origin not allowed', {error: 'origin_not_allowed'});
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return {status: 204, headers: {...headers, 'Content-Length': '0'}, body: '', hasCode};
  if (!['GET', 'POST', 'PUT'].includes(method)) return respond(405, 'method not allowed', {error: 'method_not_allowed'});

  let candidate = headerToken(incoming);
  if (!candidate && method !== 'GET') candidate = bodyToken(request.body, incoming['content-type'] || '');
  candidate ||= parameterToken(query);
  if (!candidate && hasCode && method === 'GET') {
    const codes = query.getAll('code'), statuses = query.getAll('status');
    if (codes.length !== 1 || !codes[0] || codes[0].length > 16384 || /[\s\x00-\x1f\x7f]/.test(codes[0]) || statuses.length !== 1 || statuses[0] !== '00') {
      return respond(400, 'invalid login callback', {error: 'callback_code_invalid'});
    }
    const body = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Pro 로그인</title><body><p>로그인을 확인하고 있습니다. 완료되면 채팅창으로 돌아갑니다.</p></body></html>';
    return {status: 200, headers: {...headers, 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(new TextEncoder().encode(body).length), 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"},
      body, hasCode, field: 'code', exchangeCode: codes[0]};
  }
  if (!candidate) return respond(400, 'valid jwt is required', {error: 'callback_missing'});
  try {
    const credential = cleanCredential(candidate.value, 'browser');
    const encoded = credential.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!Object.keys(claims).length) throw new Error('invalid_token');
    return respond(200, 'AI Pro login completed', {credential, field: candidate.field});
  } catch (error) {
    return respond(400, 'valid jwt is required', {error: error.message === 'expired_token' ? 'expired_token' : 'invalid_token', field: candidate.field});
  }
}
