import {historyContext, summaryMessage} from './context-state.js';
import {promptPreamble} from './chat-contract.js';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

// Keep missing counters distinct from zero, and never add cumulative stream frames.
export function normalizeUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const prompt_tokens = count(value.prompt_tokens), completion_tokens = count(value.completion_tokens);
  let total_tokens = count(value.total_tokens);
  if (prompt_tokens !== null && completion_tokens !== null) {
    const sum = prompt_tokens + completion_tokens;
    if (!Number.isSafeInteger(sum) || (total_tokens !== null && total_tokens !== sum)) return null;
    total_tokens = sum;
  }
  if (total_tokens !== null && (total_tokens < (prompt_tokens ?? 0) || total_tokens < (completion_tokens ?? 0))) return null;
  if (prompt_tokens === null && completion_tokens === null && total_tokens === null) return null;
  const reasoning = count(value.completion_tokens_details?.reasoning_tokens);
  const cached = count(value.prompt_tokens_details?.cached_tokens);
  return {prompt_tokens, completion_tokens, total_tokens,
    ...(cached !== null && prompt_tokens !== null && cached <= prompt_tokens ? {prompt_tokens_details: {cached_tokens: cached}} : {}),
    ...(reasoning !== null && completion_tokens !== null && reasoning <= completion_tokens ? {completion_tokens_details: {reasoning_tokens: reasoning}} : {})};
}

export function normalizeResponsesUsage(value) {
  if (!value || typeof value !== 'object') return null;
  return normalizeUsage({prompt_tokens: value.input_tokens, completion_tokens: value.output_tokens, total_tokens: value.total_tokens,
    prompt_tokens_details: value.input_tokens_details, completion_tokens_details: value.output_tokens_details});
}

export function estimateTokens(text) {
  let ascii = 0, unicode = 0;
  for (const char of String(text || '')) char.codePointAt(0) <= 127 ? ascii++ : unicode++;
  return Math.ceil(ascii / 4 + unicode * 1.5);
}

const restoredFiles = (messages, memory) => historyContext(messages, memory).messages.flatMap(message => message.attachments || []);
export function contextUsage(messages, draft, model, busy = false, partial = '', promptContext = {}) {
  const capacity = Number.isSafeInteger(model?.contextLength) && model.contextLength > 0 ? model.contextLength : null;
  const last = messages.at(-1);
  const usage = last?.role === 'assistant' && last.state === 'done' && last.modelId === model?.name ? normalizeUsage(last.usage) : null;
  const fileTokens = [...restoredFiles(messages, promptContext.memory), ...(promptContext.draftAttachments || [])].reduce((sum, file) => sum + (file.tokens || 0), 0);
  const measured = !busy && !draft.trim() && !promptContext.draftAttachments?.length && usage?.total_tokens != null && (last?.skillId || '') === (promptContext.skill?.id || '') && (last?.pageId || '') === (promptContext.pageId || '');
  const restored = historyContext(messages, promptContext.memory);
  const sent = [...(restored.summary ? [summaryMessage(restored.summary)] : []), ...restored.messages];
  const parts = [...sent.map(message => message.content), ...(draft.trim() ? [draft.trim()] : []), ...(busy && partial ? [partial] : [])];
  const estimated = parts.length ? 3 + [...promptPreamble(model?.name || '', undefined, promptContext).map(message => message.content), ...(promptContext.tools?.length ? [JSON.stringify(promptContext.tools)] : []), ...parts].reduce((sum, text) => sum + estimateTokens(text) + 6, 0) : 0;
  const used = measured ? usage.total_tokens : estimated + fileTokens;
  return {used, capacity, ratio: capacity ? used / capacity : null, kind: measured ? 'measured' : parts.length || fileTokens ? 'estimated' : 'empty', usage: measured ? usage : null};
}

export const formatTokens = value => value == null ? '—' : value.toLocaleString('en-US');
export const compactTokens = value => value == null ? '—' : value >= 1000 ? `${(value / 1000).toLocaleString('en-US', {maximumFractionDigits: 1})}K` : String(value);
export function contextPercent(info) {
  if (info.ratio === null) return '—';
  const percent = info.ratio * 100;
  return percent > 0 && percent < 0.1 ? '<0.1%' : `${percent.toLocaleString('en-US', {maximumFractionDigits: 1})}%`;
}
