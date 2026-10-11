// This helper is also used by the unbundled MV3 worker. No runtime dependency.
// Keep only a duration, never response headers or an upstream error body.
export function retryAfterMs(headers, now = Date.now()) {
  const value = headers?.get?.('retry-after')?.trim();
  if (!value || value.length > 128) return undefined;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, Number.MAX_SAFE_INTEGER);
  if (!/^[A-Za-z]{3,9}[, ]/.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
