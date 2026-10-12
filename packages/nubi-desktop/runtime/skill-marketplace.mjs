import path from 'node:path';
import {mkdir,writeFile,rename,rm,lstat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {readSkillPackage,skillDirectory,verifyInstalled,skillRelativePath,skillPackageHash} from './skill-import.mjs';
import {skillCatalog,parseSkill,MAX_SKILLS} from './agent-capabilities.mjs';
import {hash,fail} from './files.mjs';

export const MARKETPLACE={repository:'https://code.sdsdev.co.kr/Manufacturing-IT/ai_workspace',branch:'main',website:'https://code.sdsdev.co.kr/pages/Manufacturing-IT/ai_workspace'};
const API='https://code.sdsdev.co.kr/api/v3/repos/Manufacturing-IT/ai_workspace';
const NAME=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*))?$/;
const validName=name=>typeof name==='string'&&name.length<=64&&NAME.test(name);
const validVersion=value=>typeof value==='string'&&value.length<=48&&VERSION.test(value);
// Version ordering follows the existing team marketplace, including prereleases.
export function compareVersions(a,b) {
  if(!validVersion(a)||!validVersion(b))fail('marketplace_version');
  const aa=a.match(VERSION),bb=b.match(VERSION);
  for(let i=1;i<=3;i++){const x=BigInt(aa[i]),y=BigInt(bb[i]);if(x!==y)return x>y?1:-1;}
  if(!aa[4]||!bb[4])return aa[4]===bb[4]?0:aa[4]?-1:1;
  const x=aa[4].split('.'),y=bb[4].split('.');
  for(let i=0;i<Math.max(x.length,y.length);i++){
    if(x[i]===y[i])continue;if(x[i]===undefined)return -1;if(y[i]===undefined)return 1;
    const xn=/^\d+$/.test(x[i]),yn=/^\d+$/.test(y[i]);
    return xn&&yn?(BigInt(x[i])>BigInt(y[i])?1:-1):xn!==yn?(xn?-1:1):x[i]>y[i]?1:-1;
  }return 0;
}

// Fixed GHES origin only. Auth remains in worker memory and never enters a catalog,
// model prompt, URL, log or project file. No plugin code/hooks/MCP are executed.
export function ghesMarketplaceReader(token,fetcher=fetch,{signal}={}){
  async function json(route,max=12*1024*1024){
    if(!token)fail('ghes_login_required');
    if(signal?.aborted)fail('marketplace_auth');
    let response;
    try{response=await fetcher(API+route,{headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})},redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])])});}catch{fail(signal?.aborted?'marketplace_auth':'marketplace_network');}
    if(signal?.aborted)fail('marketplace_auth');
    if(response.status===401)fail('ghes_session_expired');
    if(response.status===403&&response.headers.get('x-github-sso'))fail('ghes_sso_required');
    if(response.status===429||response.status===403&&response.headers.get('x-ratelimit-remaining')==='0')fail('ghes_rate_limited');
    if(response.status===403)fail('ghes_permission');
    if(response.status===404)fail('marketplace_missing');
    if(!response.ok)fail('marketplace_network');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>max)fail('marketplace_limit');chunks.push(Buffer.from(chunk));}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('marketplace_invalid');}
  }
  return {
    async tree(){const commit=await json('/commits/main',1024*1024);if(!/^[a-f0-9]{40}$/.test(commit.sha)||!/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha))fail('marketplace_invalid');const tree=await json('/git/trees/'+commit.commit.tree.sha+'?recursive=1');if(tree.truncated||!Array.isArray(tree.tree)||tree.tree.length>20000)fail('marketplace_limit');return {commit:commit.sha,files:tree.tree};},
    async blob(entry){if(!/^[a-f0-9]{40}$/.test(entry.sha)||entry.size>10*1024*1024)fail('marketplace_limit');const item=await json('/git/blobs/'+entry.sha,15*1024*1024);if(item.encoding!=='base64'||typeof item.content!=='string')fail('marketplace_invalid');const bytes=Buffer.from(item.content.replace(/\s/g,''),'base64');const digest=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');if(digest!==entry.sha||bytes.length!==entry.size)fail('marketplace_changed');return bytes;}
  };
}

