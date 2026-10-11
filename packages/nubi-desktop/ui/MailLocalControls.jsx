import React,{useEffect,useRef,useState} from 'react';
import {CxButton, CxInput, DetailPanel, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
export function MailLocalControls({api,source,onChange}){
 const [busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[draft,setDraft]=useState([]),[input,setInput]=useState('');
 const active=useRef(source.id),alive=useRef(true),lock=useRef(false);active.current=source.id;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setEditing(false);setInput('');},[source.id]);
 const local=source.local||{pinned:false,tags:[]};
 async function update(patch){
  if(lock.current)return false;lock.current=true;setBusy(true);const id=source.id;
  try{const value=await api('mail',{action:'updateLocal',id,patch});onChange(id,value);if(alive.current&&active.current===id)notifyWorkspaceToast(patch.tags?'태그를 저장했어요.':value.pinned?'메일을 고정했어요.':'메일 고정을 해제했어요.');return true;}
  catch{if(alive.current&&active.current===id)notifyWorkspaceToast('메일 분류를 저장하지 못했어요.',{error:true});return false;}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function add(){const tag=input.trim();if(!tag)return;if(draft.length>=20&&!draft.includes(tag)){notifyWorkspaceToast('태그는 20개까지 추가할 수 있어요.',{error:true});return;}setDraft(current=>[...new Set([...current,tag])]);setInput('');}
 const tagsToSave=[...new Set([...draft,...(input.trim()?[input.trim()]:[])])];
 return <>
  <CxButton className="nubi-mail-local-action" aria-label={local.pinned?'메일 고정 해제':'메일 고정'} title={local.pinned?'고정 해제':'고정'} aria-pressed={local.pinned} disabled={busy} onClick={()=>void update({pinned:!local.pinned})}><Icon name="pin" size={15}/><span>{local.pinned?'고정 해제':'고정'}</span></CxButton>
  <CxButton className="nubi-mail-local-action" aria-label="메일 태그 관리" title="태그" disabled={busy} onClick={()=>{setDraft(local.tags||[]);setInput('');setEditing(true);}}><Icon name="tag" size={15}/><span>태그</span></CxButton>
  {editing&&<DetailPanel variant="modal" className="deck-dialog nubi-panel nubi-mail-tags-dialog" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon"><Icon name="tag" size={18}/></span>메일 태그</span>} busy={busy} onClose={()=>setEditing(false)}>
   <form className="nubi-mail-tag-input" onSubmit={event=>{event.preventDefault();add();}}><CxInput aria-label="새 태그" placeholder="태그 이름" maxLength={50} value={input} disabled={busy} onChange={event=>setInput(event.target.value)}/><ActionButton action="add" label="태그 추가" type="submit" disabled={busy||!input.trim()}/></form>
   <div className="nubi-mail-filter-chips" aria-label="메일 태그 목록">{draft.map(tag=><span key={tag}>{tag}<ActionButton action="clearSearch" label={`${tag} 태그 제거`} disabled={busy} onClick={()=>setDraft(current=>current.filter(value=>value!==tag))}/></span>)}</div>
   <p className="nubi-muted">고정과 태그는 누비에서만 관리해요.</p>
   <footer className="nubi-mail-dialog-actions"><ActionButton action="save" iconOnly={false} label="저장" busy={busy} disabled={busy||tagsToSave.length>20} onClick={async()=>{if(await update({tags:tagsToSave}))setEditing(false);}}/></footer>
  </DetailPanel>}
 </>;
}
