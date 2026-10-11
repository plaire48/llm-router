import React, {useEffect, useRef, useState} from 'react';
import {ActionButton, CxButton, CxNotice, notifyToast} from '@e2e/cx-design-system';
import {DeckSectionLabel, DeckStatus} from './DeckSurfaces.jsx';
import {TASK_SKILLS, TASK_ERRORS} from '../../../packages/nubi-a2a/tasks.mjs';
import './a2a-tasks.css';

const STATES = {submitted: ['수락 대기', 'warning'], working: ['진행 중', 'active'], completed: ['완료', 'success'], failed: ['실패', 'danger'], rejected: ['거절됨', 'neutral'], canceled: ['취소됨', 'neutral']};
const skillName = task => TASK_SKILLS[task.recipient]?.[task.skill]?.name || task.skill;

// Tasks exchanged with the paired desktop (nubi-task-v1). A received task runs
// only after the user accepts it here; its result is sent when the run ends.
export function A2ATasks({rpc, disabled = false, onStarted}) {
  const [data, setData] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const alive = useRef(true), pending = useRef(false);
  async function act(input) {
    if (pending.current) return;
    pending.current = true; setBusy(input.id || input.action); if (input.action !== 'list') setError('');
    try {
      const value = await rpc('A2A_TASKS', input);
      if (!alive.current) return;
      if (value?.error) throw Object.assign(new Error(value.error), {text: value.message});
      setData(value); if (input.action === 'list') setError('');
      if (input.action === 'accept') {notifyToast('작업을 시작했습니다.'); onStarted?.();}
    } catch (cause) {if (alive.current) setError(cause.text || TASK_ERRORS[cause.message] || '작업 목록을 확인하지 못했어요. 다시 조회해 주세요.');}
    finally {pending.current = false; if (alive.current) setBusy('');}
  }
  useEffect(() => {
    alive.current = true; void act({action: 'list'});
    // The dialog's own refresh belongs to the collaboration list, so this list refreshes itself.
    const timer = setInterval(() => {if (!pending.current && document.visibilityState === 'visible') void act({action: 'list'});}, 10000);
    return () => {alive.current = false; clearInterval(timer);};
  }, []);
  const tasks = data?.tasks || [], received = tasks.filter(task => task.recipient === 'browser'), sent = tasks.filter(task => task.requester === 'browser');
  const blocked = disabled || !!busy;
  const row = task => {
    const [label, tone] = STATES[task.state] || [task.state, 'neutral'], mine = task.requester === 'browser', running = data?.run?.taskId === task.id;
    return <li className="a2a-task" key={task.id} data-state={task.state}>
      <div className="a2a-task-head"><span className="a2a-task-skill">{skillName(task)}</span><DeckStatus tone={tone}>{running && task.state === 'working' ? '브라우저에서 실행 중' : label}</DeckStatus></div>
      <p className="a2a-task-request">{task.request}</p>
      {task.urls?.length > 0 && <ul className="a2a-task-links">{task.urls.map(url => <li key={url}>{url}</li>)}</ul>}
      {task.note && ['failed', 'rejected'].includes(task.state) && <p className="a2a-task-note">{task.note}</p>}
      {task.result && <details className="a2a-task-result"><summary>결과{task.result.verification === 'host_checked' ? <DeckStatus tone="success" icon="check">출처 대조됨</DeckStatus> : null}</summary>
        <p>{task.result.summary}</p>
        {task.result.facts?.length > 0 && <ul className="a2a-task-facts">{task.result.facts.map((fact, index) => <li key={index}><span className="a2a-fact-name">{fact.name}</span><span>{fact.value}</span>{fact.source_url && <a href={fact.source_url} target="_blank" rel="noreferrer noopener" title={fact.quote}>출처</a>}{fact.path && <code>{fact.path}</code>}</li>)}</ul>}
      </details>}
      {!mine && task.state === 'submitted' && <div className="a2a-task-decision">
        <ActionButton action="cancel" iconOnly label="거절" disabled={blocked} onClick={() => act({action: 'reject', id: task.id})}/>
        <CxButton variant="primary" disabled={blocked || data?.busy} busy={busy === task.id} title={data?.busy ? '현재 작업을 마친 뒤 수락해 주세요.' : undefined} onClick={() => act({action: 'accept', id: task.id})}>수락 후 실행</CxButton>
      </div>}
      {!mine && running && task.state === 'working' && data.run.stopped && <div className="a2a-task-decision">
        <span className="a2a-task-note">실행이 멈췄습니다. 대화에서 이어 가거나 실패로 알릴 수 있습니다.</span>
        <ActionButton action="close" iconOnly label="실패로 알리기" disabled={blocked} onClick={() => act({action: 'fail', id: task.id})}/>
      </div>}
      {mine && ['submitted', 'working'].includes(task.state) && <div className="a2a-task-decision"><ActionButton action="cancel" iconOnly label="요청 취소" disabled={blocked} onClick={() => act({action: 'cancel', id: task.id})}/></div>}
    </li>;
  };
  return <section className="a2a-tasks" aria-label="누비 작업" aria-busy={!!busy}>
    <DeckSectionLabel icon="layers">받은 작업</DeckSectionLabel>
    {error && <CxNotice tone="danger">{error}</CxNotice>}
    {received.length ? <ul className="a2a-task-list">{received.map(row)}</ul> : data && <p className="reply-note">받은 작업이 없습니다.</p>}
    {sent.length > 0 && <><DeckSectionLabel icon="arrowUp">보낸 작업</DeckSectionLabel><ul className="a2a-task-list">{sent.map(row)}</ul></>}
  </section>;
}
