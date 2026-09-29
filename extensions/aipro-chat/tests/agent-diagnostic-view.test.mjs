import assert from 'node:assert/strict';
import test from 'node:test';
import {diagnosticView} from '../agent-diagnostic-view.js';

test('response termination and a historical review do not certify completion', () => {
  for (const outcome of ['answer', 'waiting_user', 'failed', 'cancelled']) {
    const view = diagnosticView({phase:'run_result', outcome, verification:'not_run'});
    assert.equal(view.result, '최종 검토 미확인');
    assert.notEqual(view.status, 'done');
  }
  assert.equal(diagnosticView({phase:'run_result', outcome:'answer', verification:'passed'}).result, '최종 검토 통과');
  assert.equal(diagnosticView({phase:'run_result', outcome:'failed', verification:'passed'}).result, '최종 검토 미확인');
  assert.equal(diagnosticView({phase:'run_result', outcome:'cancelled', code:'response_invalid'}).detail, '', 'Stopping must not invite automatic retry');
  const review = diagnosticView({phase:'review_result', scope:'final', status:'complete', met:3, unmet:0, unknown:1});
  assert.equal(review.label, '최종 검토'); assert.equal(review.result, '충족');
  assert.equal(review.detail, '충족 3 / 미충족 0 / 미확인 1');
});

test('diagnostic presentation never echoes arbitrary fields or prototype values', () => {
  for (const event of [null, {phase:'private'}, {phase:'run_result', outcome:'toString'}, {phase:'review_result',scope:'toString',status:'complete'}]) {
    assert.equal(diagnosticView(event).label, '알 수 없는 기록');
  }
  const view = diagnosticView({phase:'run_result',outcome:'failed',code:'private token',message:'secret',finishReason:'length'});
  assert.equal(view.detail, '모델 출력 한도에 도달했습니다.');
  assert(!JSON.stringify(view).includes('private')); assert(!JSON.stringify(view).includes('secret'));
  assert.match(diagnosticView({phase:'review_result',scope:'final',status:'revise',met:-1,unmet:Infinity,unknown:'private'}).detail, /^충족 0 \/ 미충족 0 \/ 미확인 0$/);
});
