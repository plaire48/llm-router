import React,{useEffect,useRef,useState} from 'react';
import {CxButton, CxInput, DetailPanel, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
export function SavedMailSearches({api,query,filters,sort,onApply,onClose}){
 const [name,setName]=useState(''),[items,setItems]=useState([]),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false);
 const alive=useRef(true),locked=useRef(false);
 async function load(){setLoading(true);setFailed(false);try{const value=await api('mail',{action:'facets'});if(alive.current)setItems(value.saved||[]);}catch{if(alive.current)setFailed(true);}finally{if(alive.current)setLoading(false);}}
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[api]);
 async function save(event){
  event.preventDefault();if(locked.current||loading||!name.trim())return;locked.current=true;setBusy(true);
  try{const value=await api('mail',{action:'saveSearch',name:name.trim(),query,filters,sort:sort==='auto'?(query.trim()?'relevance':'newest'):sort});if(alive.current){setItems(current=>[value,...current.filter(item=>item.id!==value.id)]);setName('');setFailed(false);}notifyWorkspaceToast('검색 조건을 저장했어요.');}
  catch(error){notifyWorkspaceToast(error.message==='mail_search_limit'?'저장한 검색은 100개까지 사용할 수 있어요.':'검색 조건을 저장하지 못했어요.',{error:true});}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 async function remove(item){
  if(locked.current)return;locked.current=true;setBusy(true);
  try{await api('mail',{action:'removeSearch',id:item.id});if(alive.current)setItems(current=>current.filter(value=>value.id!==item.id));notifyWorkspaceToast('저장한 검색을 삭제했어요.');}
  catch{notifyWorkspaceToast('저장한 검색을 삭제하지 못했어요.',{error:true});}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 return <DetailPanel variant="modal" className="deck-dialog nubi-panel nubi-mail-saved-dialog" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon"><Icon name="bookmark" size={18}/></span>저장한 검색</span>} busy={busy} onClose={onClose}>
  <form className="nubi-mail-save-search" onSubmit={save}><CxInput aria-label="검색 이름" placeholder="현재 검색 이름" maxLength={50} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/><ActionButton action="save" iconOnly={false} label="저장" type="submit" disabled={!name.trim()||busy||loading} busy={busy}/></form>
  <p className="nubi-muted">현재 검색어와 조건을 저장해요.</p>
  <div className="nubi-mail-saved-list" aria-busy={loading}>{loading?<p role="status">검색 목록 읽는 중</p>:failed?<div className="nubi-mail-saved-retry"><p>저장한 검색을 읽지 못했어요.</p><ActionButton action="refresh" label="검색 목록 다시 확인" onClick={()=>void load()}/></div>:items.length?items.map(item=><div key={item.id}><CxButton disabled={busy} onClick={()=>{onApply(item);onClose();}}><Icon name="bookmark" size={16}/><span><strong>{item.name}</strong>{item.query&&<small>{item.query}</small>}</span></CxButton><ActionButton action="delete" label={`${item.name} 저장한 검색 삭제`} disabled={busy} onClick={()=>void remove(item)}/></div>):<p className="nubi-muted">저장한 검색이 없어요.</p>}</div>
 </DetailPanel>;
}
