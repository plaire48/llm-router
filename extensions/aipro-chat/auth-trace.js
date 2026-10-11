import {ORIGIN} from './core.js';

// Diagnostics are an allowlist of protocol names, never a dump of URLs or data.
const WORDS = new Set('api v1 v2 auth oauth oauth2 sso saml saml2 cli vscode login logout callback authorize authorization token tokens exchange verify validate refresh session sessions csrf signin signout consent code access access_token accessToken refresh_token refreshToken id_token idToken jwt check status userinfo'.split(' '));
const FIELDS = new Set('code status state port jwt token auth_jwt access_token accessToken refresh_token refreshToken id_token idToken token_type expires_in expires_at expiresAt client_id clientId redirect_uri redirectUri grant_type code_verifier code_challenge code_challenge_method scope error error_description success ok message url'.split(' '));
const CONTAINERS = new Set(['data', 'result', 'payload', 'response', 'auth', 'tokens', 'session']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const TYPES = new Set(['Document', 'Fetch', 'XHR', 'Other']);
const MAX_BODY = 262144;

export function authRequestAddress(value) {
  try {
    const url = new URL(value);
    if (url.origin !== ORIGIN || url.username || url.password) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (!segments.slice(0, 3).some(part => ['auth', 'oauth', 'oauth2', 'sso', 'saml', 'saml2'].includes(part))) return null;
    const path = '/' + segments.slice(0, 10).map(part => WORDS.has(part) ? part : '[redacted]').join('/');
    return {path, queryFields: [...new Set([...url.searchParams.keys()].filter(key => FIELDS.has(key)))].sort()};
  } catch { return null; }
}

export function authFieldNames(text, form = false) {
  if (typeof text !== 'string' || text.length > MAX_BODY) return [];
  if (form) return [...new Set([...new URLSearchParams(text).keys()].filter(key => FIELDS.has(key)))].sort();
  let value;
  try { value = JSON.parse(text); } catch { return []; }
  const fields = new Set();
  function visit(item, path = '', depth = 0) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || depth > 3) return;
    for (const key of Object.keys(item)) {
      if (FIELDS.has(key)) fields.add(path + key);
      if (CONTAINERS.has(key)) visit(item[key], path + key + '.', depth + 1);
    }
  }
  visit(value);
  return [...fields].sort();
}

function contentKind(mime) {
  return /json/i.test(mime || '') ? 'json' : /html/i.test(mime || '') ? 'html' : 'other';
}

export function createAuthTrace(onChange) {
  const requests = [], pending = new Map();
  let stopped = false, bodyReads = 0, dropped = 0, state = 'collecting';
  const snapshot = () => structuredClone({scope: 'login_tab_browser_only', valuesIncluded: false, state, dropped, requests});
  const changed = () => { if (!stopped) onChange(snapshot()); };
  function response(record, value) {
    record.status = Number.isInteger(value?.status) && value.status >= 100 && value.status <= 599 ? value.status : null;
    record.content = contentKind(value?.mimeType);
  }
  return {
    snapshot,
    stop(reason = state === 'collecting' ? 'stopped' : state) {
      state = reason; stopped = true; pending.clear();
      for (const record of requests) if (['pending', 'reading'].includes(record.body)) record.body = 'incomplete';
      return snapshot();
    },
    async observe(method, params, readBody) {
      if (stopped) return;
      if (method === 'Network.requestWillBeSent') {
        const previous = pending.get(params.requestId);
        if (previous && params.redirectResponse) { response(previous, params.redirectResponse); previous.body = 'redirect'; }
        pending.delete(params.requestId);
        const address = authRequestAddress(params.request?.url);
        if (address && TYPES.has(params.type)) {
          if (requests.length >= 40) dropped++;
          else {
            const headers = params.request.headers || {};
            const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
            const record = {...address, method: METHODS.has(params.request.method) ? params.request.method : 'other', type: params.type,
              requestFields: authFieldNames(params.request.postData, /x-www-form-urlencoded/i.test(contentType)), status: null, content: null, body: 'pending', responseFields: []};
            requests.push(record); pending.set(params.requestId, record);
          }
        }
        if (previous || address) changed();
        return;
      }
      const record = pending.get(params.requestId);
      if (!record) return;
      if (method === 'Network.responseReceived') { response(record, params.response); changed(); }
      if (method === 'Network.loadingFailed') { record.body = 'request_failed'; pending.delete(params.requestId); changed(); }
      if (method !== 'Network.loadingFinished') return;
      pending.delete(params.requestId);
      if (record.content !== 'json') record.body = 'not_json';
      else if (!Number.isFinite(params.encodedDataLength) || params.encodedDataLength > MAX_BODY) record.body = 'skipped_size';
      else if (bodyReads >= 8) record.body = 'skipped_limit';
      else {
        bodyReads++;
        record.body = 'reading'; changed();
        try {
          const result = await readBody(params.requestId);
          if (stopped) return;
          const raw = result.base64Encoded ? atob(result.body) : result.body;
          if (typeof raw !== 'string' || raw.length > MAX_BODY) record.body = 'skipped_size';
          else { record.responseFields = authFieldNames(raw); record.body = 'fields_only'; }
        } catch { if (stopped) return; record.body = 'unavailable'; }
      }
      changed();
    },
  };
}
