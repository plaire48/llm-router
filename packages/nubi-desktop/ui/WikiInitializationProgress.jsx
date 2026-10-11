import React, {useEffect, useState} from 'react';
import {Icon} from '@e2e/cx-design-system';

const stages={snapshot:'파일 읽기',planning:'구성 분석',replanning:'구성 다시 분석',generating:'문서 작성',finalizing:'문서 검토',publishing:'저장 확인'};
const states={waiting_model:'위키 모델 연결 대기',waiting_source:'위키 프로젝트 선택 대기',completed:'위키 준비 완료',existing:'위키 연결됨',attention:'위키 확인 필요',cancelled:'위키 준비 중지됨'};
function elapsed(start,end){
  const seconds=Math.max(0,Math.floor((end-start)/1000));
  if(seconds<60)return `${seconds}초`;
  if(seconds<3600)return `${Math.floor(seconds/60)}분 ${seconds%60}초`;
  return `${Math.floor(seconds/3600)}시간 ${Math.floor(seconds%3600/60)}분`;
}

// Counts come from the runner. A clock is a duration, never a synthetic percent.
export function WikiInitializationProgress({job, inline=false}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(job?.state!=='running')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[job?.id,job?.state]);
  if(!job)return null;
  const running=job.state==='running',start=Date.parse(job.startedAt),end=Date.parse(job.finishedAt);
  const duration=Number.isFinite(start)?elapsed(start,running?now:Number.isFinite(end)?end:now):null;
  const percent=running&&Number.isFinite(job.percent)?Math.max(0,Math.min(100,job.percent)):null;
  const title=running?`위키 ${stages[job.stage]||'준비 중'}`:states[job.state]||'위키';
  return <div className={`nubi-wiki-initialization${inline?' is-inline':''}`} data-state={job.state}>
    <div className="nubi-wiki-initialization-line">
      {running?<span className="status-spinner" aria-hidden="true"/>:<Icon name={job.state==='attention'?'alertCircle':'bookmark'} size={14}/>}
      <strong role={running?'status':undefined}>{title}</strong>
      {percent!==null&&<span className="nubi-wiki-percent">{percent}%</span>}
      {running&&duration&&<span className="nubi-wiki-elapsed">{duration}</span>}
      {!running&&job.state==='completed'&&<span className="nubi-wiki-elapsed">{job.pages}개 문서{duration?` / ${duration}`:''}</span>}
    </div>
    {!inline&&percent!==null&&<div className="nubi-progress" role="progressbar" aria-label={`${title} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%${job.total>0?` (${job.completed}/${job.total})`:''}`}><span style={{width:`${percent}%`}}/></div>}
    {!inline&&running&&job.total>0&&percent!==null&&<small>{job.completed}/{job.total}{job.stage==='snapshot'?'개 파일':'개 문서'}</small>}
  </div>;
}
