// OpenWiki update, proposed by Desktop and run on approval (user decision 2026-09-29).
//
// The status is read without a model: the source changed since the generation
// record, and the pages whose evidence no longer matches. An approved run
// works in a temporary Git worktree at HEAD, so the workspace changes only
// when the user approves the result, and only under openwiki/. OpenWiki's
// code is not changed: the runner is the one OpenWiki uses for `--update`.
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rm,unlink} from 'node:fs/promises';
import path from 'node:path';
import {git,hash,fail,readSource,scopedFile} from './files.mjs';
import {stalePages} from './wiki-evidence.mjs';
import {OpenWikiIgnore,RepositoryEvidenceResolver,parseRepositoryEvidenceResource} from '../generated/openwiki.mjs';
import {modelTransport} from './recovery.mjs';
import {createRunMetrics} from './run-metrics.mjs';

const WIKI='openwiki/',CLAIMS='openwiki/.claims/',RECORD='openwiki/.last-update.json',KEPT=20,EVENTS=40;
const inWiki=rel=>rel.startsWith(WIKI);
// Source changes that count, as OpenWiki counts them: outside openwiki/ and not in .openwikiignore.
const counted=ignore=>rel=>rel&&!inWiki(rel)&&!ignore.ignores(rel);

export async function wikiUpdateStatus(root){
  let record;
  try{record=JSON.parse((await readSource(root,RECORD)).content);}catch{return {state:'unknown',reason:'no_generation_record'};}
  const lastUpdate={updatedAt:record.updatedAt||null,gitHead:record.gitHead||null,status:record.status||null,language:record.language||null};
  const head=(await git(root,['rev-parse','HEAD'])).trim(),source=counted(await OpenWikiIgnore.load(root));
  let changedFiles=[],reason=null;
  if(!lastUpdate.gitHead)reason='no_base';
  else if(lastUpdate.gitHead!==head){
    try{changedFiles=(await git(root,['diff','--name-only',lastUpdate.gitHead,head])).split('\n').filter(source);}
    catch{reason='unknown_base';}
  }
  if(lastUpdate.status==='interrupted')reason='interrupted';
  const uncommitted=(await git(root,['status','--porcelain','--untracked-files=all'])).split('\n').filter(Boolean).map(line=>line.slice(3).replace(/^"|"$/g,'')).filter(source);
  const pages=await stalePages(root);
  const stale=!!reason||changedFiles.length>0||pages.length>0;
  return {state:stale?'stale':'current',...(reason?{reason}:{}),head,lastUpdate,changedFiles,stalePages:pages,uncommitted};
}

// The model connections reject a response with more than 8 tool calls, or with neither text nor a tool call
// (response_invalid). Measured 2026-09-29 with gpt-5.6-sol: OpenWiki's planner read a repository in parallel and
// asked for more calls; told the limit, it split them. After submit_plan it ended with an empty response; asked
// for a short reply, it wrote one. A rejected response is asked for again with that request, up to twice.
export const CALL_LIMIT={role:'system',content:'Host limit: return at most 8 tool calls in one response. Split larger sets of calls across responses.'};
export const TEXT_REPLY={role:'user',content:'Host note: if no tool call is needed now, reply with one short sentence.'};
const withCallLimit=wire=>{const at=wire.findIndex(message=>message.role!=='system');return at<0?[...wire,CALL_LIMIT]:[...wire.slice(0,at),CALL_LIMIT,...wire.slice(at)];};

