import React, {useEffect, useState} from 'react';
import {ActionButton, CxButton, Icon} from '@e2e/cx-design-system';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {groupSessionsByDate} from './session-navigation.mjs';

const taskState = {running:'진행 중', stopping:'중지 중', waiting_input:'답변 대기', paused:'복구 대기', failed:'확인 필요'};

// One conversation list by date, as in the browser agent's history (user decision 2026-09-30): the current conversation
// is the soft blue row, and deleting is the trash icon with a confirmation. A running conversation has no trash.
export function SessionSidebar({project, selected, open, disabled, onToggle, onChooseProject, onHistory, onNew, onSelect, onDelete}) {
  const [removing, setRemoving] = useState(null), [deleting, setDeleting] = useState(false);
  // The header's sidebar button opens and closes it (user decision 2026-09-30: no second close button).
  // Over a narrow window the sidebar covers that button, so the scrim and Escape close it there.
  useEffect(() => {
    if (!open) return;
    const close = event => { if (event.key === 'Escape' && window.matchMedia('(max-width: 900px)').matches && !document.querySelector('[role="dialog"], [role="alertdialog"]')) onToggle(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open, onToggle]);
  if (!project) return null;
  async function remove() {
    if (!removing || deleting) return;
    setDeleting(true);
    try { if (await onDelete(removing.id)) setRemoving(null); }
    finally { setDeleting(false); }
  }
  return <>
    {open && <div className="nubi-sidebar-scrim" aria-hidden="true" onClick={onToggle}/>}
    <aside className="nubi-sidebar" aria-label="프로젝트 대화" data-open={open}>
      <div className="nubi-sidebar-head"><strong>프로젝트</strong></div>
      <CxButton className="nubi-sidebar-project" aria-label="프로젝트 열기" title={`${project.name}\n다른 프로젝트 열기`} disabled={disabled} onClick={onChooseProject}><Icon name="file" size={18}/><span>{project.name}</span><Icon name="chevronDown" size={16}/></CxButton>
      <div className="nubi-sidebar-actions"><CxButton className="nubi-sidebar-new" aria-current={selected === null ? 'page' : undefined} disabled={disabled} onClick={onNew}><Icon name="plus" size={18}/>새 대화</CxButton><ActionButton action="history" label="작업 이력" title="대화 이력과 검색" onClick={onHistory}/></div>
      {project.tasks.length > 0 && <nav className="nubi-sidebar-history" aria-label="대화 목록">{groupSessionsByDate(project.tasks).map(group => <section key={group.key} aria-label={`${group.label} 대화`}><h3>{group.label}</h3>
        {group.tasks.map(task => <div className="nubi-session-row" key={task.id} data-current={selected === task.id}>
          <CxButton className="nubi-session-select" aria-current={selected === task.id ? 'page' : undefined} title={task.request} disabled={disabled} onClick={() => onSelect(task.id)}><span className="nubi-session-title">{task.request}</span>{taskState[task.state] && <small>{taskState[task.state]}</small>}</CxButton>
          {!['running', 'stopping'].includes(task.state) && <ActionButton action="delete" label={`${task.request} 삭제`} title="대화 삭제" disabled={disabled} onClick={() => setRemoving(task)}/>}
        </div>)}
      </section>)}</nav>}
    </aside>
    {removing && <DeckConfirmation title="대화를 삭제할까요?" message={`‘${removing.request}’ 대화와 작업 기록이 삭제됩니다. 프로젝트에 반영한 파일은 그대로 남아요.`} confirmLabel="삭제" confirmIcon="trash" headerCancelOnly busy={deleting} onCancel={() => { if (!deleting) setRemoving(null); }} onConfirm={remove}/>}
  </>;
}
