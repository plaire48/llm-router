import {WorkspaceActionMenu} from './WorkspaceActionMenu.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import React, {useEffect, useMemo, useState} from 'react';
import {ProjectFileTree} from './ProjectFileTree.jsx';
import {DriftLabel} from './DriftLabel.jsx';
import {CxButton, CxInput, DetailPanel, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {groupSessionsByDate} from './session-navigation.mjs';
import {NubiLogo} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {FolderMark, FolderOpenMark, RecoveryStatus} from './marks.jsx';

const taskState = {running:'진행 중', stopping:'중지 중', waiting_input:'답변 대기', paused:'복구 대기', failed:'확인 필요'};
// One conversation list by date, as in the browser agent's history (user decision 2026-09-30): the current conversation
// is the soft blue row, and deleting is the trash icon with a confirmation. A running conversation has no trash.
export function SessionSidebar({projects=[],onSwitchProject,onRenameProject,onRemoveProject,brand = false, compactAt = 900, compact, project, selected, open, disabled, onToggle, onChooseProject, onSearch, onNew, onSelect, onDelete, onCopyProjectPath, filesMode=false, activeFile, onOpenFile}) {
  const [editingProject,setEditingProject]=useState(null),[projectName,setProjectName]=useState(''),[removingProject,setRemovingProject]=useState(null),[projectBusy,setProjectBusy]=useState(false);
  const [removing, setRemoving] = useState(null), [deleting, setDeleting] = useState(false), [expanded, setExpanded] = useState(true), [showAll, setShowAll] = useState(false), [pinned, setPinned] = useState([]), [acknowledged, setAcknowledged] = useState([]);
  const fileItems = useMemo(() => (project?.files || []).map(path => ({path})), [project?.files]);
  // The left navigation rail owns the sidebar toggle. Over a narrow window the
  // sidebar covers the rail, so the scrim and Escape close it there.
  useEffect(() => {
    if (!open) return;
    const close = event => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"], [role="alertdialog"]')) {event.preventDefault();event.stopPropagation();onToggle();} };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open, onToggle, compactAt, compact]);
  useEffect(() => { if (!project?.projectId) return; setExpanded(true); setShowAll(false); setAcknowledged([]); try { setPinned(JSON.parse(localStorage.getItem(`nubi-pinned-tasks:${project.projectId}`)) || []); } catch { setPinned([]); } }, [project?.projectId]);
  useEffect(() => { if (selected && project?.tasks.some(task => task.id === selected && ['review', 'completed'].includes(task.state))) setAcknowledged(current => current.includes(selected) ? current : [...current, selected]); }, [selected, project?.tasks]);
  if (!project) return null;
  async function remove() {
    if (!removing || deleting) return;
    setDeleting(true);
    try { if (await onDelete(removing.id)) setRemoving(null); }
    finally { setDeleting(false); }
  }
  const togglePin = id => setPinned(current => { const next = current.includes(id) ? current.filter(item => item !== id) : [id, ...current]; try { localStorage.setItem(`nubi-pinned-tasks:${project.projectId}`, JSON.stringify(next)); } catch {} return next; });
  const activityTime = task => Date.parse(task.updatedAt || task.createdAt || '') || 0;
  const orderedTasks = [...project.tasks].sort((a,b) => (Number(pinned.includes(b.id)) - Number(pinned.includes(a.id))) || (activityTime(b) - activityTime(a)));
  const visibleTasks = showAll ? orderedTasks : orderedTasks.slice(0, 5);
  const hiddenTaskCount = Math.max(0, orderedTasks.length - visibleTasks.length);
  const rootParts = String(project.root || '').split(/[\\/]/).filter(Boolean);
  const folderName = rootParts.at(-1) || project.name;
  const copyRoot = () => onCopyProjectPath?.({projectId:project.projectId, taskId:selected || undefined});
  const projectRows=projects.some(entry=>entry.id===project.projectId)?projects:[{id:project.projectId,name:project.kind==='conversation'?'개인 대화':folderName,root:project.root,kind:project.kind},...projects];
  const activeContents=<>{filesMode&&onOpenFile&&<ProjectFileTree key={project.projectId} items={fileItems} selected={activeFile} onSelect={item=>onOpenFile(item.path)} disabled={disabled}/>}<div className="nubi-sidebar-actions"><CxButton className="nubi-sidebar-new" aria-current={selected === null ? 'page' : undefined} disabled={disabled} onClick={onNew}><Icon name="plus" size={18}/>새 대화</CxButton></div>
      {visibleTasks.length > 0 && <nav className="nubi-sidebar-history" aria-label="대화 목록">{groupSessionsByDate(visibleTasks, undefined, true).map(group => <section key={group.key} aria-label={`${group.label} 대화`}><h3>{group.label}</h3>
        {group.tasks.map(task => { const running = ['running', 'stopping'].includes(task.state); const complete = ['review', 'completed'].includes(task.state); return <div className="nubi-session-row" key={task.id} data-current={selected === task.id} data-state={task.state} data-pinned={pinned.includes(task.id)}>
          <CxButton className="nubi-session-select" aria-current={selected === task.id ? 'page' : undefined} title={pinned.includes(task.id)?`고정된 대화: ${task.request}`:task.request} aria-description={pinned.includes(task.id)?'고정된 대화':undefined} disabled={disabled} onClick={() => { if (complete) setAcknowledged(current => current.includes(task.id) ? current : [...current, task.id]); onSelect(task.id); }}><Icon name={pinned.includes(task.id)?"pin":"message"} size={16}/><DriftLabel className="nubi-session-title">{task.request}</DriftLabel>{running ? <span className="nubi-session-progress" role="status" aria-label="진행 중"><span className="status-spinner"/></span> : task.state==='paused' ? <RecoveryStatus/> : !complete && taskState[task.state] && <small>{taskState[task.state]}</small>}</CxButton>
          <div className="nubi-session-actions">{complete && !acknowledged.includes(task.id) && <span className="nubi-session-complete" role="status" aria-label="새 결과" title="새 결과"/>}<WorkspaceActionMenu inline label={`${task.request} 관리`}><CxButton className="nubi-session-action" aria-label={pinned.includes(task.id) ? `${task.request} 고정 해제` : `${task.request} 고정`} title={pinned.includes(task.id) ? '고정 해제' : '고정'} aria-pressed={pinned.includes(task.id)} disabled={disabled} onClick={event => { event.stopPropagation(); togglePin(task.id); }}><Icon name="pin" size={18}/></CxButton>{!running && <ActionButton action="delete" iconOnly label={`${task.request} 삭제`} title="삭제" disabled={disabled} onClick={event => { event.stopPropagation(); setRemoving(task); }}/>}</WorkspaceActionMenu></div>
        </div>})}
      </section>)}{hiddenTaskCount > 0 && <CxButton className="nubi-sidebar-more" onClick={() => setShowAll(true)}><Icon name="chevronDown" size={16}/>대화 {hiddenTaskCount}개 더보기</CxButton>}{showAll&&orderedTasks.length > 5 && <CxButton className="nubi-sidebar-more" onClick={() => setShowAll(false)}><Icon name="chevronUp" size={16}/>접기</CxButton>}</nav>}</>;
  async function manageProject(operation,close){setProjectBusy(true);try{const result=await operation();if(result)close();}finally{setProjectBusy(false);}}
  return <>
    {open&&<div className="nubi-sidebar-scrim" aria-hidden="true" onClick={onToggle}/>}
    <aside className="nubi-sidebar" aria-label="프로젝트 대화" data-open={open}>
      {brand&&<div className="nubi-sidebar-brand"><NubiLogo product="Workspace" versionLabel="Beta" size={24}/><CxButton className="nubi-sidebar-toggle" data-open={open} aria-label={open?'사이드바 접기':'사이드바 펼치기'} title={open?'사이드바 접기':'사이드바 펼치기'} aria-expanded={open} onClick={onToggle}><Icon name={open?'panelLeftClose':'panelLeft'} size={18}/></CxButton></div>}
      <div className="nubi-sidebar-body" hidden={!open}>
        <div className="nubi-sidebar-actions nubi-sidebar-quick-actions">{project.root&&<CopyButton label="프로젝트 경로 복사" disabled={disabled} resetKey={project.root} onCopy={copyRoot}/>}<CxButton className="nubi-sidebar-folder-picker" aria-label="프로젝트 추가" title="프로젝트 추가" disabled={disabled} onClick={onChooseProject}><Icon name="plus" size={18}/><span>프로젝트</span></CxButton><CxButton className="nubi-sidebar-search" aria-label="대화 검색" title="대화 검색" disabled={disabled} onClick={onSearch}><Icon name="search" size={18}/><span>검색</span></CxButton></div>
        {projectRows.map(entry=>{const current=entry.id===project.projectId;return <section className="nubi-saved-project" key={entry.id} data-current={current}>
          <div className="nubi-sidebar-project-row"><CxButton className="nubi-sidebar-project" aria-expanded={current&&expanded} aria-label={`${entry.name} 대화 ${current&&expanded?'접기':'펼치기'}`} title={entry.root} disabled={disabled||projectBusy} onClick={()=>current?setExpanded(value=>!value):onSwitchProject?.(entry.id)}>
            {current&&expanded?<FolderOpenMark size={18}/>:<FolderMark size={18}/>}<DriftLabel className="nubi-sidebar-project-name">{entry.name}</DriftLabel><Icon name="chevronDown" size={16}/>
          </CxButton>{entry.kind!=='conversation'&&onRenameProject&&<WorkspaceActionMenu inline label={`${entry.name} 프로젝트 관리`}>
            <CxButton className="nubi-session-action" aria-label={`${entry.name} 이름 변경`} title="이름 변경" disabled={disabled||projectBusy} onClick={()=>{setProjectName(entry.name);setEditingProject(entry);}}><Icon name="pencil" size={18}/></CxButton>
            <CxButton className="nubi-session-action" aria-label={`${entry.name} 목록에서 제거`} title="목록에서 제거" disabled={disabled||projectBusy} onClick={()=>setRemovingProject(entry)}><Icon name="xClose" size={18}/></CxButton>
          </WorkspaceActionMenu>}</div>{current&&expanded&&activeContents}
        </section>;})}
      </div>
    </aside>
    {editingProject&&<DetailPanel className="deck-dialog nubi-project-name-dialog" title="프로젝트 이름" variant="modal" busy={projectBusy} onClose={()=>{if(!projectBusy)setEditingProject(null);}} footer={<CxButton variant="primary" disabled={projectBusy||!projectName.trim()} onClick={()=>manageProject(()=>onRenameProject(editingProject.id,projectName),()=>setEditingProject(null))}><Icon name="check" size={16}/>저장</CxButton>}>
      <form onSubmit={event=>{event.preventDefault();if(!projectBusy&&projectName.trim())void manageProject(()=>onRenameProject(editingProject.id,projectName),()=>setEditingProject(null));}}><label htmlFor="nubi-project-name">이름</label><CxInput id="nubi-project-name" value={projectName} maxLength={80} autoFocus disabled={projectBusy} onChange={event=>setProjectName(event.target.value)}/></form>
    </DetailPanel>}
    {removingProject&&<DeckConfirmation title="목록에서 제거할까요?" message={<><strong className="nubi-delete-title" title={removingProject.name}>{removingProject.name}</strong><span className="nubi-project-remove-note">파일과 대화는 그대로 남아요.</span></>} confirmLabel="목록에서 제거" confirmIcon="xClose" showActionLabels busy={projectBusy} onCancel={()=>{if(!projectBusy)setRemovingProject(null);}} onConfirm={()=>manageProject(()=>onRemoveProject(removingProject.id),()=>setRemovingProject(null))}/>}
    {removing && <DeckConfirmation className="nubi-delete-conversation" title="대화를 삭제할까요?" message={<><strong className="nubi-delete-title" title={removing.request}>{removing.request.replace(/\\r\\n|\\n/g, ' ')}</strong><span className="nubi-delete-scope">대화와 작업 기록이 삭제돼요.</span><span className="nubi-deletion-note"><Icon name="infoCircle" size={16} aria-hidden="true"/><span>프로젝트에 반영한 파일은 그대로 남아요.</span></span></>} confirmLabel="삭제" confirmIcon="trash" showActionLabels busy={deleting} onCancel={() => { if (!deleting) setRemoving(null); }} onConfirm={remove}/>}
  </>;
}
