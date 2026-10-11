import {spawn, execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,appendFileSync} from 'node:fs';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {StringDecoder} from 'node:string_decoder';
import {POWERSHELL_TEXT_ARGS,POWERSHELL_UTF8_PREFIX} from './powershell-encoding.mjs';
import {startElevated,stopElevated} from './elevated-process.mjs';
const executeFile=promisify(execFile);
export const hostShell = (platform=process.platform) => platform==='win32'?'powershell':'bash';

export function shellArguments(shell, profile, script) {
  if(profile==='cmd'){
    const command='chcp 65001>nul & '+script;
    if(command.length>7600)throw Object.assign(new Error('shell_command_limit'),{code:'shell_command_limit'});
    return [...shell.args,command];
  }
  if(profile!=='powershell')return [...shell.args,script];
  // Windows PowerShell otherwise emits the console code page into UTF-8 pipes.
  // EncodedCommand also preserves Korean paths and literal quotes in argv.
  const content=POWERSHELL_UTF8_PREFIX+script;
  const encoded=Buffer.from(content,'utf16le').toString('base64');
  if(encoded.length>28000)throw Object.assign(new Error('shell_command_limit'),{code:'shell_command_limit'});
  return [...POWERSHELL_TEXT_ARGS,'-EncodedCommand',encoded];
}

