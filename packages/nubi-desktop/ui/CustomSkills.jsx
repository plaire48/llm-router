import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {FolderMark} from './marks.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {skillRegistrationErrors} from './skill-registration-state.mjs';

export function CustomSkills({api,taskId,openPath,onRegister,toolbarTarget}){
  const [catalog,setCatalog]=useState(null),[trash,setTrash]=useState([]),[showTrash,setShowTrash]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[confirm,setConfirm]=useState(null);
  const live=useRef(true),lock=useRef(false),actions=useRef(new Map()),listButton=useRef(null);
  function error(value){if(!live.current)return;notifyWorkspaceToast(skillRegistrationErrors[value.message]||'스킬을 확인하지 못했어요. 다시 확인해 주세요.',{error:true});}
  async function load(){
    const [next,removed]=await Promise.all([api('listSkills',{taskId}),api('skillTrash',{taskId})]);
    if(live.current){setCatalog(next);setTrash(removed.items||[]);setFailed(false);}
  }
  async function perform(operation){if(lock.current)return;lock.current=true;setBusy(true);try{return await operation();}catch(value){error(value);if(live.current)setFailed(true);}finally{lock.current=false;if(live.current)setBusy(false);}}
  useEffect(()=>{live.current=true;void perform(load);return()=>{live.current=false;};},[api,taskId]);
  function closeConfirm(){if(lock.current)return;const name=confirm?.name;setConfirm(null);requestAnimationFrame(()=>actions.current.get(name)?.focus());}
  async function previewRemoval(skill){const value=await perform(()=>api('removeSkill',{taskId,name:skill.name,preview:true}));if(value&&live.current)setConfirm({...skill,...value});}
  const items=showTrash?trash:[...(catalog?.skills||[]).filter(skill=>skill.origin!=='workspace'),...(catalog?.unavailable||[])];
  const toolbar=<div className="nubi-custom-skill-toolbar"><CxButton className="nubi-custom-skill-register" onClick={onRegister} disabled={busy}><Icon name="plus" size={16}/>등록</CxButton><ActionButton ref={listButton} action={showTrash?'list':'delete'} iconOnly label={showTrash?'등록 목록 보기':`휴지통 보기 (${trash.length}개)`} title={showTrash?'등록 목록 보기':'휴지통'} aria-pressed={showTrash} disabled={busy} onClick={()=>{setShowTrash(!showTrash);void perform(load);}}/><ActionButton action="refresh" label="목록 새로고침" disabled={busy} onClick={()=>void perform(load)}/></div>;
  return <section className="nubi-custom-skills" aria-label={showTrash?'스킬 휴지통':'커스텀 관리'} aria-busy={busy}>
    {toolbarTarget?createPortal(toolbar,toolbarTarget):toolbar}
    {showTrash&&<div className="nubi-custom-skill-view"><strong>휴지통</strong><span>{trash.length}</span></div>}
    {busy&&<span className="visually-hidden" role="status">스킬을 확인하고 있어요.</span>}
    {failed&&<div className="nubi-skill-recovery"><p>스킬 목록을 다시 확인해 주세요.</p><ActionButton action="refresh" label="스킬 목록 다시 확인" disabled={busy} onClick={()=>void perform(load)}/></div>}
    <div className="nubi-custom-skill-list">{items.map(skill=><article className="nubi-custom-skill-row" key={skill.id||skill.path||skill.name}>
      <span className="nubi-custom-skill-mark" aria-hidden="true"><FolderMark size={18}/></span>
      <div className="nubi-custom-skill-copy"><strong title={skill.description||skill.title||skill.name}>{skill.title||skill.name}</strong><p title={skill.description}>{skill.description}</p>{skill.state==='unavailable'&&<small><Icon name="infoCircle" size={12}/>지침을 확인해 주세요.</small>}{showTrash&&skill.removedAt&&<small>{new Date(skill.removedAt).toLocaleString()}</small>}</div>
      <div className="nubi-custom-skill-actions">{showTrash?<ActionButton action="undo" label={`${skill.title||skill.name} 복원`} title="복원" disabled={busy} onClick={()=>void perform(async()=>{await api('skillTrash',{operation:'restore',taskId,name:skill.name,trashId:skill.id,expectedHash:skill.packageHash});await load();requestAnimationFrame(()=>listButton.current?.focus({preventScroll:true}));notifyWorkspaceToast('스킬을 복원했어요.',{success:true});})}/>:<><ActionButton action="edit" label={`${skill.title||skill.name} 수정`} title="수정" disabled={busy} onClick={()=>void perform(()=>openPath(skill.path))}/>{skill.managed&&<ActionButton ref={element=>{if(element)actions.current.set(skill.name,element);else actions.current.delete(skill.name);}} action="delete" label={`${skill.title||skill.name} 삭제`} title="삭제" disabled={busy} onClick={()=>void previewRemoval(skill)}/>}</>}</div>
    </article>)}</div>
    {!busy&&!failed&&catalog&&!items.length&&<p className="nubi-custom-skill-empty">{showTrash?'휴지통이 비어 있어요.':'등록한 스킬이 없어요.'}</p>}
    {!showTrash&&catalog?.issues?.length>0&&<details className="nubi-skill-info"><summary><Icon name="infoCircle" size={14}/>확인이 필요한 파일</summary>{catalog.issues.map(issue=><CxButton key={issue.path} className="nubi-file-link" onClick={()=>void perform(()=>openPath(issue.path))}><Icon name="file" size={14}/>{issue.path}</CxButton>)}</details>}
    {confirm&&<DeckConfirmation title="스킬을 삭제할까요?" message={<><strong>{confirm.title||confirm.name}</strong> 스킬을 휴지통으로 옮겨요.</>} confirmLabel="확인" confirmIcon="check" showActionLabels busy={busy} onCancel={closeConfirm} onConfirm={()=>void perform(async()=>{await api('removeSkill',{taskId,name:confirm.name,expectedHash:confirm.packageHash});if(live.current)setConfirm(null);await load();requestAnimationFrame(()=>listButton.current?.focus({preventScroll:true}));notifyWorkspaceToast('스킬을 휴지통으로 옮겼어요.',{success:true});})}>
      <p className="nubi-custom-skill-note"><Icon name="infoCircle" size={14}/>휴지통에서 다시 복원할 수 있어요.</p>
    </DeckConfirmation>}
  </section>;
}
