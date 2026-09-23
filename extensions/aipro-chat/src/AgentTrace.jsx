import React, {useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {displayTrace, SCRIPT_FAILURES, TOOL_LABELS} from '../agent-trace.js';
import {TraceSurface, TraceStep} from './TraceSurface.jsx';
import {CaptureGallery} from './CaptureGallery.jsx';
import {InlineMarkdown, MessageBody} from './MessageBody.jsx';

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

export function AgentTrace({steps, captures = [], question, completed, live = false}) {
  const [expanded, setExpanded] = useState(null), [showAll, setShowAll] = useState(false);
  const [opened, setOpened] = useState(() => new Set());
  steps = displayTrace(steps, completed).filter(step => step.tool !== 'update_plan');
  // Image questions keep their candidates in the answer form. Never attach an
  // older/unlinked capture to a step by index, tool name or guessed timestamp.
  const screenshots = captures.filter(capture => capture.source === 'browser-tab' && !question?.options?.some(option => option.id === capture.id));
  const ids = new Set(steps.filter(step => step.tool !== 'progress_note').map(step => step.id).filter(Boolean));
  const unlinked = screenshots.filter(capture => !ids.has(capture.traceId));
  if (!steps.length && !screenshots.length) return null;
  const statusText = {running: '진행 중', done: '완료', error: '실행 실패', cancelled: '취소', recovered: '복구됨', waiting: '승인 대기', deferred: '실행 보류'};
  const waiting = !completed && steps.some(step => step.status === 'waiting');
  const running = steps.some(step => step.status === 'running'), attention = steps.some(step => step.status === 'error' || step.status === 'cancelled');
  const visible = live && !showAll ? steps.filter((step, index) => step.status === 'running' || opened.has(step.id) || index >= steps.length - 4) : steps;
  const toggleCapture = (id, open) => {
    setOpened(previous => {const next = new Set(previous); if (open) next.add(id); else next.delete(id); return next;});
    // Keep the reader's place if a new tool starts or the answer completes.
    if (open) setExpanded(true);
  };
  return <TraceSurface open={expanded ?? live} onOpenChange={setExpanded} live={live} running={running} waiting={waiting} attention={attention}>
    <ol>{visible.map((step, index) => {
      const key = step.id || `legacy-${steps.indexOf(step)}`;
      if (step.tool === 'progress_note') return <li key={key} className="agent-progress-note"><Icon name="message" size={14}/><MessageBody content={step.content} compact/></li>;
      const reason = SCRIPT_FAILURES[step.reason]?.[0];
      const label = step.status === 'error' ? reason || statusText.error : step.status === 'waiting' && step.tool === 'ask_user' ? '답변 대기' : statusText[step.status];
      const images = step.id ? screenshots.filter(capture => capture.traceId === step.id) : [];
      const content = <TraceStep status={step.status} label={step.status === 'recovered' && reason ? `${reason} 이후 결과 검증 완료` : label}>{step.planStep && step.planStep !== visible[index - 1]?.planStep && <span className="agent-trace-plan">{step.planStep}</span>}{step.label ? <InlineMarkdown content={step.label}/> : TOOL_LABELS[step.tool]}<span className="agent-tool-state"> {step.status === 'running' ? '중' : label}</span></TraceStep>;
      return <li key={key} data-tool={step.tool} data-status={step.status} data-step-id={step.id}>
        {images.length ? <CaptureStep captures={images} onToggle={open => toggleCapture(step.id, open)}>{content}</CaptureStep> : content}
      </li>;
    })}
      {!!unlinked.length && <li className="agent-unlinked-captures"><CaptureStep captures={unlinked} onToggle={open => {if (open) setExpanded(true);}}><span className="agent-tool-label">브라우저 캡처</span></CaptureStep></li>}
      {live && !running && !waiting && <li className="agent-next-step"><span className="status-spinner" aria-hidden="true"/>다음 단계 확인 중</li>}
      {live && steps.length > 4 && <li className="agent-trace-more"><CxButton aria-label={showAll ? '최근 진행만 보기' : '전체 진행 기록 보기'} title={showAll ? '최근 진행만 보기' : '전체 진행 기록 보기'} onClick={() => setShowAll(!showAll)}><Icon name={showAll ? 'chevronUp' : 'moreHorizontal'} size={16}/></CxButton></li>}
    </ol>
  </TraceSurface>;
}
