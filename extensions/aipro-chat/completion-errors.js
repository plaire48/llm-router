import {httpError, ERROR_TEXT} from './core.js';
import {retryAfterMs} from './http-retry.js';

const reasons = new Set(['system_messages', 'tool_messages', 'tool_schema', 'stream_options', 'context_limit', 'model_unavailable', 'image_input', 'request_body', 'endpoint', 'http', 'stream_error']);
const requestStatuses = [400, 404, 413, 415, 422];
// A server's error code is an identifier such as server_error or image_too_large.
// Only that shape is kept, never the server's message text.
export const errorCode = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(value) ? value : undefined;

// Typed check outcomes only: never retain expected values, refs or page text.
export function verificationDiagnostic(result) {
  const kinds = new Set(['field_value', 'field_valid', 'field_sum', 'field_digest', 'field_contains', 'text_style', 'control_state', 'control_expanded', 'element_in', 'text_present', 'url_is', 'url_page_is', 'link_destination', 'link_page_is', 'field_unchanged', 'fields_unchanged']);
  return (Array.isArray(result?.checks) ? result.checks : []).slice(0, 24)
    .filter(check => kinds.has(check?.kind) && typeof check.passed === 'boolean')
    .map(check => ({kind: check.kind, passed: check.passed,
      ...(['target_changed', 'check_target_incompatible', 'url_expected_invalid', 'url_expected_restricted', 'url_actual_invalid', 'url_actual_restricted', 'url_origin_mismatch', 'url_path_mismatch', 'url_identifier_mismatch', 'baseline_missing', 'field_written', 'value_changed', 'url_query_mismatch', 'url_fragment_mismatch', 'url_identity_mismatch'].includes(check.reason) ? {reason: check.reason} : {})}));
}

const SCOPE_REASONS = ['scope_issue_invalid', 'scope_target_invalid', 'scope_anchor_invalid', 'scope_review_quote_mismatch', 'scope_source_quote_mismatch', 'scope_answer_invalid'];
const SCOPE_KINDS = ['new_requirement', 'optional_method', 'new_rank', 'pending_step', 'unsupported_answer_claim', 'other'];
const SCOPE_TARGETS = ['check', 'next_step', 'plan', 'text', 'other'];
// Counts and fixed categories only; a model-authored string never passes.
function scopeShape(value) {
  const count = item => Number.isSafeInteger(item) && item >= 0 && item <= 64;
  if (!value || typeof value !== 'object' || !['within_scope', 'repair_scope', 'unknown'].includes(value.decision) ||
      !['answer', 'external', 'unknown'].includes(value.correctionTarget) || !Array.isArray(value.kinds) || !Array.isArray(value.targets) ||
      !['issues', 'anchored', 'extraKeys', 'nonmet', 'cited'].every(key => count(value[key]))) return null;
  return {decision: value.decision, correctionTarget: value.correctionTarget, issues: value.issues,
    kinds: SCOPE_KINDS.filter(kind => value.kinds.includes(kind)), targets: SCOPE_TARGETS.filter(target => value.targets.includes(target)),
    anchored: value.anchored, extraKeys: value.extraKeys, nonmet: value.nonmet, cited: value.cited};
}

