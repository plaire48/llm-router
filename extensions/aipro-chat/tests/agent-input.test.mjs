import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueueInput,nextInput,reorderInput} from '../agent-inbox.js';
import {runAgent} from '../agent-runtime.js';
const binding={conversationId:'one',provider:'aipro',credentialReceivedAt:1};
const done={content:'완료',calls:null};
const tool={type:'function',function:{name:'read_page',description:'Read page',parameters:{type:'object',properties:{}}}};
const call=()=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_page',arguments:'{}'}}]});
const base=()=>({messages:[{role:'user',content:'원래 요청'}],tools:[tool],signal:new AbortController().signal});
test('durable inputs deduplicate IDs and bind to conversation, provider and credential',()=>{
 const input={id:'one',mode:'steer',text:'변경 요청'};const queue=enqueueInput([],input,binding);
 assert.equal(enqueueInput(queue,input,binding),queue);
 for(const patch of [{conversationId:'two'},{provider:'fabrix'},{credentialReceivedAt:2},{runId:'different-run'}]) assert.equal(nextInput(queue,{...binding,...patch}),null);
 assert.throws(()=>enqueueInput(queue,{...input,text:'다른 내용'},binding),/agent_input_invalid/);
 assert.equal(nextInput(queue,binding,'queue'),null);assert.equal(nextInput(queue,binding,'steer').text,input.text);
});
test('steering arriving during model generation blocks stale tool execution and reaches next inference',async()=>{
 let input,round=0,executions=0;
 await runAgent({...base(),takeInput:async()=>{const x=input;input=null;return x;},complete:async messages=>{
  if(++round===1){input={text:'클릭하지 말고 설명만 해줘'};return call();}
  assert(messages.some(m=>m.role==='user'&&m.content=== '클릭하지 말고 설명만 해줘'));
  assert(messages.some(m=>m.role==='tool'&&m.content.includes('NOT executed')));return done;
 },execute:async()=>{executions++;return{ok:true};}});
 assert.equal(executions,0);assert.equal(round,2);
});
test('steering after completed action retains receipt and never replays the action',async()=>{
 let input,round=0,executions=0;
 await runAgent({...base(),takeInput:async()=>{const x=input;input=null;return x;},complete:async messages=>{
  if(++round===1)return call();
  assert(messages.some(m=>m.role==='tool'&&m.content.includes('receipt-1')));
  assert(messages.some(m=>m.role==='user'&&m.content==='이 결과로 표를 만들어줘'));return done;
 },execute:async()=>{executions++;input={text:'이 결과로 표를 만들어줘'};return{ok:true,receipt:'receipt-1'};}});
 assert.equal(executions,1);
});
test('input arriving while final completion assessment runs is incorporated before exit',async()=>{
 let input,round=0,reviews=0;
 await runAgent({...base(),takeInput:async()=>{const x=input;input=null;return x;},complete:async messages=>{
  round++;if(round>1)assert(messages.some(m=>m.content==='더 짧게'));return done;
 },assessCompletion:async()=>{if(++reviews===1)input={text:'더 짧게'};return{decision:'reply'};},execute:async()=>assert.fail()});
 assert.equal(round,2);assert.equal(reviews,2);
});
test('messages submitted after cancellation are not consumed',async()=>{
 const controller=new AbortController();controller.abort();let consumed=0;
 await assert.rejects(runAgent({...base(),signal:controller.signal,takeInput:async()=>{consumed++;return{text:'실행'};},complete:async()=>done}),/cancelled/);
 assert.equal(consumed,0);
});
test('withdrawing a promoted message after inference interruption resumes the original task without empty completion',async()=>{
 let round=0;
 const result=await runAgent({...base(),takeInput:async()=>null,complete:async messages=>{
  if(++round===1)return{content:'',calls:null,interruptedByUser:true};
  assert(messages.some(m=>m.role==='user'&&m.content==='원래 요청'));
  assert(messages.at(-1).content.includes('Continue the existing task'));return done;
 },execute:async()=>assert.fail('no tool may replay')});
 assert.equal(round,2);assert.equal(result.content,'완료');
});
test('an active run drains its own FIFO without executing an older paused chain',()=>{
 const paused=enqueueInput([],{id:'paused',mode:'queue',text:'보류'},{...binding,runId:'old'});
 const active=enqueueInput(paused,{id:'current',mode:'queue',text:'새 작업'},{...binding,runId:'new'});
 assert.equal(nextInput(active,{...binding,runId:'new'}).id,'current');
 assert.equal(nextInput(active,{...binding,runId:'old'}).id,'paused');
 assert.equal(nextInput(active,{...binding,runId:'new',credentialReceivedAt:2}),null);
});

test('drag reorder changes pending FIFO only and rejects stale snapshots and crossed run/account boundaries',()=>{
 const entries=['a','b','c'].map(id=>({...binding,runId:'run',id,text:id,mode:'queue'}));
 const change={id:'c',overId:'a',order:['a','b','c']};
 const moved=reorderInput(entries,change,binding);
 assert.deepEqual(moved.map(item=>item.id),['c','a','b']);
 assert.equal(nextInput(moved,{...binding,runId:'run'},'queue').id,'c');
 assert.deepEqual(entries.map(item=>item.id),['a','b','c']);
 assert.throws(()=>reorderInput(moved,change,binding),/agent_input_changed/);
 assert.throws(()=>reorderInput(entries.slice(1),change,binding),/agent_input_changed/);
 assert.throws(()=>reorderInput(entries,change,{...binding,credentialReceivedAt:2}),/agent_input_changed/);
 assert.throws(()=>reorderInput(entries.map(item=>item.id==='c'?{...item,mode:'steer'}:item),change,binding),/agent_input_changed/);
 assert.throws(()=>reorderInput(entries.map(item=>item.id==='b'?{...item,runId:'paused'}:item),change,binding),/agent_input_changed/);
});

test('visible queue reordering preserves hidden steering slots and every ownership boundary',()=>{
 const entries=['a','s1','b','s2','c'].map(id=>({...binding,runId:'run',id,text:id,mode:id.startsWith('s')?'steer':'queue'}));
 const order=entries.map(item=>item.id),change={id:'c',overId:'a',order};
 const moved=reorderInput(entries,change,binding);
 assert.deepEqual(moved.map(item=>item.id),['c','s1','a','s2','b']);
 assert.equal(moved[1],entries[1]);assert.equal(moved[3],entries[3]);
 assert.equal(nextInput(moved,{...binding,runId:'run'},'steer').id,'s1');
 assert.deepEqual(reorderInput(entries,{id:'a',overId:'c',order},binding).map(item=>item.id),['b','s1','c','s2','a']);
 assert.deepEqual(entries.map(item=>item.id),order);
 for(const changed of [{runId:'paused'},{credentialReceivedAt:2},{provider:'other'},{conversationId:'other'},{mode:'invalid'}]){
  assert.throws(()=>reorderInput(entries.map(item=>item.id==='s1'?{...item,...changed}:item),change,binding),/agent_input_changed/);
 }
 assert.throws(()=>reorderInput(entries,{...change,overId:'s1'},binding),/agent_input_changed/);
 assert.throws(()=>reorderInput(moved,change,binding),/agent_input_changed/);
});
