// The host knows which tools it dispatched and which controls they reached. A
// reviewer that could not confirm conduct ("read-only", "did not press like")
// from text alone kept a finished answer in revision, sometimes after having
// accepted the same check in earlier rounds. Such a check is settled from the
// dispatch record when that record is complete:
//   - nothing was clicked, typed or scripted, or
//   - every issued input went to a search field and every issued click to a
//     link or a search button, and none of those targets is named by the check.
// A check that also judges wording, sources, scope or accuracy is left exactly
// as the reviewer judged it, and an unmet check is never changed.
const CONDUCT = /읽기\s*전용|read[-\s]?only|금지|하지\s*않|누르지\s*않|않기|않음|않는|하지\s*마|없음|\bwithout\b|\bdid\s+not\b|\bdo\s+not\b|\bnever\b|\bno\s+\w+/i;
const OTHER_CLAIM = /표현|문구|기술|설명|서술|답변|인용|출처|범위|정확|일치|명시|구분|제시|보고|wording|statement|answer|citation|source|scope|accura|report/i;
const GENERIC = new Set(['읽기', '전용', '조사', '준수', '금지', '제한', '수행', '여부', '누르지', '누르기', '않기', '않음', '않는', '않고', '하지', '하기', '동작', '없음', '변경', '계정', '요청',
  '으로', '에서', '그리고', '또는', '연구', '확인', 'read', 'only', 'research', 'without', 'not', 'did', 'do', 'never', 'no', 'and', 'or', 'the', 'any', 'conduct', 'compliance']);
const words = text => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  .map(word => /^[가-힣]{3,}$/.test(word) ? word.replace(/(?:으로|에서|하지|하는|을|를|이|가|은|는|와|과|도|의)$/, '') : word)
  .filter(word => word.length >= 2 && !GENERIC.has(word));

function dispatchedTargets(facts) {
  const names = [];
  for (const row of facts.clickTargetReceipts || []) if (row?.actionIssued !== false) names.push(String(row?.target?.name || ''));
  for (const row of facts.semanticInputReceipts || []) for (const command of row?.commands || []) {
    if (command?.actionIssued !== false) names.push(String(command?.inputReceipt?.target?.name || ''));
  }
  return names.map(name => name.toLowerCase());
}

export function settleConductChecks(review, facts) {
  if (!review || review.status !== 'revise' || !Array.isArray(review.checks) || !review.checks.length ||
      facts?.dataKind !== 'host_tool_dispatch' || facts.taskStartObserved !== true ||
      facts.noPageInteractionToolsInvoked !== true && facts.searchAndReadOnly !== true) return review;
  const targets = facts.noPageInteractionToolsInvoked === true ? [] : dispatchedTargets(facts);
  let settled = 0;
  const checks = review.checks.map(check => {
    const text = String(check?.requirement || '');
    if (check?.status !== 'unknown' || text.length > 60 || !CONDUCT.test(text) || OTHER_CLAIM.test(text)) return check;
    // The check names what must not have been used. A dispatched target with
    // one of those names is for the reviewer to judge, not for this rule.
    const named = words(text);
    if (targets.some(name => named.some(word => name.includes(word)))) return check;
    settled++;
    return {...check, status: 'met', settledBy: 'host_tool_dispatch'};
  });
  if (!settled) return review;
  return checks.every(check => check.status === 'met')
    ? {...review, checks, status: 'complete', next_step: '', hostSettled: settled}
    : {...review, checks, hostSettled: settled};
}
export const settleReadOnlyChecks = settleConductChecks;