async function catalog(reader){
  const tree=await reader.tree();if(!/^[a-f0-9]{40}$/.test(tree.commit)||!Array.isArray(tree.files))fail('marketplace_invalid');
  const files=new Map(tree.files.filter(f=>f.type==='blob').map(f=>[f.path,f]));
  const blobs=new Map();
  const read=async file=>{const entry=files.get(file);if(!entry||entry.mode!=='100644'&&entry.mode!=='100755')fail('marketplace_invalid');if(!blobs.has(entry.sha))blobs.set(entry.sha,reader.blob(entry).catch(error=>{blobs.delete(entry.sha);throw error;}));return blobs.get(entry.sha);};
  const readJson=async file=>{try{return JSON.parse((await read(file)).toString('utf8'));}catch(e){if(e.message.startsWith('marketplace_'))throw e;fail('marketplace_invalid');}};
  const plugins=new Map(),issues=[];
  for(const file of ['.agents/plugins/marketplace.json','.claude-plugin/marketplace.json']){
    if(!files.has(file))continue;
    const document=await readJson(file);if(document.name!=='ai-workspace'||!Array.isArray(document.plugins)||document.plugins.length>200)fail('marketplace_invalid');
    for(const item of document.plugins){
      const source=typeof item.source==='string'?item.source:item.source?.source==='local'?item.source.path:null;
      if(!validName(item.name)||source!==`./plugins/${item.name}`){issues.push({name:typeof item.name==='string'?item.name:'알 수 없는 플러그인',error:'marketplace_source'});continue;}
      plugins.set(item.name,{...plugins.get(item.name),...item});
    }
  }
  if(!plugins.size&&!issues.length)fail('marketplace_missing');
  const items=[];
  const entries=[...plugins.values()];
  for(let offset=0;offset<entries.length;offset+=4)await Promise.all(entries.slice(offset,offset+4).map(async plugin=>{
    const base='plugins/'+plugin.name;
    try{
      const manifestPath=['.codex-plugin/plugin.json','.claude-plugin/plugin.json','plugin.json'].map(p=>base+'/'+p).find(p=>files.has(p));
      const manifest=manifestPath?await readJson(manifestPath):plugin;
      if(manifest.name!==plugin.name||!validVersion(manifest.version)||plugin.version&&plugin.version!==manifest.version)fail('marketplace_version');
      for(const other of ['.codex-plugin/plugin.json','.claude-plugin/plugin.json','plugin.json'].map(p=>base+'/'+p).filter(p=>files.has(p)&&p!==manifestPath)){const m=await readJson(other);if(m.name!==plugin.name||m.version!==manifest.version)fail('marketplace_version');}
      const title=manifest.interface?.displayName||manifest.displayName||plugin.displayName||plugin.name,description=manifest.description||plugin.description||'';
      if(typeof title!=='string'||title.length>200||typeof description!=='string'||description.length>2000)fail('marketplace_invalid');
      const roots=[...files.keys()].filter(p=>p.startsWith(base+'/skills/')&&/^plugins\/[^/]+\/skills\/[^/]+\/SKILL\.md$/.test(p));
      if(!roots.length)fail('marketplace_no_skills');
      for(const entry of roots){const name=entry.split('/')[3];if(!validName(name)||files.get(entry).size>32768)fail('marketplace_invalid');const metadata=parseSkill((await read(entry)).toString('utf8'),name);items.push({id:plugin.name+'/'+name,name,plugin:plugin.name,title:roots.length===1?title:name,description:metadata.description||description,version:manifest.version,prefix:entry.slice(0,-8),commit:tree.commit});}
    }catch(error){issues.push({name:plugin.name,error:error.message});}
  }));
  items.sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  if(items.length>MAX_SKILLS)fail('marketplace_limit');
  return {items,issues,files,read,commit:tree.commit};
}

export const packetHash=skillPackageHash;
const key=(root,name)=>'nubi-marketplace-skill:'+hash(root)+':'+name;
async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function safeTarget(root,name){
  let target=root;for(const part of ['.nubi','skill',name]){target=path.join(target,part);try{const info=await lstat(target);if(info.isSymbolicLink())fail('marketplace_modified');}catch(e){if(e.code!=='ENOENT')throw e;}}return target;
}
async function installedState(service,root){
  const records=service.store.list('nubi-marketplace-skill:'+hash(root)+':');
  const items=[];
  for(const record of records){
    if(record.state==='removed')continue;
    let state=record.state;
    try{const packet=await readSkillPackage(await safeTarget(root,record.name));if(packetHash(packet)!==record.hash&&state==='installed')state='modified';}catch{state=state==='installed'?'missing':state;}
    items.push({...record,state});
  }
  return items;
}

