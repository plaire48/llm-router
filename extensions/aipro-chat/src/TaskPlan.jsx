import React, {useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {normalizePlan, planDifference, planUpdateHistory} from '../task-plan.js';
import {TOOL_LABELS} from '../agent-trace.js';
import {InlineMarkdown} from './MessageBody.jsx';

export function TaskPlan({className = '', overviewClassName, debugMode = false, progress, trace = [], phase, question, detailsId, countId, countSuffix = '', stepAttributes, statusLabel, defaultExpanded = true}) {
  const [expanded, setExpanded] = useState(null);
  const Overview=overviewClassName?'div':React.Fragment;
  const plan = normalizePlan(progress?.plan);
  if (!plan) return null;
  const completed = plan.filter(step => step.status === 'completed').length;
  const waiting = progress.status === 'awaiting_user', paused = progress.status === 'paused';
  const running = trace.findLast(step => step.status === 'running' && step.tool !== 'update_plan');
  // A reporting last step stays open until the final review passes; the answer is already being checked.
  const checkingAnswer = running?.tool === 'review_task' && running.label === '답변 확인';
  const finalizing = (completed === plan.length || checkingAnswer) && !waiting && !paused && progress.status !== 'done';
  const waitingText = question?.kind === 'approval' ? '승인 대기' : '답변 대기';
  const status = statusLabel || (waiting ? waitingText : paused ? '일시 중단' : finalizing ? '답변 확인 중' : progress.status === 'done' ? '완료' : '진행 중');
  const current = plan.find(step => step.status === 'in_progress');
  const updates = planUpdateHistory(progress.updates);
  const revisions = updates.filter(entry => entry.before.length && planDifference(entry.before, entry.after).revised);
  const latest = revisions.at(-1), change = latest && planDifference(latest.before, latest.after);
  const summary = change && [change.added.length ? `${change.added.length}개 추가` : '', change.removed.length ? `${change.removed.length}개 제외` : '', change.criteria.length ? '완료 기준 변경' : '', change.reordered ? '순서 변경' : ''].filter(Boolean).join(', ');
  const currentLabel = waiting || paused ? status : '지금';
  const next = current && plan.slice(plan.indexOf(current) + 1).find(step => step.status === 'pending');
  const recent = current && trace.findLast(step => step.planStep === current.text && !['update_plan', 'progress_note'].includes(step.tool) && TOOL_LABELS[step.tool]);
  const executionStatus = {running: '실행 중', done: '도구 실행 완료', error: '실행 실패', cancelled: '취소', waiting: '확인 대기', recovered: '복구 확인', deferred: '보류'};

  return <section className={`task-plan ${className}`} aria-label="작업 계획" data-status={progress.status} data-finalizing={finalizing || undefined}>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{`작업 계획 ${completed}/${plan.length} 완료. ${status}${current ? `: ${current.text}` : ''}${latest ? `. 최근 계획 수정: ${latest.reason || summary}` : ''}`}</span>
    {current && !(expanded ?? defaultExpanded) && <div className="task-plan-current"><span>{currentLabel}</span><InlineMarkdown content={current.text}/></div>}
    <Overview {...(overviewClassName?{className:overviewClassName}:{})}><details data-plan-overview id={detailsId} open={expanded ?? defaultExpanded} onToggle={event => {if(event.target===event.currentTarget && event.currentTarget.open !== (expanded ?? defaultExpanded))setExpanded(event.currentTarget.open);}}>
      <summary><Icon name="layers" size={16}/><span>작업 계획</span><span id={countId} className="task-plan-count" title={`${plan.length}단계 중 ${completed}단계 완료`}>{completed}/{plan.length}{countSuffix}</span>{(waiting || paused || finalizing) && <span className="task-plan-pause">{status}</span>}<Icon name="chevronDown" size={14}/></summary>
      <ol>{plan.map((step, index) => {
        const active = step.status === 'in_progress', done = step.status === 'completed';
        const stopped = active && (waiting || paused);
        const label = done ? '완료' : active ? status : '예정';
        const tool = active && !stopped ? running && (!running.planStep || running.planStep === step.text) ? (running.label || TOOL_LABELS[running.tool]) : phase === 'validating' || progress.review === 'running' ? '결과 확인 중' : null : null;
        return <li {...stepAttributes?.(index)} key={`${step.text}-${plan.slice(0,index).filter(item => item.text === step.text).length}`} data-status={step.status} data-paused={stopped || undefined} aria-current={active ? 'step' : undefined}>
          <span className="task-plan-marker" aria-hidden="true">{done ? <Icon name="check" size={14}/> : stopped ? <Icon name="clock" size={14}/> : active ? <span className="status-spinner"/> : <span className="task-plan-dot"/>}</span>
          <span className="task-plan-label"><span className="visually-hidden">{label}: </span><InlineMarkdown content={step.text}/>{tool && tool !== step.text && <span className="task-plan-tool"><InlineMarkdown content={tool}/></span>}</span>
          {change?.added.some(item => item.text === step.text) && <span className="task-plan-added" title="최근 계획에 추가된 단계"><Icon name="plus" size={14}/><span className="visually-hidden">최근 계획에 추가된 단계</span></span>}
        </li>;
      })}</ol>
    </details>
    </Overview>
    {latest && <details className="task-plan-update" key={latest.revision}>
      <summary aria-label={`계획 수정: ${summary}`} title={`계획 수정: ${summary}`}><span className="task-plan-update-heading">
        <Icon name="refresh" size={14}/><span className="visually-hidden">계획 수정</span>
        {[[change.added.length, 'plus', '추가'], [change.removed.length, 'minus', '제외'], [change.criteria.length, 'pencil', '완료 기준 변경']].filter(([count]) => count > 0).map(([count, icon, label]) => <span key={icon} className="task-plan-change-count" title={`${label} ${count}개`}><Icon name={icon} size={14}/><span aria-hidden="true">{count}</span><span className="visually-hidden">{label} {count}개</span></span>)}
        {change.reordered && <span title="순서 변경"><Icon name="arrowRight" size={14}/><span className="visually-hidden">순서 변경</span></span>}
        <Icon name="chevronDown" size={14}/>
      </span></summary>
      {latest.reason && <p className="task-plan-update-caption">{latest.reason}</p>}
      <ul className="task-plan-diff" aria-label="최근 계획 변경 내용">
        {change.added.map(step => <li key={`add-${step.text}`}><span className="task-plan-diff-icon" title="추가"><Icon name="plus" size={14}/><span className="visually-hidden">추가</span></span><InlineMarkdown content={step.text}/></li>)}
        {change.removed.map(step => <li key={`remove-${step.text}`}><span className="task-plan-diff-icon" title="제외"><Icon name="minus" size={14}/><span className="visually-hidden">제외</span></span><InlineMarkdown content={step.text}/></li>)}
        {change.criteria.map(step => <li key={`criteria-${step.text}`}><span>완료 기준</span><div><InlineMarkdown content={step.text}/><span className="task-plan-tool">이전: {latest.before.find(item => item.text === step.text)?.expected_outcome || '없음'}</span><span className="task-plan-tool">변경: {step.expected_outcome || '없음'}</span></div></li>)}
        {change.reordered && <li><span>순서</span><span>{latest.after.map(step => step.text).join(' → ')}</span></li>}
      </ul>
    </details>}
    {current && <details className="task-plan-context"><summary><Icon name="infoCircle" size={14}/><span>단계 상세</span><Icon name="chevronDown" size={14}/></summary>
      <dl>
        <div><dt><Icon name="check" size={14}/>완료 기준</dt><dd>{current.expected_outcome || '구체적인 완료 기준이 아직 없습니다.'}</dd></div>
        {recent && <div><dt><Icon name="clock" size={14}/>최근 실행</dt><dd><InlineMarkdown content={recent.label || TOOL_LABELS[recent.tool]}/><span className="task-plan-tool">{executionStatus[recent.status] || '상태 미확인'}</span></dd></div>}
        {next && <div><dt><Icon name="arrowRight" size={14}/>다음 계획</dt><dd><InlineMarkdown content={next.text}/></dd></div>}
      </dl>
    </details>}
    {debugMode && updates.length > 1 && <details className="task-plan-history"><summary><Icon name="clock" size={14}/><span>변경 기록</span><Icon name="chevronDown" size={14}/></summary>
      {updates[0].revision > 1 && <p className="task-plan-tool">최근 {updates.length}회 표시</p>}
      <ol>{[...updates].reverse().map(entry => {const diff = planDifference(entry.before, entry.after), active = entry.after.find(step => step.status === 'in_progress');return <li key={entry.revision}><span className="task-plan-history-version">{entry.revision}</span><div><span>{!entry.before.length ? '계획 시작' : diff.revised ? '계획 수정' : diff.reopened.length ? '완료 단계 다시 확인' : '단계 진행'}</span>{entry.reason && <p>{entry.reason}</p>}{diff.completed.length > 0 && <p>완료: {diff.completed.map(step => step.text).join(', ')}</p>}{active && <p>진행: {active.text}</p>}{diff.added.length > 0 && entry.before.length > 0 && <p>추가: {diff.added.map(step => step.text).join(', ')}</p>}{diff.removed.length > 0 && <p>제외: {diff.removed.map(step => step.text).join(', ')}</p>}</div></li>;})}</ol>
    </details>}
  </section>;
}
