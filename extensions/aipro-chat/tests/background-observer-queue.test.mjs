import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'acorn';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../public/background.js',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declaration=name=>{const node=ast.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name===name);assert(node, name);return source.slice(node.start,node.end);};
const listener=ast.body.find(n=>n.type==='ExpressionStatement'&&source.slice(n.start,n.end).startsWith('chrome.runtime.onMessage.addListener('));
assert(listener);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture() {
  const gate=deferred(), operations=[], events=[];let call,onMessage;
  const context={queueGate:gate.promise,chrome:{runtime:{onMessage:{addListener:fn=>{onMessage=fn;}}}},
    createBackgroundRunner:options=>{call=options.call;return {};},compareImages:()=>{},trustedUI:sender=>sender?.trusted===true,
    handle:async(message,sender)=>{
      events.push(message.type);
      if(['RUN_TOOL','APPLY_FILL'].includes(message.type)) {const next=deferred();operations.push(next);return next.promise;}
      if(!sender.trusted)throw Error('invalid_sender');
      assert.equal(message.type,'GET_STATE');return {recoveryAllowed:true};
    },
    state:async(sender,clientId,readOnly)=>{assert.equal(sender.trusted,true);assert.equal(readOnly,true);events.push('READONLY_STATE');return {nativeDialog:{id:'pending'},readOnly:true};},
    ERROR_TEXT:{invalid_sender:'Denied'},prepareCredential:()=>{},
  };
  runInNewContext(`const RUNNER={};const boot=Promise.resolve();let queue=queueGate;\n${['pendingToolOperations','serial','serialTool','runner'].map(declaration).join('\n')}\n${source.slice(listener.start,listener.end)}\nglobalThis.pending=()=>pendingToolOperations;`,context);
  const message=(type,trusted=true)=>new Promise(resolve=>onMessage({type},{trusted},resolve));
  return {gate,operations,events,call,message,pending:context.pending};
}
test('actual host observer bypasses a queued worker tool before it starts or waits for a native dialog',async()=>{
  const f=fixture(), running=f.call('RUN_TOOL',{});
  assert.equal(f.pending(),1);
  const early=await f.message('GET_STATE');assert.equal(early.data.readOnly,true);
  assert.deepEqual(f.events,['READONLY_STATE']);
  f.gate.resolve();await flush();assert.equal(f.operations.length,1);
  const pending=await f.message('GET_STATE');assert.equal(pending.data.nativeDialog.id,'pending');
  f.operations[0].resolve({});await running;assert.equal(f.pending(),0);
  assert.equal((await f.message('GET_STATE')).data.recoveryAllowed,true);
});
test('external tool messages use the same enqueue reservation and release it on completion',async()=>{
  const f=fixture(), running=f.message('APPLY_FILL');assert.equal(f.pending(),1);
  assert.equal((await f.message('GET_STATE')).data.readOnly,true);
  f.gate.resolve();await flush();f.operations[0].resolve({applied:true});
  assert.equal((await running).data.applied,true);assert.equal(f.pending(),0);
});
test('untrusted state requests cannot bypass the queue or existing sender validation',async()=>{
  const f=fixture(), running=f.call('RUN_TOOL',{});let received=false;
  const denied=f.message('GET_STATE',false).then(value=>{received=true;return value;});
  f.gate.resolve();await flush();assert.equal(received,false);assert.deepEqual(f.events,['RUN_TOOL']);
  f.operations[0].resolve({});await running;
  assert.equal((await denied).error,'invalid_sender');assert(!f.events.includes('READONLY_STATE'));
});
test('a failed long operation does not clear another queued reservation and all counts recover',async()=>{
  const f=fixture(), first=f.call('RUN_TOOL',{}), second=f.call('APPLY_FILL',{});
  const failure=assert.rejects(first,/failed action/);assert.equal(f.pending(),2);
  f.gate.resolve();await flush();f.operations[0].reject(Error('failed action'));await failure;await flush();
  assert.equal(f.pending(),1);assert.equal(f.operations.length,2);
  assert.equal((await f.message('GET_STATE')).data.readOnly,true);
  f.operations[1].resolve({});await second;assert.equal(f.pending(),0);
  assert.equal((await f.message('GET_STATE')).data.recoveryAllowed,true);
});