export async function skillMarketplace({operation='status',taskId,id,expectedCommit,expectedVersion}={}){
  this.ready();if(taskId)this.task(taskId);const root=this.root;
  if(!['status','refresh','install','remove','reconcile'].includes(operation))fail('input_invalid');
  const response=async()=>{
    const installed=await installedState(this,root),local=await skillCatalog(root),cache=this.marketplaceCatalog;
    const credentialsReady=!!(this.marketplaceToken||this.marketplaceReader);
    return {source:MARKETPLACE,connected:!!this.marketplaceConnected,credentialsReady,loginRequired:!credentialsReady||!!this.marketplaceAuthRequired,checkedAt:cache?.checkedAt,issues:cache?.issues||[],installed,
      items:(cache?.items||[]).map(item=>{const own=installed.find(i=>i.name===item.name),collision=own&&own.id!==item.id||local.skills.some(i=>i.name===item.name)&&!own;return {...item,state:collision?'conflict':own?.state||'available',installedVersion:own?.version,updateAvailable:own?.state==='installed'&&compareVersions(item.version,own.version)>0};})};
  };
  if(operation==='status')return await response();
  if(['refresh','install'].includes(operation)&&(!(this.marketplaceToken||this.marketplaceReader)||this.marketplaceAuthRequired))fail('ghes_login_required');
  if(this.skillImportBusy||this.agent?.running||this.unsettledOperations?.size)fail('agent_busy');
  this.skillImportBusy=true;let staging;
  const connectionRevision=this.marketplaceRevision||0;
  try{
    if(operation==='refresh'){
      const reader=this.marketplaceReader||ghesMarketplaceReader(this.marketplaceToken,fetch,{signal:this.marketplaceController?.signal});
      const current=()=>{if(connectionRevision!==(this.marketplaceRevision||0)||this.disposed)fail('marketplace_auth');};
      const guarded=Object.fromEntries(['tree','blob'].map(method=>[method,async(...args)=>{current();const result=await reader[method](...args);current();return result;}]));
      const next=await catalog(guarded);
      if(connectionRevision!==(this.marketplaceRevision||0))fail('marketplace_auth');
      this.marketplaceConnected=true;this.marketplaceCatalog={...next,checkedAt:new Date().toISOString()};return await response();
    }
    const record=this.store.list('nubi-marketplace-skill:'+hash(root)+':').find(r=>r.id===id&&r.state!=='removed');
    if(operation==='reconcile'){
      if(!record||!['installing','attention','removing'].includes(record.state))fail('marketplace_reconcile');
      const target=await safeTarget(root,record.name);
      if(await exists(target)){const actual=packetHash(await readSkillPackage(target));if(actual!==record.hash)fail('marketplace_reconcile');this.store.set(key(root,record.name),{...record,state:'installed'});}
      else if(record.state==='removing'&&record.backup&&packetHash(await readSkillPackage(await safeTarget(root,record.backup)))===record.hash)this.store.set(key(root,record.name),{...record,state:'removed',removedAt:new Date().toISOString()});
      else fail('marketplace_reconcile');
      return await response();
    }
    if(operation==='remove'){
      if(!record||record.state!=='installed')fail('marketplace_reconcile');
      const parent=await skillDirectory(root,'.nubi/skill'),target=path.join(parent,record.name),packet=await readSkillPackage(target);
      if(packetHash(packet)!==record.hash)fail('marketplace_modified');
      const backup='.removed-'+randomUUID();
      this.store.set(key(root,record.name),{...record,state:'removing',backup});
      await rename(target,path.join(parent,backup));
      if(await exists(target))fail('marketplace_changed');
      this.store.set(key(root,record.name),{...record,state:'removed',backup,removedAt:new Date().toISOString()});
      return await response();
    }
    const cache=this.marketplaceCatalog,item=cache?.items.find(i=>i.id===id);
    if(!item||item.commit!==expectedCommit||item.version!==expectedVersion)fail('marketplace_changed');
    const old=this.store.get(key(root,item.name));
    if(old&&old.state!=='removed'&&(old.id!==id||old.state!=='installed'))fail('marketplace_reconcile');
    if(old?.state==='installed'&&compareVersions(item.version,old.version)<0)fail('marketplace_version');
    const parent=await skillDirectory(root,'.nubi/skill'),target=path.join(parent,item.name);
    const present=await exists(target);
    if(present){if(old?.state!=='installed')fail('skill_exists');if(packetHash(await readSkillPackage(target))!==old.hash)fail('marketplace_modified');}
    else if(old?.state==='installed')fail('marketplace_reconcile');
    const local=await skillCatalog(root);if(!present&&(local.truncated||local.capacityUsed>=MAX_SKILLS))fail('skill_catalog_full');
    staging=path.join(parent,'.pending-'+randomUUID());await mkdir(staging);
    const resources=[...cache.files.values()].filter(f=>f.path.startsWith(item.prefix));
    if(!resources.length||resources.length>1000)fail('marketplace_limit');let total=0;
    const aliases=new Map();
    for(const resource of resources){const rel=skillRelativePath(resource.path.slice(item.prefix.length)),parts=rel.split('/');for(let i=1;i<=parts.length;i++){const raw=parts.slice(0,i).join('/'),alias=raw.normalize('NFC').toLowerCase();if(aliases.has(alias)&&aliases.get(alias)!==raw)fail('skill_import_duplicate');aliases.set(alias,raw);}}
    for(const resource of resources){const rel=skillRelativePath(resource.path.slice(item.prefix.length));if(resource.mode!=='100644'&&resource.mode!=='100755'||resource.size>10*1024*1024||(total+=resource.size)>20*1024*1024)fail('marketplace_limit');const bytes=await cache.read(resource.path);await mkdir(path.dirname(path.join(staging,rel)),{recursive:true});await writeFile(path.join(staging,rel),bytes,{flag:'wx',mode:0o600});}
    const packet=await readSkillPackage(staging);if(packet.metadata.name!==item.name)fail('marketplace_invalid');
    const nextHash=packetHash(packet);
    if(old?.state==='installed'&&old.version===item.version){if(old.hash!==nextHash)fail('marketplace_version_changed');return await response();}
    await skillDirectory(root,'.nubi/skill');
    if(present&&packetHash(await readSkillPackage(target))!==old.hash||!present&&await exists(target))fail('marketplace_modified');
    if(this.disposed)fail('marketplace_changed');
    if(connectionRevision!==(this.marketplaceRevision||0))fail('marketplace_auth');
    const backup=present?'.previous-'+randomUUID():null;
    const next={id,name:item.name,title:item.title,version:item.version,commit:item.commit,hash:nextHash,installedAt:new Date().toISOString(),state:'installing',backup,previous:old?.state==='installed'?{version:old.version,hash:old.hash}:null};
    this.store.set(key(root,item.name),next);
    if(present)await rename(target,path.join(parent,backup));
    try{await rename(staging,target);staging=null;await verifyInstalled(target,packet);}catch(error){this.store.set(key(root,item.name),{...next,state:'attention'});if(backup&&!await exists(target))await rename(path.join(parent,backup),target);throw error;}
    this.store.set(key(root,item.name),{...next,state:'installed'});return await response();
  }catch(error){
    if(connectionRevision===(this.marketplaceRevision||0)&&!this.disposed&&['marketplace_auth','ghes_login_required','ghes_session_expired','ghes_sso_required'].includes(error.message)){this.marketplaceConnected=false;this.marketplaceAuthRequired=true;}
    throw error;
  }finally{try{if(staging)await rm(staging,{recursive:true,force:true});}finally{this.skillImportBusy=false;}}
}

export function connectSkillMarketplace({token}={}){if(typeof token!=='string'||!token.trim()||token.length>4096||/[\r\n]/.test(token))fail('input_invalid');if(this.marketplaceToken!==token.trim()){this.marketplaceController?.abort();this.marketplaceController=new AbortController();this.marketplaceRevision=(this.marketplaceRevision||0)+1;this.marketplaceToken=token.trim();this.marketplaceConnected=false;this.marketplaceCatalog=null;}this.marketplaceAuthRequired=false;return {credentialsReady:true};}
export function disconnectSkillMarketplace(){this.marketplaceController?.abort();this.marketplaceRevision=(this.marketplaceRevision||0)+1;this.marketplaceToken=null;this.marketplaceConnected=false;this.marketplaceAuthRequired=false;this.marketplaceCatalog=null;return {connected:false,credentialsReady:false,loginRequired:true};}
