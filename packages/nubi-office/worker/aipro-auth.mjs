import {exchangeCode} from '../../../extensions/aipro-chat/exchange.js';
import {nubiAuthPage} from './nubi-auth-page.mjs';
import {windowTokens as catalogWindowTokens} from '../../../extensions/aipro-chat/core.js';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import {safeError} from './connection-errors.mjs';

const ORIGIN = 'https://aipro.sdsdev.co.kr';
export function openLoginBrowser(url) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    execFile(executable, args, error => error ? reject(new Error('login_browser_failed')) : resolve());
  });
}
async function json(response) {
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(response.status===401?'unauthorized':response.status===403?'forbidden':response.status===429?'rate_limited':response.status>=500?'upstream':'aipro_login_failed'),{status:response.status}); }
  if (!response.body) throw new Error('response_json_invalid');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 1000000) throw new Error('response_json_invalid');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function validateToken(token) {
  if (typeof token !== 'string' || token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('invalid_credentials');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  if (!claims || typeof claims !== 'object' || Array.isArray(claims) || !Object.keys(claims).length || (claims.exp !== undefined && (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()))) throw new Error('unauthorized');
  return token;
}
// The model's context window in tokens. AI Pro's model list names it context_length and, in its open_api entries,
// context (glm-5.2 524288, qwen3.8-27b 262144, gpt-oss-120b 131072; user, 2026-09-30); vLLM names it max_model_len.
// The browser runtime reads the same names (extensions/aipro-chat/core.js). Unread, Office took every open_api model as
// 256K: compaction came too early for glm-5.2, and past the window of gpt-oss-120b.
export const windowTokens = catalogWindowTokens;
export async function fetchModelCatalog(token, fetchImpl = fetch, signal) {
  const response = await fetchImpl(`${ORIGIN}/api/models`, { headers: { Accept: 'application/json', Authorization: `Bearer ${validateToken(token)}`, 'X-REASONING': 'true' }, credentials:'omit',cache: 'no-store', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]) });
  const body = await json(response);
  if (body?.success === false || body?.ok === false || !Array.isArray(body?.modelList)) throw new Error('models_invalid');
  const summary = {received: body.modelList.length, usable: 0, excluded: {name: 0, duplicate: 0, target: 0, agent: 0}};
  const seen = new Set();
  const models = body.modelList.flatMap(item => {
    const id = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!id || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) {summary.excluded.name++; return [];}
    if (seen.has(id)) {summary.excluded.duplicate++; return [];}
    seen.add(id);
    return [{ id, ...(typeof item.supports_images==='boolean'?{supportsImages:item.supports_images}:{}), label: typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name.trim().slice(0, 200) : id,
      ...(windowTokens(item) ? {contextLength: windowTokens(item)} : {}),
      ...(Number.isSafeInteger(item.max_output_tokens) && item.max_output_tokens > 0 ? {maxOutputTokens: item.max_output_tokens} : {}),
      ...(Number.isSafeInteger(item.max_input_tokens) && item.max_input_tokens > 0 ? {maxInputTokens: item.max_input_tokens} : {}) }];
  });
  if (!models.length) throw new Error('models_invalid');
  summary.usable = models.length;
  return {models, diagnostics: {source: '/api/models', status: response.status, summary}, fetchedAt: Date.now()};
}
export async function fetchModels(token, fetchImpl = fetch, signal) {return (await fetchModelCatalog(token, fetchImpl, signal)).models;}

export async function startLogin({ fetchImpl = fetch, openBrowser = openLoginBrowser, timeoutMs = 180000, hostLabel = 'Excel', onProgress = () => {} } = {}) {
  const host = hostLabel === '누비 워크스페이스' ? hostLabel : 'Excel';
  const controller = new AbortController();
  let consumed = false, finished = false, pendingResponse;
  const startedAt=Date.now();let phase='waiting';
  const progress=(next,details={})=>{phase=next;try{onProgress({phase:next,at:Date.now(),elapsedMs:Date.now()-startedAt,...details});}catch{}};
  let resolve, reject;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  result.catch(() => {});
  function complete(error, value) {
    if (finished) return;
    finished = true;
    progress(error?'failed':'ready',error?{error:safeError(error),failedStage:phase,...(Number.isInteger(error.status)?{status:error.status}:{})}:{});
    clearTimeout(timer); controller.abort();
    if (pendingResponse && !pendingResponse.writableEnded) {
      pendingResponse.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      pendingResponse.end(nubiAuthPage({host,provider:'AI Pro',error:!!error}));
    }
    server.close(); server.closeIdleConnections();
    error ? reject(error) : resolve(value);
  }
  const server = createServer((request, response) => {
    const port = server.address()?.port;
    const origin = request.headers.origin;
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(request.headers.host) || (origin && ![ORIGIN, 'https://epsso.samsung.net'].includes(origin))) { response.writeHead(403).end(); return; }
    let url; try { url = new URL(request.url, 'http://localhost'); } catch { response.writeHead(400).end(); return; }
    if (request.method !== 'GET' || url.pathname !== '/auth') { response.writeHead(404).end(); return; }
    if (consumed || finished) { response.writeHead(409).end(); return; }
    const code = url.searchParams.get('code');
    if (url.searchParams.getAll('status').length!==1||url.searchParams.getAll('code').length!==1||url.searchParams.get('status') !== '00' || !code || code.length > 16384 || /[\s\x00-\x1f\x7f]/.test(code)) { response.writeHead(400).end('Invalid callback'); return; }
    consumed = true; pendingResponse = response;
    progress('callback_received');
    void (async () => {
      try {
        progress('exchanging');
        let transportError;
        const exchanged=await exchangeCode(code,{signal:controller.signal,fetchImpl:async(...args)=>{try{const response=await fetchImpl(...args);progress('exchanging',{status:response.status});return response;}catch(error){transportError=error;throw error;}}}).catch(error=>{if(transportError)throw transportError;const code=error.status===401?'unauthorized':error.status===403?'forbidden':error.status===429?'rate_limited':error.status>=500?'upstream':error.message==='exchange_timeout'?'network_timeout':'aipro_login_failed';throw Object.assign(new Error(code),{status:error.status});});
        const token=validateToken(exchanged.credential.token);
        progress('loading_models');
        const catalog = await fetchModelCatalog(token, fetchImpl, controller.signal);
        progress('loading_models',{status:catalog.diagnostics.status});
        complete(null, { token, ...catalog });
      } catch (error) { const code=safeError(error);complete(Object.assign(new Error(code==='request_failed'?'aipro_login_failed':code),{status:error.status})); }
    })();
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  const timer = setTimeout(() => complete(new Error('login_timeout')), timeoutMs);
  try {
    await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    const url = `${ORIGIN}/auth/cli/login?port=${server.address().port}`;
    await openBrowser(url);
  } catch (error) { complete(new Error(error?.code==='EADDRINUSE'?'login_port_busy':safeError(error)==='request_failed'?'login_browser_failed':safeError(error))); }
  return { result, cancel: () => complete(new Error('cancelled')) };
}
