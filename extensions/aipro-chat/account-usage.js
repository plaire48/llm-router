import {responseText} from './exchange.js';

export const ACCOUNT_USAGE_TTL = 300000;
export const ACCOUNT_USAGE_VERSION = 2;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const timestamp = value => Number.isSafeInteger(value) && value > 0 && value < 8640000000000 ? value * 1000 : null;
export function normalizeAccountUsage(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('quota_invalid');
  if (!['rate_limit', 'credits', 'spend_control'].some(key => Object.hasOwn(payload, key))) throw new Error('quota_invalid');
  if (payload.rate_limit != null && (typeof payload.rate_limit !== 'object' || Array.isArray(payload.rate_limit))) throw new Error('quota_invalid');
  const windows = ['primary_window', 'secondary_window'].flatMap((key, index) => {
    const source = payload.rate_limit?.[key];
    if (source == null) return [];
    if (typeof source !== 'object' || Array.isArray(source)) throw new Error('quota_invalid');
    const used = number(source.used_percent);
    const resetsAt = timestamp(source.reset_at) ?? (number(source.reset_after_seconds) !== null ? now + source.reset_after_seconds * 1000 : null);
    return [{id: index === 0 ? 'primary' : 'secondary', remaining: used === null ? null : Math.max(0, Math.min(100, 100 - used)),
      seconds: number(source.limit_window_seconds), resetsAt}];
  });
  const result = {windows};
  if (payload.credits != null) {
    const credits = payload.credits;
    if (typeof credits !== 'object' || Array.isArray(credits) || ['has_credits', 'unlimited'].some(key => credits[key] != null && typeof credits[key] !== 'boolean')) throw new Error('quota_invalid');
    const balance = typeof credits.balance === 'string' && /^\d+(?:\.\d+)?$/.test(credits.balance.trim()) ? number(Number(credits.balance)) : number(credits.balance);
    result.credits = {balance, unlimited: credits.unlimited === true};
  }
  if (payload.spend_control != null) {
    const control = payload.spend_control;
    if (typeof control !== 'object' || Array.isArray(control)) throw new Error('quota_invalid');
    if (control.individual_limit != null) {
      const limit = control.individual_limit;
      if (typeof limit !== 'object' || Array.isArray(limit)) throw new Error('quota_invalid');
      const remaining = number(limit.remaining_percent);
      result.individualLimit = {remaining: remaining === null ? null : Math.min(100, remaining), resetsAt: timestamp(limit.reset_at)};
    }
    if (typeof control.reached === 'boolean') result.spendControlReached = control.reached;
  }
  return result;
}

export function freshAccountUsage(account, now = Date.now()) {
  return !!account?.data && account.version === ACCOUNT_USAGE_VERSION && !account.error &&
    Number.isFinite(account.fetchedAt) && now >= account.fetchedAt && now - account.fetchedAt < ACCOUNT_USAGE_TTL &&
    ![...(account.data.windows || []), account.data.individualLimit].some(window => window?.resetsAt && window.resetsAt <= now);
}

export async function fetchAccountUsage(credential, signal, fetchImpl = fetch) {
  if (credential?.provider !== 'chatgpt') throw new Error('quota_unavailable');
  let accountId;
  try {
    const encoded = credential.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    accountId = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))['https://api.openai.com/auth']?.chatgpt_account_id;
    if (typeof accountId !== 'string' || !accountId) throw new Error();
  } catch {throw new Error('quota_unauthorized');}
  let status = 0;
  try {
    const response = await fetchImpl('https://chatgpt.com/backend-api/wham/usage', {method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
      headers: {Accept: 'application/json', Authorization: `Bearer ${credential.token}`, 'ChatGPT-Account-Id': accountId}});
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error([401, 403].includes(status) ? 'quota_unauthorized' : status === 429 ? 'quota_rate_limited' : 'quota_unavailable');
    }
    let payload;
    try {payload = JSON.parse(await responseText(response)); normalizeAccountUsage(payload);} catch {throw new Error('quota_invalid');}
    return {payload, status};
  } catch (error) {throw Object.assign(new Error(error.message.startsWith('quota_') ? error.message : 'quota_network'), {status});}
}
