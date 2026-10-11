import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {FolderMark} from './marks.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {skillRegistrationErrors,separateFolderPicker} from './skill-registration-state.mjs';

export function SkillRegistration({api,taskId,onRegistered,onBusy}){
  const [busy,setBusy]=useState(false),[dragging,setDragging]=useState(false);
  const live=useRef(true),lock=useRef(false),separateFolder=separateFolderPicker(typeof window!=='undefined'?window.nubi?.platform:undefined);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  async function register(read){
    if(lock.current)return;lock.current=true;setBusy(true);onBusy(true);
    try{const value=await read();if(value?.__nubiError)throw Error(value.__nubiError);if(value?.cancelled)return;if(typeof value?.name!=='string')throw Error('skill_import_changed');if(live.current){notifyWorkspaceToast(value.noChange?'같은 스킬이 이미 등록되어 있어요.':'스킬을 등록했어요.',{success:true});onRegistered(value);}}
    catch(error){if(live.current)notifyWorkspaceToast(skillRegistrationErrors[error.message]||'스킬을 등록하지 못했어요. 파일을 확인해 주세요.',{error:true});}
    finally{lock.current=false;onBusy(false);if(live.current)setBusy(false);}
  }
  function drop(event){
    event.preventDefault();event.stopPropagation();setDragging(false);if(busy)return;
    const files=event.dataTransfer.files;
    if(files.length!==1){notifyWorkspaceToast('스킬 하나를 선택해 주세요.',{error:true});return;}
    if(!window.nubi?.registerSkillFile){notifyWorkspaceToast('선택 버튼으로 파일이나 폴더를 등록해 주세요.',{error:true});return;}
    const file=files[0];void register(()=>window.nubi.registerSkillFile(file,taskId));
  }
  return <div className="nubi-skill-registration">
    <div className="nubi-skill-dropzone" data-dragging={dragging} aria-busy={busy} onDrop={drop} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';setDragging(true);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))setDragging(false);}}>
      <span className="nubi-skill-import-mark" aria-hidden="true"><FolderMark size={28}/></span>
      <strong>스킬을 끌어 놓으세요.</strong><p>폴더, ZIP 또는 Markdown 파일</p>
      {/* macOS takes files and folders in one dialog. Windows and Linux cannot, so a folder gets its own button (2026-10-07). */}
      <div className="nubi-skill-import-actions"><CxButton variant="primary" disabled={busy} onClick={()=>void register(()=>api('chooseSkillPackage',{taskId}))}><Icon name="file" size={16}/>{separateFolder?'파일 선택':'선택'}</CxButton>{separateFolder&&<CxButton disabled={busy} onClick={()=>void register(()=>api('chooseSkillPackage',{taskId,kind:'folder'}))}><FolderMark size={16}/>폴더 선택</CxButton>}</div>
    </div>
    {busy&&<p role="status" className="nubi-muted">스킬을 등록하고 있어요.</p>}
  </div>;
}
