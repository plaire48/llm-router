import React,{useEffect,useRef,useState} from 'react';
import {ActionButton,CxNotice,notifyToast} from '@e2e/cx-design-system';
import {DeckSectionLabel} from './DeckSurfaces.jsx';
import {workspaceRecord,stageWorkspace,discardWorkspaceStage} from '../voc-workspace.js';
import {VOC_ERRORS} from '../voc-tools.js';
export function WorkspaceSettings({rpc,clientId,disabled,onBusy}) {
  const [folder,setFolder]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[needsTab,setNeedsTab]=useState(false);
  const saved=useRef(null),pending=useRef(false),alive=useRef(true);
  async function refresh(){const [r,status]=await Promise.all([workspaceRecord(),rpc('WORKSPACE_STATUS')]);if(alive.current){saved.current=r;setFolder(status);}}
  useEffect(()=>{alive.current=true;refresh().catch(()=>{if(alive.current)setError('저장 폴더를 확인하지 못했습니다.');});return()=>{alive.current=false;};},[rpc]);
  async function change(mode){
    if(pending.current||disabled)return;let stage;
    try {
      let operation;
      if(mode==='select') {if(!window.showDirectoryPicker){setNeedsTab(true);return;}operation=window.showDirectoryPicker({id:'nubi-voc',mode:'readwrite'});}
      else if(mode==='allow'){if(!saved.current?.handle)throw new Error('workspace_missing');operation=saved.current.handle.requestPermission({mode:'readwrite'});}
      pending.current=true;setBusy(true);onBusy(true);setError('');
      if(mode==='select'){const handle=await operation;if(!alive.current)return;stage=await stageWorkspace(handle,clientId);if(!alive.current)return;await rpc('WORKSPACE_COMMIT',{stageId:stage});stage=null;}
      else if(mode==='allow'){if(await operation!=='granted')throw new Error('workspace_permission');}
      else await rpc('WORKSPACE_CLEAR');
      await refresh();if(alive.current){setNeedsTab(false);notifyToast(mode==='clear'?'폴더 연결을 해제했습니다.':'저장 폴더를 연결했습니다.');}
    }catch(cause){if(alive.current&&cause.name!=='AbortError'){if(['SecurityError','NotSupportedError'].includes(cause.name))setNeedsTab(true);else setError(VOC_ERRORS[cause.message]||'폴더에 접근하지 못했습니다. 다시 선택해 주세요.');}}
    finally{if(stage)await discardWorkspaceStage(stage,clientId).catch(()=>{});pending.current=false;if(alive.current)setBusy(false);onBusy(false);}
  }
  return <details className="integration-settings"><summary><DeckSectionLabel icon="save" tone="teal">첨부파일 설정</DeckSectionLabel></summary><div className="integration-content"><div className="connection-row"><span className="integration-name">{folder?.name||'폴더 선택'}</span><div className="integration-actions">
    {folder?.status==='permission_required'&&<ActionButton action="login" iconOnly label="저장 폴더 접근 허용" disabled={disabled||busy} onClick={()=>change('allow')}/>}
    <ActionButton action={folder?'edit':'add'} iconOnly className="icon-commit" label={folder?'저장 폴더 변경':'저장 폴더 선택'} busy={busy} disabled={disabled} onClick={()=>change('select')}/>
    {folder&&<ActionButton action="close" iconOnly label="저장 폴더 연결 해제" disabled={disabled||busy} onClick={()=>change('clear')}/>}</div></div>
    {needsTab&&<div className="connection-row"><span>전체 화면에서 폴더를 선택해 주세요.</span><ActionButton action="openExternal" iconOnly label="전체 화면에서 저장 폴더 선택" onClick={()=>rpc('OPEN_TAB',{hash:'#settings'})}/></div>}
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
  </div></details>;
}
