import React,{useState,useEffect,useRef} from 'react';
import {CxButton,CxNotice,Icon} from '@e2e/cx-design-system';
import {DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {wikiUpdateView} from './wiki-update-view.mjs';
import {ApprovalBar} from './ApprovalBar.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';

const errors={wiki_update_conflict:'갱신하는 동안 작업 공간의 페이지가 바뀌어 반영하지 않았어요. 다시 갱신해 주세요.',wiki_update_busy:'이미 갱신 중이에요.',wiki_update_changed:'그 사이 저장소가 바뀌었어요. 상태를 다시 확인해 주세요.',wiki_update_not_needed:'위키가 이미 최신이에요.'};
const states={running:'갱신 중',ready:'반영 대기',applied:'반영됨',failed:'실패',cancelled:'멈춤',discarded:'버림'};
// What an update sends to the model stays whole; it reads as a note (user decision 2026-09-30).
const MODEL_USE=/^갱신은 로그인한 모델로/;

// OpenWiki update: proposed from the status, run on approval in a copy, applied on a second approval.
// The card (user decision 2026-09-30): a tile and title with the key line, the pages as chips, the progress as a bar,
// and one decision row on the right: 갱신 or 반영 filled, stop and discard as icons.
export function WikiUpdate({api,openPath,initialization,onApplied}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),live=useRef(true),revision=useRef(0);
  const [now,setNow]=useState(Date.now);
  const load=async()=>{const request=++revision.current;try{const value=await api('wikiUpdate',{method:'status'});if(live.current&&request===revision.current){setData(value);setError('');}}catch(e){if(live.current&&request===revision.current)setError(errors[e.message]||'위키 상태를 확인하지 못했어요.');}};
  useEffect(()=>{live.current=true;load();return()=>{live.current=false;revision.current++;};},[api,initialization?.id,initialization?.state,initialization?.finishedAt]);
  // The latest update, to show its progress, its result or how it ended.
  const update=data?.updates?.[0]||null;
  useEffect(()=>{if(update?.state!=='running')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[update?.id,update?.state]);
  // A running update is read again until it ends.
  useEffect(()=>{if(update?.state!=='running')return;const timer=setInterval(load,2000);return()=>clearInterval(timer);},[update?.state]);
  if(!data)return null;
  const view=wikiUpdateView({status:data.status,update,initialization});
  const act=async fn=>{if(busy)return;setBusy(true);setError('');try{await fn();await load();}catch(e){setError(errors[e.message]||'갱신 작업을 마치지 못했어요.');await load();}finally{setBusy(false);}};
  const run=()=>act(async()=>{const proposal=await api('wikiUpdate',{method:'propose'});await api('wikiUpdate',{method:'run',id:proposal.id,fingerprint:proposal.fingerprint});});
  const [lead,...rest]=view.lines,modelUse=rest.find(line=>MODEL_USE.test(line)),notes=rest.filter(line=>line!==modelUse);
  const progress=update?.state==='running'?[...(update.events||[])].reverse().find(event=>event.type==='progress'):null;
  const completed=progress?.stage==='generating'&&progress.total>0?Math.max(0,Math.min(progress.total,progress.index-1)):null;
  const duration=durationLabel(Math.max(0,now-Date.parse(update?.startedAt)));
  const state=update?.state==='running'&&duration?`진행 ${duration}`:update?states[update.state]:data.status?.state==='current'?'최신':data.status?.state==='stale'?'갱신 필요':'';
  const quietCurrent=!update&&data.status?.state==='current';
  return <section className="nubi-recovery-card nubi-wiki-update" aria-label="위키 갱신" data-current={quietCurrent||undefined}>
    <div className="nubi-action-head"><span className="nubi-action-tile" aria-hidden="true"><Icon name={quietCurrent?'check':'bookmark'} size={20}/></span><div><h3>{view.title}</h3>{lead&&<p>{lead}</p>}</div>{state&&!quietCurrent&&<DeckStatus>{state}</DeckStatus>}</div>
    {completed!==null&&<div className="nubi-progress" role="progressbar" aria-label="갱신 진행" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={completed}><span style={{width:`${completed/progress.total*100}%`}}/></div>}
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    {notes.map((line,index)=><p key={index} className="nubi-muted">{line}</p>)}

    {modelUse&&<><p className="nubi-action-note"><Icon name="infoCircle" size={16}/><span>저장소 내용을 현재 모델에 전달해요. 결과 확인 후 반영합니다.</span></p><details className="nubi-wiki-update-detail"><summary>모델 호출과 반영 범위</summary><p>{modelUse}</p></details></>}
    {view.pages.length>0&&<ul className="nubi-page-chips">{view.pages.map(page=><li key={page.path}><CxButton className="nubi-page-chip" title={page.path} onClick={()=>openPath?.(page.path)}><Icon name="file" size={14}/><span>{page.path}</span><span className="nubi-page-change">{page.label}</span></CxButton></li>)}</ul>}
    {view.actions.includes('run')&&<ApprovalBar approveLabel="갱신" approveIcon="refresh" disabled={busy} onApprove={run}/>}
    {view.actions.some(action=>['cancel','discard','apply'].includes(action))&&<div className="nubi-approval-bar">
      {view.actions.includes('cancel')&&<CxButton className="nubi-icon-button" aria-label="위키 갱신 중지" title="위키 갱신 중지" disabled={busy} onClick={()=>act(()=>api('wikiUpdate',{method:'cancel',id:update.id}))}><span className="stop-symbol" aria-hidden="true"/></CxButton>}
      {view.actions.includes('discard')&&<CxButton className="nubi-icon-button" aria-label="버리기" title="갱신 결과 버리기" disabled={busy} onClick={()=>act(()=>api('wikiUpdate',{method:'discard',id:update.id}))}><Icon name="trash" size={18}/></CxButton>}
      {view.actions.includes('apply')&&<CxButton variant="primary" disabled={busy} onClick={()=>act(async()=>{await api('wikiUpdate',{method:'apply',id:update.id,fingerprint:update.fingerprint});await onApplied?.();})}><Icon name="check" size={16}/>반영</CxButton>}
    </div>}
  </section>;
}
