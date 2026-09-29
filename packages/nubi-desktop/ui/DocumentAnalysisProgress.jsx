import React, {useState} from 'react';
import {Icon} from '@e2e/cx-design-system';

const phases = {loading:'원본 문서를 확인하고 있어요',validating:'문서가 바뀌지 않았는지 확인하고 있어요',planning:'읽을 범위를 나누고 있어요',researching:'문서를 나눠 확인하고 있어요',thinking:'분석하고 있어요',reading:'근거를 읽고 있어요',synthesizing:'분석 결과를 합치고 있어요',synthesis_finished:'합친 결과를 확인하고 있어요'};
const states = {interrupted:'분석 중단됨',complete:'문서 분석 정리됨',partial:'일부만 확인됨',blocked:'분석 확인 필요',failed:'분석 중단됨',cancelled:'분석 중지됨'};
const roles = {planner:'범위 구성',research:'문서 분석',recovery:'누락 보완',synthesis:'결과 통합'};
const outcomes = {complete:'응답 수신',partial:'일부 확인',blocked:'확인 필요'};
const count = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const number = value => count(value).toLocaleString('ko-KR');

function workerState(worker, running) {
  if (worker.outcome) return outcomes[worker.outcome] || '응답 확인 필요';
  if (!running) return '응답 미확인';
  return ({queued:'대기',planning:'범위 구성 중',researching:'분석 중',thinking:'분석 중',reading:'근거 읽는 중',synthesizing:'통합 중',finished:'응답 수신',synthesis_finished:'응답 수신'})[worker.phase] || '대기';
}

/** Only persisted host events drive progress; counts are responses, not task success. */
export function DocumentAnalysisProgress({analysis, taskRunning = false}) {
  const [expanded, setExpanded] = useState(null);
  if (!analysis) return null;
  const running = analysis.state === 'running' && taskRunning;
  const state = analysis.state === 'running' && !taskRunning ? 'blocked' : analysis.state;
  const label = running ? phases[analysis.phase] || '문서를 분석하고 있어요' : states[state] || '분석 기록 확인';
  const workers = analysis.workers || [];
  const unread = analysis.coverage?.unreadRanges || [];
  const open = expanded ?? running;
  const sourceName = id => analysis.sources?.find(source => source.id === id)?.path || id;
  return <section className="nubi-document-progress" aria-label="문서 분석 진행" data-state={state}>
    <div className="nubi-document-progress-heading" role="status" aria-live="polite">
      <Icon name="layers" size={18}/><strong>{label}</strong>
      {count(analysis.total) > 0 && <span>응답 {number(analysis.completed)}/{number(analysis.total)}</span>}
    </div>
    {(unread.length > 0 || state === 'partial') && <p className="nubi-document-attention">{unread.length ? `읽지 못한 구간 ${number(unread.length)}개가 남아 있어요.` : '일부 분석이나 결과 통합을 확인하지 못했어요.'}</p>}
    {['failed','blocked','interrupted'].includes(state) && <p className="nubi-document-attention">수신한 분석 기록을 남겼어요. 중단 원인을 확인해 주세요.</p>}
    <details open={open} onToggle={event => {if(event.currentTarget === event.target && event.currentTarget.open !== open)setExpanded(event.currentTarget.open);}}>
      <summary>분담과 결과 {workers.length > 0 && <span>{number(workers.length)}개</span>}<Icon name="chevronDown" size={14}/></summary>
      {analysis.question && <p className="nubi-document-question">{analysis.question}</p>}
      <ol>{workers.map((worker, index) => <li key={worker.taskId ?? index} data-outcome={worker.outcome || (running ? 'pending' : 'unknown')}>
        <div className="nubi-document-worker-heading"><strong>{roles[worker.role] || '문서 분석'} {index + 1}</strong><span>{workerState(worker, running)}</span></div>
        {worker.question && <p>{worker.question}</p>}
        {worker.range ? <small>{sourceName(worker.range.documentId)} <span>문자 {number(count(worker.range.start) + 1)}–{number(worker.range.end)}</span></small> : worker.documentIds?.length > 0 && <small>{worker.documentIds.map(sourceName).join(', ')}</small>}
        {worker.summary && <p>{worker.summary}</p>}
      </li>)}</ol>
      {unread.length > 0 && <details className="nubi-document-unread"><summary>남은 구간</summary><ul>{unread.map((range,index)=><li key={index}>{sourceName(range.documentId)} <span>문자 {number(count(range.start)+1)}–{number(range.end)}</span></li>)}</ul></details>}
      {analysis.error && <p className="nubi-document-error">진단 코드: <code>{analysis.error}</code></p>}
    </details>
  </section>;
}
