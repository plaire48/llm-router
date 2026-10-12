import React from 'react';
import {Icon} from '@e2e/cx-design-system';

// Shared visual shell. Browser captures and Excel receipts stay in host adapters.
export function TraceSurface({open, onOpenChange, live, running, waiting, attention, stopped, title, summaryAside, children}) {
  return <details className="agent-trace" open={open} onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open !== open) onOpenChange(event.currentTarget.open);
  }} data-state={running ? 'running' : attention ? 'attention' : stopped ? 'stopped' : waiting ? 'waiting' : 'done'}>
    <summary><Icon name={running || live && !waiting ? 'refresh' : attention ? 'alertCircle' : stopped ? 'minus' : waiting ? 'clock' : 'check'} size={14}/><span className="agent-trace-title" title={typeof title==='string'?title:undefined}>{title || (live ? '진행 상황' : '실행 기록')}</span>{summaryAside}<Icon name="chevronDown" size={14}/></summary>
    {children}
  </details>;
}

export function TraceStep({status, label, children}) {
  return <><span className={`agent-step-status agent-step-${status}`} title={label}>
    {status === 'running' ? <span className="status-spinner" aria-hidden="true"/> : <Icon name={status === 'done' ? 'check' : status === 'error' ? 'alertCircle' : status === 'recovered' ? 'refresh' : ['waiting', 'queued'].includes(status) ? 'clock' : 'minus'} size={14}/>}
  </span><span className="agent-tool-label">{children}</span></>;
}
