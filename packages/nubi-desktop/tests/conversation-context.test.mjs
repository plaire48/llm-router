import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationMessages,conversationModel,prepareConversation,readConversation} from '../runtime/conversation-context.mjs';
import {createRunContext,contextBudget} from '../../../extensions/aipro-chat/context-manager.js';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {Store} from '../runtime/store.mjs';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {git} from '../runtime/files.mjs';
installAgent(ProjectService);
const summary={goal:'문서 초안',constraints:[],decisions:[],completed:[],pending:['현재 파일 확인'],references:[]};
const summarize=async()=>({content:JSON.stringify(summary),calls:[]});
const model=conversationModel({contextLength:16000});
function setup() {
  const task={id:'one',request:'초안만 만들고 전송하지 마세요.',messages:[
    {role:'assistant',content:'old source '.repeat(5500)},
    {role:'user',content:'금액은 42원입니다. 사용자 확인 없이 실행하지 마세요.'},
    {role:'assistant',content:'old output '.repeat(5500)},
    {role:'user',content:'최신 정정: 금액은 43원으로 해 주세요.'},
    {role:'assistant',content:'최근 답변'},
    {role:'user',content:'아직 초안만 작성하세요.'}]};
  conversationMessages(task);
  const records=new Map([['task:one',structuredClone(task)]]);
  const store={get:key=>structuredClone(records.get(key)),set:(key,value)=>records.set(key,structuredClone(value))};
  const controller=new AbortController();
  return {task,store,model,systems:[{role:'system',content:'Keep original requirements.'}],receipts:{role:'user',content:'Current host: no approval'},tools:[],invoke:summarize,signal:controller.signal,controller};
}
test('history boundary survives a fresh adapter and retains original text and literal restrictions',async()=>{
  const options=setup(),before=structuredClone(options.task);
  const first=await prepareConversation(options);
  assert(first.memory);assert.equal(first.memory.throughId,options.task.messages[2].id);
  assert.deepEqual(options.task,before);assert.deepEqual(options.store.get('task:one'),before);
  assert(!first.messages.some(m=>m.content===before.messages[0].content));
  assert.match(JSON.stringify(first.messages),/전송하지 마세요/);assert.match(JSON.stringify(first.messages),/최신 정정/);
  const restored=await prepareConversation({...options,task:structuredClone(before),invoke:()=>assert.fail('covered history must not be summarized again')});
  assert.equal(restored.memory,null);assert.deepEqual(restored.messages,first.messages);
  assert.equal(readConversation(before,{index:1}).text,before.messages[0].content.slice(0,8000));
});
test('closing and reopening SQLite restores the summary without discarding original dialogue',async t=>{
  const {directory}=await fixture(t),options=setup();let store=new Store(path.join(directory,'conversation'));
  try{store.set('task:one',options.task);
  const first=await prepareConversation({...options,store});store.close();store=new Store(path.join(directory,'conversation'));
  const restored=await prepareConversation({...options,store,task:store.get('task:one'),invoke:()=>assert.fail('durable boundary must be reused')});
  assert.deepEqual(restored.messages,first.messages);assert.deepEqual(store.get('task:one'),options.task);
  }finally{store.close();} // Close before the fixture removes its directory on Windows.
});
test('changed, reordered and deleted historical prefixes invalidate a saved summary',async()=>{
  for(const mutate of [task=>task.messages[0].content='changed '.repeat(8000),task=>{[task.messages[0],task.messages[2]]=[task.messages[2],task.messages[0]];},task=>task.messages.splice(0,1)]) {
    const options=setup();await prepareConversation(options);mutate(options.task);options.store.set('task:one',options.task);
    let calls=0;await prepareConversation({...options,invoke:async()=>{calls++;return summarize();}});
    assert(calls>0,'a stale summary must not replace edited original history');
  }
});
test('malformed summaries and cancellation never advance the durable boundary',async()=>{
  for(const abort of [false,true]) {
    const options=setup(),before=structuredClone(options.task);
    await assert.rejects(prepareConversation({...options,invoke:async()=>{if(abort)options.controller.abort();return {content:'invalid'};}}),abort?/cancelled/:/context_compaction_failed/);
    assert.equal(options.store.get('context-history:one'),undefined);assert.deepEqual(options.task,before);
  }
});
test('changed source during summarization and failed storage leave the boundary uncommitted',async()=>{
  const options=setup();
  await assert.rejects(prepareConversation({...options,invoke:async()=>{const current=options.store.get('task:one');current.messages[0].content='Human edit';options.store.set('task:one',current);return summarize();}}),/context_history_changed/);
  assert.equal(options.store.get('context-history:one'),undefined);
  assert.equal(options.store.get('task:one').messages[0].content,'Human edit');
  const other=setup();await assert.rejects(prepareConversation({...other,store:{...other.store,set:()=>{throw new Error('storage_unavailable');}}}),/storage_unavailable/);
  assert.equal(other.store.get('context-history:one'),undefined);
});
test('a too-large protected preamble never truncates requirements or persists memory',async()=>{
  const options=setup();await assert.rejects(prepareConversation({...options,systems:[{role:'system',content:'REQUIRED '.repeat(12000)}]}),/context_input_too_large/);
  assert.equal(options.store.get('context-history:one'),undefined);
});
test('completed-history fallback never summarizes an oversized unanswered current request',async()=>{
  const options=setup();
  options.task.messages.at(-1).content='CURRENT REQUEST: preserve every detail. '.repeat(6000);
  const before=structuredClone(options.task);
  options.store.set('task:one',before);
  await assert.rejects(prepareConversation(options),/context_input_too_large/);
  assert.equal(options.store.get('context-history:one'),undefined);
  assert.deepEqual(options.store.get('task:one'),before);
});
test('exact historical reads are bounded, scoped and explicitly non-authoritative',()=>{
  const {task}=setup();let input={index:1},text='';
  while(input?.index===1){const result=readConversation(task,input);assert(result.text.length<=8000);assert(result.historical);assert.match(result.instruction,/not a fresh observation, approval/);text+=result.text;input=result.next;}
  assert.equal(text,task.messages[0].content);
  for(const input of [{index:-1},{index:900},{offset:-1},{offset:999999}])assert.throws(()=>readConversation(task,input),/conversation_range/);
});
test('provider reply reservation is not replaced by the smaller requested summary size',()=>{
  assert.equal(contextBudget(conversationModel({contextLength:8000,maxOutputTokens:1024})).input,3904);
  assert.equal(contextBudget(conversationModel({contextLength:32000,maxInputTokens:18000})).input,18000);
  assert.equal(contextBudget(conversationModel({})).input,120000);
  assert.throws(()=>conversationModel({contextLength:4096}),/context_input_too_large/);
});
test('in-run compaction rereads live host receipts and preserves tool call/result pairs',async()=>{
  let receipt='pending approval';const protectedMessages=[{role:'user',content:'Never send the document.'}];
  const context=createRunContext({model,tools:[],goal:'Finish draft',protectedMessages,signal:new AbortController().signal,invoke:summarize,getRequirements:()=>['ACCEPTANCE',receipt]});
  const pair=(id,text)=>[{role:'assistant',content:'',tool_calls:[{id,type:'function',function:{name:'read_source',arguments:'{}'}}]},{role:'tool',tool_call_id:id,content:text}];
  const wire=[{role:'system',content:'System rules'},...pair('old','source '.repeat(16000)),...pair('recent','current evidence')];
  const first=await context.prepare(wire);assert.match(JSON.stringify(first),/pending approval/);
  receipt='rejected; do not replay';const next=await context.prepare(wire);
  assert.match(JSON.stringify(next),/rejected; do not replay/);assert.doesNotMatch(JSON.stringify(next),/pending approval/);
  assert.match(JSON.stringify(next),/Never send the document/);
  for(const [index,message]of next.entries())if(message.role==='tool')assert(next.slice(0,index).some(m=>m.tool_calls?.some(call=>call.id===message.tool_call_id)));
});
test('desktop run reuses durable history, displays real summary progress and retrieves exact originals',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'Keep original goal',criteria:['NEVER_SEND']});
  const history=setup().task.messages;task.messages=history;service.store.set('task:'+task.id,task);
  let summaries=0,turn=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages,tools)=>{
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;assert.equal(service.task(task.id).context.phase,'summarizing');assert.deepEqual(tools,[]);return summarize();}
    assert.match(JSON.stringify(messages),/NEVER_SEND/);assert.match(JSON.stringify(messages),/최신 정정/);
    if(turn++===0)return {content:'',calls:[{id:'read-history',type:'function',function:{name:'read_conversation',arguments:'{"index":1}'}}]};
    if(turn===2)assert.match(messages.findLast(m=>m.role==='tool').content,/old source/);
    return {content:'초안을 확인했습니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert(summaries>0);
  assert.equal(service.task(task.id).context.phase,'ready');assert(service.task(task.id).context.compactions>0);
  assert(service.store.get('context-history:'+task.id));assert.equal(service.task(task.id).messages[0].content,history[0].content);
  const prior=summaries;await service.startAgent({taskId:task.id,answer:'같은 조건으로 이어 주세요.'});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(summaries,prior);
  assert.equal(service.store.list('operation:').filter(op=>op.tool==='read_conversation').length,1);
});
// User decision 2026-09-29: after a compaction a read authorizes a patch only
// while its text is still in the conversation the model sees
// (tests/compaction-observations.test.mjs). Here the first range was replaced
// by a reference before the overflow; only later ranges stay in view, so a
// patch of line 1 needs a fresh read.
test('overflow compacts only inference and old source observations cannot authorize a patch',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'Keep original scope',criteria:['Do not apply automatically']});
  task.messages=Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',content:'Old source notes '+('details '.repeat(300))}));service.store.set('task:'+task.id,task);
  await writeFile(path.join(root,'long.md'),Array.from({length:400},(_,i)=>`line ${i+1} of a long reference document that fills the recent span`).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','long document']);
  let round=0,summaries=0,hash,visible=null;
  const call=(name,args)=>({content:'',calls:[{id:'step-'+round,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return summarize();}
    if(round===1)hash=JSON.parse(messages.findLast(m=>m.role==='tool').content).hash;
    if(round<=4){round++;return call('read_source',{path:'long.md',start:(round-1)*60+1,end:round*60});}
    if(round++===5)throw new Error('context_overflow');
    if(round===7){
      visible=messages.some(m=>m.role==='tool'&&(()=>{try{const value=JSON.parse(m.content);return value.path==='long.md'&&value.start===1&&typeof value.content==='string';}catch{return false;}})());
      return call('propose_patch',{path:'long.md',expectedHash:hash,edits:[{oldText:'line 1 of a long',newText:'first line of a long'}],reason:'Check stale read'});
    }
    assert.match(messages.findLast(m=>m.role==='tool').content,/source_read_required/);return {content:'현재 소스를 다시 읽어야 합니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);assert(summaries>0);
  assert.equal(visible,false,'the first range is not in view');
  assert.equal(service.store.list('operation:').filter(op=>op.tool==='read_source').length,5);
  assert.equal(service.state().proposals.length,0);
});
test('resuming an interrupted summary clears the stale progress state without pretending compaction succeeded',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'Resume original task'});
  task.context={phase:'summarizing'};service.store.set('task:'+task.id,task);
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>{
    assert.equal(service.task(task.id).context.phase,'ready');return {content:'이어서 확인했습니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(service.task(task.id).context.compactions,undefined);
});
