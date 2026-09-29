// Evaluation-only model relay. One session process holds the login; evaluation
// runs ask it for completions over a private socket. The credential never
// leaves the session process: it is not written to disk, logged, or sent over
// the socket. Not a product feature and not bundled.
import {createServer,createConnection} from 'node:net';
import {createInterface} from 'node:readline';
import {chmod,mkdir,rm,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir,userInfo} from 'node:os';
import {randomUUID} from 'node:crypto';
import {safeError} from '../../nubi-office/worker/connection-errors.mjs';

const posix=process.platform!=='win32';
const ACTIVITY_INTERVAL_MS=1000;
// A Unix socket path has a small platform limit (104 bytes on macOS, 108 on Linux).
const MAX_SOCKET_PATH_BYTES=100;
const checkPath=socketPath=>{if(posix&&Buffer.byteLength(socketPath)>MAX_SOCKET_PATH_BYTES)throw new Error('socket_path_too_long');};
// readline re-emits socket errors. Unhandled, they would end the process.
const lines=(socket,onLine)=>createInterface({input:socket,crlfDelay:Infinity}).on('error',()=>{}).on('line',onLine);
export const defaultSocketPath=()=>posix?join(tmpdir(),`nubi-desktop-eval-${userInfo().uid}`,'model.sock'):`\\\\.\\pipe\\nubi-desktop-eval-${userInfo().username}`;

const positive=value=>Number.isSafeInteger(value)&&value>0?value:undefined;
// Desktop budgets context from these limits, so they travel with the status.
const publicModel=model=>({id:model.id,label:model.label,contextLength:positive(model.contextLength),maxInputTokens:positive(model.maxInputTokens),maxOutputTokens:positive(model.maxOutputTokens),...(typeof model.supportsImages==='boolean'?{supportsImages:model.supportsImages}:{})});
export const publicStatus=status=>({provider:status.provider,model:status.model,connected:status.connected===true,models:(status.models||[]).map(publicModel)});
const publicResult=result=>({content:result.content??'',calls:(result.calls||[]).map(call=>({id:call.id,type:call.type,function:{name:call.function?.name,arguments:call.function?.arguments}})),finishReason:result.finishReason,...(result.usage?{usage:result.usage}:{})});
const publicError=error=>({code:safeError(error),...(Number.isInteger(error?.status)?{status:error.status}:{}),...(Number.isFinite(error?.retryAfterMs)?{retryAfterMs:error.retryAfterMs}:{})});

export async function startRelayServer({providers,socketPath}){
  checkPath(socketPath);
  if(posix){
    const directory=dirname(socketPath);
    await mkdir(directory,{recursive:true,mode:0o700});
    // Any local process that can open the socket can spend the user's model quota.
    if((await stat(directory)).mode&0o077)throw new Error('socket_directory_not_private');
    await rm(socketPath,{force:true});
  }
  const sockets=new Set();
  const server=createServer(socket=>{
    const pending=new Map();sockets.add(socket);
    const send=value=>{if(!socket.destroyed)socket.write(JSON.stringify(value)+'\n');};
    const refuse=(id,code)=>send({id,ok:false,error:{code}});
    socket.on('error',()=>{});
    socket.on('close',()=>{sockets.delete(socket);for(const controller of pending.values())controller.abort();pending.clear();});
    lines(socket,line=>{
      let request;try{request=JSON.parse(line);}catch{refuse(null,'invalid_request');return;}
      const id=typeof request?.id==='string'&&request.id.length<=100?request.id:null;
      if(!id){refuse(null,'invalid_request');return;}
      if(request.method==='status'){send({id,ok:true,result:publicStatus(providers.status())});return;}
      if(request.method==='cancel'){pending.get(request.target)?.abort();send({id,ok:true,result:{cancelled:true}});return;}
      if(request.method!=='complete'){refuse(id,'unknown_method');return;}
      if(!Array.isArray(request.messages)||!Array.isArray(request.tools)||pending.has(id)){refuse(id,'invalid_request');return;}
      const controller=new AbortController();pending.set(id,controller);
      // The run's idle clock needs model activity; forward it without content.
      let last=0;const activity=()=>{const now=Date.now();if(now-last<ACTIVITY_INTERVAL_MS||!pending.has(id))return;last=now;send({id,event:'activity'});};
      Promise.resolve().then(()=>providers.complete(request.messages,request.tools,controller.signal,activity,activity))
        .then(result=>send({id,ok:true,result:publicResult(result)}),error=>send({id,ok:false,error:controller.signal.aborted?{code:'cancelled'}:publicError(error)}))
        .finally(()=>pending.delete(id));
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  if(posix)await chmod(socketPath,0o600);
  return{async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));if(posix)await rm(socketPath,{force:true});}};
}

// The providers object an evaluation run uses. It holds no credential.
export async function connectRelayProviders({socketPath}){
  checkPath(socketPath);
  const socket=createConnection(socketPath),pending=new Map();let closed=false;
  // A lost session must stop the run; a retryable code would loop on a dead socket.
  const lost=()=>{if(closed)return;closed=true;for(const {reject} of pending.values())reject(Object.assign(new Error('worker_disconnected'),{retryable:false}));pending.clear();};
  socket.on('error',lost);socket.on('close',lost);
  lines(socket,line=>{
    let reply;try{reply=JSON.parse(line);}catch{return;}
    const waiting=pending.get(reply.id);if(!waiting)return;
    if(reply.event==='activity'){try{waiting.activity();}catch{/* Presentation only. */}return;}
    pending.delete(reply.id);
    if(reply.ok)waiting.resolve(reply.result);
    else{const {code,...facts}=reply.error||{};waiting.reject(Object.assign(new Error(code||'request_failed'),facts));}
  });
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',()=>reject(new Error('worker_disconnected')));});
  const request=(id,method,body={},activity=()=>{})=>new Promise((resolve,reject)=>{
    if(closed){reject(Object.assign(new Error('worker_disconnected'),{retryable:false}));return;}
    pending.set(id,{resolve,reject,activity});
    socket.write(JSON.stringify({id,method,...body})+'\n');
  });
  const status=await request(randomUUID(),'status');
  return{
    status:()=>structuredClone(status),
    complete(messages,tools=[],signal,onText=()=>{}){
      if(signal?.aborted)return Promise.reject(new Error('cancelled'));
      const id=randomUUID(),result=request(id,'complete',{messages,tools},()=>onText());
      const abort=()=>{
        const waiting=pending.get(id);if(!waiting)return;
        pending.delete(id);waiting.reject(new Error('cancelled'));
        if(!closed)socket.write(JSON.stringify({id:randomUUID(),method:'cancel',target:id})+'\n');
      };
      signal?.addEventListener('abort',abort,{once:true});
      return result.finally(()=>signal?.removeEventListener('abort',abort));
    },
    dispose(){closed=true;pending.clear();socket.destroy();}
  };
}
