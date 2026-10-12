import {ORIGIN, cleanCredential} from './core.js';

const MAX_RESPONSE_BYTES = 131072;
function failure(code, status = 0) { return Object.assign(new Error(code), {status}); }
export async function responseText(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw failure('exchange_invalid_response', response.status);
  }
  if (!response.body) throw failure('exchange_invalid_response', response.status);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw failure('exchange_invalid_response', response.status);
      text += decoder.decode(value, {stream: true});
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function exchangeCode(code, {signal, fetchImpl = fetch, timeoutMs = 15000} = {}) {
  if (typeof code !== 'string' || !code || code.length > 16384 || /[\s\x00-\x1f\x7f]/.test(code)) throw failure('callback_code_invalid');
  const controller = new AbortController();
  const cancel = () => controller.abort('cancelled');
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, {once: true});
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  let status = 0;
  try {
    if (controller.signal.aborted) throw failure('exchange_interrupted');
    const response = await fetchImpl(`${ORIGIN}/auth/exchange`, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
      body: new URLSearchParams({code}).toString(),
    });
    status = response.status;
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw failure('exchange_rejected', status); }
    const raw = await responseText(response);
    let credential;
    try {
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.ok === false || payload.success === false) throw new Error();
      credential = cleanCredential(payload.token, 'browser');
      const encoded = credential.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      if (!Object.keys(JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))).length) throw new Error();
    } catch (error) { throw failure(error.message === 'expired_token' ? 'expired_token' : 'exchange_invalid_response', status); }
    return {credential, status, field: 'token'};
  } catch (error) {
    if (controller.signal.aborted) throw failure(controller.signal.reason === 'timeout' ? 'exchange_timeout' : 'exchange_interrupted', status);
    if (['exchange_rejected', 'exchange_invalid_response', 'expired_token'].includes(error.message)) throw error;
    throw failure('exchange_network', status);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
