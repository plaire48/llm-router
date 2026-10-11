const active = worker => ['queued','running'].includes(worker.status);
const stateOf = workers => workers.some(active)?'running':workers.some(worker=>worker.status==='interrupted')?'interrupted':workers.some(worker=>worker.status==='cancelled')?'cancelled':workers.some(worker=>worker.status==='error'||['partial','blocked'].includes(worker.analysis?.outcome))?'partial':'complete';

/** A new run must never revive persisted interrupted work from its retained trace. */
export function mergeRoleHistory(records,task){
  const running=task.state==='running',runId=task.checkpoint?.runId;
  const roleSteps=(task.trace||[]).filter(step=>step.tool?.startsWith('analysis_'));
  const current=step=>running&&typeof runId==='string'&&step.id.startsWith(runId+':');
  const liveWorkers=new Map(roleSteps.filter(current).map(worker=>[worker.id,worker]));
  const merged=records.map(record=>{
    if(!running||record.kind!=='roles'||record.runId!==runId)return record;
    const workers=(record.workers||[]).map(worker=>{
      const live=liveWorkers.get(worker.id);
      if(!live||(!active(worker)&&active(live)))return worker;
      // Current traces can arrive before a history read, or behind it. Missing
      // timestamps do not override persisted facts; runtime events always have at.
      if(!live.at||worker.at&&live.at<worker.at)return worker;
      return {...worker,...live,analysis:{...worker.analysis,...live.analysis}};
    });
    return {...record,workers,state:stateOf(workers)};
  });
  const known=new Set(merged.filter(record=>record.kind==='roles').flatMap(record=>(record.workers||[]).map(worker=>worker.id)));
  const missing=roleSteps.filter(step=>!known.has(step.id)).map(worker=>!current(worker)&&active(worker)?{...worker,status:task.state==='cancelled'?'cancelled':'interrupted',analysis:{...worker.analysis,phase:'finished',delivered:false}}:worker);
  if(missing.length)merged.unshift({kind:'roles',id:'trace',state:stateOf(missing),workers:missing});
  return merged;
}
