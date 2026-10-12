const {fork,execFile}=require('node:child_process');
const {access}=require('node:fs/promises');
const path=require('node:path');
const {promisify}=require('node:util');
const exec=promisify(execFile);
async function interactiveShell(profile,{platform=process.platform,env=process.env,exists=access,lookup=exec}={}){
 if(profile==='powershell'&&platform==='win32'){
  const candidates=[path.win32.join(env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe')];
  try{const result=await lookup('where.exe',['pwsh.exe'],{windowsHide:true,timeout:2000});candidates.push(...result.stdout.trim().split(/\r?\n/));}catch{}
  candidates.push(path.win32.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'));
  for(const executable of candidates){try{await exists(executable);return {executable,argv:['-NoProfile']};}catch{}}
 }else if(profile==='cmd'&&platform==='win32')return {executable:path.win32.join(env.SystemRoot||'C:\\Windows','System32','cmd.exe'),argv:['/D']};
 return null;
}
class TerminalHost{
 constructor({invoke,notify,workerFile,profiles}){this.profiles=profiles;this.invoke=invoke;this.notify=notify;this.workerFile=workerFile;this.pending=new Map();this.next=0;this.sessions=new Map();this.opens=new Map();this.generation=0;}
 start(){if(this.worker)return;const child=fork(this.workerFile,[],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','ignore','ipc']});this.worker=child;
  child.on('message',message=>{if(message.event){this.notify(message.event);return;}const pending=this.pending.get(message.requestId);if(!pending)return;this.pending.delete(message.requestId);message.error?pending.reject(Error(message.error)):pending.resolve(message.result);});
  const failed=()=>{if(this.worker!==child)return;this.worker=null;for(const pending of this.pending.values())pending.reject(Error('terminal_disconnected'));this.pending.clear();for(const id of this.sessions.keys())this.notify({id,type:'disconnected'});this.sessions.clear();};child.on('error',failed);child.on('exit',failed);
 }
 call(action,args){this.start();return new Promise((resolve,reject)=>{const requestId=++this.next;this.pending.set(requestId,{resolve,reject});this.worker.send({requestId,action,args},error=>{if(error){this.pending.delete(requestId);reject(Error('terminal_disconnected'));}});});}
 async request(args){
  const {action='open',id,projectId}=args||{};
  if(typeof id!=='string'||!/^[-\w]{1,80}$/.test(id)||typeof projectId!=='string')throw Error('terminal_session_missing');
  if(action==='open'){
   if(this.opens.has(id)){const opening=this.opens.get(id);if(opening.projectId!==projectId)throw Error('terminal_session_missing');return opening;}
   if(this.opens.size+this.sessions.size>=12&&!this.sessions.has(id))throw Error('terminal_session_limit');
   const opening=this.open(args);opening.projectId=projectId;this.opens.set(id,opening);try{return await opening;}finally{if(this.opens.get(id)===opening)this.opens.delete(id);}
  }
  if(this.opens.has(id)){const opening=this.opens.get(id);if(opening.projectId!==projectId)throw Error('terminal_session_missing');await opening;}
  if(this.sessions.get(id)!==projectId)throw Error('terminal_session_missing');
  if(!['input','resize','ack','detach','close'].includes(action))throw Error('method_invalid');
  const result=await this.call(action,args);if(action==='close')this.sessions.delete(id);return result;
 }
 async open(args){
  const {id,projectId}=args,generation=this.generation;
  await this.invoke('projectPath',{projectId});
  if(generation!==this.generation)throw Error('terminal_disconnected');
  const existing=this.sessions.get(id);if(existing&&existing!==projectId)throw Error('terminal_session_missing');
  if(existing)return this.call('open',{id,projectId});
  const location=await this.invoke('browseDirectory',{projectId,path:args.path||''});
  const profile=(await this.profiles()).find(item=>item.id===(args.profile||(process.platform==='win32'?'powershell':'bash')));if(!profile)throw Error('shell_unavailable');
  const shell=await interactiveShell(profile.id)||{executable:profile.executable,argv:profile.id==='bash'?['--noprofile','--norc','-i']:[]};
  if(!shell.executable)throw Error('shell_unavailable');
  // Folder/model work may have changed while shell discovery was pending.
  await this.invoke('projectPath',{projectId});
  if(generation!==this.generation)throw Error('terminal_disconnected');
  const result=await this.call('open',{id,projectId,cwd:location.absolute,...shell,cols:args.cols,rows:args.rows});this.sessions.set(id,projectId);return result;
 }
 dispose(){this.generation++;this.opens.clear();const child=this.worker;this.worker=null;for(const pending of this.pending.values())pending.reject(Error('terminal_disconnected'));this.pending.clear();this.sessions.clear();if(child?.connected)child.disconnect();}
}
module.exports={TerminalHost,interactiveShell};
