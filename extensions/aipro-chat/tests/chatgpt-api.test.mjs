import test from 'node:test';
import {zstdDecompressSync} from 'node:zlib';
const readBody = body => JSON.parse(typeof body === 'string' ? body : zstdDecompressSync(body).toString());
import assert from 'node:assert/strict';
import {completeChatGPT,chatGPTModels} from '../chatgpt-api.js';
import {runAgent} from '../agent-runtime.js';
import {chatgptToken,responsesSSE} from './fixtures/chatgpt.mjs';
import {recoverModel, retryableModelError} from '../model-recovery.js';
const options=()=>({messages:[{role:'system',content:'Synthetic instructions'},{role:'user',content:'Synthetic question'}],tools:[],modelId:'gpt-5.6-sol',credential:{token:chatgptToken()},signal:new AbortController().signal,onText:()=>{},onPhase:()=>{}});
test('ChatGPT uses the subscription Responses endpoint, Bearer auth and real SDK catalog',async t=>{
  const before=globalThis.fetch;t.after(()=>{globalThis.fetch=before;});
  let request;
  globalThis.fetch=async(url,options)=>{request={url,options};return new Response(responsesSSE(),{headers:{'content-type':'text/event-stream'}});};
  const initial=options();
  const result=await completeChatGPT(initial);
  assert.equal(request.url,'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(new Headers(request.options.headers).get('authorization'),`Bearer ${initial.credential.token}`);
  assert.equal(new Headers(request.options.headers).get('chatgpt-account-id'),'synthetic-account');
  assert.equal(request.options.credentials,'omit');assert.equal(request.options.redirect,'error');
  const body=readBody(request.options.body);
  assert.equal(body.instructions,'Synthetic instructions');assert.equal(body.store,false);assert.equal(body.stream,true);
  assert.equal(result.content,'ChatGPT 합성 응답입니다.');
  assert.equal(result.usage.prompt_tokens,120);assert.equal(result.usage.completion_tokens,20);assert.equal(result.usage.total_tokens,140);
  assert.equal(chatGPTModels().status,null);assert(chatGPTModels().payload.modelList.some(model=>model.name==='gpt-5.6-sol'));
});
test('ChatGPT tool calls round-trip through Pi with matching result IDs and no reasoning item dependency',async t=>{
  const before=globalThis.fetch;t.after(()=>{globalThis.fetch=before;});
  const requests=[];let executed=0;
  const tools=[{type:'function',function:{name:'read_page',description:'Read current page',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}}];
  globalThis.fetch=async(_,options)=>{requests.push(readBody(options.body));return new Response(responsesSSE(requests.length===1?{tool:{name:'read_page',arguments:{}}}:{text:'페이지를 읽었습니다.'}),{headers:{'content-type':'text/event-stream'}});};
  const initial=options();
  const result=await runAgent({...initial,tools,execute:async()=>{executed++;return {text:'Synthetic page evidence'};},complete:messages=>completeChatGPT({...initial,messages,tools})});
  assert.equal(executed,1);assert.equal(result.content,'페이지를 읽었습니다.');assert.equal(requests.length,2);
  const call=requests[1].input.find(item=>item.type==='function_call'),output=requests[1].input.find(item=>item.type==='function_call_output');
  assert.equal(call.call_id,'call_synthetic');assert.equal(output.call_id,call.call_id);assert.equal(call.id,undefined);assert(output.output.includes('Synthetic page evidence'));
  assert.equal(requests[0].tools[0].name,'read_page');
});
test('HTTP and interrupted SSE failures are safe and never retried',async t=>{
  const before=globalThis.fetch;t.after(()=>{globalThis.fetch=before;});
  for (const [status,error] of [[401,'unauthorized'],[403,'forbidden'],[429,'rate_limited'],[500,'upstream']]) {
    let count=0;globalThis.fetch=async()=>{count++;return new Response('synthetic-private-secret',{status,headers:{'Retry-After':'7'}});};
    await assert.rejects(completeChatGPT(options()),e=>e.message===error&&e.retryAfterMs===7000&&!JSON.stringify(e).includes('private-secret'));
    assert.equal(count,1);
  }
  globalThis.fetch=async()=>new Response('data: {"type":"response.created","response":{"id":"r"}}\n\n',{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(completeChatGPT(options()),/model_stream_incomplete/);
});
test('stopping a chat does not wait for a pending token refresh',async t=>{
  const {completeChat}=await import('../src/api.js');
  const before=globalThis.chrome;t.after(()=>{globalThis.chrome=before;});
  globalThis.chrome={runtime:{sendMessage:()=>new Promise(()=>{})}};
  const controller=new AbortController(),pending=completeChat({provider:'chatgpt',credentialReceivedAt:1},controller.signal);
  controller.abort();await assert.rejects(pending,/cancelled/);
});
test('ChatGPT missing upstream usage remains unknown instead of adopting SDK zero defaults',async t=>{
 const before=globalThis.fetch;t.after(()=>{globalThis.fetch=before;});
 globalThis.fetch=async()=>new Response(responsesSSE({usage:null}),{headers:{'content-type':'text/event-stream'}});
 assert.equal((await completeChatGPT(options())).usage,null);
});
test('ChatGPT context overflow is identified without leaking the server body or retrying inside the adapter', async t => {
  const before = globalThis.fetch; t.after(() => {globalThis.fetch = before;});
  let count = 0;
  globalThis.fetch = async () => {count++; return Response.json({error: {code: 'context_length_exceeded', message: 'synthetic-private-secret'}}, {status: 400});};
  await assert.rejects(completeChatGPT(options()), error => error.message === 'context_overflow' && !JSON.stringify(error).includes('private-secret'));
  assert.equal(count, 1);
});

test('ChatGPT failed response events retain their recovery class through the actual Pi SDK', async t => {
  const previous = globalThis.fetch; t.after(() => {globalThis.fetch = previous;});
  for (const type of ['response.failed', 'error']) for (const [code, retryable] of [['server_error', true], ['invalid_api_key', false], ['insufficient_quota', false], ['unknown', false]]) {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      const error = {code, message: 'PRIVATE upstream details'};
      const event = type === 'response.failed' ? {type, response: {id: 'r', error, status: 'failed'}} : {type, ...error};
      return new Response(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`, {headers: {'content-type': 'text/event-stream'}});
    };
    await assert.rejects(completeChatGPT(options()), error => {
      assert.equal(error.status, 200); assert.equal(retryableModelError(error), retryable);
      assert(!JSON.stringify(error).includes('PRIVATE')); return true;
    });
    assert.equal(requests, 1, 'The shared recovery layer alone owns retries');
  }
  let attempts = 0;
  globalThis.fetch = async () => new Response(++attempts === 1
    ? 'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"code":"server_error"}}}\n\n'
    : responsesSSE(), {headers: {'content-type': 'text/event-stream'}});
  const initial = options();
  const result = await recoverModel(({signal}) => completeChatGPT({...initial, signal}), {signal: initial.signal, minTimeout: 0});
  assert.equal(result.content, 'ChatGPT 합성 응답입니다.'); assert.equal(attempts, 2);
});
