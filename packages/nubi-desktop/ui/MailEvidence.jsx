import React,{useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';

export const mailReferenceKey=item=>`${item.id}:${item.attachmentId||''}:${JSON.stringify(item.location||{})}`;
const validReference=item=>item&&typeof item==='object'&&typeof item.id==='string'&&typeof item.sourceHash==='string';
export function useMailDraftReferences(projectId,taskId){
  const cache=useRef(new Map()),[,update]=useState(0),key=projectId?`nubi-mail-draft:${JSON.stringify([projectId,taskId||null])}`:null;
  if(key&&!cache.current.has(key)){let values=[];try{const stored=JSON.parse(sessionStorage.getItem(key)||'[]');if(Array.isArray(stored))values=stored.filter(validReference).slice(0,20);}catch{}cache.current.set(key,values);}
  function setReferences(value){if(!key)return;const current=cache.current.get(key)||[],next=typeof value==='function'?value(current):value;cache.current.set(key,next);try{if(next.length)sessionStorage.setItem(key,JSON.stringify(next));else sessionStorage.removeItem(key);}catch{}update(n=>n+1);}
  function moveTo(nextTaskId){if(!key)return;const nextKey=`nubi-mail-draft:${JSON.stringify([projectId,nextTaskId])}`,values=cache.current.get(key)||[];cache.current.set(nextKey,values);try{if(values.length)sessionStorage.setItem(nextKey,JSON.stringify(values));else sessionStorage.removeItem(nextKey);}catch{}setReferences([]);}
  return [key?cache.current.get(key):[],setReferences,()=>key?cache.current.get(key)||[]:[],moveTo];
}
export function MailEvidenceChips({references=[],onRemove,onOpen}){
  if(!references.length)return null;
  const chips=<div className="nubi-mail-evidence-chips" aria-label="연결한 메일 근거">{references.filter(validReference).map(item=><span className="nubi-mail-evidence-chip" key={mailReferenceKey(item)}><CxButton type="button" aria-label={`${item.filename||item.title||'메일'} 원문 보기`} title={item.filename?`${item.title}\n${item.filename}`:item.title} onClick={()=>onOpen?.(item)}><Icon name={item.attachmentId?'file':'mail'} size={14}/><span>{item.filename||item.title||'메일'}{item.location?.page?` / ${item.location.page}쪽`:item.location?.sheet?` / ${item.location.sheet}`:item.location?.slide?` / 슬라이드 ${item.location.slide}`:''}</span></CxButton>{onRemove&&<CxButton type="button" aria-label={`${item.filename||item.title||'메일'} 근거 제거`} title="근거 제거" onClick={()=>onRemove(item)}><Icon name="xClose" size={12}/></CxButton>}</span>)}</div>;
  return onRemove&&references.length>1?<details className="nubi-mail-evidence-group"><summary><Icon name="mail" size={16}/><span>선택한 메일 {references.length}개</span><Icon name="chevronDown" size={14}/></summary>{chips}</details>:chips;
}
export function appendMailReferences(current,added){const result=[...current];for(const item of added){const index=result.findIndex(value=>mailReferenceKey(value)===mailReferenceKey(item));if(index<0)result.push(item);else result[index]=item;}if(result.length>20)throw Error('mail_reference_limit');return result;}
export function removeMailReference(current,item){return current.filter(value=>mailReferenceKey(value)!==mailReferenceKey(item));}
