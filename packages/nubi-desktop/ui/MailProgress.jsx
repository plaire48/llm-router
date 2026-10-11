import {ResponseTime} from './ResponseTime.jsx';
import {MailTimestamp} from './MailTimestamp.jsx';
import {WikiInitializationProgress} from './WikiInitializationProgress.jsx';
import React,{useEffect,useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
const stages={connecting:'메일 연결 중',disconnected:'메일 연결 필요',off:'자동 정리 꺼짐',checking:'새 메일 확인 중',attachments:'첨부 읽는 중',organizing:'메일 정리 중',waiting_model:'모델 연결 대기',waiting_agent:'현재 작업 후 정리',queued:'정리 대기',paused:'수집 일시중지',attention:'확인 필요',watching:'새 메일 확인 대기'};
const active=new Set(['connecting','checking','attachments','organizing']);
export function MailProgress({api,wiki}){
  const [status,setStatus]=useState(null),[unavailable,setUnavailable]=useState(false);
  useEffect(()=>{
    let alive=true,pending=false;
    async function refresh(){
      if(pending)return;pending=true;
      try{const value=await api('mail',{action:'status'});if(alive){setStatus(value);setUnavailable(false);}}
      catch{if(alive)setUnavailable(true);}
      finally{pending=false;}
    }
    void refresh();const timer=setInterval(refresh,3000);
    return()=>{alive=false;clearInterval(timer);};
  },[api]);
  const showMail=!!status&&(status.connected||status.connecting||status.counts?.received>0),showWiki=wiki?.state==='running';
  if(!showMail&&!showWiki)return null;
  if(!showMail)return <footer className="desktop-mail-progress" aria-label="위키 백그라운드 상태"><WikiInitializationProgress job={wiki} inline/></footer>;
  const progress=status.progress||{stage:status.connecting?'connecting':!status.connected?'disconnected':!status.autoWiki?'off':status.checking?'checking':status.readingAttachments?'attachments':status.summarizing?'organizing':status.error?'attention':status.watchPaused?'paused':'watching',completed:status.counts?.saved||0,remaining:null,queued:status.counts?.queued||0,attention:(status.counts?.attention||0)+(status.counts?.attachmentAttention||0)};
  // Current controls take precedence over a processing snapshot from before
  // stopping. Collection pause is distinct from turning auto organization off.
  const stage=unavailable?'attention':status.connecting?'connecting':!status.connected?'disconnected':!status.autoWiki?'off':progress.stage;
  const background=status.connected&&status.autoWiki&&!status.watchPaused&&!unavailable;
  const stopped=['off','disconnected','paused'].includes(stage);
  const pending=stopped?progress.queued:progress.remaining??progress.queued;
  const showCounts=progress.completed>0||pending>0||progress.attention>0;
  const next=status.connected&&status.autoWiki&&!status.watchPaused&&status.nextCheckAt&&!active.has(stage)?new Date(status.nextCheckAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):null;
  return <footer className="desktop-mail-progress" aria-label="백그라운드 상태">
    {showWiki&&<WikiInitializationProgress job={wiki} inline/>}
    <span className="nubi-mail-progress-state" role="status">{active.has(stage)||(background&&stage==='watching')?<span className={`status-spinner${stage==='watching'?' nubi-mail-watching-spinner':''}`} aria-hidden="true"/>:<Icon name={stage==='attention'?'alertCircle':'mail'} size={14}/>}<strong>{background?'백그라운드 / ':''}{unavailable?'상태 확인 중':stages[stage]||'메일 처리 중'}</strong></span>
    {showCounts&&<span className="nubi-mail-progress-counts">{progress.completed>0&&<span>완료 <b>{progress.completed}</b></span>}{pending>0&&<span>{stopped?'보류':progress.remaining==null?'정리 대기':'남음'} <b>{pending}</b></span>}{progress.attention>0&&<span>확인 필요 <b>{progress.attention}</b></span>}</span>}
    {!stopped&&progress.timing&&<ResponseTime timing={progress.timing} label={progress.timing.kind==='saving'?'저장':'정리'} live/>}
    {!stopped&&progress.attachment&&<span className="nubi-mail-progress-attachment">첨부 {progress.attachment.completed}/{progress.attachment.total}</span>}
    <MailTimestamp at={progress.lastAppliedAt}/>
    {next&&<span className="nubi-mail-progress-next">다음 확인 {next}</span>}
  </footer>;
}
