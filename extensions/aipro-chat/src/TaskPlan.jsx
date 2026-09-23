import React, {useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {normalizePlan} from '../task-plan.js';
import {TOOL_LABELS} from '../agent-trace.js';
import {InlineMarkdown} from './MessageBody.jsx';

export function TaskPlan({progress, trace = [], phase, question, detailsId, countId, countSuffix = '', stepAttributes, statusLabel, defaultExpanded = true}) {
  const [expanded, setExpanded] = useState(null);
  const plan = normalizePlan(progress?.plan);
  if (!plan) return null;
  const completed = plan.filter(step => step.status === 'completed').length;
  const waiting = progress.status === 'awaiting_user', paused = progress.status === 'paused';
  const waitingText = question?.kind === 'approval' ? '승인 대기' : '답변 대기';
  const status = statusLabel || (waiting ? waitingText : paused ? '일시 중단' : progress.status === 'done' ? '완료' : '진행 중');
  const current = plan.find(step => step.status === 'in_progress');
  const running = trace.findLast(step => step.status === 'running' && step.tool !== 'update_plan');
  return <section className="task-plan" aria-label="작업 계획" data-status={progress.status}>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{`작업 계획 ${completed}/${plan.length} 완료. ${status}${current ? `: ${current.text}` : ''}`}</span>
    <details id={detailsId} open={expanded ?? defaultExpanded} onToggle={event => {if(event.target===event.currentTarget && event.currentTarget.open !== (expanded ?? defaultExpanded))setExpanded(event.currentTarget.open);}}>
      <summary><Icon name="layers" size={16}/><span>작업 계획</span><span id={countId} className="task-plan-count" title={`${plan.length}단계 중 ${completed}단계 완료`}>{completed}/{plan.length}{countSuffix}</span>{(waiting || paused) && <span className="task-plan-pause">{status}</span>}<Icon name="chevronDown" size={14}/></summary>
      <ol>{plan.map((step, index) => {
        const active = step.status === 'in_progress', done = step.status === 'completed';
        const stopped = active && (waiting || paused);
        const label = done ? '완료' : active ? status : '예정';
        const tool = active && !stopped ? running && (!running.planStep || running.planStep === step.text) ? (running.label || TOOL_LABELS[running.tool]) : phase === 'validating' || progress.review === 'running' ? '결과 확인 중' : null : null;
        return <li {...stepAttributes?.(index)} key={index} data-status={step.status} data-paused={stopped || undefined} aria-current={active ? 'step' : undefined}>
          <span className="task-plan-marker" aria-hidden="true">{done ? <Icon name="check" size={14}/> : stopped ? <Icon name="clock" size={14}/> : active ? <span className="status-spinner"/> : <span className="task-plan-dot"/>}</span>
          <span className="task-plan-label"><span className="visually-hidden">{label}: </span>{step.text}{tool && <span className="task-plan-tool"><InlineMarkdown content={tool}/></span>}</span>
        </li>;
      })}</ol>
    </details>
  </section>;
}
