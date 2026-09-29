import test from 'node:test';
import assert from 'node:assert/strict';
import {recordUsage,finishUsage,usageSummary} from '../usage-ledger.js';
import {normalizeResponsesUsage} from '../usage.js';
import {observeResponsesUsage} from '../usage-stream.js';
import {responsesSSE} from './fixtures/chatgpt.mjs';
const now=new Date(2026,8,21,12).getTime();
const u={prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:30},completion_tokens_details:{reasoning_tokens:5}};
const event=(requestId='r',round=1,phase='report',provider='aipro',usage=u)=>({requestId,round,phase,provider,usage});
test('duplicate usage snapshots replace one request while tool rounds and providers accumulate separately',()=>{
 let ledger=recordUsage(null,event('r',1,'start','aipro',null),now);
 ledger=recordUsage(ledger,event(),now);ledger=recordUsage(ledger,event(),now);
 ledger=recordUsage(ledger,event('r',1,'finish','aipro',null),now);
 ledger=recordUsage(ledger,event('r',2),now);
 assert.equal(usageSummary(ledger,now).total.aipro.total,240);
 assert.equal(usageSummary(ledger,now).total.aipro.calls,2);
 assert.equal(usageSummary(ledger,now).total.aipro.cached,60);
 assert.equal(usageSummary(ledger,now).total.aipro.reasoning,10);
 ledger=finishUsage(ledger,'r');ledger=recordUsage(ledger,event('s',1,'report','chatgpt'),now);
 assert.equal(usageSummary(ledger,now).total.chatgpt.total,120);
 assert.equal(usageSummary(ledger,now).total.aipro.total,240);
 assert(!JSON.stringify(usageSummary(ledger,now)).includes('requestId'));
});
test('unknown, zero and interrupted measurements stay distinct; idle summary does not rewrite storage',()=>{
 let ledger=recordUsage(null,event('r',1,'start','aipro',null),now);
 assert.equal(usageSummary(ledger,now).total.aipro.pending,1);
 ledger=finishUsage(ledger,'r');
 assert.equal(usageSummary(ledger,now).total.aipro.measured,0);
 assert.equal(usageSummary(ledger,now).total.aipro.pending,0);
 assert.equal(finishUsage(ledger),ledger);assert.equal(finishUsage(undefined),undefined);
 ledger=recordUsage(ledger,event('s',1,'report','aipro',{prompt_tokens:0,completion_tokens:0}),now);
 assert.equal(usageSummary(ledger,now).total.aipro.measured,1);
 assert.equal(usageSummary(ledger,now).total.aipro.total,0);
});
test('daily totals use the local date and lifetime totals survive day rollover and new chats',()=>{
 let ledger=recordUsage(null,event(),now);
 ledger=recordUsage(ledger,event('next'),now+86400000);
 assert.equal(usageSummary(ledger,now+86400000).today.aipro.total,120);
 assert.equal(usageSummary(ledger,now+86400000).total.aipro.total,240);
 for(let day=2;day<40;day++)ledger=recordUsage(ledger,event(`r${day}`),now+day*86400000);
 assert.equal(Object.keys(ledger.days).length,31);
 assert.equal(usageSummary(ledger,now+39*86400000).total.aipro.total,4800);
});
test('account-like details are excluded and unsafe fields cannot change ledger attribution',()=>{
 let ledger=recordUsage(null,event(),now);
 assert.equal(recordUsage(ledger,{...event(),provider:'other'}),ledger);
 assert.equal(recordUsage(ledger,{...event(),round:Number.MAX_SAFE_INTEGER+1}),ledger);
 assert.equal(recordUsage(ledger,{...event(),provider:'chatgpt'}),ledger);
 assert.deepEqual(normalizeResponsesUsage({input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:30},output_tokens_details:{reasoning_tokens:5}}),u);
 assert.equal(normalizeResponsesUsage(null),null);
});
test('usage after the sixty-fourth request remains measured and deduplicated',()=>{
 let ledger;
 for(let round=1;round<=100;round++) {
  ledger=recordUsage(ledger,event('long-task',round),now);
  ledger=recordUsage(ledger,event('long-task',round),now);
  ledger=recordUsage(ledger,event('long-task',round,'finish'),now);
 }
 assert.equal(usageSummary(ledger,now).total.aipro.calls,100);
 assert.equal(usageSummary(ledger,now).total.aipro.total,12000);
});
test('Responses usage observation handles byte splits, UTF-8 and missing usage without affecting response bytes',async()=>{
 for(const usage of [null,{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:30},output_tokens_details:{reasoning_tokens:5}}]){
  const text=responsesSSE({text:'합성 한글',usage}).replace(/\n/g,'\r\n'),bytes=new TextEncoder().encode(text),seen=[];
  const body=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}});
  const response=observeResponsesUsage(new Response(body,{headers:{'content-type':'text/event-stream'}}),v=>seen.push(v));
  assert.equal(await response.text(),text);
  assert.deepEqual(seen,usage?[u]:[]);
 }
});
