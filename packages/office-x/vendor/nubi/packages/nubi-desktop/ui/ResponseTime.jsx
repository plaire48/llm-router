import React,{useEffect,useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {durationLabel} from '../runtime/response-timing.mjs';
export function ResponseTime({timing,label='응답',live=false}){
  const [elapsed,setElapsed]=useState(null);
  const measured=timing?.durationMs??timing?.elapsedMs;
  useEffect(()=>{
    if(!live||!Number.isFinite(measured)){setElapsed(null);return;}
    const received=performance.now();const update=()=>setElapsed(measured+performance.now()-received);
    update();const timer=setInterval(update,1000);return()=>clearInterval(timer);
  },[live,timing?.startedAt,measured]);
  const text=durationLabel(live?(elapsed??measured):timing?.durationMs);
  if(!text)return null;
  return <span className="nubi-response-time" aria-label={`${live?'진행 시간':'소요 시간'} ${text}`} title={live?'현재 실행의 경과 시간':'실행 시작부터 결과 완료까지 걸린 시간'}><Icon name="clock" size={12}/><span>{label?`${label} ${text}`:text}</span></span>;
}
