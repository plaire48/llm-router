import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import React,{useRef,useState} from 'react';
import {CxInput, CxNotice, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {DeckDisclosure,DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {A2A_ERRORS,ROLE_NAMES} from '../../nubi-a2a/contract.mjs';
import {TASK_SKILLS,TASK_ERRORS} from '../../nubi-a2a/tasks.mjs';
import {ApprovalBar} from './ApprovalBar.jsx';
import {incomingRequests,pairedRoles,exchangedTasks} from './agent-connections.mjs';

const STATES={submitted:'수락 대기',working:'진행 중',completed:'결과 받음',failed:'확인 필요',canceled:'취소됨',rejected:'거절됨',stale:'조건 변경'};
const appName=role=>ROLE_NAMES[role]||'다른 앱';

// The header's agent connection (user decision 2026-10-01): pairing with Nubi in the browser or Office, and the
// requests they send, which run only after this user accepts them. Sending stays in each conversation.
export function AgentConnections({project,api,refresh,disabled,onOpenTask,onInvite}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[invite,setInvite]=useState(null);
  const pending=useRef(false);
  async function act(args,after){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try{const value=await api('collaboration',args);await after?.(value);}
    catch(e){setError(TASK_ERRORS[e.message]||A2A_ERRORS[e.message]||'연결 상태를 확인하지 못했어요. 다시 시도해 주세요.');}
    finally{pending.current=false;setBusy(false);}
  }
  const paired=pairedRoles(project),incoming=incomingRequests(project),exchanged=exchangedTasks(project);
  // An address works once: when its app pairs, the pairing's expiry changes and the used address goes away.
  const expiry=role=>(project?.peerLinks||[]).find(link=>link.role===role)?.expiresAt||0;
  const shown=invite&&expiry(invite.recipient)===invite.pairedUntil?invite:null;
  return <div className="nubi-agent-links">
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    <section aria-label="연결한 앱">
      {Object.entries(ROLE_NAMES).filter(([role])=>role!=='office').map(([role,label])=><div className="nubi-agent-link" key={role}>
        <span className="nubi-settings-row-icon" aria-hidden="true"><Icon name="link" size={18}/></span>
        <div><strong>{label} 누비</strong><p className="nubi-muted">{paired.has(role)?'연결됨':'연결 안 됨'}</p></div>
        <ActionButton action="add" label={`${label} 누비 연결 주소 만들기`} disabled={busy||disabled} onClick={()=>act({action:'invite',recipient:role},value=>{setInvite({...value,pairedUntil:expiry(role)});onInvite?.(value.expiresAt);})}/>
      </div>)}
      {shown&&<div className="nubi-agent-invite">
        <label htmlFor="nubi-agent-invite">{appName(shown.recipient)} 누비 설정의 ‘누비 작업 연결’에 붙여넣으세요. 10분 안에 한 번 쓸 수 있어요.</label>
        <div className="nubi-agent-invite-field"><CxInput id="nubi-agent-invite" readOnly value={shown.url} onFocus={e=>e.target.select()}/><CopyButton label="연결 주소 복사" text={shown.url}/></div>
      </div>}
    </section>
    <section aria-label="받은 요청">
      <h3>받은 요청</h3>
      {incoming.length?incoming.map(job=><article className="nubi-recovery-card nubi-agent-request" key={job.id} aria-label={`${appName(job.requester)} 누비의 요청`}>
        <div className="nubi-action-head"><span className="nubi-action-tile" data-tone="blue" aria-hidden="true"><Icon name="link" size={20}/></span><div><h3>{TASK_SKILLS.desktop[job.skill]?.name||'요청'}</h3><p>{appName(job.requester)} 누비가 보냈어요. 수락하면 새 대화에 읽기 전용으로 열려요.</p></div></div>
        <p className="nubi-agent-request-text">{job.request}</p>
        {!!job.facts?.length&&<p className="nubi-muted">찾을 항목: {job.facts.join(', ')}</p>}
        {job.context&&<DeckDisclosure title="함께 보낸 참고 자료"><p className="nubi-muted">참고 자료일 뿐 실행 권한이 아니에요.</p><MessageBody content={job.context} role="assistant"/></DeckDisclosure>}
        <ApprovalBar approveLabel="수락" approveIcon="check" rejectLabel="거절" disabled={busy||disabled} onReject={()=>act({action:'task_reject',id:job.id},refresh)} onApprove={()=>act({action:'task_accept',id:job.id},async value=>{await refresh();onOpenTask?.(value.localTaskId);})}/>
      </article>):<p className="nubi-muted">받은 요청이 없어요.</p>}
    </section>
    {exchanged.length>0&&<section aria-label="주고받은 작업">
      <h3>주고받은 작업</h3>
      {exchanged.map(job=><div className="nubi-agent-job" key={job.id}>
        <div><strong>{job.recipient==='desktop'?`${appName(job.requester)} 누비에게 받음`:`${appName(job.recipient)} 누비에게 보냄`}</strong><p>{job.request}</p></div>
        <DeckStatus>{STATES[job.state]||'상태 확인'}</DeckStatus>
        {job.conversation&&<ActionButton action="detail" label="대화 열기" onClick={()=>onOpenTask?.(job.conversation)}/>}
      </div>)}
    </section>}
  </div>;
}
