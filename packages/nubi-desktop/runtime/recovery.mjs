import {processOutputPreview} from './process-output.mjs';
import {randomUUID} from 'node:crypto';
import {recoverModel,createModelCooldown} from '../../../extensions/aipro-chat/model-recovery.js';
import {safeError} from '../../nubi-office/worker/connection-errors.mjs';
import {hash,fail} from './files.mjs';
import {shellProfiles} from './processes.mjs';

export const READ_TOOLS=new Set(['ask_openwiki','inspect_environment','inspect_workspace_changes','read_process_output','read_document_analysis','analyze_documents','list_skill_resources','discover_capabilities','use_skill','read_skill','read_conversation','search_voc','read_voc','computer_checkpoint','read_computer_result','list_computer_apps','inspect_path','code_outline','source_search','read_source','wiki_query','knowledge_query','recovery_snapshot']);
const recoverableProcesses=new Set(['failed','timed_out','interrupted']);
const now=()=>new Date().toISOString();
export const recoveryCode=error=>safeError(error);

// Reuse Nubi's p-retry transport. Only inference is repeated; tool receipts
// already in the transcript are never executed by a transport retry.
export function modelTransport(service,{signal,onRetry,metrics}){
  const cooldown=createModelCooldown();
  // Telemetry reads the model name defensively: it must not add a failure path.
  const modelName=()=>{try{return service.providers.status().model;}catch{return null;}};
  return (messages,tools,childSignal=signal,purpose='actor')=>recoverModel(async ({signal:attemptSignal,activity,attempt})=>{
    const measured=metrics?.beginModel({purpose,attempt,messages,tools,model:modelName()});
    try{const result=await service.providers.complete(messages,tools,attemptSignal,activity,activity);measured?.end(result);return result;}
    catch(error){const code=safeError(error);measured?.fail(code);throw Object.assign(new Error(({network_error:'network',network_timeout:'model_timeout'})[code]||code),{status:error.status,retryAfterMs:error.retryAfterMs});}
  },{signal:childSignal,cooldown,retries:2,...service.recoveryOptions?.model,onRetry});
}

export async function boundedRead(operation,{signal,timeoutMs=30000}){
  if(signal.aborted)throw new Error('cancelled');
  let timer,cancel;
  const interrupt=new Promise((resolve,reject)=>{cancel=()=>reject(new Error('cancelled'));signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>reject(new Error('tool_timeout')),timeoutMs);});
  try{return await Promise.race([Promise.resolve().then(operation),interrupt]);}
  finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}

export function beginOperation(service,taskId,runId,tool,args){
  const item={id:randomUUID(),taskId,runId,tool,state:'started',startedAt:now(),inputHash:hash(JSON.stringify(args)),...(args.path?{path:args.path}:{}),effect:READ_TOOLS.has(tool)?'read':'local_record'};
  service.store.set('operation:'+item.id,item);return item;
}
export function endOperation(service,item,result){
  Object.assign(item,{state:result?.error||result?.ok===false?'failed':'completed',finishedAt:now(),receipt:{...(result?.error?{error:safeError(result.error)}:{}),...(result?.id?{id:result.id}:{}),...(result?.hash?{hash:result.hash}:{}),...(result?.state?{state:result.state}:{})}});
  service.store.set('operation:'+item.id,item);return item;
}

export async function recoverySnapshot({taskId}){
  const task=this.task(taskId),root=await this.target(taskId),proposals=[];
  for(const p of this.store.list('proposal:').filter(p=>p.taskId===taskId).slice(0,30)){
    let disk='unavailable';try{const current=await this.read({taskId,path:p.path,start:1,end:1});disk=current.hash===p.afterHash?'matches_proposal':current.hash===p.expectedHash?'matches_before':'changed';}catch(error){if(p.kind==='create'&&error.code==='ENOENT')disk='absent';}
    proposals.push({id:p.id,path:p.path,kind:p.kind||'edit',state:p.state,disk});
  }
  return {taskId,request:task.request,criteria:task.criteria,workspace:root,checkpoint:task.checkpoint||null,
    operations:this.store.list('operation:').filter(o=>o.taskId===taskId).slice(0,30),proposals,
    processes:this.store.list('process:').filter(p=>p.taskId===taskId).slice(0,10).map(p=>({id:p.id,profile:p.profile,script:p.script,state:p.state,execution:p.execution||'unknown',fault:p.fault,exitCode:p.exitCode,stopReason:p.stopReason,...processOutputPreview(p)})),
    shells:(await shellProfiles()).map(({id,label})=>({id,label})),
    instruction:'Current disk checks and process receipts, not approval or task completion. Failed/interrupted commands may have changed files. Never replay a command automatically. Keep original criteria, inspect current files and correct only unfinished work. Host restart does not prove earlier subprocess exit.'};
}