// Persist only typed lifecycle facts. Model-written review text, source bodies,
// arguments and arbitrary error strings never enter the session event log.
export function agentDiagnostic(value) {
  if (value?.kind !== 'agent') return null;
  if (value.phase === 'scope_review' && ['plan_scope', 'plan_step', 'checkpoint', 'final'].includes(value.scope) &&
      ['within_scope', 'repair_scope', 'unknown'].includes(value.decision) && ['answer', 'external', 'unknown'].includes(value.correctionTarget) && typeof value.corrected === 'boolean') {
    return {phase: value.phase, scope: value.scope, decision: value.decision, correctionTarget: value.correctionTarget, corrected: value.corrected,
      ...(['scope_input_invalid', 'scope_context_budget', 'scope_protocol_invalid', 'scope_quote_invalid', 'scope_issue_invalid', 'scope_target_invalid', 'scope_anchor_invalid', 'scope_review_quote_mismatch', 'scope_source_quote_mismatch', 'scope_answer_invalid', 'scope_response_invalid', 'scope_skipped', 'cancelled', 'authentication'].includes(value.reason) ? {reason: value.reason} : {}),
      ...(SCOPE_REASONS.includes(value.withdrawn) ? {withdrawn: value.withdrawn} : {}),
      // The stage was settled by its met checks: every open check lay outside it.
      ...(value.settled === true && value.scope === 'plan_step' && value.decision === 'repair_scope' ? {settled: true} : {}),
      ...(scopeShape(value.shape) ? {shape: scopeShape(value.shape)} : {})};
  }
  if (value.phase === 'review_result' && ['plan_step', 'checkpoint', 'final'].includes(value.scope) && ['complete', 'revise', 'blocked'].includes(value.status)) {
    const checks = Array.isArray(value.checks) ? value.checks.slice(0, 8) : [];
    return {phase: value.phase, scope: value.scope, status: value.status,
      met: checks.filter(check => check?.status === 'met').length,
      unmet: checks.filter(check => check?.status === 'unmet').length,
      unknown: checks.filter(check => check?.status === 'unknown').length};
  }
  if (value.phase === 'run_result' && ['answer', 'waiting_user', 'cancelled', 'failed'].includes(value.outcome)) {
    return {phase: value.phase, outcome: value.outcome,
      verification: value.verification === 'passed' && value.outcome === 'answer' ? 'passed' : 'not_run',
      ...(value.outcome === 'failed' || value.outcome === 'cancelled' ? {code: Object.hasOwn(ERROR_TEXT, value.code) ? value.code : 'response_invalid'} : {}),
      finishReason: ['stop', 'length', 'tool_calls'].includes(value.finishReason) ? value.finishReason : 'unknown'};
  }
  return null;
}
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
  ['invalid_prompt', ['response_filtered', false]],
  // OpenAI Responses image failures: the image, not the server, was refused.
  ...['invalid_image', 'invalid_image_format', 'invalid_base64_image', 'invalid_image_url', 'image_too_large', 'image_too_small', 'image_parse_error',
    'image_content_policy_violation', 'invalid_image_mode', 'image_file_too_large', 'unsupported_image_media_type', 'empty_image_file'].map(code => [code, ['request_image', false]]),
]);
export function completionStreamError(payload, headers) {
  const source = payload?.response?.error || payload?.error || payload;
  const key = typeof source?.code === 'string' && source.code ? source.code : source?.type;
  const [message, retryable] = streamCodes.get(key) || ['upstream', false];
  const delay = retryable ? retryAfterMs(headers) : undefined;
  return Object.assign(new Error(message), {retryable, ...(errorCode(key) ? {code: errorCode(key)} : {}), ...(delay === undefined ? {} : {retryAfterMs: delay})});
}

// Only fixed classifications cross the provider boundary. Raw error messages
// may echo prompts, generated code or credentials and must never be persisted.
export function completionDiagnostic(value) {
  if (!value || !['rejected', 'recovered'].includes(value.phase) || !reasons.has(value.reason) || ![1, 2].includes(value.attempt) ||
      !Number.isInteger(value.status) || value.status < 200 || value.status > 599) return null;
  return {phase: value.phase, reason: value.reason, attempt: value.attempt, status: value.status, ...(errorCode(value.code) ? {code: value.code} : {})};
}

export function classifyCompletionError(status, payload) {
  let reason = status === 404 ? 'endpoint' : requestStatuses.includes(status) ? 'request_body' : 'http', code = '';
  if (requestStatuses.includes(status)) {
    const error = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
    code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
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
  return {error: errorFor(reason) || httpError(status), reason, status, ...(errorCode(code) ? {code} : {})};
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
