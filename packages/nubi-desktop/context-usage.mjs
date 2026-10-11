import {normalizeUsage} from '../../extensions/aipro-chat/usage.js';

// A reported total remains usable even when a compatible provider omits its
// input/output breakdown. Estimates and catalog capacity are never reports.
export function reportedContextUsage(record) {
  if (record?.reported) return normalizeUsage(record.reported);
  if (record?.kind !== 'measured') return null;
  return normalizeUsage({prompt_tokens:record.prompt, completion_tokens:record.completion, total_tokens:record.used,
    completion_tokens_details:{reasoning_tokens:record.reasoning}, prompt_tokens_details:{cached_tokens:record.cached}});
}

export function createContextUsage({usage, estimate, model, compactAt, at, reason = 'response_usage_missing'}) {
  const reported = normalizeUsage(usage), measured = reported?.total_tokens != null;
  const record = {kind:measured ? 'measured' : 'estimated', used:measured ? reported.total_tokens : estimate(),
    window:Number.isSafeInteger(model?.contextLength) && model.contextLength > 0 ? model.contextLength : null,
    compactAt, model:model?.id || null, at};
  if (!measured) return {...record, reason, ...(reported ? {reported} : {})};
  return {...record, prompt:reported.prompt_tokens, completion:reported.completion_tokens,
    ...(reported.completion_tokens_details ? {reasoning:reported.completion_tokens_details.reasoning_tokens} : {}),
    ...(reported.prompt_tokens_details ? {cached:reported.prompt_tokens_details.cached_tokens} : {})};
}
