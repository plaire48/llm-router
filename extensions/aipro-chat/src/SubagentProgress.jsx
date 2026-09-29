import React, {useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {TOOL_LABELS} from '../agent-trace.js';
import {TraceStep} from './TraceSurface.jsx';
import {InlineMarkdown, MessageBody} from './MessageBody.jsx';

const ROLE_LABELS = {planner:'작업 분할',research:'문서 조사',recovery:'누락 보완',synthesis:'결과 통합',coordinator:'문서 조사 진행'};
const pending = step => ['queued', 'running'].includes(step.status);
function stateLabel(step) {
  if (step.status === 'queued') return '대기';
  if (step.status === 'running') return step.analysis?.phase === 'reading' ? '근거 확인 중' : step.analysis?.role === 'planner' ? '분할 중' : step.analysis?.role === 'synthesis' || step.analysis?.phase === 'synthesizing' ? '통합 중' : '분석 중';
  if (step.status === 'error') return '실패';
  if (step.status === 'cancelled') return '중지';
  if (step.analysis?.outcome === 'partial') return '일부 확인';
  if (step.analysis?.outcome === 'blocked') return '확인 필요';
  return '완료';
}

function AssignmentDetails({analysis}) {
  const {assignment,doneWhen,sources = [],sourceCount,reads,completed,total,role,uncertainties = [],uncertaintiesOmitted,nextStep} = analysis || {};
  const documents = assignment?.documents || [], range = assignment?.range;
  const images = sources.filter(source => source.hasImage || source.imageRead), imagesRead = images.filter(source => source.imageRead).length;
  const hasDetails = Boolean(doneWhen || documents.length || sources.length || uncertainties.length || nextStep);
  return <>
    {role === 'coordinator' && total > 0 && <span className="subagent-scope">하위 작업 {completed}/{total} 처리</span>}
    {range && <span className="subagent-scope" title="원문 UTF-16 문자 위치. 0부터 시작하며 끝 위치는 포함하지 않습니다.">문자 {range.start.toLocaleString('ko-KR')}–{range.end.toLocaleString('ko-KR')}</span>}
    {hasDetails && <details className="subagent-evidence">
      <summary><Icon name="layers" size={14}/><span>담당 범위와 근거</span><Icon name="chevronDown" size={14}/></summary>
      {documents.length > 0 && <ul>{documents.map(doc => <li key={doc.id}>{doc.title || doc.id}</li>)}</ul>}
      {doneWhen && <p><strong>완료 조건</strong> <InlineMarkdown content={doneWhen}/></p>}
      {uncertainties.length > 0 && <><p><strong>미확인</strong></p><ul>{uncertainties.map((item,index) => <li key={index}><InlineMarkdown content={item}/></li>)}</ul></>}
      {uncertaintiesOmitted > 0 && <p>미확인 {uncertaintiesOmitted}개 더 있음</p>}
      {nextStep && <p><strong>다음 행동</strong> <InlineMarkdown content={nextStep}/></p>}
      {sourceCount !== undefined && <p>배정 근거 {sourceCount}개{reads > 0 ? ` / 조회 ${reads}회` : ''}</p>}
      {images.length > 0 && <p><Icon name="image" size={14}/>{imagesRead ? `이미지 읽음 ${imagesRead}개` : '이미지 미열람'}</p>}
      {sources.length > 0 && <ul>{sources.map((source,index) => <li key={`${source.id}-${index}`}>{source.path || TOOL_LABELS[source.tool] || source.id}<span>{source.imageRead ? '이미지 읽음' : source.read ? '텍스트 읽음' : '미열람'}{source.historical ? ' / 이전 관찰' : ''}</span></li>)}</ul>}
    </details>}
  </>;
}

export function SubagentProgress({steps, live}) {
  const [expanded, setExpanded] = useState(null);
  const active = steps.some(pending);
  const done = steps.filter(step => step.status === 'done' && (!step.analysis?.outcome || step.analysis.outcome === 'complete')).length;
  const attention = steps.some(step => ['error', 'cancelled'].includes(step.status) || ['partial', 'blocked'].includes(step.analysis?.outcome));
  const label = active ? `${done}/${steps.length} 완료` : attention ? `${done}/${steps.length} 완료` : '분석 완료';
  const open = expanded ?? (live && active);
  return <details className="subagent-group" open={open} data-active={active} onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open !== open) setExpanded(event.currentTarget.open);
  }}>
    <summary><Icon name="layers" size={16}/><strong>하위 작업</strong><span className="subagent-count">{label}</span><Icon name="chevronDown" size={14}/></summary>
    <ol>{steps.map((step, index) => <li key={step.id || index} data-tool={step.tool} data-status={step.status}>
      <TraceStep status={step.status === 'done' && ['partial', 'blocked'].includes(step.analysis?.outcome) ? 'waiting' : step.status} label={stateLabel(step)}>
        <span className="subagent-role">{ROLE_LABELS[step.analysis?.role] || TOOL_LABELS[step.tool]}{Number.isSafeInteger(step.analysis?.workerId) ? ` ${step.analysis.workerId + 1}` : Number.isSafeInteger(step.analysis?.synthesisId) ? ` ${step.analysis.synthesisId + 1}` : ''}<span className="agent-tool-state">{stateLabel(step)}</span></span>
        {step.analysis?.task && <span className="subagent-task"><InlineMarkdown content={step.analysis.assignment?.question || step.analysis.task}/></span>}
        <AssignmentDetails analysis={step.analysis}/>
        {step.analysis?.summary && <MessageBody content={step.analysis.summary} compact/>}
        {step.analysis?.delivered && <span className="subagent-handoff"><Icon name="check" size={14}/>{step.analysis.deliveredTo === 'synthesis' ? '결과 통합에 전달' : '메인 에이전트에 전달'}</span>}
      </TraceStep>
    </li>)}</ol>
  </details>;
}
