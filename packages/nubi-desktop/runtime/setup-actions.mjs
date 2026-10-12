import {randomUUID} from 'node:crypto';
import {fail,hash,readSource} from './files.mjs';
import {shellProfiles} from './processes.mjs';
import Ajv from 'ajv';
import {preferredShell} from './environment-inspection.mjs';
import {toolArgumentIssues} from '../../../extensions/aipro-chat/tool-validation.js';

const text = maxLength => ({type:'string',minLength:1,maxLength});
export const SETUP_ACTION_SCHEMA = {
  type:'object',additionalProperties:false,
  properties:{title:{...text(120),description:'Short approval card title.'},kind:{type:'string',enum:['inspect','install','configure','build','start','verify'],description:'Use start for running an app/server, verify for tests, inspect for a version check.'},
    profile:{...text(40),description:'Exact availableShells ID from inspect_environment, e.g. powershell, cmd or bash. Omit to use the host default; do not send null.'},
    script:{...text(16000),description:'ONE exact shell command as a string, not an array/object. This field is script, not command. Use the selected shell syntax.'},
    reason:{...text(1000),description:'Why this command is needed, as a string.'},effects:{...text(1500),description:'Downloads, hooks, changes and their scope, as one string, not a list.'},verification:{...text(1000),description:'How its result will be checked, as one string, not an object or list.'},
    privilege:{type:'string',enum:['user','administrator'],description:'Omit for ordinary execution. Administrator requires separate consent.'},privilegeReason:text(1000),
    references:{type:'array',minItems:0,maxItems:10,description:'Copy path/hash pairs from this run\'s inspect_environment.references or read_source results. Never invent a hash. Use [] only when the command is independent of project files, such as an explicit host/version check. If it depends on a project script/configuration, read and reference that file.',items:{type:'object',additionalProperties:false,properties:{path:text(1000),hash:text(100)},required:['path','hash']}}},
  required:['title','kind','script','reason','effects','verification','references']
};

const validate=new Ajv().compile(SETUP_ACTION_SCHEMA);

// Approval is not a shell sandbox. Keep model-described effects and the exact command visible.
export async function prepareSetupAction(service,taskId,args,observations) {
  if(!validate(args))throw Object.assign(Error('setup_invalid'),{details:{issues:toolArgumentIssues(SETUP_ACTION_SCHEMA,args)},actionIssued:false});
  if(service.task(taskId).question)fail('question_pending');
  const profiles=await shellProfiles();args={...args,profile:args.profile||preferredShell(profiles,process.platform,service.shellPreference())};
  if(args.privilege==='administrator'){
    if(process.platform!=='win32'||args.profile!=='powershell')fail('elevation_unavailable');
    if(!args.privilegeReason||args.script.length>3000||args.kind==='start')fail('elevation_command_limit');
  }
  const workspace=await service.target(taskId);
  if(!profiles.some(p=>p.id===args.profile))fail('shell_unavailable');
  const references=new Map(args.references.map(ref=>[ref.path,ref]));
  for(const ref of args.references){
    const inspected=observations?.environment?.get(ref.path);
    if(inspected?.hash===ref.hash)for(const dependency of inspected.dependencies||[])references.set(dependency.path,dependency);
  }
  args={...args,references:[...references.values()]};
  for(const ref of args.references){
    const observed=observations?.files.get(ref.path)?.hash===ref.hash?observations.files.get(ref.path):observations?.environment?.get(ref.path);
    if(!observed||observed.hash!==ref.hash)fail('source_read_required');
    if((await readSource(workspace,ref.path)).hash!==ref.hash)fail('source_stale');
  }
  // A command proposed after file proposals of the same run is meant to run on them, such as a test after its fix
  // (2026-09-30, the command suite): the host holds it until each of them is applied.
  const runId=service.agent?.running&&service.agent.taskId===taskId?service.agent.runId:null;
  const afterProposals=runId?service.store.list('proposal:').filter(p=>p.taskId===taskId&&p.runId===runId&&p.state==='proposed').map(p=>p.id):[];
  const fingerprint=hash(JSON.stringify([taskId,workspace,args]));
  // The same command again: an open one keeps its card and now also waits for this run's fixes; a rejected or
  // uncertain one stays as it is and is never replayed. One whose run finished may run again with a new approval,
  // such as a test after its fix; so may one whose references changed.
  const finished=v=>v.state==='stale'||v.state==='started'&&!['checking','running','stopping'].includes(service.store.get('process:'+v.resultProcessId)?.state);
  const previous=service.store.list('setup-action:').find(v=>v.fingerprint===fingerprint&&!finished(v));
  if(previous?.state==='proposed'&&afterProposals.some(id=>!(previous.afterProposals||[]).includes(id))){
    const merged={...previous,afterProposals:[...new Set([...(previous.afterProposals||[]),...afterProposals])]};
    service.store.set('setup-action:'+previous.id,merged);return merged;
  }
  if(previous)return previous;
  const value={...args,id:randomUUID(),taskId,workspace,fingerprint,state:'proposed',createdAt:new Date().toISOString(),...(afterProposals.length?{afterProposals}:{})};
  service.store.set('setup-action:'+value.id,value);return value;
}