export async function shellProfiles({platform=process.platform,bashCandidates}={}) {
  if (platform !== 'win32') return [{id: 'bash', label: 'Bash', executable: '/bin/bash', args: ['--noprofile', '--norc', '-c']}];
  const system32=path.join(process.env.SystemRoot || 'C:\\Windows','System32');
  const profiles = [{id: 'powershell', label: 'PowerShell', executable: path.join(system32,'WindowsPowerShell/v1.0/powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']},
    {id:'cmd',label:'CMD',executable:path.join(system32,'cmd.exe'),args:['/D','/Q','/C']}];
  const candidates = bashCandidates || [process.env.NUBI_BASH_PATH, 'C:\\Program Files\\Git\\bin\\bash.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs/Git/bin/bash.exe')].filter(Boolean);
  for (const executable of candidates) { try { await access(executable); profiles.push({id: 'bash', label: 'Git Bash', executable, args: ['--noprofile', '--norc', '-c']}); break; } catch {} }
  return profiles;
}
export class Processes {
  constructor(store,{onFinished=()=>{},profiles=shellProfiles}={}) { this.store = store; this.active = new Map(); this.records = new Map(); this.pending=new Set();this.preflights=new Map();this.disposed=false;this.onFinished=onFinished;this.profiles=profiles; }
  async start({cwd, script, profile = hostShell(), taskId, timeoutMs = 0,autoDiagnose=true,repairOf,setupActionId,privilege='user',terminalRequestId,terminalProjectId}) {
    if(this.disposed)throw new Error('host_disconnected');
    if(privilege==='administrator')return startElevated(this,{cwd,script,profile,taskId,setupActionId});
    if(privilege!=='user')throw new Error('elevation_approval_required');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 86400000) throw new Error('timeout_invalid');
    if (typeof script !== 'string' || !script.trim() || script.length > 16000) throw new Error('command_invalid');
    const id = randomUUID(), record = {id, taskId, cwd, profile, script,timeoutMs,autoDiagnose:autoDiagnose===true,...(repairOf?{repairOf}:{}),...(setupActionId?{setupActionId}:{}),...(terminalRequestId?{terminal:true,terminalRequestId,terminalProjectId}:{}), startedAt: new Date().toISOString(), state: 'checking', execution:'not_started', output: '', exitCode: null};
    const persist=()=>this.store.set('process:'+id,record);
    const finish=()=>{record.finishedAt=new Date().toISOString();persist();this.store.event('process_finished',{id,state:record.state,exitCode:record.exitCode});try{this.onFinished({...record});}catch{}};
    mkdirSync(path.join(this.store.directory,'logs'),{recursive:true}); record.logPath=path.join(this.store.directory,'logs',id+'.log');
    // Credentials belonging to the host are not inherited by development commands.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|CREDENTIAL)/i.test(name)));
    const preflight=new AbortController();this.preflights.set(id,preflight);this.pending.add(id);this.records.set(id,record);persist();let shell,args;
    try{
      shell=(await this.profiles()).find(p=>p.id===profile);if(!shell)throw Object.assign(new Error(),{code:'shell_unavailable'});
      args=shellArguments(shell,profile,script);
      if(preflight.signal.aborted)throw new Error('cancelled');
      // Parse only: even a syntactically broken script with a valid prefix
      // must not partially execute before the model diagnoses it.
      if(profile==='bash')await executeFile(shell.executable,['--noprofile','--norc','-n','-c',script],{cwd,env,signal:preflight.signal,timeout:3000,maxBuffer:16000,windowsHide:true});
      if(preflight.signal.aborted)throw new Error('cancelled');
    }catch(error){record.state=preflight.signal.aborted?'cancelled':'failed';if(record.state==='failed'){record.fault=['shell_unavailable','shell_command_limit'].includes(error.code)?error.code:error.code==='ENOENT'?'shell_executable_missing':typeof error.code==='number'?'shell_syntax':'shell_preflight_failed';record.output=typeof error.stderr==='string'?error.stderr.slice(-16000):record.fault;}this.records.delete(id);finish();return {...record};}
    finally{this.pending.delete(id);this.preflights.delete(id);}
    record.state='running';record.execution='started';record.lastOutputAt=Date.now();
    const child = spawn(shell.executable, args, {cwd, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    this.active.set(id, child); this.records.set(id, record); this.store.set('process:' + id, record);
    const decoders=[new StringDecoder('utf8'),new StringDecoder('utf8')];
    const append = (data,decoder) => { try {appendFileSync(record.logPath,data);} catch {record.logIncomplete=true;} record.lastOutputAt=Date.now();record.output = (record.output + decoder.write(data)).slice(-128000); this.store.set('process:' + id, record); };
    child.stdout.on('data', data=>append(data,decoders[0])); child.stderr.on('data', data=>append(data,decoders[1]));
    let timer;
    if (timeoutMs > 0) timer = setTimeout(() => this.stop(id,'timeout'), timeoutMs);
    child.on('error', error => { record.state = 'failed';record.execution='not_started';record.fault='shell_spawn_failed'; record.output += '\n' + error.code; this.store.set('process:' + id, record); });
    child.on('close', (code, signal) => { clearTimeout(timer);record.output=(record.output+decoders.map(d=>d.end()).join('')).slice(-128000); record.exitCode = code; record.signal = signal; if (record.stopReason==='timeout'){record.state='timed_out';record.fault='process_timeout';}else if (record.cancellationRequested) record.state='cancelled'; else if (record.state === 'running') record.state = code === 0 ? 'completed' : 'failed';if(record.state==='failed')record.fault ||= code===127?'command_not_found':'command_failed';this.active.delete(id); this.records.delete(id);finish(); });
    this.store.event('process_started', {id, taskId}); return {...record};
  }
  poll(id) { const item = this.store.get('process:' + id); if (!item) throw new Error('process_missing'); return {...item,...(item.state==='running'?{quietForMs:Date.now()-item.lastOutputAt}:{})}; }
  input(id, value) { const child = this.active.get(id); if (!child?.stdin || typeof value !== 'string' || value.length > 8000) throw new Error('process_missing'); child.stdin.write(value); return {accepted: true}; }
  stop(id,reason='user') {
    const preflight=this.preflights.get(id);
    if(preflight){const item=this.records.get(id);item.state='stopping';item.cancellationRequested=true;item.stopReason=reason;this.store.set('process:'+id,item);preflight.abort();return item;}
    const child = this.active.get(id); if (!child) return this.poll(id);
    if(child.nubiElevation)return stopElevated(this,id,child,reason);
    const item = this.records.get(id); item.state = 'stopping'; item.cancellationRequested=true;item.stopReason=reason; this.store.set('process:' + id, item);
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true}, () => {});
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} const timer = setTimeout(() => { if (this.active.get(id) === child) {try {process.kill(-child.pid, 'SIGKILL');} catch {}} }, 1500); timer.unref(); }
    return item;
  }
  dispose() { this.disposed=true;for (const id of this.pending) this.stop(id);for (const id of this.active.keys()) this.stop(id); }
}
