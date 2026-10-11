const {GhesAccount,ORIGIN,SECRET_KEY}=require('../../nubi-vscode/src/ghes.cjs');
const {chooseRepository}=require('../../nubi-vscode/src/ghes-git.cjs');
const {startTeamWorkspace}=require('./team-workspace.cjs');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const {randomUUID,randomBytes}=require('node:crypto');
const {mkdtemp,mkdir,writeFile,rm,realpath}=require('node:fs/promises');
const path=require('node:path'),os=require('node:os');
const SECRET_SERVICE='nubi.workspace.electron';
const missingWorkspaceBrowser=async()=>{throw Error('ghes_browser_unavailable');};
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function remote(input){
  if(typeof input!=='string'||input.length>2000||/[\s\x00-\x1f]/.test(input))throw Error('remote_invalid');
  if(/^[\w.-]+@[\w.-]+:[^:\s][^\s]*$/.test(input))return {href:input,pathname:input.slice(input.indexOf(':')+1),origin:null,protocol:'ssh:'};
  let url;try{url=new URL(input);}catch{throw Error('remote_invalid');}
  if(!['https:','http:','ssh:','git:'].includes(url.protocol)||!url.hostname||url.password||url.search||url.hash)throw Error('remote_invalid');
  return url;
}
class ElectronHost{
  constructor({keyStore,invoke,helperPath,fetcher,openBrowser=missingWorkspaceBrowser,confirmWorkspaceSave,platform=process.platform,spawnProcess=spawn}){
    this.invoke=invoke;this.helperPath=helperPath;this.platform=platform;this.spawnProcess=spawnProcess;this.repositories=new Map();this.children=new Set();
    this.confirmWorkspaceSave=confirmWorkspaceSave;
    this.account=new GhesAccount({fetcher,openExternal:openBrowser,copyCode:async()=>{},
      secrets:{get:key=>keyStore.getPassword(SECRET_SERVICE,key),store:(key,value)=>keyStore.setPassword(SECRET_SERVICE,key,value),delete:key=>keyStore.deletePassword(SECRET_SERVICE,key)},
      onInvalidated:async()=>{this.workspace?.close();this.workspace=null;this.repositories.clear();for(const child of this.children)child.kill();await invoke('disconnectSkillMarketplace').catch(()=>{});}});
  }
  async accountAction(operation){return this.account.action(operation);}
  async openTeamWorkspace({refresh=false}={}){
    if(!(await this.account.status()).connected)return {loginRequired:true};
    if(!refresh&&this.workspace?.generation===this.account.generation)return this.workspaceInfo();
    if(this.workspaceOpening)return this.workspaceOpening;
    this.workspaceOpening=(async()=>{
      const next=await startTeamWorkspace({account:this.account,confirmSave:this.confirmWorkspaceSave});
      this.workspace?.close();this.workspace=next;return this.workspaceInfo();
    })();
    try{return await this.workspaceOpening;}finally{this.workspaceOpening=null;}
  }
  workspaceInfo(){const {url,revision,repository}=this.workspace;return {embedded:true,url,revision,repository};}
  async connectMarketplace(){
    if(!(await this.account.status()).connected)return {loginRequired:true};
    const credential=await this.account.credential();
    const result=await this.invoke('connectSkillMarketplace',{token:credential.token});
    if(credential.generation!==this.account.generation){await this.invoke('disconnectSkillMarketplace');throw Error('ghes_session_changed');}
    return result;
  }
  async listRepositories(){
    const generation=this.account.generation;let choices=[];
    await chooseRepository({window:{showQuickPick:async items=>{choices=items;return undefined;}}},this.account);
    if(generation!==this.account.generation)throw Error('ghes_session_changed');
    this.repositories.clear();return choices.map(item=>{const id=randomUUID();this.repositories.set(id,{url:item.url,generation});return {id,label:item.label,description:item.description};});
  }
  async clone({url,parent,repositoryId}){
    if(repositoryId){const item=this.repositories.get(repositoryId);if(!item||item.generation!==this.account.generation)throw Error('ghes_session_changed');url=item.url;}
    const address=remote(url),directory=await realpath(parent),name=address.pathname.split('/').at(-1).replace(/\.git$/,'');
    if(!/^[\w.-]+$/.test(name)||['.','..'].includes(name))throw Error('remote_invalid');
    const target=path.join(directory,name);
    const credential=address.origin===ORIGIN&&(await this.account.status()).connected?await this.account.credential():null;
    // Allocate the destination exclusively. A failed/uncertain clone is kept
    // for inspection; retries never overwrite or remove its files.
    await mkdir(target).catch(error=>{throw Error(error.code==='EEXIST'?'clone_target_exists':'clone_failed');});
    const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-git-'));
    const socketPath=this.platform==='win32'?'\\\\.\\pipe\\nubi-git-'+randomUUID():path.join(temp,'socket');
    const nonce=randomBytes(32).toString('hex');let server;
    try{
      const askpass=path.join(temp,this.platform==='win32'?'askpass.cmd':'askpass.sh');
      const executable=process.execPath;
      if(this.platform==='win32'&&[executable,this.helperPath].some(value=>/["%\r\n]/.test(value)))throw Error('clone_failed');
      await writeFile(askpass,this.platform==='win32'?`@echo off\r\n"${executable}" "${this.helperPath}" %*\r\n`:`#!/bin/sh\nexec ${quote(executable)} ${quote(this.helperPath)} "$@"\n`,{mode:0o700});
      server=createServer(socket=>{
        let raw='';socket.setTimeout(15000,()=>socket.destroy());
        socket.on('error',()=>{});socket.on('data',async chunk=>{
          raw+=chunk;if(raw.length>8192)return socket.destroy();if(!raw.includes('\n'))return;
          socket.pause();let value='';
          try{const message=JSON.parse(raw);const match=/^(Username|Password) for '([^']+)':\s*$/.exec(message.prompt||'');
            const prompt=match&&new URL(match[2]);
            if(message.nonce!==nonce||!credential||credential.generation!==this.account.generation||this.account.state!=='connected'||this.account.record?.expiresAt&&this.account.record.expiresAt<=Date.now()||!prompt||prompt.origin!==ORIGIN||prompt.password||prompt.username&&!['x-access-token'].includes(prompt.username))throw Error();
            value=match[1]==='Username'?'x-access-token':credential.token;
          }catch{}socket.end(JSON.stringify({value}));
        });
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
      const env={...process.env,ELECTRON_RUN_AS_NODE:'1',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:askpass,NUBI_GIT_SOCKET:socketPath,NUBI_GIT_NONCE:nonce};
      for(const key of Object.keys(env))if(/^GIT_TRACE|^GIT_CURL_VERBOSE$|^GIT_SSL_NO_VERIFY$/.test(key))delete env[key];
      await new Promise((resolve,reject)=>{
        const child=this.spawnProcess('git',[...(credential?['-c','credential.helper=']:[]),'-c','http.sslVerify=true','clone','--',address.href,target],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});this.children.add(child);
        child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
        child.once('error',()=>{this.children.delete(child);reject(Error('clone_failed'));});
        child.once('exit',code=>{this.children.delete(child);code===0?resolve():reject(Error('clone_failed'));});
      });
      if(credential&&credential.generation!==this.account.generation)throw Error('ghes_session_changed');
      return {cloned:true,root:target};
    }finally{if(server)await new Promise(resolve=>{server.close(resolve);});await rm(temp,{recursive:true,force:true});}
  }
  dispose(){this.workspace?.close();this.workspace=null;this.account.dispose();for(const child of this.children)child.kill();this.repositories.clear();}
}
module.exports={ElectronHost,SECRET_SERVICE,remote};
