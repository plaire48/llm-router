import React, {useEffect, useRef, useState} from 'react';
import {ActionButton, Icon} from '@e2e/cx-design-system';
import {displayTrace, isAnalysisStep, SCRIPT_FAILURES, TOOL_LABELS} from '../agent-trace.js';
import {SubagentProgress} from './SubagentProgress.jsx';
import {TraceSurface, TraceStep} from './TraceSurface.jsx';
import {CaptureGallery} from './CaptureGallery.jsx';
import {InlineMarkdown, MessageBody} from './MessageBody.jsx';
import './trace-journal.css';
import {diagnosticView} from '../agent-diagnostic-view.js';

function CaptureStep({captures, children, onToggle}) {
  const [open, setOpen] = useState(false);
  return <details className="agent-step-capture" onToggle={event => {
    if (event.target !== event.currentTarget) return;
    setOpen(event.currentTarget.open); onToggle?.(event.currentTarget.open);
  }}>
    <summary>{children}<span className="agent-capture-toggle"><Icon name="image" size={14}/><Icon name="chevronDown" size={14}/><span className="visually-hidden">캡처 보기</span></span></summary>
    {open && <CaptureGallery captures={captures} inline/>}
  </details>;
}

function TraceJournal({owner, read, live, diagnostics = false}) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [cursors, setCursors] = useState([undefined]), [position, setPosition] = useState(0);
  const revision = useRef(0);
  useEffect(() => () => {revision.current++;}, []);
  async function load(before, nextCursors = [undefined], nextPosition = 0) {
    const request = ++revision.current;
    setBusy(true); setError(false);
    try {
      const result = await read({...owner, ...(before !== undefined ? {before} : {})});
      if (request !== revision.current) return;
      setPage(result); setCursors(nextCursors); setPosition(nextPosition);
    } catch {if (request === revision.current) setError(true);}
    finally {if (request === revision.current) setBusy(false);}
  }
  const status = {queued:'대기 등록',running:'실행 시작',done:'완료',error:'실패',cancelled:'취소',waiting:'확인 대기',deferred:'보류'};
  const phases = {planning:'작업 분할',thinking:'분석 호출',reading:'근거 조회',researching:'하위 작업 진행',synthesizing:'결과 통합'};
  const roles = {planner:'계획',research:'문서 조사',recovery:'누락 보완',synthesis:'결과 합치기',coordinator:'조사 진행',page:'화면 분석',review:'독립 검토'};
  return <details className={`agent-step-capture trace-journal${diagnostics ? ' agent-diagnostics' : ''}`} open={open} onToggle={event => {
    if (event.target !== event.currentTarget) return;
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open && !page && !busy) void load();
  }}>
    <summary><Icon name={diagnostics ? 'infoCircle' : 'clockRewind'} size={14}/><span>{diagnostics ? '실행 진단' : '전체 진행 기록'}</span><Icon name="chevronDown" size={14}/></summary>
    {open && <div aria-busy={busy}>
      <div className="agent-trace-more">
        <ActionButton action="refresh" iconOnly label={diagnostics ? '실행 진단 새로고침' : '진행 기록 새로고침'} disabled={busy} onClick={() => load()}/>
        {page?.available && <span>{page.retained.toLocaleString()}개 기록{live ? ' (진행 중)' : ''}</span>}
      </div>
      {error && <p role="alert">기록을 불러오지 못했습니다.</p>}
      {error && page && <p>이전에 조회한 기록입니다.</p>}
      {busy && <p role="status">기록을 불러오는 중</p>}
      {page && !page.available && <p>{diagnostics ? '보관된 진단이 없습니다. 완료 여부를 판단할 수 없습니다.' : page.priorRecord ? '보관 한도로 제외된 기록입니다.' : '이 작업의 전체 기록이 없습니다.'}</p>}
      {page && (page.dropped > 0 || page.missing > 0 || page.incomplete) && <p role="status">일부 기록이 없습니다.{page.dropped > 0 ? ` 보관 한도로 이전 ${page.dropped.toLocaleString()}개가 제외됐습니다.` : ''}{page.missing > 0 || page.incomplete ? ' 저장하지 못한 구간이 있습니다.' : ''}</p>}
      {!!page?.events?.length && <ol aria-label={diagnostics ? '실행 진단 최신순' : '진행 이벤트 최신순'} tabIndex={0}>{page.events.map(event => {
        if (diagnostics) {
          const view = diagnosticView(event);
          return <li key={event.sequence} data-diagnostic-sequence={event.sequence}>
            <TraceStep status={view.status} label={view.result}><strong>{view.label}</strong><span className="agent-tool-state"> {view.result}</span>
              {view.detail && <span className="diagnostic-detail">{view.detail}</span>}
              <time className="agent-tool-state" dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleString('ko-KR', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'})}</time>
            </TraceStep>
          </li>;
        }
        const analysis = event.analysis, range = analysis?.range;
        const name = roles[analysis?.role] || TOOL_LABELS[event.tool];
        const outcome = analysis?.outcome === 'partial' ? '일부 확인' : analysis?.outcome === 'blocked' ? '확인 필요' : event.status === 'running' && analysis ? phases[analysis.phase] || '진행 기록' : status[event.status];
        return <li key={event.sequence} data-journal-sequence={event.sequence} data-run-id={analysis?.runId} data-worker-id={analysis?.workerId} data-status={event.status}>
          <TraceStep status={event.status === 'running' || ['partial','blocked'].includes(analysis?.outcome) ? 'waiting' : event.status} label={outcome}><span>{name}{analysis?.workerId !== undefined ? ` ${analysis.workerId + 1}` : analysis?.synthesisId !== undefined ? ` ${analysis.synthesisId + 1}` : ''}</span><span className="agent-tool-state"> {outcome}</span>
            {range && <span className="agent-tool-state"> ({range.start.toLocaleString()}–{range.end.toLocaleString()})</span>}
            <span className="agent-tool-state"> <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</time></span>
            {analysis?.delivered && ['synthesis','main'].includes(analysis.deliveredTo) && <span className="subagent-handoff"><Icon name="check" size={14}/>{analysis.deliveredTo === 'main' ? '메인 전달' : '통합 전달'}</span>}
          </TraceStep>
        </li>;
      })}</ol>}
      {!!page?.events?.length && <div className="agent-trace-more">
        <ActionButton action="previousMedia" iconOnly label={diagnostics ? '더 최근 진단' : '더 최근 기록'} disabled={busy || position === 0} onClick={() => load(cursors[position - 1], cursors, position - 1)}/>
        <span>{position + 1}쪽</span>
        <ActionButton action="nextMedia" iconOnly label={diagnostics ? '이전 진단' : '이전 기록'} disabled={busy || page.next === null} onClick={() => load(page.next, [...cursors.slice(0, position + 1), page.next], position + 1)}/>
      </div>}
    </div>}
  </details>;
}

