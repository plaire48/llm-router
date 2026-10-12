import React,{useState} from 'react';
import {WorkspaceAction} from './WorkspaceAction.jsx';

const pageSize=10;
export function useSkillPagination(items,key){
  const [position,setPosition]=useState({key,page:1});
  const pages=Math.max(1,Math.ceil(items.length/pageSize));
  const page=position.key===key?Math.min(position.page,pages):1;
  // Clamp the saved position too, so removing the final row cannot resurrect
  // an out-of-range page when the catalog grows again.
  if(position.key!==key||position.page!==page)setPosition({key,page});
  const start=(page-1)*pageSize;
  return {page,pages,total:items.length,start,items:items.slice(start,start+pageSize),go:next=>setPosition({key,page:Math.max(1,Math.min(pages,next))})};
}
export function SkillPagination({pagination:p,label,busy}){
  if(p.pages<=1)return null;
  return <nav className="nubi-skill-pagination" aria-label={`${label} 페이지 이동`}>
    <span role="status" aria-atomic="true">{p.start+1}–{p.start+p.items.length} / {p.total}</span>
    <WorkspaceAction action="previousMedia" iconOnly label={`${label} 이전 페이지`} disabled={busy||p.page===1} onClick={()=>p.go(p.page-1)}/>
    <WorkspaceAction action="nextMedia" iconOnly label={`${label} 다음 페이지`} disabled={busy||p.page===p.pages} onClick={()=>p.go(p.page+1)}/>
  </nav>;
}
