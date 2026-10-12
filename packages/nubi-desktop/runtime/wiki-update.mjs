import {requireWikiGit} from './git-runtime.mjs';
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
import {git,hash,fail,readSource,scopedFile,gitOpenFailure,privatePath} from './files.mjs';
import {wikiSources,wikiFiles,listWikiPages,listWikiSourceFiles,writeWikiSnapshot,initializeWikiSnapshotGit,checkpointSnapshotWiki,readWikiSource,WIKI_CHECKPOINT} from './wiki-snapshot.mjs';
import {stalePages} from './wiki-evidence.mjs';
import {OpenWikiIgnore,RepositoryEvidenceResolver,parseRepositoryEvidenceResource} from '../generated/openwiki.mjs';
import {modelTransport} from './recovery.mjs';
import {createRunMetrics} from './run-metrics.mjs';

const WIKI='openwiki/',CLAIMS='openwiki/.claims/',RECORD='openwiki/.last-update.json',KEPT=20,EVENTS=40;
const inWiki=rel=>rel.startsWith(WIKI);
// Source changes that count, as OpenWiki counts them: outside openwiki/ and not in .openwikiignore.
const counted=ignore=>rel=>rel&&!inWiki(rel)&&!ignore.ignores(rel);
// The rows of `git status`, NUL-separated so that a name with spaces or Korean letters is not quoted and escaped.
// A rename's origin path is skipped.
async function statusPaths(root){
  const records=(await git(root,['status','--porcelain','-z','--untracked-files=all'])).split('\0'),rows=[];
  for(let i=0;i<records.length;i++){const record=records[i];if(!record)continue;const code=record.slice(0,2);rows.push({code,path:record.slice(3)});if(/^[RC]/.test(code))i++;}
  return rows;
}

export async function wikiUpdateStatus(root){
  if(!(await listWikiPages(root)).length)return {state:'unknown',reason:'no_wiki_pages'};
  let record;
  try{record=JSON.parse((await readSource(root,RECORD)).content);}catch{
    record={};
  }
  const lastUpdate={updatedAt:record.updatedAt||null,gitHead:record.gitHead||null,status:record.status||null,language:record.language||null};
  let head=null;try{head=(await git(root,['rev-parse','HEAD'])).trim();}catch(error){if(!['not_git_repository','git_unavailable'].includes(gitOpenFailure(error)))throw error;}
  const source=counted(await OpenWikiIgnore.load(root));
  if(!head||!lastUpdate.gitHead){
    let checkpoint;try{checkpoint=JSON.parse((await readSource(root,WIKI_CHECKPOINT)).content);}catch{}
    const files=await wikiSources(root),current=Object.fromEntries(files.map(file=>[file.path,file.hash]));
    const known=checkpoint?.schemaVersion===1&&checkpoint.files&&typeof checkpoint.files==='object';
    const changedFiles=known?[...new Set([...Object.keys(checkpoint.files),...Object.keys(current)])].filter(rel=>checkpoint.files[rel]!==current[rel]):[];
    const pages=await stalePages(root),reason=record.status==='interrupted'?'interrupted':!known?'no_generation_record':null;
    const uncommitted=head?(await statusPaths(root)).map(row=>row.path).filter(source):[];
    return {state:reason||changedFiles.length||pages.length?'stale':'current',...(reason?{reason}:{}),head,lastUpdate,changedFiles,stalePages:pages,uncommitted,sourceMode:head?'committed':'folder'};
  }
  let changedFiles=[],reason=null;
  if(!lastUpdate.gitHead)reason='no_base';
  else if(lastUpdate.gitHead!==head){
    try{changedFiles=(await git(root,['diff','--name-only',lastUpdate.gitHead,head])).split('\n').filter(source);}
    catch{reason='unknown_base';}
  }
  if(lastUpdate.status==='interrupted')reason='interrupted';
  const uncommitted=(await statusPaths(root)).map(row=>row.path).filter(source);
  // Uncommitted edits reach the Wiki through an update (user decision 2026-10-12), so they count once they differ
  // from the sources the last run read, which the checkpoint names. Without a checkpoint they are only named.
  const checkpoint=await readCheckpoint(root);
  if(checkpoint)for(const rel of await changedSinceCheckpoint(root,checkpoint,uncommitted))if(!changedFiles.includes(rel))changedFiles.push(rel);
  const pages=await stalePages(root);
  const stale=!!reason||changedFiles.length>0||pages.length>0;
  return {state:stale?'stale':'current',...(reason?{reason}:{}),head,lastUpdate,changedFiles,stalePages:pages,uncommitted};
}

