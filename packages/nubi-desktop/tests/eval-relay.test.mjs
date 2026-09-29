import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,chmod,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startRelayServer,connectRelayProviders,publicStatus} from '../eval/relay.mjs';

const posix=process.platform!=='win32';
async function session(t,providers){
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-relay-'));await chmod(directory,0o700);
  const socketPath=posix?path.join(directory,'model.sock'):`\\\\.\\pipe\\nubi-relay-test-${process.pid}-${Date.now()}`;
  const server=await startRelayServer({providers,socketPath}),client=await connectRelayProviders({socketPath});
  t.after(async()=>{client.dispose();await server.close();await rm(directory,{recursive:true,force:true});});
  return {client,server,socketPath,directory};
}
const status=()=>({provider:'chatgpt',model:'fixture',connected:true,token:'SECRET_TOKEN',sessions:{secret:'SECRET_SESSION'},models:[{id:'fixture',label:'Fixture',contextLength:200000,maxOutputTokens:8192,supportsImages:true,secret:'SECRET_MODEL_FIELD'}]});

test('status carries model limits and never a credential',async t=>{
  const {client}=await session(t,{status,complete:async()=>({content:''})});
  assert.deepEqual(client.status(),{provider:'chatgpt',model:'fixture',connected:true,models:[{id:'fixture',label:'Fixture',contextLength:200000,maxOutputTokens:8192,supportsImages:true}]});
  assert.ok(!JSON.stringify(publicStatus(status())).includes('SECRET'));
});

test('a completion returns content, calls and usage; activity reaches the caller',async t=>{
  let received;
  const {client}=await session(t,{status,async complete(messages,tools,signal,onText){received={messages,tools};onText('partial');return {content:'답변',calls:[{id:'c1',type:'function',function:{name:'read_source',arguments:'{"path":"a"}'},secret:'x'}],finishReason:'stop',usage:{prompt_tokens:10,completion_tokens:2},raw:'SECRET_RAW'};}});
  let active=0;
  const result=await client.complete([{role:'user',content:'질문'}],[{type:'function',function:{name:'read_source'}}],undefined,()=>active++);
  assert.deepEqual(received.messages,[{role:'user',content:'질문'}]);
  assert.deepEqual(result,{content:'답변',calls:[{id:'c1',type:'function',function:{name:'read_source',arguments:'{"path":"a"}'}}],finishReason:'stop',usage:{prompt_tokens:10,completion_tokens:2}});
  assert.equal(active,1);
});

test('an upstream failure keeps its safe code and status only',async t=>{
  const {client}=await session(t,{status,async complete(){throw Object.assign(new Error('Bearer SECRET_TOKEN rejected at https://internal.example'),{status:401});}});
  await assert.rejects(client.complete([{role:'user',content:'q'}],[]),error=>{assert.equal(error.status,401);assert.ok(!error.message.includes('SECRET'));assert.ok(!error.message.includes('https://'));return true;});
});

test('cancelling a run aborts the upstream call',async t=>{
  let aborted=false,started;const running=new Promise(resolve=>{started=resolve;});
  const {client}=await session(t,{status,complete:(messages,tools,signal)=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>{aborted=true;reject(new Error('cancelled'));});})});
  const controller=new AbortController(),pending=client.complete([{role:'user',content:'q'}],[],controller.signal);
  await running;controller.abort();
  await assert.rejects(pending,/cancelled/);
  for(let wait=0;wait<50&&!aborted;wait++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(aborted,true);
});

test('a lost session rejects the call with a code that is not retried',async t=>{
  const {client,server}=await session(t,{status,complete:()=>new Promise(()=>{})});
  // Attach the expectation first: the rejection arrives while the server closes.
  const pending=assert.rejects(client.complete([{role:'user',content:'q'}],[]),error=>error.message==='worker_disconnected'&&error.retryable===false);
  await server.close();
  await pending;
  await assert.rejects(client.complete([{role:'user',content:'q'}],[]),/worker_disconnected/);
});

test('a socket directory readable by others is refused',{skip:!posix},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-relay-open-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const open=path.join(directory,'open');await mkdir(open,{mode:0o755});await chmod(open,0o755);
  await assert.rejects(startRelayServer({providers:{status,complete:async()=>({})},socketPath:path.join(open,'model.sock')}),/socket_directory_not_private/);
});

test('the socket itself is owner-only',{skip:!posix},async t=>{
  const {socketPath}=await session(t,{status,complete:async()=>({content:''})});
  assert.equal((await stat(socketPath)).mode&0o077,0);
});

test('a missing session and an overlong socket path fail with clear codes',{skip:!posix},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-relay-none-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await assert.rejects(connectRelayProviders({socketPath:path.join(directory,'absent.sock')}),/worker_disconnected/);
  const long=path.join(directory,'x'.repeat(120),'model.sock');
  await assert.rejects(connectRelayProviders({socketPath:long}),/socket_path_too_long/);
  await assert.rejects(startRelayServer({providers:{status,complete:async()=>({})},socketPath:long}),/socket_path_too_long/);
});