export function installRecovery(ProjectService){
  ProjectService.prototype.recoverySnapshot=recoverySnapshot;
  ProjectService.prototype.resumeAgent=async function({taskId}){
    const task=this.task(taskId);if(this.computerBusy||this.agent?.running||this.reconciling)fail('agent_busy');if(task.question)fail('question_pending');
    if(!['paused','failed','interrupted'].includes(task.state))fail('recovery_changed');
    this.reconciling=true;
    try{const snapshot=await recoverySnapshot.call(this,{taskId});this.store.set('reconciliation:'+taskId,{...snapshot,at:now()});}
    finally{this.reconciling=false;}
    return this.startAgent({taskId});
  };
  ProjectService.prototype.processFinished=function(record){
    if(!record.autoDiagnose||!(['failed','timed_out'].includes(record.state)||record.state==='completed'&&(record.repairOf||record.setupActionId))||this.disposed)return;
    this.recoveryQueue ||=new Set();this.recoveryQueue.add(record.id);
    record.recoveryState='queued';this.store.set('process:'+record.id,record);
    this.drainRecovery().catch(()=>{});
  };
  ProjectService.prototype.drainRecovery=async function(){
    if(this.computerBusy||this.disposed||this.newFileBusy||this.setupBusy||this.agent?.running||this.reconciling||!this.providers?.status().connected)return;
    for(const id of this.recoveryQueue||[]){
      const record=this.store.get('process:'+id);if(!record){this.recoveryQueue.delete(id);continue;}
      const task=this.task(record.taskId);
      if(task.state==='cancelled'){this.recoveryQueue.delete(id);record.recoveryState='cancelled';this.store.set('process:'+id,record);continue;}
      if(task.question||['pending','connected'].includes(task.computerConnectionRequest?.state))continue;
      this.recoveryQueue.delete(id);record.recoveryState='diagnosing';this.store.set('process:'+id,record);
      try{await this.startAgent({taskId:record.taskId,recoveryProcessId:id});}
      catch{record.recoveryState='attention';this.store.set('process:'+id,record);}
      return;
    }
  };
  ProjectService.prototype.diagnoseProcess=async function({id}){
    const record=this.processes.poll(id);if(!recoverableProcesses.has(record.state))fail('recovery_changed');
    if(this.computerBusy||this.agent?.running||this.task(record.taskId).question)fail('agent_busy');
    if(!this.providers?.status().connected)fail('provider_missing');
    this.recoveryQueue?.delete(id);return this.startAgent({taskId:record.taskId,recoveryProcessId:id});
  };
  ProjectService.prototype.proposeCommandRepair=async function({taskId,processId,profile,script,reason}){
    const process=this.processes.poll(processId);
    if(process.taskId!==taskId||!recoverableProcesses.has(process.state)||typeof script!=='string'||!script.trim()||script.length>16000||typeof reason!=='string'||!reason.trim()||reason.length>1000)fail('repair_invalid');
    if(!(await shellProfiles()).some(p=>p.id===profile))fail('shell_unavailable');
    const fingerprint=hash(JSON.stringify([processId,profile,script]));
    const previous=this.store.list('command-repair:').find(r=>r.fingerprint===fingerprint&&r.state==='proposed');if(previous)return previous;
    const value={id:randomUUID(),taskId,processId,profile,script,reason,workspace:await this.target(taskId),fingerprint,state:'proposed',createdAt:now()};
    this.store.set('command-repair:'+value.id,value);return value;
  };
  ProjectService.prototype.applyCommandRepair=async function({id}){
    const value=this.store.get('command-repair:'+id);if(!value)fail('repair_invalid');
    if(value.state!=='proposed')return value; // A lost response cannot launch twice.
    if(this.computerBusy||this.agent?.running||this.task(value.taskId).question)fail('agent_busy');
    if(this.unsettledOperations?.size)fail('tool_unsettled');
    // Reserve before the first await, including concurrent renderer calls.
    value.state='starting';this.store.set('command-repair:'+id,value);
    try{
      if(await this.target(value.taskId)!==value.workspace)fail('workspace_changed');
      const original=this.processes.poll(value.processId);if(!recoverableProcesses.has(original.state))fail('recovery_changed');
      const process=await this.run({taskId:value.taskId,script:value.script,profile:value.profile,timeoutMs:original.timeoutMs||0,autoDiagnose:true,repairOf:value.processId});
      value.state='started';value.resultProcessId=process.id;this.store.set('command-repair:'+id,value);return value;
    }catch(error){value.state='attention';value.error=safeError(error);this.store.set('command-repair:'+id,value);throw error;}
  };
}