export async function decideSetupAction({id,fingerprint,decision,elevationConsent=false}) {
  const value=this.store.get('setup-action:'+id);
  if(!value||value.fingerprint!==fingerprint||!['approve','reject'].includes(decision))fail('setup_changed');
  if(value.state!=='proposed')return value;
  if(this.computerBusy||this.agent?.running||this.newFileBusy||this.setupBusy||this.task(value.taskId).question)fail('agent_busy');
  if(this.task(value.taskId).state==='cancelled')fail('setup_cancelled');
  if(this.unsettledOperations?.size)fail('tool_unsettled');
  if(decision==='approve'&&value.privilege==='administrator'&&elevationConsent!==true)fail('elevation_approval_required');
  if(decision==='approve'&&(value.afterProposals||[]).some(id=>this.store.get('proposal:'+id)?.state==='proposed'))fail('setup_waiting_for_proposals');
  if(decision==='reject'){
    value.state='rejected';value.decidedAt=new Date().toISOString();this.store.set('setup-action:'+id,value);return value;
  }
  // Reserve synchronously before validation or process creation. A retry reads
  // the receipt; it cannot run the same installation twice.
  value.state='starting';value.decidedAt=new Date().toISOString();this.store.set('setup-action:'+id,value);this.setupBusy=true;
  if(value.privilege==='administrator'){value.elevationConsentAt=value.decidedAt;this.store.set('setup-action:'+id,value);}
  try{
    if(await this.target(value.taskId)!==value.workspace)fail('setup_changed');
    for(const ref of value.references){
      const current=(await readSource(value.workspace,ref.path)).hash;
      // A file changed only by applying a proposal of this task is the change the command is meant to run on.
      if(current!==ref.hash&&!this.store.list('proposal:').some(p=>p.taskId===value.taskId&&p.path===ref.path&&p.state==='applied'&&p.expectedHash===ref.hash&&p.afterHash===current))fail('setup_changed');
    }
    if(this.disposed||this.task(value.taskId).state==='cancelled'||this.task(value.taskId).question)fail('setup_cancelled');
    const process=await this.processes.start({cwd:value.workspace,taskId:value.taskId,script:value.script,profile:value.profile,autoDiagnose:true,setupActionId:value.id,privilege:value.privilege||'user'});
    value.state='started';value.resultProcessId=process.id;
    this.store.set('setup-action:'+id,value);return value;
  }catch(error){
    value.state=error.message==='setup_changed'?'stale':'attention';
    value.error=error.message==='setup_changed'?'setup_changed':'setup_execution_unconfirmed';
    this.store.set('setup-action:'+id,value);throw error;
  }finally{this.setupBusy=false;queueMicrotask(()=>this.drainRecovery?.().catch(()=>{}));}
}
