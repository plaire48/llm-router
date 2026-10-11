import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,SearchInput,Icon} from '@e2e/cx-design-system';
import {groupSessionsByDate} from './session-navigation.mjs';
import {ConversationTime} from './ConversationTime.jsx';
import {highlightParts} from './conversation-search.mjs';
export function SearchHighlight({text,query}){return highlightParts(text,query).map((part,index)=>part.match?<mark key={index}>{part.text}</mark>:<React.Fragment key={index}>{part.text}</React.Fragment>);}
export function ConversationSearch({api,projectId,taskId,busy,onSelect}){
 const [query,setQuery]=useState(''),[page,setPage]=useState({items:[],total:0,hasMore:false}),[loading,setLoading]=useState(true),[error,setError]=useState(false),[revision,setRevision]=useState(0),sequence=useRef(0);
 useEffect(()=>{let active=true;const run=++sequence.current;setLoading(true);setError(false);setPage({items:[],total:0,hasMore:false});const timer=setTimeout(async()=>{try{const result=await api('conversationHistory',{query});if(active&&run===sequence.current)setPage(result);}catch{if(active)setError(true);}finally{if(active)setLoading(false);}},query?120:0);return()=>{active=false;sequence.current++;clearTimeout(timer);};},[api,projectId,query,revision]);
 async function more(){const run=sequence.current;setLoading(true);try{const result=await api('conversationHistory',{query,offset:page.items.length});if(run===sequence.current)setPage(previous=>({...result,items:[...previous.items,...result.items]}));}catch{if(run===sequence.current)setError(true);}finally{if(run===sequence.current)setLoading(false);}}
 return <>
  <div className="nubi-history-toolbar"><SearchInput><CxInput id="nubi-conversation-search" type="search" aria-label="대화 검색" placeholder="제목과 대화 내용 검색" value={query} onChange={event=>setQuery(event.target.value)}/></SearchInput></div>
  <div className="nubi-history-search-status" role="status">{error?'검색하지 못했어요':loading?'검색 중':query?`${page.total}개 대화`:'현재 공간의 모든 대화'}</div>
  {error&&<CxButton onClick={()=>setRevision(value=>value+1)}><Icon name="refresh" size={18}/>다시 검색</CxButton>}
  <div role="group" aria-label="저장된 대화" aria-busy={loading}>{groupSessionsByDate(page.items).map(group=><section className="nubi-history-date" key={group.key} aria-label={`${group.label} 대화`}><h3>{group.label}</h3>{group.tasks.map(item=><div className="nubi-history-row" key={item.id}><CxButton className="nubi-history-item" title={item.request} aria-current={item.id===taskId?'true':undefined} disabled={busy} onClick={()=>onSelect(item.id)}><span className="nubi-history-heading"><Icon name="message" size={18}/><strong><SearchHighlight text={item.request} query={query}/></strong><span className="nubi-history-meta"><ConversationTime task={item}/></span></span>{item.match&&<span className="nubi-history-excerpt" title={item.match.snippet}><span className="nubi-history-speaker">{item.match.role==='assistant'?'AI':'나'}</span><span><SearchHighlight text={item.match.snippet} query={query}/></span></span>}</CxButton></div>)}</section>)}</div>
  {!loading&&!error&&!page.items.length&&<p className="nubi-muted">{query?'검색 결과가 없어요':'아직 대화가 없어요'}</p>}
  {page.hasMore&&<CxButton disabled={loading} onClick={more}>더 보기</CxButton>}
 </>;
}
