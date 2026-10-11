import {readdir,lstat,realpath,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fail,privatePath,scopedFile,hash,readSource} from './files.mjs';

async function directory(service,input='',root=service.root) {
  if(typeof input!=='string'||input.length>2000||input.includes('\0'))fail('path_scope');
  const candidate=path.resolve(root,input||'.');
  const relative=path.relative(root,candidate).split(path.sep).join('/');
  if(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative)||privatePath(relative))fail('path_scope');
  const file=relative?await scopedFile(root,relative):root;
  if((await realpath(file))!==file||!(await lstat(file)).isDirectory())fail('directory_missing');
  return {relative,absolute:file};
}
function requireProject(service,projectId) {service.ready();if(service.projectId!==projectId)fail('project_changed');}
export function installProjectBrowser(Service) {
  // Opening a file in the human editor does not request agent guidance. Keep
  // the agent's bounded rules/read contract separate from this scoped read.
  Service.prototype.editorSource=async function({projectId,path:input,taskId}) {
    requireProject(this,projectId);const root=await this.target(taskId),source=await readSource(root,input);
    requireProject(this,projectId);if(await this.target(taskId)!==root)fail('project_changed');
    return {...source,root,uri:pathToFileURL(path.join(root,input)).href};
  };
  Service.prototype.previewFile=async function({projectId,path:input}) {
    requireProject(this,projectId);
    const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon'}[path.extname(input).toLowerCase()];
    if(!mime)fail('binary_file');const file=await scopedFile(this.root,input),stats=await lstat(file);
    if(!stats.isFile()||stats.isSymbolicLink()||stats.size>4*1024*1024)fail('file_too_large');
    const bytes=await readFile(file);requireProject(this,projectId);
    return {path:input,hash:hash(bytes),content:`data:${mime};base64,${bytes.toString('base64')}`};
  };
  Service.prototype.browseDirectory=async function({projectId,path:input='',taskId}) {
    requireProject(this,projectId);const root=await this.target(taskId),location=await directory(this,input,root);
    const rows=await readdir(location.absolute,{withFileTypes:true});
    const entries=rows.filter(row=>!row.isSymbolicLink()&&(row.isFile()||row.isDirectory()))
      .map(row=>({id:location.relative?`${location.relative}/${row.name}`:row.name,name:row.name,path:location.relative?`${location.relative}/${row.name}`:row.name,directory:row.isDirectory(),extension:row.isFile()?path.extname(row.name).slice(1).toLowerCase():''}))
      .filter(row=>!privatePath(row.path)).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
    requireProject(this,projectId);if(await this.target(taskId)!==root)fail('project_changed');
    return {...location,entries:entries.slice(0,2000),truncated:entries.length>2000};
  };
  Service.prototype.terminalCommand=async function({projectId,action='run',path:input='',script,id,profile,requestId}) {
    requireProject(this,projectId);
    if(action==='receipt') {
      if(typeof requestId!=='string'||!/^[\w-]{1,80}$/.test(requestId))fail('command_invalid');
      const entry=this.terminalRequests?.get(requestId);
      const recorded=entry?.result?.id?null:this.store.list('process:').find(row=>row.terminal===true&&row.terminalRequestId===requestId&&row.terminalProjectId===projectId);
      if(recorded)return {...recorded,relative:path.relative(this.root,recorded.cwd).split(path.sep).join('/')};
      if(!entry||entry.projectId!==projectId)return {state:'unknown',execution:'unconfirmed'};
      return entry.result?.id?{...this.processes.poll(entry.result.id),relative:entry.result.relative}:entry.result||{state:'checking',execution:'not_started'};
    }
    if(action==='poll'||action==='stop') {
      const record=this.processes.poll(id);if(record.terminal!==true)fail('process_missing');
      return action==='stop'?this.processes.stop(id):record;
    }
    if(action!=='run')fail('method_invalid');
    if(requestId!==undefined&&(typeof requestId!=='string'||!/^[\w-]{1,80}$/.test(requestId)))fail('command_invalid');
    const signature=JSON.stringify([projectId,input,script,profile]);
    this.terminalRequests ||= new Map();
    const previous=requestId&&this.terminalRequests.get(requestId);
    if(previous){if(previous.signature!==signature)fail('command_request_changed');return previous.promise;}
    if(requestId&&this.terminalRequests.size>=1024)fail('terminal_request_limit');
    const entry={projectId,signature};if(requestId)this.terminalRequests.set(requestId,entry);
    let launchAttempted=false;
    entry.promise=(async()=>{
      try{
        if(this.agent?.running||this.setupBusy||this.computerBusy||this.newFileBusy||this.reconciling||this.unsettledOperations?.size)fail('project_busy');
        if(typeof script!=='string'||!script.trim()||script.length>16000)fail('command_invalid');
        const selected=profile??(this.shellPreference()||undefined);
        if(selected!==undefined&&!(await this.processes.profiles()).some(item=>item.id===selected))fail('shell_unavailable');
        const location=await directory(this,input);
        const cd=/^\s*(?:cd|chdir|Set-Location)\s+((?:"[^"\r\n]*"|'[^'\r\n]*'|[^;&|<>\r\n]+))\s*$/i.exec(script);
        if(cd){const value=cd[1].trim().replace(/^(['"])(.*)\1$/,'$2');const next=await directory(this,path.resolve(location.absolute,value));requireProject(this,projectId);return entry.result={state:'completed',exitCode:0,output:'',...next};}
        requireProject(this,projectId);launchAttempted=true;
        const record=await this.processes.start({cwd:location.absolute,script,profile:selected,taskId:null,autoDiagnose:false,terminalRequestId:requestId,terminalProjectId:projectId});
        record.terminal=true;this.store.set('process:'+record.id,record);
        const live=this.processes.records.get(record.id);if(live)live.terminal=true;
        return entry.result={...record,...location};
      }catch(error){
        // The renderer may lose the launch response. Observe this receipt;
        // never repeat a command just because the transport failed.
        entry.result={state:launchAttempted?'unknown':'failed',execution:launchAttempted?'unconfirmed':'not_started',fault:launchAttempted?'terminal_launch_unconfirmed':error.message};
        throw error;
      }
    })();
    return entry.promise;
  };
}
