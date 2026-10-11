import React,{useEffect,useState} from 'react';
import {CxButton} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {MailReader} from './MailReader.jsx';

// Exact observed sources remain beside the central conversation. Switching a
// source never sends a question or widens the selection.
export function MailSourcePane({references,api,onDocument,onAsk}){
 const [index,setIndex]=useState(0),[source,setSource]=useState(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{setIndex(0);},[references]);
 const reference=references[index]||references[0];
 useEffect(()=>{let live=true;setSource(null);setFailed(false);void (async()=>{
  try{await api('mail',{...reference,action:'evidence'});const value=await api('mail',{action:'read',id:reference.id});if(value.sourceHash!==reference.sourceHash)throw Error('mail_source_changed');if(live)setSource(value);}
  catch{if(live)setFailed(true);}
 })();return()=>{live=false;};},[reference,api,retry]);
 return <section className="desktop-mail-source" aria-label="질문에 연결한 메일 원문">
  {references.length>1&&<div className="desktop-mail-source-switch"><ActionButton action="previousMedia" iconOnly label="이전 연결 메일" disabled={index===0} onClick={()=>setIndex(value=>value-1)}/><select aria-label="연결한 메일 선택" value={index} onChange={event=>setIndex(Number(event.target.value))}>{references.map((item,i)=><option key={item.id+':'+i} value={i}>{i+1}. {item.title||'메일'}</option>)}</select><ActionButton action="nextMedia" iconOnly label="다음 연결 메일" disabled={index>=references.length-1} onClick={()=>setIndex(value=>value+1)}/></div>}
  {failed?<div role="alert"><p>원문이 바뀌었거나 읽을 수 없어요. 메일 목록에서 다시 확인해 주세요.</p><CxButton onClick={()=>setRetry(value=>value+1)}>다시 확인</CxButton></div>:source?<MailReader key={source.id} source={source} api={api} onDocument={onDocument} onAsk={onAsk} onLocalChange={(id,local)=>setSource(current=>current?.id===id?{...current,local}:current)}/>:<p role="status">원문 읽는 중</p>}
 </section>;
}