export function AgentTrace({debugMode = false, steps, captures = [], question, completed, verified = false, live = false, journalOwner, readJournal, diagnosticOwner, readDiagnostics}) {
  const [expanded, setExpanded] = useState(null), [showAll, setShowAll] = useState(false);
  const [opened, setOpened] = useState(() => new Set());
  steps = displayTrace(steps, completed).filter(step => step.tool !== 'update_plan');
  const analyses = debugMode ? steps.filter(isAnalysisStep) : [];
  // Image questions keep their candidates in the answer form. Never attach an
  // older/unlinked capture to a step by index, tool name or guessed timestamp.
  const screenshots = captures.filter(capture => capture.source === 'browser-tab' && !question?.options?.some(option => option.id === capture.id));
  const ids = new Set(steps.filter(step => step.tool !== 'progress_note').map(step => step.id).filter(Boolean));
  const unlinked = screenshots.filter(capture => !ids.has(capture.traceId));
  const statusText = {queued: '대기', running: '진행 중', done: '완료', error: '실행 실패', cancelled: '취소', recovered: '복구됨', waiting: '승인 대기', deferred: '실행 보류'};
  const waiting = !completed && steps.some(step => step.status === 'waiting');
  const running = steps.some(step => ['running', 'queued'].includes(step.status)), attention = steps.some(step => step.status === 'error' || step.status === 'cancelled');
  const ordinary = debugMode ? steps.filter(step => !isAnalysisStep(step)) : steps;
  const latestNote = live ? ordinary.findLast(step => step.tool === 'progress_note') : null;
  const visible = debugMode
    ? live && !showAll ? ordinary.filter((step, index) => step.status === 'running' || opened.has(step.id) || index >= ordinary.length - 4) : ordinary
    : ordinary.filter(step => ['running', 'queued', 'waiting', 'error', 'cancelled', 'deferred'].includes(step.status) ||
      ['partial', 'blocked'].includes(step.analysis?.outcome) || step === latestNote || screenshots.some(capture => capture.traceId === step.id));
  if (!visible.length && !analyses.length && !screenshots.length && !live && !(debugMode && (journalOwner || diagnosticOwner))) return null;
  const toggleCapture = (id, open) => {
    setOpened(previous => {const next = new Set(previous); if (open) next.add(id); else next.delete(id); return next;});
    // Keep the reader's place if a new tool starts or the answer completes.
    if (open) setExpanded(true);
  };
  return <TraceSurface open={expanded ?? live} onOpenChange={setExpanded} live={live} running={running} waiting={waiting} attention={attention && !verified} title={!debugMode ? '진행 상황' : analyses.length && verified ? '메인 에이전트 완료' : undefined}>
    <ol>{!!analyses.length && <li className="subagent-section"><SubagentProgress steps={analyses} live={live}/></li>}{visible.map((step, index) => {
      const key = step.id || `legacy-${steps.indexOf(step)}`;
      if (step.tool === 'progress_note') return <li key={key} className="agent-progress-note"><Icon name="message" size={14}/><MessageBody content={step.content} compact/></li>;
      const reason = SCRIPT_FAILURES[step.reason]?.[0];
      const label = step.status === 'error' ? reason || statusText.error : step.status === 'waiting' && step.tool === 'ask_user' ? '답변 대기' : statusText[step.status];
      const images = step.id ? screenshots.filter(capture => capture.traceId === step.id) : [];
      const content = <TraceStep status={step.status} label={step.status === 'recovered' && reason ? `${reason} 이후 결과 검증 완료` : label}>{step.planStep && step.planStep !== visible[index - 1]?.planStep && <span className="agent-trace-plan"><InlineMarkdown content={step.planStep}/></span>}{step.label ? <InlineMarkdown content={step.label}/> : TOOL_LABELS[step.tool]}<span className="agent-tool-state"> {step.status === 'running' ? '중' : label}</span></TraceStep>;
      return <li key={key} data-tool={step.tool} data-status={step.status} data-step-id={step.id}>
        {images.length ? <CaptureStep captures={images} onToggle={open => toggleCapture(step.id, open)}>{content}</CaptureStep> : content}
      </li>;
    })}
      {!!unlinked.length && <li className="agent-unlinked-captures"><CaptureStep captures={unlinked} onToggle={open => {if (open) setExpanded(true);}}><span className="agent-tool-label">브라우저 캡처</span></CaptureStep></li>}
      {live && !running && !waiting && <li className="agent-next-step"><span className="status-spinner" aria-hidden="true"/>다음 단계 확인 중</li>}
      {debugMode && live && steps.length > 4 && <li className="agent-trace-more"><ActionButton action={showAll ? 'collapse' : 'more'} iconOnly label={showAll ? '최근 단계 접기' : '최근 단계 펼치기'} onClick={() => setShowAll(!showAll)}/></li>}
      {debugMode && journalOwner && readJournal && <li><TraceJournal key={journalOwner.requestId} owner={journalOwner} read={readJournal} live={live}/></li>}
      {debugMode && diagnosticOwner && readDiagnostics && <li><TraceJournal key={JSON.stringify(diagnosticOwner)} owner={diagnosticOwner} read={readDiagnostics} live={live} diagnostics/></li>}
    </ol>
  </TraceSurface>;
}
