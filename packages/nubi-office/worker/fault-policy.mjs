import {safeError} from './connection-errors.mjs';

const permanent = new Set(['cancelled','unauthorized','forbidden','invalid_model','invalid_credentials','no_credential','tls_untrusted','tls_expired','tls_hostname','network_dns','network_refused','response_json_invalid','response_filtered','context_overflow','fabrix_tool_protocol']);
const retryableStatus = new Set([408,425,429,500,502,503,504]);
const retryableCode = new Set(['upstream','rate_limited','network_error','network_timeout','model_timeout','model_stream_incomplete','chatgpt_network','fabrix_network','office_timeout','excel_busy','office_busy']);

// Status is authoritative. A generic "upstream" label must not turn a 400 or
// 501 into an endless retry. Output/schema repair has a separate supervisor.
export function transient(error) {
  if (permanent.has(safeError(error))) return false;
  if (Number.isInteger(error?.status) && error.status >= 400) return retryableStatus.has(error.status);
  return retryableCode.has(safeError(error));
}

export function retryAfterMs(headers, now=Date.now()) {
  const value=headers?.get?.('retry-after')?.trim();
  if (!value || value.length>128) return undefined;
  if (/^\d+$/.test(value)) return Math.min(Number(value)*1000,Number.MAX_SAFE_INTEGER);
  if (!/^[A-Za-z]{3,9}[, ]/.test(value)) return undefined;
  const date=Date.parse(value);
  return Number.isFinite(date)?Math.max(0,date-now):undefined;
}

// Only these safe scalar facts cross recovery/UI boundaries. No server body,
// raw error, headers, endpoint, tool arguments or partial response is logged.
export function faultFacts(error) {
  return {
    ...(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?{status:error.status}:{}),
    ...(Number.isFinite(error?.retryAfterMs)&&error.retryAfterMs>=0?{retryAfterMs:Math.min(error.retryAfterMs,Number.MAX_SAFE_INTEGER)}:{})
  };
}

const reads = new Set(['read_selection','verify_selection','workbook_range','workbook_sheets','workbook_structure','reconcile_changes','document_reconcile','document_read','office_read','office_read_text','office_receipt']);
export const isRetryableRead = name => reads.has(name);
export const transientRead = error => ['office_timeout','excel_busy','office_busy'].includes(safeError(error));
