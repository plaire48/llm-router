import {createReceiver} from '../../nubi-a2a/receiver.mjs';
import {createOfficeTasks} from './office-tasks.mjs';
import {packageMetadata} from './skill-package.mjs';
import {startSkillIntake} from './skill-intake.mjs';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {createProviders, safeError} from './providers.mjs';
import {startAgent} from './agent.mjs';
import {startDocumentAgent} from './document-agent.mjs';
import {startIntentAgent} from './intent-agent.mjs';
import {createHash} from 'node:crypto';
import {startContentAgent} from './content-agent.mjs';
import {officeHost} from './office-hosts.mjs';

export function createWorker(providers = createProviders(), {host='excel'}={}) {
  officeHost(host);
  const session=value=>({...value,host});
  let run, requestId, requestSignature, a2aState={};
  const receiver=role=>createReceiver({role,load:async()=>a2aState,save:async value=>{a2aState=value;},
    busy:async()=>run?.status().state==='running'||run?.status().state==='awaiting_user',
    conversation:async input=>{if(typeof input.conversationId!=='string'||!/^[-\w]{16,100}$/.test(input.conversationId)||typeof input.draft!=='string'||input.draft.length>16000)throw new Error('a2a_scope');return {id:input.conversationId,provider:providers.status().provider,draft:input.draft};},
    result:async binding=>{if(binding.runId!==run?.id||binding.provider!==providers.status().provider)return null;const result=run.status();return result.error?null:{state:result.state,text:result.answer,awaitingUser:!!result.question};}});
  const legacy=receiver('office'),modern=receiver('office-'+host);
  const collaboration={dispatch:payload=>{let role=a2aState.connection?.role;if(payload.action==='connect'){try{role=new URLSearchParams(new URL(payload.url).hash.slice(1)).get('agent');}catch{role=null;}}return(role==='office'?legacy:modern).dispatch(payload);},bindRun:input=>modern.bindRun(input)};
  const peer=createOfficeTasks({host,connection:async()=>a2aState.connection,saveConnection:async connection=>{a2aState={...a2aState,connection};},provider:()=>providers.status(),currentRun:()=>run?{...run.status(),id:run.id}:null,cancel:()=>run?.cancel()});
  const snapshot=()=>({...run.status(),...(requestId?{requestId}:{})});
  const bound=payload=>run&&(payload.id?run.id===payload.id:payload.requestId&&requestId===payload.requestId);
  return {async dispatch(method, payload = {}) {
    const busy = run?.status().state === 'running';
    if ((busy||peer.locked()) && ['connect', 'login', 'disconnect', 'selectProvider', 'selectModel', 'refreshModels'].includes(method)) throw new Error('run_busy');
    switch (method) {
      case 'a2a': if(payload.action?.startsWith('task_'))return peer.dispatch(payload);if(peer.locked()&&['connect','disconnect','detach'].includes(payload.action))throw new Error('a2a_busy');return collaboration.dispatch(payload);
      case 'skillPackageMetadata': return packageMetadata(payload.content);
      case 'session': return session(providers.status());
      case 'connect': return session(await providers.connect(payload));
      case 'login': return session(await providers.login(payload.provider));
      case 'cancelLogin': return session(await providers.cancelLogin());
      case 'disconnect': return session(await providers.disconnect(payload.provider));
      case 'selectProvider': return session(await providers.select(payload.provider));
      case 'selectModel': return session(await providers.model(payload.model));
      case 'refreshModels': return session(await providers.refreshModels());
      case 'runStart': {
        const key=payload.requestId;
        if(key!==undefined&&(typeof key!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(key)))throw new Error('invalid_request');
        const signature=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        if(key&&key===requestId){if(signature!==requestSignature)throw new Error('operation_collision');return snapshot();}
        if (busy) throw new Error('run_busy');
        await peer.guardStart(payload);
        const start=options=>host!=='excel'?startContentAgent(options):!options.mode||options.mode==='auto'?startIntentAgent(options):options.mode==='document'?startDocumentAgent(options):startAgent(options);
        const options={...payload,providers,host};
        const next=payload.documentSkill?startSkillIntake(options,start):start(options);
        const continuation=run?.status().state==='awaiting_user';
        run=next;requestId=key;requestSignature=signature;
        peer.bindRun(payload,run);
        await collaboration.bindRun({text:payload.request,runId:run.id,conversationId:payload.conversationId,provider:providers.status().provider,continuation});
        return snapshot();
      }
      case 'runLookup': if (!run || !payload.requestId || requestId!==payload.requestId) throw new Error('run_expired'); return snapshot();
      case 'runStatus': if (!run || run.id !== payload.id) throw new Error('run_expired'); return snapshot();
      case 'runCancel': if (!bound(payload)) throw new Error('run_expired'); run.cancel(); return snapshot();
      case 'toolResult': if (!run || run.id !== payload.id) throw new Error('run_expired'); run.respond(payload.callId, payload.result); return {accepted: true};
      default: throw new Error('unknown_method');
    }
  }, dispose() { run?.cancel();peer.dispose();a2aState={}; providers.dispose(); }};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const worker = createWorker(createProviders(),{host:process.env.NUBI_OFFICE_HOST||'excel'}), lines = createInterface({input: process.stdin, crlfDelay: Infinity});
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  lines.on('line', line => {
    // One line carries a whole request: the selection and the conversation may each reach 1,000,000 characters.
    if (line.length > 8000000) {worker.dispose(); process.exitCode = 1; lines.close(); return;}
    // .NET Framework StandardInput may emit a UTF-8 preamble on Windows.
    let request; try {request = JSON.parse(line.charCodeAt(0)===0xfeff?line.slice(1):line);} catch {return;}
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(request.id || '')) return;
    void worker.dispatch(request.method, request.payload).then(result => send({id: request.id, ok: true, result}), error => send({id: request.id, ok: false, error: safeError(error)}));
  });
  lines.on('close', () => {worker.dispose(); process.exit(0);});
}
