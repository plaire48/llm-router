import { randomUUID } from 'node:crypto';
import { startAgent } from './agent';
import {trackEdits} from './edit-receipts';
import { nubiTransport } from './nubi-transport';
import { Conversations } from './conversations';
// @ts-expect-error Nubi preserves its original JavaScript modules.
import { officeProviders, publicProviderState } from './nubi-providers.mjs';
// @ts-expect-error Office-only connection adapter preserves upstream modules.
import {restoreManualConnection,providerCommandError} from './provider-connection.mjs';
import { providerTransport, validateConfig } from './transport';
import {Artifacts} from './services';
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
let compactControl:AbortController|undefined;
// @ts-expect-error Shared Workspace context policy.
import {estimateTokens,contextBudget} from './context-policy.mjs';
const selectedModel=()=>{const state=publicProviderState(providers);return (state.models||[]).find((m:any)=>m.id===state.model)||{id:state.model||''};};
const contextState=(id:string,model=selectedModel())=>({type:'context_state',conversationId:id,...conversations.status(id,model)});
const artifactStores=new Map<string,Artifacts>();
let authBusy=false,initialized=false,lastState='';
const savedConnections=new Map<string,Record<string,any>>();
function publish(){const state={...publicProviderState(providers),initializing:!initialized,authBusy},encoded=JSON.stringify(state);if(encoded!==lastState){lastState=encoded;send({type:'provider_state',state});}}
const stateTimer=setInterval(publish,500);stateTimer.unref();
const methods=new Set(['status','login','cancelLogin','select','model','reasoning','refreshModels','disconnect','connect']);
async function providerCommand(msg:Record<string,any>){
  if(msg.method==='cancelLogin'&&!active){providers.cancelLogin();publish();return publicProviderState(providers);}
  if(active||authBusy||compactControl)throw Error('worker_busy');
  if(!initialized)throw Error('provider_initializing');
  if(!methods.has(msg.method))throw Error('unsupported_command');
  authBusy=true;publish();
  try {
    const arg=msg.input;
    if(['login','select','disconnect'].includes(msg.method)&&!['aipro','chatgpt','fabrix','claude'].includes(arg))throw Error('invalid_provider');
    if(msg.method==='connect'&&arg?.provider!=='fabrix')throw Error('invalid_provider');
    let result;
    if(msg.method==='login'){
      let expired=false,timer:ReturnType<typeof setTimeout>|undefined;
      const connect=async()=>{
        if(savedConnections.has(arg)){
          const record=savedConnections.get(arg);
          const restored=await restoreManualConnection(providers,record,arg,{cancelled:()=>expired});if(expired)throw Error('cancelled');
          savedConnections.delete(arg);if(restored)return restored;
        }
        if(expired)throw Error('cancelled');return providers.login(arg);
      };
      try{result=await Promise.race([connect(),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;providers.cancelConnection(arg);reject(Error('connection_timeout'));},55000);})]);}
      finally{if(timer)clearTimeout(timer);}
    }else{if(msg.method==='disconnect')savedConnections.delete(arg);result=await providers[msg.method](arg);}
    await providers.flushConnections();publish();return result;
  }finally{authBusy=false;publish();}
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
    authBusy=true;try{for(const record of msg.records||[])if(record&&['aipro','chatgpt','fabrix','claude'].includes(record.provider))savedConnections.set(record.provider,record);}finally{initialized=true;authBusy=false;publish();}return;
  }
  if(msg.type==='services'){send({type:'reply',id:msg.id,error:'feature_removed'});return;}
  if(msg.type==='context'){
    const conversationId=String(msg.input?.conversationId||'');
    if(!conversationId||conversationId.length>128){send({type:'reply',id:msg.id,error:'context_invalid'});return;}
    if(msg.method==='cancel'){compactControl?.abort();send({type:'reply',id:msg.id,result:{cancelled:true}});return;}
    if(msg.method==='status'){send({type:'reply',id:msg.id,result:contextState(conversationId)});return;}
    if(msg.method!=='compact'||active||authBusy||compactControl||!initialized){send({type:'reply',id:msg.id,error:'worker_busy'});return;}
    const control=new AbortController();compactControl=control;
    send({type:'context_compacting',conversationId,active:true});
    try{
      if(!providers.status().connected||providers.status().pending)throw Error('no_credential');
      conversations.seed(conversationId,msg.input.messages);
      const result=await conversations.compact(conversationId,nubiTransport(providers),selectedModel(),control.signal);
      send(contextState(conversationId));send({type:'reply',id:msg.id,result});
    }catch(e){send({type:'reply',id:msg.id,error:(e as Error).message==='cancelled'?'cancelled':'context_compaction_failed'});}
    finally{compactControl=undefined;send({type:'context_compacting',conversationId,active:false});publish();}return;
  }
  if(msg.type==='provider'){
    try{const result=await providerCommand(msg);send({type:'reply',id:msg.id,result});}
    catch(e){send({type:'reply',id:msg.id,operation:msg.method,error:providerCommandError(msg.method,e)});}return;
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
  if (active || authBusy || compactControl) { send({type:'error',runId:id,error:'worker_busy'}); return; }
  if (typeof msg.request !== 'string' || !msg.request.trim() || msg.request.length > 8000) {
    send({type:'error',runId:id,error:'request_invalid'}); return;
  }
  try {
    const baseTransport=msg.config?providerTransport(validateConfig(msg.config)):nubiTransport(providers);
    if(!msg.config&&(!initialized||!providers.status().connected||providers.status().pending))throw Error('no_credential');
    const conversationId=String(msg.conversationId||id);
    const context=(msg.context||{}) as Record<string,unknown>;
    const native:import('./excel-skill').NativeCall=trackEdits((name,input,signal) => new Promise((resolve,reject) => {
        if (signal?.aborted) { reject(new Error('cancelled')); return; }
        const callId = randomUUID();
        const cancel = () => { const p=pending.get(callId); pending.delete(callId); p?.cleanup(); reject(new Error('cancelled')); };
        const timeout = setTimeout(cancel, 10 * 60 * 1000);
        pending.set(callId,{resolve:(result)=>{if(result.documentTarget==='current'||result.documentTarget==='new')context.documentTarget=result.documentTarget;if(result.documentId){context.documentId=result.documentId;context.targetId=result.targetId||'document';context.selectionAvailable=false;delete context.snapshotId;delete context.address;delete context.worksheet;delete context.worksheetId;delete context.cells;delete context.selection;context.document=result.document;}resolve(result);},reject,cleanup:()=>{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}});
        signal?.addEventListener('abort',cancel,{once:true});
        send({type:'tool',runId:id,id:callId,name,input});
      }));
    const model=msg.config?{id:msg.config.model}:selectedModel();
    conversations.begin(conversationId,context);
    const publishContext=()=>send(contextState(conversationId,model));
    const transport:import('@genoffice/agent-core').AgentTransport={stream(request,cb){
      const primary=request.tools.length>0;let output='';
      if(primary){conversations.updateUsage(conversationId,{model:model.id,used:estimateTokens(JSON.stringify(request)),kind:'estimated',reason:'request_pending'});publishContext();}
      return baseTransport.stream(request,{...cb,onPhase:phase=>{send({type:'phase',runId:id,data:phase});cb.onPhase?.(phase);},onDelta:text=>{output+=text;cb.onDelta(text);},onUsage:usage=>{
        if(primary&&Number.isSafeInteger(usage.inputTokens)&&Number.isSafeInteger(usage.outputTokens)&&usage.inputTokens!>=0&&usage.outputTokens!>=0&&Number.isSafeInteger(usage.inputTokens!+usage.outputTokens!)){conversations.updateUsage(conversationId,{model:model.id,used:usage.inputTokens!+usage.outputTokens!,kind:'measured',reported:{prompt_tokens:usage.inputTokens!,completion_tokens:usage.outputTokens!,total_tokens:usage.inputTokens!+usage.outputTokens!}});publishContext();}cb.onUsage?.(usage);
      },onDone:()=>{if(primary&&conversations.status(conversationId,model).usage?.kind!=='measured'){conversations.updateUsage(conversationId,{model:model.id,used:estimateTokens(JSON.stringify(request))+estimateTokens(output),kind:'estimated',reason:'response_usage_missing'});publishContext();}cb.onDone();}});
    }};
    const preparation=new AbortController();active={id,cancel:()=>preparation.abort()};
    const autoCompact=estimateTokens(JSON.stringify(conversations.history(conversationId,context)))>=contextBudget(model).trigger;
    if(autoCompact)send({type:'context_compacting',conversationId,active:true});
    let history;try{history=await conversations.prepare(conversationId,context,baseTransport,model,preparation.signal);}finally{if(autoCompact)send({type:'context_compacting',conversationId,active:false});}
    if(preparation.signal.aborted)throw Error('cancelled');publishContext();
    const root=String(context.artifactRoot||mkdtempSync(join(tmpdir(),'office-x-artifacts-')));
    let artifacts=artifactStores.get(root);if(!artifacts){artifacts=new Artifacts(root);artifactStores.set(root,artifacts);}
    const run = startAgent({transport, request:msg.request, history,compactionBytes:Math.max(128*1024,Math.min(768*1024,contextBudget(model).trigger*2)),
      additionalSkills:[extendedOfficeSkill({native,context,transport,artifacts,event:(type,data)=>send({type,runId:id,data})}),originalFileSkill(native,context,artifacts)],
      context:(msg.context || {}) as Record<string,unknown>,
      event:(type,data) => send({type,runId:id,data}),
      native,
    });
    active = {id,cancel:run.cancel};
    // Host cancellation still works during provider timeout/backoff or native approval waits.
    const result = await run.result;
    if(!result.cancelled)conversations.remember(conversationId,context,run.messages());
    publishContext();publish();send({type:'done',runId:id,result});
  } catch(e) {
    const code=(e as Error).message;
    if(code==='cancelled'){send({type:'done',runId:id,result:{text:'',cancelled:true,turnLimit:false}});return;}
    send({type:'error',runId:id,error:/^(office_repeated_tool_failure|agent_tool_input_failed|agent_tool_failed|agent_no_progress|agent_response_unverified|claude_[a-z_]+|rate_limited|provider_response_failed|no_credential)$/.test(code)?code:'agent_failed'});
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
