import React from 'react';
import {ActionButton, CxButton, Icon} from '@e2e/cx-design-system';
import {SessionTabs} from './SessionTabs.jsx';
import {groupSessionsByDate} from './session-navigation.mjs';

const taskState = {running:'진행 중', stopping:'중지 중', waiting_input:'답변 대기', paused:'복구 대기', failed:'확인 필요'};

export function SessionSidebar({project, ids, selected, open, disabled, onToggle, onChooseProject, onHistory, onNew, onSelect, onClose}) {
  if (!project) return null;
  const saved = project.tasks.filter(task => !ids.includes(task.id));
  return <>
    {open && <div className="nubi-sidebar-scrim" aria-hidden="true" onClick={onToggle}/>}
    <aside className="nubi-sidebar" aria-label="프로젝트 대화" data-open={open}>
      <div className="nubi-sidebar-head"><strong>프로젝트</strong><ActionButton action="close" label="사이드바 닫기" onClick={onToggle}/></div>
      <CxButton className="nubi-sidebar-project" aria-label="프로젝트 열기" title={`${project.name} · 다른 프로젝트 열기`} disabled={disabled} onClick={onChooseProject}><Icon name="file" size={18}/><span>{project.name}</span><Icon name="chevronDown" size={16}/></CxButton>
      <div className="nubi-sidebar-actions"><CxButton className="nubi-sidebar-new" aria-current={selected === null ? 'page' : undefined} disabled={disabled} onClick={onNew}><Icon name="plus" size={18}/>새 대화</CxButton><ActionButton action="history" label="작업 이력" title="대화 이력과 검색" onClick={onHistory}/></div>
      <SessionTabs tasks={project.tasks} ids={ids} selected={selected} disabled={disabled} onSelect={onSelect} onClose={onClose}/>
      {saved.length > 0 && <nav className="nubi-sidebar-history" aria-label="지난 대화"><h2>지난 대화</h2>{groupSessionsByDate(saved).map(group => <section key={group.key} aria-label={`${group.label} 대화`}><h3>{group.label}</h3>{group.tasks.map(task => <CxButton key={task.id} className="nubi-sidebar-history-item" onClick={() => onSelect(task.id)} disabled={disabled} title={task.request}><span>{task.request}</span>{taskState[task.state] && <small>{taskState[task.state]}</small>}</CxButton>)}</section>)}</nav>}
    </aside>
  </>;
}
