import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewScopeMessages, parseReviewScope, settleStepScope} from '../review-scope.js';

// Measured on a filter-and-sort request with two models: the stage's own outcome
// was marked met, the stage was sent back for the form of the final answer, the
// audit named that check as outside the stage, and the re-review repeated it.
const goal = '검색 필터에서 동영상을 선택하고 업로드 날짜순으로 정렬해 줘. 바뀐 결과에서 앞의 일반 영상 3개 제목과 채널을 알려줘.';
const stepOutcomes = [{text: '필터와 정렬 적용', expected_outcome: '동영상이 업로드 날짜순으로 정렬된 검색 결과를 연다.'}];
const currentPlan = [{text: '현재 검색 결과와 필터 항목 확인', expected_outcome: '동영상 필터와 업로드 날짜순 정렬 컨트롤을 식별한다.'}, ...stepOutcomes,
  {text: '결과 정리', expected_outcome: '앞의 일반 영상 3개 제목과 채널을 정리한다.'}];
const measured = () => ({status: 'revise', checks: [
  {requirement: '동영상 필터와 업로드 날짜순 정렬이 적용된 결과를 열었는지 확인', status: 'met', evidence_ids: [11]},
  {requirement: '확인한 출처 URL과 열람 범위, 확인하지 못한 부분을 구분해 보고', status: 'unmet', evidence_ids: []}],
  next_step: '검색 결과 URL과 관찰 범위를 명시해 단계 결과를 작성하세요.'});
const audit = (review, issues, phase = 'plan_step', decision = 'repair_scope') => {
  const scoped = reviewScopeMessages({goal, userHistory: [], phase, stepOutcomes, currentPlan, answer: '정렬을 적용했습니다.', review, inputBudget: 64000});
  return parseReviewScope({content: JSON.stringify({decision, correctionTarget: decision === 'repair_scope' ? 'external' : 'unknown', issues}), finishReason: 'stop'}, scoped.payload);
};
const outside = (target, review_quote, kind = 'pending_step') => ({target, kind, source: 'outcome', quote: '정렬된 검색 결과를 연다', review_quote});

test('a stage whose only open check lies outside it is settled by its met check', () => {
  const review = measured(), settled = settleStepScope(review, audit(review, [outside(1, '확인한 출처 URL과 열람 범위')]));
  assert.equal(settled.status, 'complete'); assert.equal(settled.next_step, '');
  assert.deepEqual(settled.checks, [review.checks[0]]);
  assert.equal(review.status, 'revise', 'the review that was given is not changed');
});

test('an open check that the audit did not name keeps the stage open', () => {
  const review = measured();
  review.checks.push({requirement: '정렬 선택 상태가 화면에 표시됨', status: 'unknown', evidence_ids: []});
  assert.equal(settleStepScope(review, audit(review, [outside(1, '확인한 출처 URL과 열람 범위')])), null);
  // Naming the next step alone says nothing about the open checks.
  const other = measured();
  assert.equal(settleStepScope(other, audit(other, [outside('next_step', '검색 결과 URL과 관찰 범위')])), null);
});

test('a stage without a met check that has evidence is not settled', () => {
  const bare = {status: 'revise', checks: [{requirement: '확인한 출처 URL과 열람 범위를 보고', status: 'unmet', evidence_ids: []}], next_step: '출처를 명시하세요.'};
  assert.equal(settleStepScope(bare, audit(bare, [outside(0, '확인한 출처 URL과 열람 범위')])), null);
  const unproven = measured(); unproven.checks[0].evidence_ids = [];
  assert.equal(settleStepScope(unproven, audit(unproven, [outside(1, '확인한 출처 URL과 열람 범위')])), null);
  // A met check that the audit itself placed outside the stage does not count.
  const drifted = measured();
  assert.equal(settleStepScope(drifted, audit(drifted, [outside(0, '정렬이 적용된 결과', 'new_requirement'), outside(1, '확인한 출처 URL과 열람 범위')])), null);
});

test('a criterion of the plan itself still needs a corrected plan', () => {
  const review = measured();
  const issues = [outside(1, '확인한 출처 URL과 열람 범위'), {target: 'plan2', kind: 'new_requirement', source: 'user', quote: '앞의 일반 영상 3개', review_quote: '앞의 일반 영상 3개'}];
  assert.equal(settleStepScope(review, audit(review, issues)), null);
});

test('only a stage review with a validated repair audit is settled', () => {
  const review = measured(), issues = [outside(1, '확인한 출처 URL과 열람 범위')];
  assert.equal(settleStepScope(review, audit(review, issues, 'final')), null);
  assert.equal(settleStepScope(review, audit(review, [], 'plan_step', 'unknown')), null);
  // A copied object is not the audit that the host parsed.
  assert.equal(settleStepScope(review, structuredClone(audit(review, issues))), null);
  assert.equal(settleStepScope(review, {decision: 'repair_scope', correctionTarget: 'external', issues}), null);
  // Another review than the one that was audited.
  const changed = measured(); changed.checks[1].status = 'unknown';
  assert.equal(settleStepScope(changed, audit(review, issues)), null);
  const blocked = {...measured(), status: 'blocked'};
  assert.equal(settleStepScope(blocked, audit(blocked, issues)), null);
});
