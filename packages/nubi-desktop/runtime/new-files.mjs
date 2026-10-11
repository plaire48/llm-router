import {lstat,realpath,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {relativeFile,fail,readSource,hash} from './files.mjs';
import {projectRules,validateProjectRules} from './project-rules.mjs';
import {checkCodeQuality,requireCodeQuality} from './code-quality.mjs';
import {summarizeDiff} from './source-edits.mjs';

export async function inspectNewPath(root,rel) {
  relativeFile(rel);
  if(rel.split('/').some(part=>/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('path_scope');
  const target=path.join(root,rel),parent=path.dirname(target);
  let actual;try{actual=await realpath(parent);}catch(error){if(error.code==='ENOENT')fail('parent_missing');throw error;}
  if(actual!==parent)fail('path_scope');
  try{await lstat(target);fail('file_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  return {path:rel,exists:false,parent:path.posix.dirname(rel),hash:'absent',projectRules:await projectRules(root,rel)};
}

export async function proposeNewFile({taskId,path:rel,content,reason='',signal,rulesFingerprint}) {
  this.task(taskId);
  if(typeof content!=='string'||content.includes('\0')||!content.isWellFormed()||Buffer.byteLength(content)>1024*1024)fail('content_limit');
  const root=await this.target(taskId),observed=await inspectNewPath(root,rel);
  await validateProjectRules(root,rel,rulesFingerprint);
  const quality=await checkCodeQuality(rel,'',content,{signal});requireCodeQuality(quality);
  if(signal?.aborted)fail('cancelled');
  await inspectNewPath(root,rel);await validateProjectRules(root,rel,observed.projectRules.fingerprint);
  const previous=this.store.list('proposal:').find(p=>p.taskId===taskId&&p.path===rel&&p.kind==='create'&&p.afterHash===hash(content)&&p.rulesFingerprint===observed.projectRules.fingerprint&&p.state==='proposed');if(previous)return previous;
  const id=randomUUID(),folder=path.join(this.store.directory,'proposals',id);await mkdir(folder,{recursive:true});
  const before=path.join(folder,'before'+path.extname(rel)),after=path.join(folder,'after'+path.extname(rel));
  await writeFile(before,'');await writeFile(after,content);
  const runId=this.agent?.running&&this.agent.taskId===taskId?this.agent.runId:undefined;
  const proposal={id,taskId,path:rel,kind:'create',expectedHash:'absent',afterHash:hash(content),before,after,content,reason:String(reason).slice(0,2000),quality,stats:summarizeDiff('',content),rulesFingerprint:observed.projectRules.fingerprint,state:'proposed',createdAt:new Date().toISOString(),...(runId?{runId}:{})};
  this.store.set('proposal:'+id,proposal);
  // Only the newest proposal of a file can be applied: an older open one of the task is superseded.
  for(const older of this.store.list('proposal:').filter(p=>p.id!==id&&p.taskId===taskId&&p.path===rel&&p.state==='proposed'))this.store.set('proposal:'+older.id,{...older,state:'superseded'});
  return proposal;
}

export async function prepareNewFile(proposal) {
  const root=await this.target(proposal.taskId),uri=pathToFileURL(path.join(root,proposal.path)).href;
  if(proposal.state==='applied'){
    if((await readSource(root,proposal.path)).hash!==proposal.afterHash)fail('applied_changed');
    return {...proposal,uri,alreadyApplied:true};
  }
  if(proposal.state!=='proposed')fail('write_unconfirmed');
  await inspectNewPath(root,proposal.path);await validateProjectRules(root,proposal.path,proposal.rulesFingerprint);
  proposal.quality=await checkCodeQuality(proposal.path,'',proposal.content);requireCodeQuality(proposal.quality);
  this.store.set('proposal:'+proposal.id,proposal);
  return {...proposal,uri,alreadyApplied:false};
}

export async function applyNewFile({proposalId}) {
  const proposal=this.store.get('proposal:'+proposalId);
  if(!proposal||proposal.kind!=='create')fail('proposal_missing');
  if(this.computerBusy||this.agent?.running||this.newFileBusy||this.setupBusy||this.task(proposal.taskId).question)fail('agent_busy');
  if(this.task(proposal.taskId).state==='cancelled')fail('setup_cancelled');
  if(this.unsettledOperations?.size)fail('tool_unsettled');
  if(proposal.state==='applied')return prepareNewFile.call(this,proposal);
  if(proposal.state!=='proposed')fail('write_unconfirmed');
  this.newFileBusy=true;
  try{
    const ready=await prepareNewFile.call(this,proposal),root=await this.target(proposal.taskId);
    if(this.computerBusy||this.disposed||this.task(proposal.taskId).state==='cancelled')fail('setup_cancelled');
    await inspectNewPath(root,proposal.path);await validateProjectRules(root,proposal.path,proposal.rulesFingerprint);
    proposal.state='creating';this.store.set('proposal:'+proposalId,proposal);
    try{await writeFile(path.join(root,proposal.path),proposal.content,{flag:'wx'});}
    catch(error){proposal.state=error.code==='EEXIST'?'conflicted':'attention';this.store.set('proposal:'+proposalId,proposal);fail(error.code==='EEXIST'?'file_exists':'write_unconfirmed');}
    let actual;try{actual=await readSource(root,proposal.path);if(actual.hash!==proposal.afterHash)fail('write_unconfirmed');}
    catch{proposal.state='attention';this.store.set('proposal:'+proposalId,proposal);fail('write_unconfirmed');}
    proposal.state='applied';this.store.set('proposal:'+proposalId,proposal);this.store.event('proposal_applied',{proposalId,hash:actual.hash,kind:'create'});
    return {...proposal,uri:ready.uri};
  }finally{this.newFileBusy=false;queueMicrotask(()=>this.drainRecovery?.().catch(()=>{}));}
}
