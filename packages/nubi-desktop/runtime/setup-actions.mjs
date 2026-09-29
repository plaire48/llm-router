import {randomUUID} from 'node:crypto';
import {fail,hash,readSource} from './files.mjs';
import {shellProfiles} from './processes.mjs';
import Ajv from 'ajv';
import {preferredShell} from './environment-inspection.mjs';

const text = maxLength => ({type:'string',minLength:1,maxLength});
export const SETUP_ACTION_SCHEMA = {
  type:'object',additionalProperties:false,
  properties:{title:text(120),kind:{type:'string',enum:['inspect','install','configure','build','start','verify']},profile:text(40),script:text(16000),reason:text(1000),effects:text(1500),verification:text(1000),
    privilege:{type:'string',enum:['user','administrator']},privilegeReason:text(1000),
    references:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,properties:{path:text(1000),hash:text(100)},required:['path','hash']}}},
  required:['title','kind','script','reason','effects','verification','references']
};

const validate=new Ajv().compile(SETUP_ACTION_SCHEMA);

// Approval is not a shell sandbox. Keep model-described effects and the exact command visible.
export async function prepareSetupAction(service,taskId,args,observations) {
  if(!validate(args))fail('setup_invalid');
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
  const fingerprint=hash(JSON.stringify([taskId,workspace,args]));
  const previous=service.store.list('setup-action:').find(v=>v.fingerprint===fingerprint);
  if(previous)return previous;
  const value={...args,id:randomUUID(),taskId,workspace,fingerprint,state:'proposed',createdAt:new Date().toISOString()};
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
      if((await readSource(value.workspace,ref.path)).hash!==ref.hash)fail('setup_changed');
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
