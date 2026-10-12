const {createHash,randomUUID}=require('node:crypto');
const {readdir,lstat,readFile,mkdir,writeFile,realpath}=require('node:fs/promises');
const path=require('node:path');
const REPOSITORY='Manufacturing-IT/nuri',API='/api/v3/repos/'+REPOSITORY,ORIGIN='https://code.sdsdev.co.kr';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/,VERSION=/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const LOGIN=/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const MAX_BYTES=20*1024*1024,MAX_FILES=500;
const fail=code=>{throw Error(code);},digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePath=value=>typeof value==='string'&&value.length<=400&&!/[\\:\x00-\x1f<>"|?*]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('.')&&!/[. ]$/.test(part)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const nextVersion=(a,b)=>a.split('.').some((v,i)=>+v!==+b.split('.')[i])&&a.split('.').reduce((result,v,i)=>result||Math.sign(+v-+b.split('.')[i]),0)>0;
function fields(value){
 if(!value||!['code','personal'].includes(value.mode)||!VERSION.test(value.version||''))fail('wiki_share_fields');
 const title=typeof value.title==='string'?value.title.trim():'',description=typeof value.description==='string'?value.description.trim():'';
 if(!title||title.length>100||!description||description.length>500)fail('wiki_share_fields');
 if(value.managers!==undefined&&!Array.isArray(value.managers))fail('wiki_share_fields');
 const managers=[...new Set(value.managers||[])];if(managers.length>10||managers.some(name=>!LOGIN.test(name)))fail('wiki_share_fields');
 return {title,description,mode:value.mode,version:value.version,managers};
}
function catalog(document){
 if(document?.schemaVersion!==1||!Array.isArray(document.items)||document.items.length>2000)fail('wiki_share_invalid');
 const ids=new Set();for(const item of document.items){fields(item);if(!UUID.test(item.id)||ids.has(item.id)||!LOGIN.test(item.createdBy)||!LOGIN.test(item.updatedBy)||!Number.isFinite(Date.parse(item.createdAt))||!Number.isFinite(Date.parse(item.updatedAt))||!Array.isArray(item.releases)||!item.releases.length||item.releases.length>200)fail('wiki_share_invalid');ids.add(item.id);const versions=new Set();for(const r of item.releases){if(!VERSION.test(r.version)||versions.has(r.version)||!HASH.test(r.hash)||!LOGIN.test(r.createdBy)||!Number.isFinite(Date.parse(r.createdAt)))fail('wiki_share_invalid');versions.add(r.version);}if(!versions.has(item.version))fail('wiki_share_invalid');}
 return document;
}
function canEdit(item,actor,permissions){return !!permissions.push&&(!item||permissions.admin||item.createdBy===actor||item.managers.includes(actor));}
async function collectWiki(directory){
 const root=await realpath(directory),files=[];let total=0,visited=0;
 async function walk(relative=''){
  const entries=await readdir(path.join(root,relative),{withFileTypes:true});
  for(const entry of entries){if(++visited>10000)fail('wiki_share_limit');if(entry.name.startsWith('.')||['node_modules','raw','cache','secrets','credentials'].includes(entry.name))continue;
   const name=relative?relative+'/'+entry.name:entry.name;if(!safePath(name))continue;const file=path.join(root,name),stat=await lstat(file);
   if(stat.isSymbolicLink())fail('wiki_share_symlink');
   if(stat.isDirectory())await walk(name);
   else if(stat.isFile()&&/\.md$/i.test(name)){if(stat.size>2*1024*1024||(total+=stat.size)>MAX_BYTES||files.length>=MAX_FILES)fail('wiki_share_limit');const bytes=await readFile(file);let content;try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('wiki_share_encoding');}if(content.includes('\0'))fail('wiki_share_encoding');files.push({path:name,content,size:bytes.length,hash:digest(bytes)});}
  }
 }
 await walk();const aliases=new Set();for(const file of files){const key=file.path.normalize('NFC').toLowerCase();if(aliases.has(key))fail('wiki_share_invalid');aliases.add(key);}
 if(!files.length)fail('wiki_share_empty');files.sort((a,b)=>a.path.localeCompare(b.path));return {files,root};
}
class WikiRepository{
 constructor({account,confirmSave=async()=>false,now=()=>new Date().toISOString()}){this.account=account;this.confirmSave=confirmSave;this.now=now;this.staged=new Map();this.busy=false;this.progress=null;}
 async session(){const credential=await this.account.credential();const active=()=>{if(credential.generation!==this.account.generation||this.account.state!=='connected')fail('ghes_session_changed');};
  const request=async(route,{method='GET',body}={})=>{active();let response;try{response=await this.account.fetcher(ORIGIN+route,{method,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.any([this.account.accessController.signal,AbortSignal.timeout(30000)]),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+credential.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}catch{active();fail('wiki_share_network');}active();
   if(!response.ok){if(response.status===401){await this.account.invalidate('ghes_session_expired');fail('ghes_session_expired');}const error=Error(({403:'wiki_share_permission',404:'wiki_share_missing',409:'wiki_share_changed',422:'wiki_share_changed'})[response.status]||'wiki_share_network');error.status=response.status;throw error;}
   let size=0,parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES*2)fail('wiki_share_limit');parts.push(Buffer.from(chunk));}active();try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('wiki_share_invalid');}};
  const meta=await request(API);if(typeof meta.default_branch!=='string'||!meta.default_branch||meta.default_branch.length>200)fail('wiki_share_invalid');
  return {request,active,actor:this.account.profile.login,permissions:meta.permissions||{},branch:meta.default_branch,generation:credential.generation};
 }
 async document(s,file,head,{missing=false}={}){let item;try{item=await s.request(`${API}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(head)}`);}catch(e){if(missing&&e.status===404)return null;throw e;}if(!SHA.test(item.sha||''))fail('wiki_share_invalid');if(item.encoding==='none')item=await s.request(API+'/git/blobs/'+item.sha);if(item.encoding!=='base64'||typeof item.content!=='string')fail('wiki_share_invalid');const bytes=Buffer.from(item.content.replace(/\s/g,''),'base64');if(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')!==item.sha)fail('wiki_share_changed');try{return JSON.parse(bytes.toString('utf8'));}catch{fail('wiki_share_invalid');}}
 async snapshot(s){const head=(await s.request(API+'/git/ref/heads/'+encodeURIComponent(s.branch))).object?.sha;if(!SHA.test(head||''))fail('wiki_share_invalid');const doc=await this.document(s,'wiki/catalog.json',head,{missing:true});return {head,document:doc?catalog(doc):{schemaVersion:1,items:[]}};}
 async list(){const s=await this.session(),value=await this.snapshot(s);return {...value,repository:REPOSITORY,branch:s.branch,actor:s.actor,canUpload:!!s.permissions.push,items:value.document.items.map(item=>({...item,canEdit:canEdit(item,s.actor,s.permissions)}))};}
 async stage(directory){const packet=await collectWiki(directory);const id=randomUUID();this.staged.clear();this.staged.set(id,{...packet,generation:this.account.generation,createdAt:Date.now()});return {id,files:packet.files.map(({path,size})=>({path,size}))};}
 cancel(){this.staged.clear();}
 async publish({stageId,paths,metadata,id,expectedHead,archive=false}={}){
  if(this.busy)fail('wiki_share_busy');this.busy=true;
  try{const s=await this.session(),latest=await this.snapshot(s);if(latest.head!==expectedHead)fail('wiki_share_changed');if(id&&!UUID.test(id))fail('wiki_share_fields');const previous=latest.document.items.find(item=>item.id===id);if(id&&!previous)fail('wiki_share_missing');if(!canEdit(previous,s.actor,s.permissions))fail('wiki_share_permission');
   let item,changes=[];const now=this.now();
   if(archive){if(!previous)fail('wiki_share_missing');item={...previous,archived:!previous.archived,updatedAt:now,updatedBy:s.actor};}
   else{
    const values=fields(metadata),stage=this.staged.get(stageId);if(!stage||stage.generation!==s.generation||Date.now()-stage.createdAt>30*60*1000)fail('wiki_share_stage_expired');
    if(previous&&(previous.mode!==values.mode||!nextVersion(values.version,previous.version)||previous.releases.some(r=>r.version===values.version)))fail('wiki_share_version');
    if(previous&&previous.createdBy!==s.actor&&!s.permissions.admin&&JSON.stringify(values.managers)!==JSON.stringify(previous.managers))fail('wiki_share_permission');
    if(!Array.isArray(paths)||!paths.length||paths.length>MAX_FILES||new Set(paths).size!==paths.length)fail('wiki_share_empty');
    const selected=paths.map(name=>stage.files.find(file=>file.path===name));if(selected.some(file=>!file))fail('wiki_share_fields');
    // Re-read only the explicitly selected files. Never silently upload stale previews.
    for(const file of selected){const target=path.join(stage.root,file.path),resolved=await realpath(target);if(resolved!==target||digest(await readFile(target))!==file.hash)fail('wiki_share_source_changed');}
    const wikiId=id||randomUUID(),prefix=`wiki/${wikiId}/versions/${values.version}`;
    const manifest={schemaVersion:1,id:wikiId,...values,createdAt:now,createdBy:s.actor,files:selected.map(({path,size,hash})=>({path,size,hash}))};
    const manifestText=JSON.stringify(manifest,null,2)+'\n';
    changes=selected.map(file=>({path:prefix+'/pages/'+file.path,content:file.content}));changes.push({path:prefix+'/manifest.json',content:manifestText});
    item={...values,id:wikiId,archived:false,createdAt:previous?.createdAt||now,createdBy:previous?.createdBy||s.actor,updatedAt:now,updatedBy:s.actor,releases:[...(previous?.releases||[]),{version:values.version,createdAt:now,createdBy:s.actor,hash:digest(Buffer.from(manifestText))}]};
    changes.push({path:`wiki/${wikiId}/manifest.json`,content:JSON.stringify(item,null,2)+'\n'});
   }
   const document={schemaVersion:1,items:previous?latest.document.items.map(row=>row.id===id?item:row):[...latest.document.items,item]};catalog(document);
   if(archive)changes.push({path:`wiki/${item.id}/manifest.json`,content:JSON.stringify(item,null,2)+'\n'});
   changes.push({path:'wiki/catalog.json',content:JSON.stringify(document,null,2)+'\n'});
   // Native approval occurs before any remote write, with the exact repository and files.
   if(!await this.confirmSave({repository:REPOSITORY,branch:s.branch,message:`위키 ${archive?(item.archived?'공유 중단':'공유 재개'):previous?'새 버전 등록':'등록'}: ${item.title} ${item.version}`,files:changes.map(c=>c.path)}))return {cancelled:true};
   s.active();if((await this.snapshot(s)).head!==latest.head)fail('wiki_share_changed');
   const parent=await s.request(API+'/git/commits/'+latest.head);if(!SHA.test(parent.tree?.sha||''))fail('wiki_share_invalid');
   this.progress={phase:'upload',completed:0,total:changes.length};const entries=[];for(let offset=0;offset<changes.length;offset+=4){const batch=await Promise.all(changes.slice(offset,offset+4).map(async change=>{const blob=await s.request(API+'/git/blobs',{method:'POST',body:{encoding:'utf-8',content:change.content}});if(!SHA.test(blob.sha||''))fail('wiki_share_invalid');if(this.progress)this.progress.completed++;return {path:change.path,mode:'100644',type:'blob',sha:blob.sha};}));entries.push(...batch);}
   this.progress={phase:'save',completed:0,total:1};const tree=await s.request(API+'/git/trees',{method:'POST',body:{base_tree:parent.tree.sha,tree:entries}});if(!SHA.test(tree.sha||''))fail('wiki_share_invalid');
   const commit=await s.request(API+'/git/commits',{method:'POST',body:{message:`wiki: ${archive?'visibility':previous?'release':'add'} ${item.id} ${item.version}`,tree:tree.sha,parents:[latest.head]}});if(!SHA.test(commit.sha||''))fail('wiki_share_invalid');
   // Never retry a ref update whose response is lost. A new list resolves the outcome.
   try{await s.request(API+'/git/refs/heads/'+encodeURIComponent(s.branch),{method:'PATCH',body:{sha:commit.sha,force:false}});}catch(e){if(e.message==='wiki_share_network')fail('wiki_share_unconfirmed');throw e;}
   const saved=await this.document(s,'wiki/catalog.json',commit.sha);if(JSON.stringify(saved)!==JSON.stringify(document))fail('wiki_share_unconfirmed');this.staged.delete(stageId);return {saved:true,item,commit:commit.sha};
  }finally{this.busy=false;this.progress=null;}
 }
 async detail({id,version}){
  if(!UUID.test(id)||!VERSION.test(version||''))fail('wiki_share_fields');const s=await this.session(),snapshot=await this.snapshot(s),item=snapshot.document.items.find(row=>row.id===id&&!row.archived),release=item?.releases.find(row=>row.version===version);if(!release)fail('wiki_share_missing');
  const manifest=await this.document(s,`wiki/${id}/versions/${version}/manifest.json`,snapshot.head);if(digest(Buffer.from(JSON.stringify(manifest,null,2)+'\n'))!==release.hash||manifest.id!==id||manifest.version!==version||!Array.isArray(manifest.files))fail('wiki_share_invalid');
  return {item,manifest};
 }
 async download({id,version},directory){
  if(!UUID.test(id)||!VERSION.test(version||''))fail('wiki_share_fields');const s=await this.session(),snapshot=await this.snapshot(s),item=snapshot.document.items.find(row=>row.id===id&&!row.archived),release=item?.releases.find(row=>row.version===version);if(!release)fail('wiki_share_missing');
  const prefix=`wiki/${id}/versions/${version}`,manifest=await this.document(s,prefix+'/manifest.json',snapshot.head);
  if(digest(Buffer.from(JSON.stringify(manifest,null,2)+'\n'))!==release.hash||manifest.id!==id||manifest.version!==version||manifest.mode!==item.mode||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>MAX_FILES)fail('wiki_share_invalid');
  const seen=new Set();let size=0;for(const file of manifest.files){if(!safePath(file.path)||!/\.md$/i.test(file.path)||!HASH.test(file.hash)||!Number.isSafeInteger(file.size)||file.size<0||file.size>2*1024*1024||(size+=file.size)>MAX_BYTES||seen.has(file.path.normalize('NFC').toLowerCase()))fail('wiki_share_invalid');seen.add(file.path.normalize('NFC').toLowerCase());}
  const files=[];for(const file of manifest.files){const entry=await s.request(`${API}/contents/${(prefix+'/pages/'+file.path).split('/').map(encodeURIComponent).join('/')}?ref=${snapshot.head}`);const blob=entry.encoding==='none'?await s.request(API+'/git/blobs/'+entry.sha):entry;if(blob.encoding!=='base64'||typeof blob.content!=='string')fail('wiki_share_invalid');const bytes=Buffer.from(blob.content.replace(/\s/g,''),'base64');if(bytes.length!==file.size||digest(bytes)!==file.hash)fail('wiki_share_changed');files.push({...file,bytes});}
  s.active();const parent=await realpath(directory),target=path.join(parent,`wiki-${id}-${version}`);try{await mkdir(target);}catch(e){if(e.code==='EEXIST')fail('wiki_share_exists');throw e;}
  // Exclusive destination: originals are never overwritten, and partial failures are not called success.
  for(const file of files){const output=path.join(target,item.mode==='code'?'openwiki':'personal',file.path);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,file.bytes,{flag:'wx',mode:0o600});if(digest(await readFile(output))!==file.hash)fail('wiki_share_download_unconfirmed');}
  await writeFile(path.join(target,'wiki-share.json'),JSON.stringify({...manifest,repository:REPOSITORY,commit:snapshot.head},null,2),{flag:'wx',mode:0o600});return {saved:true,path:target,version,mode:item.mode};
 }
}
module.exports={WikiRepository,collectWiki,catalog,fields,safePath,canEdit,REPOSITORY};
