import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {runInNewContext} from 'node:vm';
const host = await readFile(new URL('../public/background.js',import.meta.url),'utf8');
const store = await readFile(new URL('../capture-store.js',import.meta.url),'utf8');
const functions = (source,names) => parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.flatMap(node=>{
  const declaration=node.type==='ExportNamedDeclaration'?node.declaration:node;
  return declaration?.type==='FunctionDeclaration'&&names.includes(declaration.id.name)?[source.slice(declaration.start,declaration.end)]:[];
}).join('\n');
const id='capture-fixture-123';
function fixture() {
  const lease={id:'reply',conversationId:'conversation',provider:'chatgpt',credentialReceivedAt:1,until:Date.now()+60000,toolNames:['attach_images']};
  const f={lease,session:{chatLease:structuredClone(lease),credential:{provider:'chatgpt',receivedAt:1}},
    chat:{sessionId:'conversation',provider:'chatgpt',messages:[{id:'reply',role:'assistant',captures:[{id,source:'browser-tab'}]}]},reads:0};
  const context={Date,Set,Number,Promise,RUNNER:{},trustedUI:()=>true,ownsChat:()=>true,refreshBrowserPolicy:async()=>{},touchChatLease:async()=>{},
    fail:code=>{throw Error(code);},getSession:async()=>f.session,
    chrome:{storage:{local:{get:async()=>({chat:f.chat})}}},
    attachedScreenshotRecords:async(ids,owner)=>{f.reads++;assert.deepEqual({...owner},{requestId:'reply',provider:'chatgpt'});await f.afterRead?.();return f.missing?null:ids.map(id=>({id,availableInChat:true}));}};
  runInNewContext(`${functions(host,['alreadyAttachedScreenshots','handle'])}\nglobalThis.lookup=alreadyAttachedScreenshots;globalThis.run=handle;`,context);
  f.lookup=refs=>context.lookup(lease,refs);
  f.run=()=>context.run({type:'RUN_TOOL',requestId:'reply',name:'attach_images',args:{refs:[id]}},{trusted:true});
  return f;
}
test('actual RUN_TOOL returns a verified existing attachment without browser or save calls',async()=>{
  const f=fixture(),before=JSON.stringify(f.chat),result=await f.run();
  assert.equal(result.alreadyAttached,true);assert.equal(result.attachments[0].id,id);
  assert.equal(result.scope,'stored_chat_attachments');assert.match(result.instruction,/does not verify the current page/);
  assert.equal(f.reads,1);assert.equal(JSON.stringify(f.chat),before);
  assert.equal((await f.run()).alreadyAttached,true);assert.equal(f.chat.messages[0].captures.length,1);
});
test('up to four screenshots in the same reply return their original attachment IDs',async()=>{
  const f=fixture(),ids=Array.from({length:4},(_,index)=>`capture-fixture-${index}`);
  f.chat.messages[0].captures=ids.map(id=>({id,source:'browser-tab'}));
  const result=await f.lookup(ids);
  assert.equal(result.alreadyAttached,true);assert.deepEqual(Array.from(result.attachments,item=>item.id),ids);
  assert.equal(f.reads,1);assert.equal(f.chat.messages[0].captures.length,4);
});
test('mixed assets, unknown IDs, old replies, other conversations/providers and invalid lists keep the existing path',async()=>{
  for(const refs of [[],[id,id],[id,'image-ref-123'],['unknown-capture'],[id,1],Array(5).fill(id)]) {
    const f=fixture();assert.equal(await f.lookup(refs),null);assert.equal(f.reads,0);
  }
  for(const change of [f=>f.chat.sessionId='other',f=>f.chat.provider='aipro',f=>f.chat.messages[0].id='old-reply',f=>f.chat.messages[0].role='user',f=>f.chat.messages[0].captures[0].source='page-image']) {
    const f=fixture();change(f);assert.equal(await f.lookup([id]),null);assert.equal(f.reads,0);
  }
});
test('missing IndexedDB screenshot is an attachment failure, never a fresh browser capture',async()=>{
  const f=fixture();f.missing=true;const result=await f.run();
  assert.equal(result.error,'capture_save_failed');assert.equal(result.alreadyAttached,false);
});
test('cancel, lease/credential/conversation/reply changes during the DB read cannot return success',async()=>{
  for(const change of [f=>f.session.chatLease.cancelled=true,f=>f.session.chatLease.id='other',f=>f.session.chatLease.conversationId='other',f=>f.session.chatLease.provider='aipro',f=>f.session.chatLease.until=0,f=>f.session.chatLease.awaitingUser=true,f=>f.session.credential.receivedAt=2,f=>f.session.credential.rejected=true,f=>f.session.credential=null,f=>f.chat.sessionId='other',f=>f.chat.messages[0].captures=[],f=>f.chat.messages[0].id='old']) {
    const f=fixture();f.afterRead=async()=>change(f);await assert.rejects(f.run(),/interrupted/);
  }
});
test('host authorization still rejects expired, cancelled and ungranted tool requests before lookup',async()=>{
  for(const change of [f=>f.session.chatLease.cancelled=true,f=>f.session.chatLease.until=0,f=>f.session.chatLease.toolNames=[]]) {
    const f=fixture();change(f);await assert.rejects(f.run(),/interrupted|tools_unavailable/);assert.equal(f.reads,0);
  }
});
test('record lookup requires matching owner, browser screenshot provenance and a nonempty PNG Blob',async()=>{
  const valid={id,source:'browser-tab',requestId:'reply',provider:'chatgpt',bytes:1,blob:new Blob(['a'],{type:'image/png'})};
  let record=valid,transactions=0;
  const context={Blob,Set,transaction:async(mode,operation)=>{transactions++;assert.equal(mode,'readonly');return new Promise(resolve=>operation({get:()=>{const request={};queueMicrotask(()=>{request.result=record;request.onsuccess();});return request;}},resolve));}};
  runInNewContext(`${functions(store,['attachedScreenshotRecords'])}\nglobalThis.lookup=attachedScreenshotRecords;`,context);
  assert.equal((await context.lookup([id],{requestId:'reply',provider:'chatgpt'}))[0].availableInChat,true);
  for(const patch of [{id:'other'},{requestId:'old'},{provider:'aipro'},{source:'page-image'},{blob:null},{blob:new Blob([],{type:'image/png'})},{blob:new Blob(['a'],{type:'image/jpeg'})},{bytes:2}]) {
    record={...valid,...patch};assert.equal(await context.lookup([id],{requestId:'reply',provider:'chatgpt'}),null);
  }
  const count=transactions;assert.equal(await context.lookup(Array(5).fill(id),{requestId:'reply',provider:'chatgpt'}),null);assert.equal(transactions,count);
});
