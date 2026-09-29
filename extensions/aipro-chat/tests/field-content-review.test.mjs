import test from 'node:test';
import assert from 'node:assert/strict';
import {goalReviewMessages, reviewEvidence} from '../goal-review.js';

// Measured on a draft task with two models: the first plan stage asked to
// confirm what the memo held. Observations never show field contents, so the
// stage review sent it back five and six times, asking for the memo text.
const observed = reviewEvidence(1, 'browser_snapshot', {}, {url: 'https://example.test/draft', frames: [{frame: 0, text: '초안', elements: [{ref: 'f-1', name: '메모', role: 'textbox', kind: 'field'}]}]});
const reviewed = phase => goalReviewMessages({goal: '제목이 가을 교육인 초안을 작성하고 기존 메모는 보존해 줘.', history: [], evidence: [observed], answer: '초안 화면을 확인했습니다.',
  inputBudget: 64000, phase, ...(phase === 'plan_step' ? {stepOutcomes: [{text: '초안 화면과 기존 메모 확인', expected_outcome: '제목·담당 팀·메모 필드와 현재 값이 확인됨'}]} : {})}).messages[0].content;

test('the stage review is told that field contents cannot be demanded', () => {
  const prompt = reviewed('plan_step');
  assert.match(prompt, /never show what an input field holds/);
  assert.match(prompt, /never require quoting, recording or confirming a field's current content/);
  assert.match(prompt, /Identifying the field meets such a criterion/);
  assert.match(prompt, /field_unchanged/);
});

test('the final review is told the same, and what field_unchanged does not prove', () => {
  const prompt = reviewed('final');
  assert.match(prompt, /field contents are never observable/);
  assert.match(prompt, /field_unchanged check proves an existing field value was kept, not persistence after save/);
});
