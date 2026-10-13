import { randomUUID } from 'node:crypto';
import { startAgent } from './agent';
import { nubiTransport } from './nubi-transport';
import { Conversations } from './conversations';
// @ts-expect-error Nubi preserves its original JavaScript modules.
import { officeProviders, publicProviderState } from './nubi-providers.mjs';
import { providerTransport, validateConfig } from './transport';
import {OfficeServices,Artifacts} from './services';
import {extendedOfficeSkill} from './genoffice-skill';
import {originalFileSkill} from './original-file-skill';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Agent messages use inherited stdio. Only a user-started OAuth login opens a temporary loopback callback.
// Only this process's parent owns the native session and authorization UI.
const MAX_LINE = 1024 * 1024;
let active: { id: string; cancel(): void } | undefined;
const pending = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; cleanup(): void }>();
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
console.log = () => {}; console.warn = () => {}; console.error = () => {};

const conversations=new Conversations();
const vaultPending=new Map<string,{resolve():void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
const persist=(key:string,value:unknown)=>new Promise<void>((resolve,reject)=>{
  const id=randomUUID();const timer=setTimeout(()=>{vaultPending.delete(id);reject(Error('storage_failed'));},10000);
  vaultPending.set(id,{resolve,reject,timer});send({type:'vault_write',id,key,value});
});
const providers=officeProviders(persist);
const services=new OfficeServices(persist);
const artifactStores=new Map<string,Artifacts>();
let authBusy=false,initialized=false,lastState='';
function publish(){const state={...publicProviderState(providers),initializing:!initialized},encoded=JSON.stringify(state);if(encoded!==lastState){lastState=encoded;send({type:'provider_state',state});}}
const stateTimer=setInterval(publish,500);stateTimer.unref();
const methods=new Set(['status','login','cancelLogin','select','model','reasoning','refreshModels','disconnect','connect']);
async function providerCommand(msg:Record<string,any>){
  if(msg.method==='cancelLogin'&&!active){providers.cancelLogin();publish();return publicProviderState(providers);}
  if(active||authBusy)throw Error('worker_busy');
  if(!initialized)throw Error('provider_initializing');
  if(!methods.has(msg.method))throw Error('unsupported_command');
  authBusy=true;
  try {
    const arg=msg.input;
    if(['login','select','disconnect'].includes(msg.method)&&!['aipro','chatgpt','fabrix','claude'].includes(arg))throw Error('invalid_provider');
    if(msg.method==='connect'&&arg?.provider!=='fabrix')throw Error('invalid_provider');
    const result=await providers[msg.method](arg);await providers.flushConnections();publish();return result;
  }finally{authBusy=false;}
}

function stopPending() {
  for (const p of pending.values()) { p.cleanup(); p.reject(new Error('cancelled')); }
  pending.clear();
}

async function receive(msg: Record<string, any>) {
  if(msg.type==='vault_result'){
    const p=vaultPending.get(msg.id);if(p){clearTimeout(p.timer);vaultPending.delete(msg.id);msg.ok?p.resolve():p.reject(Error('storage_failed'));}return;
  }
  if(msg.type==='init'&&!initialized&&!authBusy){
    authBusy=true;try{services.restore(msg.services);await providers.restoreConnections(msg.records||[],msg.selected);}finally{initialized=true;authBusy=false;publish();send({type:"services_state",state:services.state()});}return;
  }
  if(msg.type==='services'){
    if(active||authBusy||!initialized){send({type:'reply',id:msg.id,error:'worker_busy'});return;}
    authBusy=true;try{const result=msg.method==='configure'?await services.configure(msg.input):msg.method==='clear'?await services.clear():services.state();send({type:'services_state',state:services.state()});send({type:'reply',id:msg.id,result});}catch{send({type:'reply',id:msg.id,error:'services_connection_failed'});}finally{authBusy=false;}return;
  }
  if(msg.type==='provider'){
    try{const result=await providerCommand(msg);send({type:'reply',id:msg.id,result});}
    catch(e){send({type:'reply',id:msg.id,error:['worker_busy','claude_cli_missing','claude_cli_failed','claude_cli_timeout','claude_cli_update','claude_login_required','browser_unavailable'].includes((e as Error).message)?(e as Error).message:'connection_failed'});}return;
  }
  if(msg.type==='clear_conversation'&&!active){conversations.clear(String(msg.conversationId));return;}

  if (msg.type === 'tool_result' && typeof msg.id === 'string') {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p.cleanup(); p.resolve(msg.result as Record<string, unknown>); }
    return;
  }
  if (msg.type === 'cancel' && active && active.id === msg.runId) { active.cancel(); stopPending(); return; }
  if (msg.type !== 'start' || typeof msg.runId !== 'string') return;
  const id = msg.runId;
  if (active || authBusy) { send({type:'error',runId:id,error:'worker_busy'}); return; }
  if (typeof msg.request !== 'string' || !msg.request.trim() || msg.request.length > 8000) {
    send({type:'error',runId:id,error:'request_invalid'}); return;
  }
  try {
    const transport=msg.config?providerTransport(validateConfig(msg.config)):nubiTransport(providers);
    if(!msg.config&&(!initialized||!providers.status().connected||providers.status().pending))throw Error('no_credential');
    const conversationId=String(msg.conversationId||id);
    const context=(msg.context||{}) as Record<string,unknown>;
    const native:import('./excel-skill').NativeCall=(name,input,signal) => new Promise((resolve,reject) => {
        if (signal?.aborted) { reject(new Error('cancelled')); return; }
        const callId = randomUUID();
        const cancel = () => { const p=pending.get(callId); pending.delete(callId); p?.cleanup(); reject(new Error('cancelled')); };
        const timeout = setTimeout(cancel, 10 * 60 * 1000);
        pending.set(callId,{resolve,reject,cleanup:()=>{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}});
        signal?.addEventListener('abort',cancel,{once:true});
        send({type:'tool',runId:id,id:callId,name,input});
      });
    const root=String(context.artifactRoot||mkdtempSync(join(tmpdir(),'office-x-artifacts-')));
    let artifacts=artifactStores.get(root);if(!artifacts){artifacts=new Artifacts(root);artifactStores.set(root,artifacts);}
    const run = startAgent({transport, request:msg.request, history:conversations.history(conversationId,context),
      additionalSkills:[extendedOfficeSkill({native,context,transport,services,artifacts,event:(type,data)=>send({type,runId:id,data})}),originalFileSkill(native,context,artifacts)],
      context:(msg.context || {}) as Record<string,unknown>,
      event:(type,data) => send({type,runId:id,data}),
      native,
    });
    active = {id,cancel:run.cancel};
    // Host cancellation still works during provider timeout/backoff or native approval waits.
    const result = await run.result;
    if(!result.cancelled)conversations.remember(conversationId,context,run.messages());
    publish();send({type:'done',runId:id,result});
  } catch(e) {
    const code=(e as Error).message;
    send({type:'error',runId:id,error:/^(office_repeated_tool_failure|claude_[a-z_]+|rate_limited|provider_response_failed|no_credential)$/.test(code)?code:'agent_failed'});
  } finally { if (active?.id === id) active=undefined; stopPending(); }
}

// Bound input before JSON parsing, including a peer that never sends a newline.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  if (buffer.length > MAX_LINE) { active?.cancel(); stopPending(); process.exit(2); }
  let index: number;
  while ((index=buffer.indexOf('\n')) >= 0) {
    const line=buffer.slice(0,index); buffer=buffer.slice(index+1);
    try { void receive(JSON.parse(line)).catch(()=>process.exit(2)); }
    catch { active?.cancel(); stopPending(); process.exit(2); }
  }
});
process.stdin.on('end',()=>{active?.cancel();stopPending();providers.dispose();process.exit(0);});
send({type:'ready',protocol:'office-x-v1',engine:'genoffice',revision:'438d9c65709952490c970beaa2599ef45e74431f'});
