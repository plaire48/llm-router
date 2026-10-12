const {createHash,randomUUID}=require('node:crypto');
const {mkdir,open,rename,rm,lstat}=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const ORIGIN='https://code.sdsdev.co.kr',REPOSITORY='Manufacturing-IT/nuri',API='/api/v3/repos/'+REPOSITORY;
const VERSION=/^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const fail=code=>{throw Error(code);};
function newer(a,b){if(!VERSION.test(a)||!VERSION.test(b))return false;const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]>bb[i];}return false;}
function manifest(value){
 if(!value||value.schemaVersion!==1||!VERSION.test(value.version)||value.platform!=='win32'||value.arch!=='x64'||value.repository!==REPOSITORY||value.tag!==`nubi-desktop-v${value.version}`||!Number.isSafeInteger(value.assetId)||value.assetId<1||value.filename!==`Nubi-Workspace-beta-${value.version}-x64-Setup.exe`||!Number.isSafeInteger(value.size)||value.size<1||value.size>2*1024**3||!/^[a-f0-9]{64}$/.test(value.sha256)||typeof value.notes!=='string'||value.notes.length>4000)fail('update_manifest_invalid');
 return Object.fromEntries(['schemaVersion','version','platform','arch','repository','tag','assetId','filename','size','sha256','notes'].map(key=>[key,value[key]]));
}
async function hashFile(file){const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())fail('update_integrity');const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return {size:stat.size,sha256:hash.digest('hex')};}
class WorkspaceUpdater{
 constructor({account,directory,version,platform=process.platform,arch=process.arch,now=Date.now}){Object.assign(this,{account,directory,version,platform,arch,now});this.state={phase:'idle',currentVersion:version};this.busy=false;this.file=null;}
 status(){return {...this.state,supported:this.platform==='win32'&&this.arch==='x64'};}
 active(session){if(session.generation!==this.account.generation||this.account.state!=='connected')fail('ghes_session_changed');if(this.controller?.signal.aborted)fail('update_cancelled');}
 async request(session,route,{binary=false,limit=128*1024}={}){
  this.active(session);const url=ORIGIN+route;let response;
  try{response=await this.account.fetcher(url,{headers:{Authorization:'Bearer '+session.token,Accept:binary?'application/octet-stream':'application/vnd.github+json'},credentials:'omit',cache:'no-store',redirect:'manual',signal:AbortSignal.any([this.controller.signal,this.account.accessController.signal,AbortSignal.timeout(binary?20*60*1000:30000)])});
   // GHES may redirect release assets. Auth never leaves the fixed origin.
   if(binary&&[301,302,303,307,308].includes(response.status)){const next=new URL(response.headers.get('location'),url);if(next.origin!==ORIGIN||next.username||next.password||!next.pathname.startsWith('/'))fail('update_download_origin');response=await this.account.fetcher(next.href,{headers:{Authorization:'Bearer '+session.token,Accept:'application/octet-stream'},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([this.controller.signal,this.account.accessController.signal,AbortSignal.timeout(20*60*1000)])});}
  }catch(e){this.active(session);if(e.message==='update_download_origin')throw e;fail('update_network');}
  this.active(session);if(response.status===401)fail('ghes_session_expired');if(response.status===403)fail('update_permission');if(response.status===404)fail('update_not_published');if(!response.ok||!response.body)fail('update_network');if(binary)return response;
  let count=0,parts=[];for await(const part of response.body){count+=part.length;if(count>limit)fail('update_manifest_invalid');parts.push(Buffer.from(part));}this.active(session);try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('update_manifest_invalid');}
 }
 async check(){
  if(this.busy)return this.status();if(!this.status().supported){this.state.phase='unsupported';return this.status();}
  this.busy=true;this.controller=new AbortController();this.state={phase:'checking',currentVersion:this.version};
  try{const session=await this.account.credential();const doc=await this.request(session,API+'/contents/latest/windows-x64.json');if(doc.encoding!=='base64'||typeof doc.content!=='string')fail('update_manifest_invalid');let raw;try{raw=JSON.parse(Buffer.from(doc.content,'base64').toString('utf8'));}catch{fail('update_manifest_invalid');}const release=manifest(raw);
   this.state={phase:newer(release.version,this.version)?'available':'current',currentVersion:this.version,release};this.file=null;
  }catch(e){this.state={phase:'error',currentVersion:this.version,error:e.message};}finally{this.busy=false;}return this.status();
 }
 async download(){
  if(this.busy)fail('update_busy');if(this.state.phase!=='available'&&!(this.state.phase==='error'&&this.state.release))fail('update_not_ready');
  const release=manifest(this.state.release);if(!newer(release.version,this.version))fail('update_not_ready');this.busy=true;this.controller=new AbortController();const temporary=path.join(this.directory,randomUUID()+'.part');let handle;
  this.state={phase:'downloading',currentVersion:this.version,release,received:0,percent:0};
  try{const session=await this.account.credential();
   const published=await this.request(session,API+'/releases/tags/'+encodeURIComponent(release.tag));
   if(published.draft||published.tag_name!==release.tag||!published.assets?.some(asset=>asset.id===release.assetId&&asset.name===release.filename&&asset.size===release.size&&asset.state==='uploaded'))fail('update_manifest_invalid');
   const response=await this.request(session,API+'/releases/assets/'+release.assetId,{binary:true});
   const length=response.headers.get('content-length');if(length&&Number(length)!==release.size)fail('update_integrity');
   await mkdir(this.directory,{recursive:true,mode:0o700});handle=await open(temporary,'wx',0o600);const hash=createHash('sha256');let received=0;const start=this.now();
   for await(const chunk of response.body){this.active(session);received+=chunk.length;if(received>release.size)fail('update_integrity');hash.update(chunk);await handle.writeFile(chunk);const elapsed=Math.max(1,this.now()-start);this.state={...this.state,received,percent:Math.floor(received/release.size*100),remainingSeconds:received>0&&elapsed>=2000?Math.ceil((release.size-received)/(received/elapsed)/1000):null};}
   this.active(session);if(received!==release.size||hash.digest('hex')!==release.sha256)fail('update_integrity');await handle.sync();await handle.close();handle=null;
   const file=path.join(this.directory,randomUUID()+'.exe');await rename(temporary,file);this.file=file;this.state={phase:'ready',currentVersion:this.version,release,received,percent:100};
  }catch(e){this.file=null;this.state={phase:this.controller.signal.aborted?'available':'error',currentVersion:this.version,release,...(this.controller.signal.aborted?{}:{error:/^(update_|ghes_)/.test(e.message)?e.message:'update_download_failed'})};}
  finally{await handle?.close().catch(()=>{});await rm(temporary,{force:true}).catch(()=>{});this.busy=false;}return this.status();
 }
 cancel(){this.controller?.abort();return this.status();}
 async installer(){if(this.busy||this.state.phase!=='ready'||!this.file)fail('update_not_ready');const actual=await hashFile(this.file);if(actual.size!==this.state.release.size||actual.sha256!==this.state.release.sha256){this.state={...this.state,phase:'error',error:'update_integrity'};this.file=null;fail('update_integrity');}return this.file;}
}
module.exports={WorkspaceUpdater,manifest,newer,hashFile,REPOSITORY};