// The model connections reject a response with more than 8 tool calls, or with neither text nor a tool call
// (response_invalid). Measured 2026-09-29 with gpt-5.6-sol: OpenWiki's planner read a repository in parallel and
// asked for more calls; told the limit, it split them. After submit_plan it ended with an empty response; asked
// for a short reply, it wrote one. A rejected response is asked for again with that request, up to three more times
// (2026-10-12: three rejections in a row ended a five-minute generation).
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
      const active=service.providers.status();if(!active.connected||active.model!==status.model||active.provider!==status.provider||active.connectionId!==status.connectionId)fail('provider_changed');
      const request=withCallLimit(wire);let attempt=request;
      for(let retry=0;;retry++){
        try{return await invoke(attempt,tools,options.signal||signal,'wiki_update',{retryInvalidResponse:false});}
        catch(error){
          if(error.message==='response_invalid'&&retry<3){attempt=[...request,TEXT_REPLY];continue;}
          // The runner turns a page worker's failure into a skipped page: without this the host saw only an empty Wiki (2026-10-12).
          onEvent?.({type:'model_error',code:/^[a-z_]{3,60}$/.test(error?.message||'')?error.message:'model_failed'});throw error;
        }
      }
    };
    const model=new NubiOpenWikiModel({complete,signal,modelId:status.model,taskId:null});
    const progress=event=>{if(event?.type==='repository_progress')onEvent({type:'progress',stage:String(event.stage),...(typeof event.page==='string'?{page:event.page.slice(0,300)}:{}),...(Number.isSafeInteger(event.pageIndex)?{index:event.pageIndex}:{}),...(Number.isSafeInteger(event.pageCount)?{total:event.pageCount}:{})});};
    return runNativeRepositoryGeneration({root,mode,language:language||null,modelId:status.model,model,onEvent:progress});
  };
}

// The checkpoint of a run names the sources it read (path to hash). Files that differ from it now.
async function readCheckpoint(root){
  let checkpoint;try{checkpoint=JSON.parse((await readSource(root,WIKI_CHECKPOINT)).content);}catch{return null;}
  return checkpoint?.schemaVersion===1&&checkpoint.files&&typeof checkpoint.files==='object'?checkpoint:null;
}
async function changedSinceCheckpoint(root,checkpoint,paths){
  const changed=[];
  for(const rel of paths){let current=null;try{current=(await readSource(root,rel)).hash;}catch{current=null;}if(current!==(checkpoint.files[rel]??null))changed.push(rel);}
  return changed;
}
// Without a model, for the host receipts of a run: whether the Wiki is behind its sources. Commits come from Git;
// uncommitted edits, and the files of a folder without Git, from the checkpoint of the last run (2026-10-12: the
// agent answered from a Wiki the card called stale, and a folder without Git never said so). A folder of more than
// 3,000 files is not hashed at every run.
const SUMMARY_FILE_LIMIT=3000;
export async function wikiChangeSummary(root){
  let record;try{record=JSON.parse((await readSource(root,RECORD)).content);}catch{return null;}
  if(record.status==='interrupted')return {state:'stale',reason:'interrupted'};
  let head=null;try{head=(await git(root,['rev-parse','HEAD'])).trim();}catch(error){if(!['not_git_repository','git_unavailable'].includes(gitOpenFailure(error)))throw error;}
  const source=counted(await OpenWikiIgnore.load(root)),changed=[];
  if(head&&record.gitHead&&record.gitHead!==head){
    try{changed.push(...(await git(root,['diff','--name-only',record.gitHead,head])).split('\n').filter(source));}catch{return {state:'stale',reason:'unknown_base'};}
  }
  const checkpoint=await readCheckpoint(root);
  if(checkpoint){
    let paths;
    if(head)paths=(await statusPaths(root)).map(row=>row.path).filter(source);
    else{const listed=await listWikiSourceFiles(root);paths=listed.truncated?null:[...new Set([...Object.keys(checkpoint.files),...listed.paths.filter(source)])];if(paths&&paths.length>SUMMARY_FILE_LIMIT)paths=null;}
    if(paths)for(const rel of await changedSinceCheckpoint(root,checkpoint,paths))if(!changed.includes(rel))changed.push(rel);
  }
  return changed.length?{state:'stale',changedFiles:changed.length,sample:changed.slice(0,8)}:null;
}

const records=service=>service.store.list('wiki-update:').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
const save=(service,value)=>{service.store.set('wiki-update:'+value.id,value);return value;};
const visible=({controller,...value})=>value;

