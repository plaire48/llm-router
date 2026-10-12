import React,{useEffect,useState} from 'react';
import {Icon,CxButton} from '@e2e/cx-design-system';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {MessageTimestamp} from './MessageTimestamp.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {MailEvidenceChips} from './MailEvidence.jsx';
const storageKey='nubi-outgoing-v1';
export function useOutgoingMessages(){
 const [items,setItems]=useState(()=>{try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'[]');return Array.isArray(saved)?saved.filter(item=>item&&typeof item.id==='string'&&typeof item.text==='string').map(item=>({...item,phase:'unconfirmed'})):[];}catch{return [];}});
 useEffect(()=>{try{if(items.length)sessionStorage.setItem(storageKey,JSON.stringify(items));else sessionStorage.removeItem(storageKey);}catch{}},[items]);
 return [items,setItems];
}
export function deliveryRecorded(item,task){
  if(!task)return false;
  if(item.createdTask)return !['draft','ready','creating'].includes(task.state);
  return task.inbox?.some(message=>message.id===item.inputId)||task.messages?.slice(item.messageCount||0).some(message=>message.role==='user'&&(message.inputId===item.inputId||message.content===item.text));
}
export function OutgoingMessages({items,task,onSource,onDismiss}){
 return items.map(item=>{
  const echoed=item.createdTask||task?.messages?.slice(item.messageCount||0).some(message=>message.role==='user'&&message.content===item.text);
  return <div key={item.id} className="nubi-outgoing" data-delivery={item.phase}>
   {!echoed&&<article className="message message-user nubi-request" aria-label="내 메시지"><div className="nubi-user-bubble"><MessageBody role="user" content={item.text}/><MailEvidenceChips references={item.references} onOpen={onSource}/></div><div className="message-actions"><MessageTimestamp at={item.at}/><CopyButton text={item.text} label="내 메시지 복사" successMessage="메시지를 복사했습니다."/></div></article>}
   {item.phase==='unconfirmed'?<p className="nubi-delivery-status" role="status"><Icon name="alertCircle" size={18}/><span>전송 결과 확인 필요</span>{onDismiss&&<CxButton type="button" className="nubi-icon-button" data-icon-only aria-label="보관한 요청 지우기" title="보관한 요청 지우기" onClick={()=>onDismiss(item.id)}><Icon name="xClose" size={16}/></CxButton>}</p>:(!item.createdTask||task?.state!=='running')&&<p className="nubi-delivery-status" role="status"><span className="status-spinner" aria-hidden="true"/><span>{item.phase==='accepted'?'진행 확인 중':item.queued?'대기열에 보내는 중':item.createdTask?'시작하는 중':'요청 보내는 중'}</span></p>}
  </div>;
 });
}
