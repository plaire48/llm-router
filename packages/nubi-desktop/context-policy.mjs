// Desktop keeps the provider's maximum window intact. Only the automatic
// summary trigger changes; output reservations and smaller input ceilings
// remain separate safety limits.
export const CONTEXT_SUMMARY_RATIO = .75;
// The shared compactor's own line between a large and a small window (input tokens). The 75% of the whole window is the
// user's decision for the models in use (262,144 → 196,608). Below this line that trigger sat within a few thousand
// tokens of the input limit, and one more tool result stopped a run with context_input_too_large (unit tests of
// 2026-10-05, 22,000-token windows). A small window keeps the shared conservative trigger, 75% of its input budget, which
// the gauge shows as '자동 요약' with '모델의 입력 제한을 먼저 보호해요.'
export const LARGE_WINDOW_INPUT_TOKENS = 128000;

export function conversationModel(model = {}) {
  if (!Number.isSafeInteger(model.contextLength) || model.contextLength <= 0) return {...model, contextCompactionRatio: CONTEXT_SUMMARY_RATIO};
  const reported = Number.isSafeInteger(model.maxOutputTokens) && model.maxOutputTokens > 0 ? model.maxOutputTokens : 24576;
  const reserve = Math.max(4096, Math.min(reported, 32768, Math.max(1024, Math.floor(model.contextLength * .15))));
  if (model.contextLength - reserve < 1024) throw new Error('context_input_too_large');
  const maxInputTokens = Math.min(model.maxInputTokens || Infinity, model.contextLength - reserve);
  return {...model, ...(maxInputTokens >= LARGE_WINDOW_INPUT_TOKENS ? {contextCompactionRatio: CONTEXT_SUMMARY_RATIO} : {}), maxInputTokens};
}
