const prefix=taskId=>'analysis-history:'+taskId+':';
const active=worker=>['queued','running'].includes(worker.status);
const stateOf=workers=>workers.some(active)?'running':workers.some(w=>w.status==='interrupted')?'interrupted':workers.some(w=>w.status==='cancelled')?'cancelled':workers.some(w=>w.status==='error'||['partial','blocked'].includes(w.analysis?.outcome))?'partial':'complete';

export function saveDocumentProgress(store,record){
  const key=prefix(record.taskId)+'document:'+record.id,previous=store.get(key);
  const now=new Date().toISOString();
  // Never publish source text, model messages or full findings in progress RPCs.
  const {id,runId,state,phase,question,completed,total,workers,sources,coverage,error}=record;
  store.set(key,{kind:'document',id,runId,state,phase,question,completed,total,workers,sources,coverage,error,createdAt:previous?.createdAt||now,updatedAt:now});
}

export function saveRoleProgress(store,taskId,runId,entry){
  if(!/^analysis_(page|research|review|recovery)$/.test(entry.tool))return;
  const key=prefix(taskId)+'roles:'+runId,previous=store.get(key),now=new Date().toISOString();
  const workers=previous?.workers||[],index=workers.findIndex(worker=>worker.id===entry.id);
  const old=index<0?null:workers[index];
  const worker={...old,...entry,analysis:{...old?.analysis,...entry.analysis}};
  if(index<0)workers.push(worker);else workers[index]=worker;
  store.set(key,{kind:'roles',id:runId,taskId,runId,state:stateOf(workers),workers,createdAt:previous?.createdAt||now,updatedAt:now});
}

export function finishRoleProgress(store,taskId,runId,status='interrupted'){
  const key=prefix(taskId)+'roles:'+runId,record=store.get(key);
  if(!record||!record.workers.some(active))return;
  record.workers=record.workers.map(worker=>active(worker)?{...worker,status,analysis:{...worker.analysis,phase:'finished',delivered:false}}:worker);
  record.state=stateOf(record.workers);record.updatedAt=new Date().toISOString();store.set(key,record);
}

export function restoreAnalysisHistory(store){
  // Index retained pre-upgrade document receipts once; responses stay separate.
  for(const record of store.list('document-analysis:')){const indexed=store.get(prefix(record.taskId)+'document:'+record.id);if(!indexed||indexed.state!==record.state)saveDocumentProgress(store,record);}
  for(const record of store.list('analysis-history:').filter(row=>row.kind==='review'&&row.state==='running')){saveReviewProgress(store,record.taskId,{...record,state:'interrupted'});}
  for(const record of store.list('analysis-history:').filter(row=>row.kind==='roles'&&row.state==='running')){
    if(record.taskId)finishRoleProgress(store,record.taskId,record.runId);
  }
}

export function analysisHistory({taskId,before,limit=10,refresh=[]}={}){
  this.ready();this.task(taskId);
  if(!Number.isSafeInteger(limit)||limit<1||limit>20||before!==undefined&&(typeof before!=='string'||!/^\d{1,15}$/.test(before)||Number(before)<1))throw Error('analysis_history_range');
  if(!Array.isArray(refresh)||refresh.length>20||refresh.some(item=>!item||!['document','roles','review'].includes(item.kind)||typeof item.id!=='string'||!item.id.length||item.id.length>200))throw Error('analysis_history_range');
  const updates=refresh.map(item=>this.store.get(prefix(taskId)+item.kind+':'+item.id)).filter(Boolean);
  const key=prefix(taskId),rows=this.store.db.prepare('SELECT rowid,value FROM records WHERE substr(key,1,?)=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(key.length,key,before===undefined?Number.MAX_SAFE_INTEGER:Number(before),limit+1);
  const page=rows.slice(0,limit);
  return {records:page.map(row=>JSON.parse(row.value)),updates,next:rows.length>limit?String(page.at(-1).rowid):null};
}

// Public child handoffs remain advisory and cannot become usable host evidence.
export function roleHandoffs(store,taskId,runId){
  const workers=store.get(prefix(taskId)+'roles:'+runId)?.workers||[];
  // An old unresolved assignment must not disappear behind newer successful
  // responses. Within each class keep original order; never mutate stored work.
  const unresolved=worker=>worker.status!=='done'||worker.analysis?.outcome!=='complete'||worker.analysis?.delivered!==true||!!worker.analysis?.uncertainties?.length;
  const pending=workers.filter(unresolved),settled=workers.filter(worker=>!unresolved(worker));
  const selected=[...pending,...settled.slice(-Math.max(0,12-pending.length))].slice(0,12);
  const items=selected.map(worker=>({id:worker.id,role:worker.tool.replace('analysis_',''),state:worker.status,
    task:worker.analysis?.task||'',doneWhen:worker.analysis?.doneWhen||'',collected:worker.analysis?.delivered===true,
    outcome:worker.analysis?.outcome||'unknown',summary:worker.analysis?.summary||'',uncertainties:worker.analysis?.uncertainties||[],nextStep:worker.analysis?.nextStep||'',error:worker.analysis?.error||null}));
  return {items,omitted:Math.max(0,workers.length-items.length),omittedUnresolved:Math.max(0,pending.length-12)};
}
export function saveReviewProgress(store,taskId,record){
  const key=prefix(taskId)+'review:'+record.id,previous=store.get(key),now=new Date().toISOString();
  const {id,runId,round,state,checks,nextStep,advisoryCount,omittedHandoffs,omittedUnresolvedHandoffs}=record;
  store.set(key,{kind:'review',id,taskId,runId,round,state,checks,nextStep,advisoryCount,omittedHandoffs,omittedUnresolvedHandoffs,createdAt:previous?.createdAt||now,updatedAt:now});
}
