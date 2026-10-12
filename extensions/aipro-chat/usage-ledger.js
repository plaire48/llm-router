import {normalizeUsage} from './usage.js';

const providers = ['aipro', 'chatgpt', 'fabrix'];
const empty = () => ({calls: 0, measured: 0, pending: 0, input: 0, output: 0, total: 0, inputReports: 0, outputReports: 0, cached: 0, reasoning: 0});
const pair = () => Object.fromEntries(providers.map(provider => [provider, empty()]));
const dayKey = time => {const date = new Date(time); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;};
const metric = receipt => {
  if (!receipt) return empty();
  const u = receipt.usage;
  return {calls: 1, measured: u?.total_tokens != null ? 1 : 0, pending: receipt.finished || u?.total_tokens != null ? 0 : 1,
    input: u?.prompt_tokens || 0, output: u?.completion_tokens || 0, total: u?.total_tokens || 0,
    inputReports: u?.prompt_tokens != null ? 1 : 0, outputReports: u?.completion_tokens != null ? 1 : 0,
    cached: u?.prompt_tokens_details?.cached_tokens || 0, reasoning: u?.completion_tokens_details?.reasoning_tokens || 0};
};
function update(ledger, previous, next) {
  const before = metric(previous), after = metric(next);
  ledger.days[next.day] ||= pair();
  ledger.total[next.provider] ||= empty();
  ledger.days[next.day][next.provider] ||= empty();
  for (const target of [ledger.total[next.provider], ledger.days[next.day][next.provider]]) {
    for (const key of Object.keys(after)) target[key] = Math.max(0, target[key] + after[key] - before[key]);
  }
}
export function newLedger(now = Date.now()) {return {version: 1, startedAt: now, total: pair(), days: {}, active: null};}

// One snapshot per model request, including tool follow-up calls. Repeated SSE
// usage frames replace that call's counters; they are never added twice.
export function recordUsage(ledger, {requestId, round, provider, phase, usage}, now = Date.now()) {
  if (!requestId || !Number.isSafeInteger(round) || round < 1 || ![...providers,'claude'].includes(provider) || !['start', 'report', 'finish'].includes(phase)) return ledger;
  const next = ledger?.version === 1 ? structuredClone(ledger) : newLedger(now);
  if (next.active?.requestId !== requestId) {
    finishActive(next);
    next.active = {requestId, rounds: {}};
  }
  const previous = next.active.rounds[round];
  if (previous && previous.provider !== provider) return ledger;
  if (previous?.finished) return ledger;
  const receipt = {...(previous || {provider, day: dayKey(now), usage: null, finished: false})};
  const measured = normalizeUsage(usage);
  if (measured) receipt.usage = measured;
  if (phase === 'finish') receipt.finished = true;
  update(next, previous, receipt);
  next.active.rounds[round] = receipt;
  for (const day of Object.keys(next.days).sort().slice(0, -31)) delete next.days[day];
  return next;
}
function finishActive(ledger) {
  for (const [key, previous] of Object.entries(ledger.active?.rounds || {})) {
    if (previous.finished) continue;
    const next = {...previous, finished: true};
    update(ledger, previous, next); ledger.active.rounds[key] = next;
  }
}
export function finishUsage(ledger, requestId) {
  if (!requestId || ledger?.active?.requestId !== requestId) return ledger;
  const next = structuredClone(ledger); finishActive(next); next.active = null; return next;
}
export function usageSummary(ledger, now = Date.now()) {
  return {startedAt: ledger?.startedAt || null, today: {...pair(), ...ledger?.days?.[dayKey(now)]}, total: {...pair(), ...ledger?.total}};
}
