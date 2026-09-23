import {httpError} from './core.js';
import {retryAfterMs} from './http-retry.js';

const reasons = new Set(['system_messages', 'tool_messages', 'tool_schema', 'stream_options', 'context_limit', 'model_unavailable', 'image_input', 'request_body', 'endpoint', 'http']);
const requestStatuses = [400, 404, 413, 415, 422];
const errorFor = reason => ({system_messages: 'request_format', tool_messages: 'request_format', tool_schema: 'request_format', stream_options: 'request_format',
  context_limit: 'context_overflow', model_unavailable: 'invalid_model', image_input: 'request_image', request_body: 'request_rejected', endpoint: 'request_endpoint'})[reason];

// A successful HTTP handshake can still end with an API error event. Preserve
// that distinction without inventing an HTTP status or copying server text.
// Specific permanent codes take precedence over a generic transient type.
const streamCodes = new Map([
  ...['server_error', 'internal_server_error', 'service_unavailable', 'overloaded_error', 'timeout', 'request_timeout'].map(code => [code, ['upstream', true]]),
  ['rate_limit_exceeded', ['rate_limited', true]], ['rate_limit_error', ['rate_limited', true]],
  ...['invalid_api_key', 'authentication_error', 'unauthorized'].map(code => [code, ['unauthorized', false]]),
  ['permission_denied', ['forbidden', false]], ['permission_error', ['forbidden', false]],
  ['insufficient_quota', ['rate_limited', false]],
  ...['context_length_exceeded', 'context_window_exceeded', 'max_input_tokens'].map(code => [code, ['context_overflow', false]]),
  ...['model_not_found', 'invalid_model', 'unknown_model'].map(code => [code, ['invalid_model', false]]),
  ['invalid_request_error', ['request_rejected', false]], ['content_filter', ['response_filtered', false]],
]);
export function completionStreamError(payload, headers) {
  const source = payload?.response?.error || payload?.error || payload;
  const key = typeof source?.code === 'string' && source.code ? source.code : source?.type;
  const [message, retryable] = streamCodes.get(key) || ['upstream', false];
  const delay = retryable ? retryAfterMs(headers) : undefined;
  return Object.assign(new Error(message), {retryable, ...(delay === undefined ? {} : {retryAfterMs: delay})});
}

// Only fixed classifications cross the provider boundary. Raw error messages
// may echo prompts, generated code or credentials and must never be persisted.
export function completionDiagnostic(value) {
  if (!value || !['rejected', 'recovered'].includes(value.phase) || !reasons.has(value.reason) || ![1, 2].includes(value.attempt) ||
      !Number.isInteger(value.status) || value.status < 200 || value.status > 599) return null;
  return {phase: value.phase, reason: value.reason, attempt: value.attempt, status: value.status};
}

export function classifyCompletionError(status, payload) {
  let reason = status === 404 ? 'endpoint' : requestStatuses.includes(status) ? 'request_body' : 'http';
  if (requestStatuses.includes(status)) {
    const error = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
    const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
    const message = typeof error?.message === 'string' ? error.message.slice(0, 8192) : '';
    const param = typeof error?.param === 'string' ? error.param : '';
    const locations = Array.isArray(payload?.detail) ? payload.detail.slice(0, 32).flatMap(item => Array.isArray(item?.loc) ? item.loc.filter(value => typeof value === 'string') : []) : [];
    if (status === 413 || ['context_length_exceeded', 'context_window_exceeded', 'max_input_tokens'].includes(code) ||
        /maximum context length|context (?:length|window).{0,40}(?:exceed|too (?:long|large))|(?:input|prompt) tokens.{0,40}exceed/i.test(message)) reason = 'context_limit';
    else if (['model_not_found', 'invalid_model', 'unknown_model'].includes(code) || param === 'model') reason = 'model_unavailable';
    else if (/system message must be at the beginning|only (?:one|a single) system message/i.test(message)) reason = 'system_messages';
    else if (['stream_options', 'stream_options.include_usage'].includes(param) || locations.includes('stream_options')) reason = 'stream_options';
    else if (/tool_call_id|tool (?:call|response|result).{0,60}(?:missing|match|follow)|messages with role ['"]?tool/i.test(message)) reason = 'tool_messages';
    else if (param === 'tools' || param.startsWith('tools.') || locations.includes('tools')) reason = 'tool_schema';
    else if (['image_url', 'image'].includes(param) || locations.includes('image_url') || /(?:image|vision).{0,50}(?:not supported|unsupported)|(?:not support|unsupported).{0,30}(?:image|vision)/i.test(message)) reason = 'image_input';
  }
  return {error: errorFor(reason) || httpError(status), reason, status};
}

export async function readCompletionError(response) {
  let payload;
  if (requestStatuses.includes(response.status) && response.body) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let text = '', bytes = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) {text += decoder.decode(); payload = JSON.parse(text); break;}
        bytes += value.byteLength;
        if (bytes > 65536) break;
        text += decoder.decode(value, {stream: true});
      }
    } catch { /* HTML, truncated and oversized bodies retain their HTTP class. */ }
    finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
  } else await response.body?.cancel().catch(() => {});
  const delay = retryAfterMs(response.headers);
  return {...classifyCompletionError(response.status, payload), ...(delay === undefined ? {} : {retryAfterMs: delay})};
}