// The runner OpenWiki uses for `openwiki --update`, with the model the user logged in to Desktop.
// Model calls are counted under the purpose wiki_update. Only progress facts leave the run:
// stage, page and position, never page text.
export function defaultWikiUpdater(service,{load=()=>import('../generated/openwiki-update/index.mjs')}={}){
  // mode init serves only the evaluation, which generates the Wiki that it then updates.
  return async({root,language,signal,onEvent,updateId,mode='update'})=>{
    const status=service.providers?.status?.();
    if(!status?.connected)fail('model_unavailable');
    const {runNativeRepositoryGeneration,NubiOpenWikiModel,syncBundledSkills}=await load();
    // As `openwiki --update` does: the runner's agents read the skills from the OpenWiki home.
    await syncBundledSkills?.();
    const invoke=modelTransport(service,{signal,metrics:createRunMetrics({store:service.store,taskId:'wiki-update:'+updateId,runId:updateId})});
    const complete=async(wire,tools,options={})=>{
      const request=withCallLimit(wire);
      try{return await invoke(request,tools,options.signal||signal,'wiki_update');}
      catch(error){
        if(error.message!=='response_invalid')throw error;
        try{return await invoke([...request,TEXT_REPLY],tools,options.signal||signal,'wiki_update');}
        catch(again){if(again.message!=='response_invalid')throw again;return invoke([...request,TEXT_REPLY],tools,options.signal||signal,'wiki_update');}
      }
    };
    const model=new NubiOpenWikiModel({complete,signal,modelId:status.model,taskId:null});
    const progress=event=>{if(event?.type==='repository_progress')onEvent({type:'progress',stage:String(event.stage),...(typeof event.page==='string'?{page:event.page.slice(0,300)}:{}),...(Number.isSafeInteger(event.pageIndex)?{index:event.pageIndex}:{}),...(Number.isSafeInteger(event.pageCount)?{total:event.pageCount}:{})});};
    return runNativeRepositoryGeneration({root,mode,language:language||null,modelId:status.model,model,onEvent:progress});
  };
}

// From Git alone, for the host receipts of a run: whether the Wiki is behind its sources.
export async function wikiChangeSummary(root){
  let record;try{record=JSON.parse((await readSource(root,RECORD)).content);}catch{return null;}
  if(record.status==='interrupted')return {state:'stale',reason:'interrupted'};
  const head=(await git(root,['rev-parse','HEAD'])).trim();
  if(!record.gitHead||record.gitHead===head)return null;
  let changed;
  try{changed=(await git(root,['diff','--name-only',record.gitHead,head])).split('\n').filter(counted(await OpenWikiIgnore.load(root)));}catch{return {state:'stale',reason:'unknown_base'};}
  return changed.length?{state:'stale',changedFiles:changed.length,sample:changed.slice(0,8)}:null;
}

const records=service=>service.store.list('wiki-update:').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
const save=(service,value)=>{service.store.set('wiki-update:'+value.id,value);return value;};
const visible=({controller,...value})=>value;

