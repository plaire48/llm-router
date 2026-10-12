import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {QueuedInputs} from '../../../extensions/aipro-chat/src/QueuedInputs.jsx';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {MailEvidenceChips} from './MailEvidence.jsx';

export function WorkspaceInputs({task,busy,onAction,onEdit,onSource,kind='queue'}) {
  const items=task.inbox||[],running=task.state==='running',blocked=!!task.question||!!task.peerWait||['pending','connected'].includes(task.computerConnectionRequest?.state);
  const chain=task.checkpoint?.inputChain||task.checkpoint?.runId;
  const actions=item=><span className="agent-input-actions">
    {running&&!blocked&&item.mode==='queue'&&item.runId===chain&&<CxButton className="composer-icon" disabled={busy} aria-label="지금 반영" title="현재 작업에 지금 반영" onClick={()=>onAction('steer',{id:item.id})}><Icon name="arrowUp" size={14}/></CxButton>}
    {!running&&!blocked&&item.id===items[0]?.id&&<CxButton className="composer-icon" disabled={busy} aria-label="대기 메시지 실행" title="이 메시지부터 이어서 실행" onClick={()=>onAction('start',{id:item.id})}><Icon name="arrowUp" size={14}/></CxButton>}
    <CxButton className="composer-icon" disabled={busy} aria-label="메시지 수정" title="수정" onClick={()=>onEdit(item.id)}><Icon name="pencil" size={14}/></CxButton>
    <CxButton className="composer-icon" disabled={busy} aria-label="메시지 삭제" title="삭제" onClick={()=>onAction('remove',{id:item.id})}><Icon name="trash" size={14}/></CxButton>
  </span>;
  if(!items.length)return null;
  return <>
    {kind==='steer'&&items.filter(item=>item.mode==='steer').map(item=><article key={item.id} className="message message-user nubi-message user agent-input-pending" aria-label="반영 대기 메시지"><div className="nubi-user-bubble"><MessageBody role="user" content={item.text}/><MailEvidenceChips references={item.mailReferences} onOpen={onSource}/></div><div className="nubi-pending-footer"><span className="agent-input-mode">{running&&!blocked?'반영 대기':'보류'}</span>{actions(item)}</div></article>)}
    {kind==='queue'&&items.some(item=>item.mode==='queue')&&<QueuedInputs items={items} busy={busy} hideSteering onReorder={args=>onAction('reorder',args)}>{item=><><span className="nubi-queued-content"><span className="agent-input-text" title={item.text}>{item.text}</span><MailEvidenceChips references={item.mailReferences} onOpen={onSource}/></span>{actions(item)}</>}</QueuedInputs>}
  </>;
}
