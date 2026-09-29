import {ERROR_TEXT} from './core.js';

const labelFor = (labels, key) => Object.hasOwn(labels, key) ? labels[key] : undefined;

// Present only known lifecycle fields. Unknown persisted values are never UI copy.
export function diagnosticView(event) {
  const scope = labelFor({plan_step: '단계 검토', checkpoint: '중간 검토', final: '최종 검토'}, event?.scope);
  const review = labelFor({complete: '충족', revise: '보완 필요', blocked: '사용자 확인 필요'}, event?.status);
  if (event?.phase === 'review_result' && scope && review) {
    const count = key => Number.isSafeInteger(event[key]) && event[key] >= 0 && event[key] <= 8 ? event[key] : 0;
    return {label: scope, result: review, status: event.status === 'complete' ? 'done' : 'waiting',
      detail: `충족 ${count('met')} / 미충족 ${count('unmet')} / 미확인 ${count('unknown')}`};
  }
  const outcome = labelFor({answer: '응답 종료', waiting_user: '사용자 답변 대기', cancelled: '실행 중지', failed: '실행 실패'}, event?.outcome);
  if (event?.phase === 'run_result' && outcome) {
    const passed = event.outcome === 'answer' && event.verification === 'passed';
    const error = event.outcome === 'failed' && Object.hasOwn(ERROR_TEXT, event.code) ? ERROR_TEXT[event.code] : '';
    return {label: outcome, result: passed ? '최종 검토 통과' : '최종 검토 미확인',
      status: event.outcome === 'failed' ? 'error' : passed ? 'done' : event.outcome === 'cancelled' ? 'cancelled' : 'waiting',
      detail: error || (event.finishReason === 'length' ? '모델 출력 한도에 도달했습니다.' : '')};
  }
  return {label: '알 수 없는 기록', result: '확인 필요', status: 'waiting', detail: ''};
}