// What a copy holds under openwiki/ that HEAD does not, and what the runner changed outside. The overlay names the
// working tree's own uncommitted sources in the copy (path to hash, null for a deleted one): those are not the runner's.
async function changesOf(copy,overlay=new Map()){
  const changes=[],outside=[];
  for(const {code,path:rel} of await statusPaths(copy)){
    if(!inWiki(rel)){
      if(overlay.has(rel)){let now=null;try{now=hash(await readFile(path.join(copy,rel)));}catch(error){if(error.code!=='ENOENT')throw error;}if(now===overlay.get(rel))continue;}
      outside.push(rel);continue;
    }
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
  this.ready();const root=this.root,owner=this.store;
  // A run that an app exit or a project switch interrupted is still 'running' in its record, with no controller to
  // reach: it ends here, as a restarted host ends its tasks, and its copy goes (2026-10-12).
  for(const item of records(this).filter(item=>item.state==='running'&&item.id!==this.wikiUpdateRun?.id)){if(item.copy)await removeCopy(root,item.copy);save(this,{...item,state:'failed',error:'wiki_update_interrupted',finishedAt:new Date().toISOString()});}
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
    await requireWikiGit();
    if(value.state!=='proposed')fail('wiki_update_state');
    if(value.fingerprint!==fingerprint)fail('wiki_update_changed');
    if(this.wikiUpdateRun)fail('wiki_update_busy');
    // The proposal holds what was stale. A moved HEAD is a different update.
    if(value.status.head&&(await git(root,['rev-parse','HEAD'])).trim()!==value.status.head)fail('wiki_update_changed');
    const copy=path.join(this.store.directory,'wiki-update',value.id);
    await mkdir(path.dirname(copy),{recursive:true});
    const originalWiki=await wikiFiles(root);
    let folderSources;const overlay=new Map();
    if(value.status.head){
      await git(root,['-c','core.hooksPath='+path.join(copy,'.nubi-no-hooks'),'worktree','add','--detach',copy,value.status.head],{timeout:120000});
      // The copy then holds the sources as the working tree holds them (user decision 2026-10-12): a developer's edits
      // reach the Wiki before a commit, and the status that proposed this update read those same files. A file the
      // snapshot would not read (private, binary, too large) keeps its committed version.
      const ignore=await OpenWikiIgnore.load(root);
      for(const rel of (await statusPaths(root)).map(row=>row.path).filter(counted(ignore)).filter(rel=>!privatePath(rel))){
        let file=null,absent=false;try{file=await readWikiSource(root,rel);}catch(error){if(error.message==='source_stale')absent=true;else if(!['file_too_large','binary_file','file_encoding'].includes(error.message))throw error;}
        if(file){await writeWikiSnapshot(copy,[file]);overlay.set(rel,file.hash);}
        else if(absent){await rm(path.join(copy,rel),{force:true});overlay.set(rel,null);}
      }
      // Files the snapshot never reads (.env, keys, credentials) leave the copy too, as the initialization snapshot leaves them out.
      for(const rel of (await git(copy,['ls-files','-z'])).split('\0').filter(Boolean).filter(privatePath)){await rm(path.join(copy,rel),{force:true});overlay.set(rel,null);}
    }
    else{folderSources=await wikiSources(root);await mkdir(copy,{recursive:true});await writeWikiSnapshot(copy,folderSources);await initializeWikiSnapshotGit(copy);}
    // Newly generated or edited Wiki files may not be committed. Give OpenWiki
    // the current pages and provenance, never an older/empty HEAD copy.
    await rm(path.join(copy,'openwiki'),{recursive:true,force:true});
    await writeWikiSnapshot(copy,originalWiki);
    const controller=new AbortController(),events=[];
    this.wikiUpdateRun={id:value.id,controller};
    const running=save(this,{...value,state:'running',copy,startedAt:new Date().toISOString(),events:[]});
    const runner=this.wikiUpdater||defaultWikiUpdater(this);
    const finish=async patch=>{
      const current={...running,...(owner.db.isOpen?owner.get('wiki-update:'+value.id):{}),...patch,events:events.slice(-EVENTS),finishedAt:new Date().toISOString()};
      if(!['ready'].includes(current.state))await removeCopy(root,copy);
      if(owner.db.isOpen)owner.set('wiki-update:'+value.id,current);if(this.wikiUpdateRun?.id===value.id)this.wikiUpdateRun=null;
    };
    Promise.resolve().then(async()=>{
      const result=await runner({root:copy,language:value.status.lastUpdate.language,signal:controller.signal,updateId:value.id,onEvent:event=>{events.push({...event,at:new Date().toISOString()});}});
      if(controller.signal.aborted||this.store!==owner||this.root!==root)return finish({state:'cancelled'});
      // The checkpoint names the sources this run read; the status reads it for uncommitted edits since.
      if(folderSources)await checkpointSnapshotWiki(copy,folderSources);else await checkpointSnapshotWiki(copy,await wikiSources(copy),{gitHead:value.status.head});
      const {changes,outside}=await changesOf(copy,overlay);
      // Compare with the actual Wiki snapshot, including deletions of pages that
      // were never committed. Capture conflict hashes before the model ran.
      const before=new Map(originalWiki.map(file=>[file.path,file])),after=new Map((await wikiFiles(copy)).map(file=>[file.path,file]));
      changes.length=0;
      for(const rel of new Set([...before.keys(),...after.keys()]))if(before.get(rel)?.hash!==after.get(rel)?.hash)changes.push({path:rel,change:!after.has(rel)?'deleted':!before.has(rel)?'added':'modified'});
      const base={};for(const change of changes)base[change.path]=before.get(change.path)?.hash??null;
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
      let parent=root;for(const segment of change.path.split('/').slice(0,-1)){parent=path.join(parent,segment);await mkdir(parent,{recursive:true});await scopedFile(root,path.relative(root,parent).split(path.sep).join('/'));}
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
