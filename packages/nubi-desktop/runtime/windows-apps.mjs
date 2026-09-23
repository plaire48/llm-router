import {spawn} from 'node:child_process';
import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fail} from './files.mjs';

// The host UI supplies an exact local executable. Models never supply a path,
// arguments, environment overrides, shell command, URI or Start Menu query.
export function localExecutable(value){
  if(typeof value!=='string'||value.length>2000||! /^[a-z]:\\/i.test(value)||/[\x00-\x1f]/.test(value)||value.slice(2).includes(':')||path.win32.extname(value).toLowerCase()!=='.exe')fail('computer_app_invalid');
  return path.win32.normalize(value);
}
export function appEnvironment(source=process.env){
  const allowed=new Set(['systemroot','windir','systemdrive','programfiles','programfiles(x86)','programw6432','commonprogramfiles','commonprogramfiles(x86)','commonprogramw6432','userprofile','appdata','localappdata','temp','tmp','username','userdomain','homedrive','homepath','processor_architecture','number_of_processors']);
  return Object.fromEntries(Object.entries(source).filter(([key])=>allowed.has(key.toLowerCase())));
}
export class WindowsApps {
  constructor({platform=process.platform,inspectFile,spawnProcess=spawn}={}){this.platform=platform;this.inspectFile=inspectFile;this.spawnProcess=spawnProcess;this.children=new Map();this.disposed=false;}
  async inspect(file){
    if(this.disposed||this.platform!=='win32')fail('computer_unavailable');
    file=localExecutable(file);
    if(this.inspectFile)return this.inspectFile(file);
    const resolved=localExecutable(await realpath(file)),info=await stat(resolved);
    if(!info.isFile()||info.size>300000000)fail('computer_app_invalid');
    const bytes=await readFile(resolved);
    if(bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')fail('computer_app_invalid');
    return {path:resolved,name:path.win32.basename(resolved),sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  async verify(app){const actual=await this.inspect(app.path);if(actual.path!==app.path||actual.sha256!==app.sha256)fail('computer_app_changed');return actual;}
  start(app,id){
    if(this.disposed||this.platform!=='win32')fail('computer_unavailable');
    return new Promise((resolve,reject)=>{
      // An executable's directory is required by many Win32 applications.
      // Do not inherit project cwd, PATH, NODE_OPTIONS or provider credentials.
      const child=this.spawnProcess(app.path,[],{cwd:path.win32.dirname(app.path),shell:false,windowsHide:false,stdio:'ignore',env:appEnvironment()});
      const record={child,pid:null,exited:false,startedAt:new Date().toISOString()};this.children.set(id,record);
      child.once('error',()=>{record.exited=true;reject(new Error('computer_launch_failed'));});
      child.once('exit',()=>{record.exited=true;});
      child.once('spawn',()=>{record.pid=child.pid;child.unref();resolve({pid:child.pid,startedAt:record.startedAt});});
    });
  }
  alive(id,pid){const record=this.children.get(id);return !this.disposed&&record?.pid===pid&&!record.exited;}
  dispose(){this.disposed=true;this.children.clear();} // Never close a user's app.
}