// What a copy holds under openwiki/ that HEAD does not, and what it changed outside.
async function changesOf(copy){
  const lines=(await git(copy,['status','--porcelain','--untracked-files=all'])).split('\n').filter(Boolean);
  const changes=[],outside=[];
  for(const line of lines){
    const code=line.slice(0,2),rel=line.slice(3).replace(/^"|"$/g,'');
    if(!inWiki(rel)){outside.push(rel);continue;}
    changes.push({path:rel,change:code.includes('D')?'deleted':code.includes('?')||code.includes('A')?'added':'modified'});
  }
  return {changes:changes.sort((a,b)=>a.path.localeCompare(b.path)),outside:outside.sort()};
}
// Claims of the result that cite a file outside the Wiki that the run changed, as the part of AGENTS.md that
// OpenWiki manages. That change is not applied, so the evidence is read from the workspace version of the file;
// those that it does not hold are named before the result is applied (measured 2026-09-29: a page became unavailable).
async function outsideEvidence(root,copy,changes,outside){
  if(!outside.length)return [];
  const resolver=new RepositoryEvidenceResolver({rootDir:root}),found=new Map();
  for(const change of changes){
    if(change.change==='deleted'||!change.path.startsWith(CLAIMS)||!change.path.endsWith('.json'))continue;
    let claims;try{claims=JSON.parse(await readFile(path.join(copy,change.path),'utf8'));}catch{continue;}
    for(const claim of claims.claims||[])for(const evidence of claim.evidence||[]){
      let cited;try{cited=parseRepositoryEvidenceResource(evidence.resource).path;}catch{continue;}
      if(!outside.includes(cited))continue;
      let version=null;try{version=(await resolver.resolve(evidence.resource))?.evidence?.version??null;}catch{version=null;}
      if(version===evidence.version)continue;
      const page=WIKI+change.path.slice(CLAIMS.length).replace(/\.json$/,'.md');found.set(page+'\n'+cited,{page,path:cited});
    }
  }
  return [...found.values()].slice(0,20);
}
async function fileHash(root,rel){try{return hash(await readFile(await scopedFile(root,rel)));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function removeCopy(root,copy){
  try{await git(root,['worktree','remove','--force',copy]);}catch{/* Already removed. */}
  await rm(copy,{recursive:true,force:true});
  try{await git(root,['worktree','prune']);}catch{/* Nothing to prune. */}
}

export async function wikiUpdate({method='status',id,fingerprint}={}){
  this.ready();const root=this.root;
  if(method==='status')return {status:await wikiUpdateStatus(root),updates:records(this).slice(0,KEPT).map(visible)};
  if(method==='propose'){
    const status=await wikiUpdateStatus(root);
    if(status.state!=='stale')fail(status.state==='unknown'?'wiki_update_unavailable':'wiki_update_not_needed');
    const value={id:randomUUID(),state:'proposed',createdAt:new Date().toISOString(),status};
    value.fingerprint=hash(JSON.stringify([value.id,status.head,status.changedFiles,status.stalePages]));
    return save(this,value);
  }
  const value=this.store.get('wiki-update:'+id);
  if(!value)fail('wiki_update_missing');
  if(method==='cancel'){this.wikiUpdateRun?.id===id&&this.wikiUpdateRun.controller.abort();return visible(value);}
  if(method==='discard'){
    if(!['ready','proposed'].includes(value.state))fail('wiki_update_state');
    if(value.copy)await removeCopy(root,value.copy);
    return save(this,{...value,state:'discarded',finishedAt:new Date().toISOString()});
  }
  if(method==='run'){
    if(value.state!=='proposed')fail('wiki_update_state');
    if(value.fingerprint!==fingerprint)fail('wiki_update_changed');
    if(this.wikiUpdateRun)fail('wiki_update_busy');
    // The proposal holds what was stale. A moved HEAD is a different update.
    if((await git(root,['rev-parse','HEAD'])).trim()!==value.status.head)fail('wiki_update_changed');
    const copy=path.join(this.store.directory,'wiki-update',value.id);
    await mkdir(path.dirname(copy),{recursive:true});
    await git(root,['worktree','add','--detach',copy,value.status.head]);
    const controller=new AbortController(),events=[];
    this.wikiUpdateRun={id:value.id,controller};
    const running=save(this,{...value,state:'running',copy,startedAt:new Date().toISOString(),events:[]});
    const runner=this.wikiUpdater||defaultWikiUpdater(this);
    const finish=async patch=>{
      const current={...this.store.get('wiki-update:'+value.id),...patch,events:events.slice(-EVENTS),finishedAt:new Date().toISOString()};
      if(!['ready'].includes(current.state))await removeCopy(root,copy);
      save(this,current);this.wikiUpdateRun=null;
    };
    Promise.resolve().then(async()=>{
      const result=await runner({root:copy,language:value.status.lastUpdate.language,signal:controller.signal,updateId:value.id,onEvent:event=>{events.push({...event,at:new Date().toISOString()});}});
      if(controller.signal.aborted)return finish({state:'cancelled'});
      const {changes,outside}=await changesOf(copy);
      // The hashes of the workspace files that the result would replace, as they were when the run started.
      const base={};for(const change of changes)base[change.path]=await fileHash(root,change.path);
      // The runner reports whether preflight proved no generation was needed, and whether the source moved during the run.
      const ready={state:'ready',changes,outside,outsideEvidence:await outsideEvidence(root,copy,changes,outside),base,result:{skipped:result?.skipped===true,...(result?.sourceChanged?{sourceChanged:true}:{})}};
      ready.fingerprint=hash(JSON.stringify([value.id,changes,base]));
      return finish(ready);
    }).catch(error=>finish(controller.signal.aborted?{state:'cancelled'}:{state:'failed',error:/^[a-z_]{3,60}$/.test(error?.message||'')?error.message:'wiki_update_failed'}));
    return visible(running);
  }
  if(method==='apply'){
    if(value.state!=='ready')fail('wiki_update_state');
    if(value.fingerprint!==fingerprint)fail('wiki_update_changed');
    // A page changed in the workspace since the run is the user's: nothing is overwritten.
    for(const change of value.changes)if(await fileHash(root,change.path)!==value.base[change.path])fail('wiki_update_conflict');
    for(const change of value.changes){
      const target=await scopedFile(root,change.path,{newFile:true});
      if(change.change==='deleted'){await unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});continue;}
      await mkdir(path.dirname(target),{recursive:true});
      await writeFile(target,await readFile(path.join(value.copy,change.path)));
    }
    await removeCopy(root,value.copy);
    this.store.event('wiki_update_applied',{id:value.id,files:value.changes.length});
    return save(this,{...value,state:'applied',appliedAt:new Date().toISOString()});
  }
  fail('wiki_update_invalid');
}
