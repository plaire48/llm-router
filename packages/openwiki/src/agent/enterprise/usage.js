// Adapted from extensions/aipro-chat/usage.js (0.10.2).
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;

// Keep missing counters distinct from zero, and never add cumulative stream frames.
export function normalizeUsage(value) {
  if (!value || typeof value !== "object") return null;
  const prompt_tokens = count(value.prompt_tokens),
    completion_tokens = count(value.completion_tokens);
  let total_tokens = count(value.total_tokens);
  if (prompt_tokens !== null && completion_tokens !== null) {
    const sum = prompt_tokens + completion_tokens;
    if (
      !Number.isSafeInteger(sum) ||
      (total_tokens !== null && total_tokens !== sum)
    )
      return null;
    total_tokens = sum;
  }
  if (
    total_tokens !== null &&
    (total_tokens < (prompt_tokens ?? 0) ||
      total_tokens < (completion_tokens ?? 0))
  )
    return null;
  if (
    prompt_tokens === null &&
    completion_tokens === null &&
    total_tokens === null
  )
    return null;
  const reasoning = count(value.completion_tokens_details?.reasoning_tokens);
  const cached = count(value.prompt_tokens_details?.cached_tokens);
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens,
    ...(cached !== null && prompt_tokens !== null && cached <= prompt_tokens
      ? { prompt_tokens_details: { cached_tokens: cached } }
      : {}),
    ...(reasoning !== null &&
    completion_tokens !== null &&
    reasoning <= completion_tokens
      ? { completion_tokens_details: { reasoning_tokens: reasoning } }
      : {}),
  };
}
