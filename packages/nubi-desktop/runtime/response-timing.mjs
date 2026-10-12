// Durations use a monotonic clock; calendar timestamps are display metadata only.
export function responseTimer(metadata={}){
  const began=performance.now(),startedAt=new Date().toISOString();let finished;
  const snapshot=()=>finished||{...metadata,startedAt,state:'running',elapsedMs:Math.max(0,Math.round(performance.now()-began)),durationMs:null};
  return {snapshot,finish(state='completed'){
    finished ||= {...snapshot(),state,finishedAt:new Date().toISOString(),durationMs:Math.max(0,Math.round(performance.now()-began))};return finished;
  }};
}
export function durationLabel(milliseconds){
  if(!Number.isFinite(milliseconds)||milliseconds<0)return null;
  const seconds=Math.floor(milliseconds/1000);
  if(seconds<60)return `${seconds}초`;
  const minutes=Math.floor(seconds/60),rest=seconds%60;
  return [minutes>=60?`${Math.floor(minutes/60)}시간`:null,minutes%60?`${minutes%60}분`:null,rest?`${rest}초`:null].filter(Boolean).join(' ');
}
