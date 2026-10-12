import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {SkillPagination,useSkillPagination} from './SkillPagination.jsx';
import {skillRegistrationErrors} from './skill-registration-state.mjs';

export function CustomSkills({api,taskId,openPath,onRegister,toolbarTarget,searchable=false}){
  const [query,setQuery]=useState(''),[catalog,setCatalog]=useState(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[confirm,setConfirm]=useState(null);
  const live=useRef(true),lock=useRef(false),actions=useRef(new Map()),listButton=useRef(null);
  function error(value){if(!live.current)return;notifyWorkspaceToast(skillRegistrationErrors[value.message]||'스킬을 확인하지 못했어요. 다시 확인해 주세요.',{error:true});}
  async function load(){
    const next=await api('listSkills',{taskId});
    if(live.current){setCatalog(next);setFailed(false);}
  }
  async function perform(operation){if(lock.current)return;lock.current=true;setBusy(true);try{return await operation();}catch(value){error(value);if(live.current)setFailed(true);}finally{lock.current=false;if(live.current)setBusy(false);}}
  useEffect(()=>{live.current=true;void perform(load);return()=>{live.current=false;};},[api,taskId]);
  function closeConfirm(){if(lock.current)return;const name=confirm?.name;setConfirm(null);requestAnimationFrame(()=>actions.current.get(name)?.focus());}
  async function previewRemoval(skill){const value=await perform(()=>api('removeSkill',{taskId,name:skill.name,preview:true}));if(value&&live.current)setConfirm({...skill,...value});}
  const all=[...(catalog?.skills||[]),...(catalog?.unavailable||[])],items=all.filter(skill=>[skill.title,skill.name,skill.description].some(value=>value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const pagination=useSkillPagination(items,`${taskId}:${query}`);
  const toolbar=<div className="nubi-custom-skill-toolbar"><CxButton ref={listButton} className="nubi-custom-skill-register" aria-label="등록" title="스킬 등록" onClick={onRegister} disabled={busy}><Icon name="plus" size={16}/><span>스킬 등록</span></CxButton><ActionButton action="refresh" label="목록 새로고침" disabled={busy} onClick={()=>void perform(load)}/></div>;
  return <section className="nubi-custom-skills" aria-label="내 스킬" aria-busy={busy}>
    {toolbarTarget?createPortal(toolbar,toolbarTarget):toolbar}
    {searchable&&<div className="nubi-marketplace-search"><Icon name="search" size={18}/><input aria-label="내 스킬 검색" placeholder="내 스킬 검색" value={query} onChange={event=>setQuery(event.target.value)}/></div>}
    <SkillPagination pagination={pagination} label="내 스킬" busy={busy}/>
    {busy&&<span className="visually-hidden" role="status">스킬을 확인하고 있어요.</span>}
    {failed&&<div className="nubi-skill-recovery"><p>스킬 목록을 다시 확인해 주세요.</p><ActionButton action="refresh" label="스킬 목록 다시 확인" disabled={busy} onClick={()=>void perform(load)}/></div>}
    <div className="nubi-custom-skill-list">{pagination.items.map(skill=><article className="nubi-custom-skill-row" key={skill.id||skill.path||skill.name}>
      <span className="nubi-custom-skill-mark" title={skill.origin==='workspace'?'AI Workspace에서 받은 스킬':'내가 등록한 스킬'}><Icon name="layers" size={18}/></span>
      <div className="nubi-custom-skill-copy"><strong title={skill.description||skill.title||skill.name}>{skill.title||skill.name}</strong><p title={skill.description}>{skill.description}</p>{skill.state==='unavailable'&&<small className="nubi-skill-needs-attention"><Icon name="infoCircle" size={16}/>지침을 확인해 주세요.</small>}</div>
      <div className="nubi-custom-skill-actions"><ActionButton action="edit" label={`${skill.title||skill.name} 수정`} title="수정" disabled={busy} onClick={()=>void perform(()=>openPath(skill.path))}/>{skill.managed&&<ActionButton ref={element=>{if(element)actions.current.set(skill.name,element);else actions.current.delete(skill.name);}} action="delete" label={`${skill.title||skill.name} 삭제`} title="삭제" disabled={busy} onClick={()=>void previewRemoval(skill)}/>}</div>
    </article>)}</div>
    {!busy&&!failed&&catalog&&!items.length&&<p className="nubi-custom-skill-empty">{query?'검색 결과가 없어요.':'등록한 스킬이 없어요.'}</p>}
    {catalog?.issues?.length>0&&<details className="nubi-skill-info"><summary><Icon name="infoCircle" size={14}/>확인이 필요한 파일</summary>{catalog.issues.map(issue=><CxButton key={issue.path} className="nubi-file-link" onClick={()=>void perform(()=>openPath(issue.path))}><Icon name="file" size={14}/>{issue.path}</CxButton>)}</details>}
    {confirm&&<DeckConfirmation className="nubi-delete-skill" title="스킬을 삭제할까요?" message={<><strong>{confirm.title||confirm.name}</strong> 스킬을 이 프로젝트에서 삭제해요.</>} confirmLabel="삭제" confirmIcon="check" showActionLabels busy={busy} onCancel={closeConfirm} onConfirm={()=>void perform(async()=>{await api('removeSkill',{taskId,name:confirm.name,expectedHash:confirm.packageHash});if(live.current)setConfirm(null);await load();requestAnimationFrame(()=>listButton.current?.focus({preventScroll:true}));notifyWorkspaceToast('스킬을 삭제했어요.',{success:true});})}>
    </DeckConfirmation>}
  </section>;
}
