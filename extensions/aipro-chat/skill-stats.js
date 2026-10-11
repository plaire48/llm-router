// How registered skills fared when a run used them. Counts and times only:
// never a request, an answer or a page. A skill is "used" when it was the
// selected skill of the run or when the run read it.
const LIMIT = 40;
const valid = id => typeof id === 'string' && /^custom-[\w-]{1,80}$/.test(id);
const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100000) : 0;

export function skillStats(value, now = Date.now()) {
  const rows = Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {}).filter(([id, row]) => valid(id) && row && typeof row === 'object')
    .map(([id, row]) => [id, {uses: count(row.uses), passed: count(row.passed), failed: count(row.failed),
      lastUsedAt: Number.isFinite(row.lastUsedAt) && row.lastUsedAt <= now ? row.lastUsedAt : 0,
      lastOutcome: ['passed', 'failed'].includes(row.lastOutcome) ? row.lastOutcome : 'failed'}])
    .filter(([, row]) => row.uses > 0 && row.passed + row.failed <= row.uses)
    .sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt).slice(0, LIMIT);
  return Object.fromEntries(rows);
}
export function recordSkillUse(value, ids, outcome, now = Date.now()) {
  const stats = skillStats(value, now);
  if (!['passed', 'failed'].includes(outcome)) return stats;
  for (const id of [...new Set(Array.isArray(ids) ? ids : [])].filter(valid).slice(0, 5)) {
    const row = stats[id] || {uses: 0, passed: 0, failed: 0};
    stats[id] = {uses: row.uses + 1, passed: row.passed + (outcome === 'passed' ? 1 : 0), failed: row.failed + (outcome === 'failed' ? 1 : 0), lastUsedAt: now, lastOutcome: outcome};
  }
  return skillStats(stats, now);
}
export function forgetSkill(value, id, now = Date.now()) {
  const {[id]: removed, ...rest} = skillStats(value, now);
  return rest;
}
export const skillRecord = (value, id) => skillStats(value)[id] || null;
export function skillRecordText(record) {
  return record?.uses > 0 ? `사용 ${record.uses}회 · 검토 통과 ${record.passed}회${record.lastOutcome === 'failed' ? ' · 최근 사용은 검토를 통과하지 못함' : ''}` : '';
}
