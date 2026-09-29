import {PLAN_PROMPT} from '../../task-plan.js';
import {scopeAuditCompletion} from './goal-review.mjs';
// Synthetic planning transport. Production always uses the selected provider.
export const fixturePlan = [{text: '현재 페이지 확인', expected_outcome: '현재 페이지에서 요청한 정보와 관찰 범위를 확인', status: 'in_progress'}, {text: '요청 작업과 결과 확인', expected_outcome: '원래 요청의 결과와 미확인 사항을 근거로 구분', status: 'pending'}];
export function planCompletion(body) {
  const audit = scopeAuditCompletion(body);
  if (audit) {Object.defineProperty(audit, 'scopeAudit', {value: true}); return audit;}
  if (!body.messages?.some(message => message.role === 'system' && message.content.startsWith(PLAN_PROMPT))) return null;
  return {choices: [{message: {content: '', tool_calls: [{id: 'fixture-plan', type: 'function', function: {name: 'update_plan', arguments: JSON.stringify({steps: fixturePlan})}}]}, finish_reason: 'tool_calls'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}};
}
