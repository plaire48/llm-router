import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordingProviders,leaderEntries,leaderToolResults} from '../eval/transcript.mjs';

const status=()=>({provider:'chatgpt',model:'fixture',connected:true,models:[{id:'fixture',contextLength:200000,maxOutputTokens:4096},{id:'other',contextLength:64000}]});
const tools=[{type:'function',function:{name:'read_source'}}];

test('normal evaluation preserves provider-specific 256K, 512K and 1M windows',()=>{
  for(const contextLength of [256000,262144,272000,512000,524288,1000000,1048576]){
    const catalog={provider:'aipro',model:'fixture',connected:true,models:[{id:'fixture',contextLength,maxInputTokens:contextLength-4096,maxOutputTokens:4096}]};
    const recorded=recordingProviders({status:()=>catalog,complete:async()=>({})});
    assert.deepEqual(recorded.status(),catalog);
  }
});

test('each call is recorded with full messages, tool names and the response',async()=>{
  const entries=[],providers=recordingProviders({status,complete:async()=>({content:'답변',calls:[{id:'c',function:{name:'read_source',arguments:'{"path":"a"}'}}],finishReason:'tool_calls',usage:{prompt_tokens:5,completion_tokens:1}})},{write:entry=>entries.push(entry)});
  const messages=[{role:'system',content:'You are Nubi Desktop.'},{role:'user',content:'질문'}];
  await providers.complete(messages,tools);messages[1].content='changed later';
  assert.equal(entries.length,1);assert.equal(entries[0].sequence,1);assert.equal(entries[0].request.messages[1].content,'질문','the record is a copy');
  assert.deepEqual(entries[0].request.toolNames,['read_source']);
  assert.deepEqual(entries[0].response,{content:'답변',calls:[{name:'read_source',arguments:'{"path":"a"}'}],finishReason:'tool_calls',usage:{prompt_tokens:5,completion_tokens:1}});
  assert.equal(providers.modelCalls(),1);
});

test('a failure is recorded with its safe code and rethrown unchanged',async()=>{
  const entries=[],failure=Object.assign(new Error('Bearer SECRET at https://internal.example'),{status:500});
  const providers=recordingProviders({status,complete:async()=>{throw failure;}},{write:entry=>entries.push(entry)});
  await assert.rejects(providers.complete([{role:'user',content:'q'}],[]),error=>error===failure);
  assert.deepEqual(entries[0].error,{code:'request_failed',status:500});
});

test('the model call budget stops the next call without reaching the model',async()=>{
  let reached=0;const providers=recordingProviders({status,complete:async()=>{reached++;return {content:''};}},{maxModelCalls:2});
  await providers.complete([],[]);await providers.complete([],[]);
  await assert.rejects(providers.complete([],[]),error=>error.message==='evaluation_model_budget'&&error.retryable===false);
  assert.equal(reached,2);
});

test('a broken recorder does not change the result',async()=>{
  const providers=recordingProviders({status,complete:async()=>({content:'ok'})},{write(){throw new Error('disk full');}});
  assert.equal((await providers.complete([],[])).content,'ok');
});

test('a case can lower the selected model context limit but never raise it',()=>{
  const lowered=recordingProviders({status,complete:async()=>({})},{modelLimits:{contextLength:32000}}).status();
  assert.equal(lowered.models[0].contextLength,32000);assert.equal(lowered.models[1].contextLength,64000,'other models are untouched');
  const raised=recordingProviders({status,complete:async()=>({})},{modelLimits:{contextLength:900000}}).status();
  assert.equal(raised.models[0].contextLength,200000);
  assert.deepEqual(recordingProviders({status,complete:async()=>({})}).status(),status());
});

test('only the main agent tool results are collected, once each',()=>{
  const tool=(id,content)=>({role:'tool',tool_call_id:id,content});
  const entries=[
    {request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean'},{role:'user',content:'q'}]}},
    {request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean'},{role:'user',content:'q'},tool('a','{"path":"openwiki/a.md"}')]}},
    {request:{messages:[{role:'system',content:'You are Nubi Desktop. Reply in Korean'},{role:'user',content:'q'},tool('a','{"path":"openwiki/a.md"}'),tool('b',[{type:'text',text:'{"path":"src/b.mjs"}'},{type:'image_url',image_url:{url:'data:x'}}])]}},
    {request:{messages:[{role:'system',content:'You are an isolated research analyst'},tool('c','{"path":"child/only.md"}')]}},
    {request:{messages:[{role:'system',content:'Review the task'},{role:'user',content:'{"evidence":"reviewer/only.md"}'}]}},
  ];
  assert.equal(leaderEntries(entries).length,3);
  const results=leaderToolResults(entries);
  assert.equal(results.length,2);assert.ok(results[0].includes('openwiki/a.md'));assert.ok(results[1].includes('src/b.mjs'));
  assert.ok(!results.join('\n').includes('child/only.md'));
});

// User decision 2026-09-29: the OpenWiki agent works the way it does. Its calls
// have their own limit, so a whole-Wiki review does not use up the main agent's.
test('calls of the OpenWiki agent are counted apart and have their own limit',async()=>{
  const entries=[],providers=recordingProviders({status,complete:async()=>({content:'ok'})},{write:entry=>entries.push(entry),maxModelCalls:2,maxDelegatedCalls:3});
  const leader=[{role:'system',content:'You are Nubi Desktop. Reply in Korean.'},{role:'user',content:'질문'}];
  const research=[{role:'system',content:"You are OpenWiki's read-only evidence researcher. Answer the original question in its language."},{role:'user',content:'q'}];
  const planner=[{role:'system',content:'Plan OpenWiki research. Return ONLY JSON.'},{role:'user',content:'{}'}];
  await providers.complete(leader,[]);await providers.complete(planner,[]);await providers.complete(research,[]);await providers.complete(research,[]);
  assert.equal(providers.modelCalls(),1);assert.equal(providers.delegatedCalls(),3);
  await assert.rejects(providers.complete(research,[]),/evaluation_delegated_budget/);
  await providers.complete(leader,[]);
  await assert.rejects(providers.complete(leader,[]),/evaluation_model_budget/);
  assert.deepEqual(entries.map(entry=>entry.delegated===true),[false,true,true,true,false]);
  assert.deepEqual(entries.map(entry=>entry.sequence),[1,2,3,4,5]);
});

test('each call records its longest wait between two signs of model activity',async()=>{
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),entries=[];
  const providers={status:()=>({model:'fixture'}),async complete(messages,tools,signal,onText){onText('a');await pause(60);onText('b');await pause(5);return {content:'끝',calls:[]};}};
  const recorded=recordingProviders(providers,{write:entry=>entries.push(entry)});
  await recorded.complete([{role:'system',content:'You are Nubi Desktop.'}],[]);
  assert.equal(entries[0].activity.events,2);assert.ok(entries[0].activity.longestGapMs>=55,String(entries[0].activity.longestGapMs));
});
