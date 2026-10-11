import {DeckField} from './DeckSurfaces.jsx';
import {AgentMark} from './AgentMark.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {ActionButton,CxButton,CxInput,CxNotice,DetailPanel} from '@e2e/cx-design-system';
import {A2A_ERRORS,invitation} from '../../../packages/nubi-a2a/contract.mjs';

export function A2AInbox({role,call,onImport,onClose,disabled=false,beforeConnect,children}){
  const [data,setData]=useState(null),[url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const pending=useRef(false),alive=useRef(true),callRef=useRef(call);callRef.current=call;
  async function act(input){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');
    try{
      if(input.action==='connect'){const parsed=invitation(url.trim(),role);if(beforeConnect&&!await beforeConnect(parsed.origin))throw new Error('a2a_scope');}
      const value=await callRef.current({...input,...(input.action==='connect'?{url:url.trim()}:{})});
      if(!alive.current)return;
      if(value.error)throw new Error(value.error);
      if(value.draft){await onImport(value.draft);onClose();}else{setData(value);if(input.action==='connect')setUrl('');if(input.action==='result')setNotice('데스크톱으로 답변을 보냈습니다.');}
    }catch(cause){if(alive.current)setError(A2A_ERRORS[cause.message]||'연결을 확인하지 못했어요. 다시 조회해 주세요.');}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  useEffect(()=>{alive.current=true;void act({action:'status'});return()=>{alive.current=false;};},[]);
  return <DetailPanel title="누비 작업 연결" variant="modal" className="deck-dialog project-dialog" hideHelp busy={busy} onClose={()=>{if(!pending.current)onClose();}}>
    <div className="project-connection-fields">
      <div className="project-connection-summary"><AgentMark size={40} mood={busy?'working':error?'sad':'idle'} lively/><span className="project-connection-name">누비 Workspace<span className="project-task-state">소스와 Wiki로 함께 작업합니다.</span></span></div>
      {error&&<CxNotice tone="danger">{error}</CxNotice>}{notice&&<CxNotice tone="info">{notice}</CxNotice>}
      {!data?.connected?<form className="project-connection-form" onSubmit={e=>{e.preventDefault();void act({action:'connect'});}}><DeckField icon="linkExternal" label="데스크톱에서 복사한 연결 주소"><CxInput type="url" value={url} autoComplete="off" spellCheck={false} onChange={e=>setUrl(e.target.value)} disabled={busy||disabled}/></DeckField><div className="project-connection-actions"><ActionButton action="login" iconOnly label="연결" title="데스크톱 연결" type="submit" busy={busy} disabled={disabled||!url.trim()}/></div></form>:<>
        <div className="connection-row"><span>데스크톱 연결됨</span><ActionButton action="refresh" iconOnly label="새로고침" disabled={busy} onClick={()=>act({action:'status'})}/><ActionButton action="close" iconOnly label="연결 해제" disabled={busy||disabled} onClick={()=>act({action:'disconnect'})}/></div>
        {children}
        {data.active&&<div><p>{data.active.canSend?'이 요청의 답변을 데스크톱으로 보낼 수 있어요.':'요청을 가져온 대화에서 전송하고 답변을 완성해 주세요.'}</p><CxButton disabled={busy||disabled||!data.active.canSend} onClick={()=>act({action:'result',id:data.active.taskId})}>답변 보내기</CxButton><ActionButton action="close" iconOnly label="요청 연결 해제" disabled={busy||disabled} onClick={()=>act({action:'detach'})}/></div>}
        {data.tasks?.length?data.tasks.map(task=><div className="project-connection-summary" key={task.id}><span className="project-connection-name"><span>{task.request}</span><span className="project-task-state">{task.state===3?'결과 전달됨':task.state===5?'취소됨':'검토 대기'}</span></span>{task.state===6&&<CxButton disabled={busy||disabled||!!data.active} onClick={()=>act({action:'import',id:task.id})}>요청 가져오기</CxButton>}</div>):!children&&<p>받은 작업이 없습니다.</p>}
        {data.hasMore&&<p className="reply-note">최근 25개 작업을 표시합니다.</p>}
        <p className="reply-note">답변 전달은 테스트 통과나 문서 저장의 증거가 아닙니다.</p>
      </>}
    </div>
  </DetailPanel>;
}
