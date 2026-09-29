import assert from 'node:assert/strict';
import {REVIEW_SCOPE_PROMPT} from '../../review-scope.js';
// Legacy browser fixtures test their existing outcome/receipt gates. Route the
// new auxiliary audit separately so it cannot advance an executor stage or
// masquerade as a task verdict; dedicated scope tests cover positive repairs.
export function scopeAuditCompletion(body) {
  if (!body.messages?.some(message => message.role === 'system' && message.content?.startsWith(REVIEW_SCOPE_PROMPT))) return null;
  assert(!body.tools?.length);
  return {choices: [{message: {content: JSON.stringify({decision: 'unknown', correctionTarget: 'unknown', issues: []})}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}};
}
// Transport fixtures only. Requirement-gap behavior is tested separately in
// goal-review.test.mjs and harness-browser.mjs against actual page outcomes.
export function goalReviewPayload(messages) {
  if (!messages.some(message => message.role === 'system' && message.content?.startsWith("You are Nubi's independent task-result reviewer."))) return null;
  const content = messages.findLast(message => message.role === 'user').content;
  return JSON.parse(typeof content === 'string' ? content : content.find(part => part.type === 'text').text);
}
export function acceptedReview(payload) {
  if (payload.phase === 'checkpoint') return {status: 'revise', checks: [{requirement: '남은 작업 확인', status: 'unknown', evidence_ids: []}], next_step: '현재 관찰과 오류를 확인하고 누락된 단계만 이어가세요. 완료한 입력을 반복하지 마세요.'};
  const proof = payload.evidence.findLast(item => item.usable);
  assert(proof, 'Reviewer fixture must receive real current evidence');
  return {status: 'complete', checks: [{requirement: '요청 결과 확인', status: 'met', evidence_ids: [proof.id]}], next_step: ''};
}
export function reviewCompletion(payload) {
  return {choices: [{message: {content: JSON.stringify(acceptedReview(payload))}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}};
}
