// OAuth protocol adapted from Pi 0.86.1 (MIT). The extension owns PKCE and
// receives the loopback navigation in its login tab; no Node server is used.
import {responseText} from './exchange.js';

export const CHATGPT_AUTH_ORIGIN = 'https://auth.openai.com';
export const CHATGPT_REDIRECT = 'http://localhost:1455/auth/callback';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const failure = (code, status = 0) => Object.assign(new Error(code), {status});
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function createChatGPTLogin() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL('/oauth/authorize', CHATGPT_AUTH_ORIGIN);
  url.search = new URLSearchParams({response_type: 'code', client_id: CLIENT_ID, redirect_uri: CHATGPT_REDIRECT,
    scope: 'openid profile email offline_access', code_challenge: challenge, code_challenge_method: 'S256', state,
    id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', originator: 'pi'}).toString();
  return {url: url.href, verifier, state};
}

// Waiting PKCE survives MV3 suspension in trusted session storage only.
export function validChatGPTFlow(flow, attemptId) {
  return !!flow && flow.attemptId === attemptId && /^[\w-]{43}$/.test(flow.state) && /^[\w-]{43}$/.test(flow.verifier);
}

export function chatGPTCallback(url, flow) {
  let parsed;
  try {parsed = new URL(url);} catch {throw failure('chatgpt_callback_invalid');}
  if (`${parsed.origin}${parsed.pathname}` !== CHATGPT_REDIRECT || parsed.username || parsed.password || parsed.hash ||
      parsed.searchParams.getAll('state').length !== 1 || !flow?.state || parsed.searchParams.get('state') !== flow.state) throw failure('chatgpt_callback_invalid');
  if (parsed.searchParams.has('error')) throw failure('chatgpt_login_denied');
  const code = parsed.searchParams.get('code');
  if (parsed.searchParams.getAll('code').length !== 1 || !code || code.length > 16384 || /[\s\x00-\x1f\x7f]/.test(code)) throw failure('chatgpt_callback_invalid');
  return code;
}

function credentialFrom(payload, previous) {
  try {
    const {access_token: token, refresh_token: refreshToken, expires_in: expires} = payload;
    if (typeof token !== 'string' || token.length > 32768 || token.split('.').length !== 3 ||
        typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 16384 || /\s/.test(refreshToken) ||
        typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) throw new Error();
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')), char => char.charCodeAt(0))));
    if (typeof claims['https://api.openai.com/auth']?.chatgpt_account_id !== 'string' || !claims['https://api.openai.com/auth'].chatgpt_account_id) throw new Error();
    const expiresAt = Math.min(Date.now() + expires * 1000, Number.isFinite(claims.exp) ? claims.exp * 1000 : Infinity);
    if (expiresAt <= Date.now()) throw new Error();
    return {provider: 'chatgpt', mode: 'browser', token, refreshToken, expiresAt, receivedAt: previous?.receivedAt || Date.now(), source: 'login'};
  } catch {throw failure('chatgpt_token_invalid');}
}

async function tokenRequest(fields, {signal, fetchImpl = fetch, timeoutMs = 20000, previous} = {}) {
  const controller = new AbortController(), cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, {once: true});
  const timer = setTimeout(cancel, timeoutMs);
  let status = 0;
  try {
    if (controller.signal.aborted) throw failure('exchange_interrupted');
    const response = await fetchImpl(`${CHATGPT_AUTH_ORIGIN}/oauth/token`, {method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: new URLSearchParams({client_id: CLIENT_ID, ...fields}).toString()});
    status = response.status;
    if (!response.ok) {await response.body?.cancel().catch(() => {}); throw failure('chatgpt_exchange_rejected', status);}
    let payload;
    try {payload = JSON.parse(await responseText(response));} catch {throw failure('chatgpt_token_invalid', status);}
    return {credential: credentialFrom(payload, previous), status, field: 'access_token'};
  } catch (error) {
    if (controller.signal.aborted) throw failure(signal?.aborted ? 'exchange_interrupted' : 'exchange_timeout', status);
    if (error.message.startsWith('chatgpt_')) throw error;
    throw failure('chatgpt_network', status);
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', cancel);}
}

export function exchangeChatGPTCode(code, flow, options) {
  return tokenRequest({grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: CHATGPT_REDIRECT}, options);
}
export function refreshChatGPTToken(credential, options) {
  return tokenRequest({grant_type: 'refresh_token', refresh_token: credential.refreshToken}, {...options, previous: credential});
}
