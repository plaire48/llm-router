import React,{useState,useEffect,useRef} from 'react';
import {CxButton,CxNotice} from '@e2e/cx-design-system';
import {DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {wikiUpdateView} from './wiki-update-view.mjs';

const errors={wiki_update_conflict:'갱신하는 동안 작업 공간의 페이지가 바뀌어 반영하지 않았어요. 다시 갱신해 주세요.',wiki_update_busy:'이미 갱신 중이에요.',wiki_update_changed:'그 사이 저장소가 바뀌었어요. 상태를 다시 확인해 주세요.',wiki_update_not_needed:'Wiki가 이미 최신이에요.'};

// OpenWiki update: proposed from the status, run on approval in a copy, applied on a second approval.
export function WikiUpdate({api,openPath}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),live=useRef(true);
  const load=async()=>{try{const value=await api('wikiUpdate',{method:'status'});if(live.current)setData(value);}catch(e){if(live.current)setError(errors[e.message]||'Wiki 상태를 확인하지 못했어요.');}};
  useEffect(()=>{live.current=true;load();return()=>{live.current=false;};},[]);
  // The latest update, to show its progress, its result or how it ended.
  const update=data?.updates?.[0]||null;
  // A running update is read again until it ends.
  useEffect(()=>{if(update?.state!=='running')return;const timer=setInterval(load,2000);return()=>clearInterval(timer);},[update?.state]);
  if(!data)return null;
  const view=wikiUpdateView({status:data.status,update});
  const act=async fn=>{if(busy)return;setBusy(true);setError('');try{await fn();await load();}catch(e){setError(errors[e.message]||'갱신 작업을 마치지 못했어요.');await load();}finally{setBusy(false);}};
  const run=()=>act(async()=>{const proposal=await api('wikiUpdate',{method:'propose'});await api('wikiUpdate',{method:'run',id:proposal.id,fingerprint:proposal.fingerprint});});
  return <section className="nubi-recovery-card nubi-wiki-update" aria-label="OpenWiki 갱신">
    <div className="nubi-inline"><strong>{view.title}</strong>{update&&<DeckStatus>{({running:'갱신 중',ready:'반영 대기',applied:'반영됨',failed:'실패',cancelled:'멈춤',discarded:'버림'})[update.state]||''}</DeckStatus>}</div>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    {view.lines.map((line,index)=><p key={index} className={index?'nubi-muted':undefined}>{line}</p>)}
    {view.pages.length>0&&<ul className="nubi-wiki-update-pages">{view.pages.map(page=><li key={page.path}><CxButton className="nubi-link" onClick={()=>openPath?.(page.path)}>{page.path}</CxButton> <small>{page.label}</small></li>)}</ul>}
    <div className="nubi-inline">
      {view.actions.includes('run')&&<CxButton variant="primary" disabled={busy} onClick={run}>갱신 실행</CxButton>}
      {view.actions.includes('cancel')&&<CxButton disabled={busy} onClick={()=>act(()=>api('wikiUpdate',{method:'cancel',id:update.id}))}>중지</CxButton>}
      {view.actions.includes('apply')&&<CxButton variant="primary" disabled={busy} onClick={()=>act(()=>api('wikiUpdate',{method:'apply',id:update.id,fingerprint:update.fingerprint}))}>변경 반영</CxButton>}
      {view.actions.includes('discard')&&<CxButton disabled={busy} onClick={()=>act(()=>api('wikiUpdate',{method:'discard',id:update.id}))}>버리기</CxButton>}
    </div>
  </section>;
}
