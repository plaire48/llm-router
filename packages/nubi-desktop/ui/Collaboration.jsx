import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import React,{useState,useRef} from 'react';
import {CxButton,CxInput,CxNotice,Icon} from '@e2e/cx-design-system';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {A2A_ERRORS,ROLE_NAMES} from '../../nubi-a2a/contract.mjs';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
export function Collaboration({task,rows,api,refresh,disabled}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[invite,setInvite]=useState(null),[copied,setCopied]=useState(false);
  const pending=useRef(false),attempts=useRef({});
  async function act(action,recipient,id){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try{
      if(action==='request')attempts.current[recipient]||=crypto.randomUUID();
      const value=await api('collaboration',{action,taskId:task.id,recipient,id,requestId:attempts.current[recipient]});
      if(action==='invite'){setInvite(value);setCopied(false);}else{if(action==='request')delete attempts.current[recipient];await refresh();}
    }catch(e){setError(A2A_ERRORS[e.message]||'작업 연결을 확인하지 못했어요. 새로고침해 주세요.');}finally{pending.current=false;setBusy(false);}
  }
  return <DeckDisclosure title="다른 누비와 작업" icon="link"><div className="nubi-collaboration-intro"><AgentMark size={40} mood={busy?'working':error?'sad':'idle'} lively/><p className="nubi-muted">소스와 Wiki를 다른 누비와 함께 활용합니다.</p></div>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    {Object.entries(ROLE_NAMES).map(([role,label])=><div className="nubi-task-actions" key={role}><CxButton disabled={busy||disabled} onClick={()=>act('request',role)}><Icon name={role==='browser'?'link':'file'} size={18}/>{role==='browser'?'브라우저에 시나리오 요청':'Office에 검토 문서 요청'}</CxButton><CxButton disabled={busy||disabled} onClick={()=>act('invite',role)}>{label} 연결 주소</CxButton></div>)}
    {invite&&<div><label htmlFor="a2a-invite">{ROLE_NAMES[invite.recipient]} 설정의 ‘누비 작업 연결’에 붙여넣으세요.</label><p className="nubi-muted">10분 동안 한 번 사용할 수 있습니다.</p><CxInput id="a2a-invite" readOnly value={invite.url}/><CxButton onClick={async()=>{try{await navigator.clipboard.writeText(invite.url);setCopied(true);}catch{setError('주소를 선택해서 복사해 주세요.');}}}>{copied?'복사됨':'연결 주소 복사'}</CxButton></div>}
    <CxButton disabled={busy} onClick={()=>act('status')}>결과 새로고침</CxButton>
    {rows.map(row=><DeckDisclosure key={row.id} title={`${ROLE_NAMES[row.recipient]} ${row.state===3?'결과 받음':row.state===5?'취소됨':'검토 대기'}`}>
      {row.result?<><p className="nubi-muted">전달받은 초안입니다. 실제 실행 결과는 별도로 확인합니다.</p><MessageBody content={row.result.text} role="assistant"/></>:<CxButton disabled={busy||row.state!==6} onClick={()=>act('cancel',undefined,row.id)}>전달 취소</CxButton>}
    </DeckDisclosure>)}
  </DeckDisclosure>;
}
