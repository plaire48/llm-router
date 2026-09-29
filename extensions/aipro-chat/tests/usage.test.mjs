import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUsage, contextUsage, contextPercent} from '../usage.js';
import {readCompletion, completeChat} from '../src/api.js';

const model = {name: 'glm', contextLength: 525288, maxInputTokens: 460800};
const usage = {prompt_tokens: 24000, completion_tokens: 1000, total_tokens: 25000};
const messages = [{role: 'user', content: '요약해 주세요'}, {role: 'assistant', state: 'done', modelId: 'glm', content: '완료', usage}];
const sse = body => new Response(body, {headers: {'content-type': 'text/event-stream'}});

test('usage handles zero, missing counters, unsafe values and inconsistent totals', () => {
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({prompt_tokens: '100', completion_tokens: -1, total_tokens: Infinity}), null);
  assert.deepEqual(normalizeUsage({prompt_tokens: 0, completion_tokens: 0}), {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0});
  assert.deepEqual(normalizeUsage({prompt_tokens: 3}), {prompt_tokens: 3, completion_tokens: null, total_tokens: null});
  assert.deepEqual(normalizeUsage({total_tokens: 20}), {prompt_tokens: null, completion_tokens: null, total_tokens: 20});
  assert.equal(normalizeUsage({...usage, total_tokens: 1}), null);
  assert.equal(normalizeUsage({prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1}), null);
});

test('usage-only final stream chunk and JSON usage are reported once without summing frames', async () => {
  const seen = [];
  const wire = `data: ${JSON.stringify({choices: [{delta: {content: '답변'}, finish_reason: 'stop'}], usage})}\n\ndata: ${JSON.stringify({choices: [], usage})}\n\ndata: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(wire);
  const stream = new ReadableStream({start(controller) {for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();}});
  assert.equal(await readCompletion(sse(stream), undefined, value => seen.push(value)), '답변');
  assert.deepEqual(seen, [usage]);
  await readCompletion(new Response(JSON.stringify({choices: [{message: {content: '답변'}}], usage})), undefined, value => seen.push(value));
  assert.deepEqual(seen, [usage, usage]);
});

test('absent and interrupted usage is never reported as a completed measurement', async () => {
  let seen = 'not-called';
  await readCompletion(sse('data: {"choices":[{"delta":{"content":"답변"},"finish_reason":"stop"}]}\n\n'), undefined, value => {seen = value;});
  assert.equal(seen, null);
  seen = 'not-called';
  await assert.rejects(readCompletion(sse(`data: ${JSON.stringify({choices: [{delta: {content: '부분'}}], usage})}\n\n`), undefined, value => {seen = value;}), /model_stream_incomplete/);
  assert.equal(seen, 'not-called');
});

test('context uses only the latest request, and changes to estimates for draft or model changes', () => {
  const info = contextUsage([...messages, ...messages], '', model);
  assert.equal(info.used, 25000);
  assert.equal(info.kind, 'measured');
  assert.equal(info.capacity, 525288);
  assert.equal(contextPercent(info), '4.8%');
  assert.equal(contextUsage(messages, '다음 질문', model).kind, 'estimated');
  assert.equal(contextUsage(messages, '', {...model, name: 'another-model'}).kind, 'estimated');
  assert.equal(contextUsage(messages, '', model, true, '부분').kind, 'estimated');
  assert.equal(contextUsage([...messages, {role: 'user', content: '새 질문'}], '', model).kind, 'estimated');
  assert.equal(contextUsage([{...messages[1], usage: undefined}], '', model).kind, 'estimated');
});

test('unknown capacity remains unknown, and failed partial replies are excluded from estimates', () => {
  const baseline = contextUsage([messages[0]], '', {name: 'glm'});
  const failed = contextUsage([messages[0], {role: 'assistant', state: 'error', content: 'x'.repeat(10000), usage}], '', {name: 'glm'});
  assert.equal(failed.used, baseline.used);
  assert.equal(failed.capacity, null);
  assert.equal(contextPercent(failed), '—');
  assert.equal(contextUsage([], '', model).used, 0);
  assert.equal(contextUsage([], '', model).kind, 'empty');
  assert.equal(contextUsage(messages, '', {...model, contextLength: null}).kind, 'measured');
});

test('usage schema fallback stays distinct from transient model recovery and never retries auth errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => {throw new Error('Unconfigured fixture');});
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {receivedAt: 1, token: 'synthetic', mode: 'browser'}})}}};
  t.after(() => {if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome;});
  const request = {modelId: 'glm', credentialReceivedAt: 1, messages: [{role: 'user', content: 'test'}]};
  const success = () => new Response(JSON.stringify({choices: [{message: {content: 'answer'}}], usage}));
  for (const body of [{error: {param: 'stream_options'}}, {detail: [{loc: ['body', 'stream_options'], type: 'extra_forbidden'}]}]) {
    const calls = [];
    globalThis.fetch.mock.mockImplementation(async (_url, init) => {calls.push(JSON.parse(init.body)); return calls.length === 1 ? new Response(JSON.stringify(body), {status: 422}) : success();});
    assert.equal(await completeChat(request, new AbortController().signal), 'answer');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].stream_options, {include_usage: true});
    assert.equal(calls[1].stream_options, undefined);
  }
  for (const status of [400, 401, 429, 503]) {
    let count = 0;
    globalThis.fetch.mock.mockImplementation(async () => {count++; return new Response(JSON.stringify({error: {param: 'model'}}), {status});});
    await assert.rejects(completeChat(request, new AbortController().signal));
    assert.equal(count, [429, 503].includes(status) ? 4 : 1);
  }
});
test('every AI Pro tool round records its own usage while context retains only the final request',async t=>{
  const previousChrome=globalThis.chrome,previousFetch=globalThis.fetch;
  t.after(()=>{globalThis.chrome=previousChrome;globalThis.fetch=previousFetch;});
  globalThis.chrome={storage:{session:{get:async()=>({credential:{receivedAt:1,token:'synthetic',mode:'browser'}})}}};
  let count=0,lastUsage;const records=[];
  const tools=[{type:'function',function:{name:'read_page',description:'Read page',parameters:{type:'object',properties:{},additionalProperties:false}}}];
  globalThis.fetch=async()=>{count++;return Response.json({choices:[count===1?{message:{content:null,tool_calls:[{id:'c1',type:'function',function:{name:'read_page',arguments:'{}'}}]},finish_reason:'tool_calls'}:{message:{content:'done'},finish_reason:'stop'}],usage:{prompt_tokens:count*100,completion_tokens:10,total_tokens:count*100+10}});};
  await completeChat({modelId:'glm',credentialReceivedAt:1,messages:[{role:'user',content:'read page'}],tools},new AbortController().signal,undefined,u=>{lastUsage=u;},undefined,undefined,async()=>({text:'page'}),undefined,event=>records.push(event));
  assert.equal(count,2);assert.equal(lastUsage.total_tokens,210);
  assert.deepEqual(records.filter(r=>r.phase==='report').map(r=>[r.round,r.usage.total_tokens]),[[1,110],[2,210]]);
  assert.equal(records.filter(r=>r.phase==='finish').length,2);
  assert.equal(await completeChat({modelId:'glm',credentialReceivedAt:1,messages:[{role:'user',content:'test'}]},new AbortController().signal,undefined,undefined,undefined,undefined,undefined,undefined,()=>{throw new Error('storage failed');}),'done');
});
