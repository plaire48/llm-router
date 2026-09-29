import test from 'node:test';
import assert from 'node:assert/strict';
import {fabrixCompletion, fabrixToolMessage, testFabrixConnection, fabrixDiagnostic} from '../fabrix.js';
import {readCompletion, completeChat} from '../src/api.js';
import {recordUsage, usageSummary} from '../usage-ledger.js';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {connection, protocol, toolReply, messageReply, probeReply, nativeResponse} from './fixtures/fabrix.mjs';

const tools = [{type: 'function', function: {name: 'inspect_dom', parameters: {type: 'object', properties: {}, additionalProperties: false}}}];
const request = {model: connection.modelId, messages: [{role: 'system', content: 'Write Markdown documents, preserving the user task.'}, {role: 'user', content: 'Read the current page.'}], tools, tool_choice: 'auto', stream: true, max_tokens: 4096};
const usage = {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120};

test('accepts a whole fenced tool envelope without extracting executable JSON from prose', () => {
  const valid = JSON.stringify({protocol, request_id: 'nonce', type: 'tool_calls', tool_calls: [{name: 'inspect_dom', arguments: {}}]});
  assert.equal(fabrixToolMessage('```json\n'+valid+'\n```', 'nonce', tools).tool_calls[0].function.name, 'inspect_dom');
  for (const text of ['Example: '+valid, valid+'\n'+valid, '<think>'+valid+'</think>', '```json\n'+valid+'\n```\nOther text']) {
    assert.throws(() => fabrixToolMessage(text, 'nonce', tools), e => e.message === 'fabrix_tool_protocol' && e.reason === 'invalid_json' && e.status !== 502);
  }
});

test('reproduces a format failure and repairs once without sending the discarded answer or changing the task', async () => {
  const bodies=[], measured=[], diagnostics=[]; let repairs=0;
  const response = await fabrixCompletion(request, connection, {onRetry: () => {repairs++;}, onDiagnostic: value => diagnostics.push(value), onMeasurement: value => measured.push(value), fetchImpl: async (_, options) => {
    const body=JSON.parse(options.body); bodies.push(body);
    if (bodies.length === 1) return nativeResponse('Malformed private response with a secret-marker', {stream: true, usage});
    assert(body.systemPrompt.includes('invalid_json'));
    assert(!options.body.includes('secret-marker'));
    assert(body.systemPrompt.startsWith(request.messages[0].content));
    return nativeResponse('```json\n'+toolReply(body, 'inspect_dom')+'\n```', {stream: true, usage: {prompt_tokens: 200, completion_tokens: 40, total_tokens: 240}});
  }});
  const firstId=bodies[0].systemPrompt.match(/and request_id "([^"]+)"/)[1];
  const secondId=bodies[1].systemPrompt.match(/and request_id "([^"]+)"/)[1];
  assert.notEqual(firstId, secondId); assert.equal(repairs,1);
  let calls, finalUsage;
  await readCompletion(response, undefined, value=>{finalUsage=value;}, undefined, undefined, value=>{calls=value;});
  assert.equal(calls.length,1);assert.equal(calls[0].function.name,'inspect_dom');
  assert.deepEqual(measured,[usage,{prompt_tokens:200,completion_tokens:40,total_tokens:240}]);
  assert.equal(finalUsage.total_tokens,240); // Context is the successful request, not both attempts summed.
  assert.deepEqual(diagnostics.map(d=>d.phase),['retry','recovered']);
  assert.equal(diagnostics[0].reason,'invalid_json');assert.equal(diagnostics[0].status,200);
  assert(!JSON.stringify(diagnostics).includes('secret-marker'));
});

test('two malformed responses stop with a local reason and never masquerade as HTTP 502', async () => {
  let count=0;const events=[];
  await assert.rejects(fabrixCompletion(request,connection,{onDiagnostic:e=>events.push(e),fetchImpl:async()=>{count++;return nativeResponse('not JSON',{stream:true});}}),e=>e.message==='fabrix_tool_protocol'&&e.reason==='invalid_json'&&e.status===undefined);
  assert.equal(count,2);assert.deepEqual(events.map(e=>e.phase),['retry','failed']);
});

test('stale nonce, unknown tool and invalid argument envelopes remain non-executable', () => {
  const value={protocol,request_id:'nonce',type:'tool_calls',tool_calls:[{name:'inspect_dom',arguments:{}}]};
  for(const [extra,reason] of [[{request_id:'stale'},'request_id_mismatch'],[{protocol:'other'},'invalid_protocol'],[{tool_calls:[{name:'arbitrary',arguments:{}}]},'unknown_tool'],[{tool_calls:[{name:'inspect_dom',arguments:'code()'}]},'invalid_arguments']]) {
    assert.throws(()=>fabrixToolMessage(JSON.stringify({...value,...extra}),'nonce',tools),e=>e.reason===reason);
  }
});

test('real HTTP errors, END truncation and cancellation do not trigger format repair', async () => {
  for (const status of [401,429,502]) {
    let count=0;
    await assert.rejects(fabrixCompletion(request,connection,{fetchImpl:async()=>{count++;return new Response('private',{status});}}),e=>e.status===status&&e.message!=='fabrix_tool_protocol');
    assert.equal(count,1);
  }
  let count=0;
  await assert.rejects(fabrixCompletion(request,connection,{fetchImpl:async(_,opts)=>{
    count++;const content=toolReply(JSON.parse(opts.body),'inspect_dom');
    return new Response(`data: ${JSON.stringify({eventStatus:'CHUNK',content})}\n\ndata: {"eventStatus":"END","finishReason":"length"}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
  }}),/output_limit/);assert.equal(count,1);
  const controller=new AbortController();count=0;
  await assert.rejects(fabrixCompletion(request,connection,{signal:controller.signal,onRetry:()=>controller.abort(),fetchImpl:async()=>{count++;return nativeResponse('bad',{stream:true});}}),/cancelled/);assert.equal(count,1);
});

test('connection probe can recover format errors in both rounds and reports separate physical requests',async()=>{
  const events=[];let count=0;
  const result=await testFabrixConnection(connection,{onRequest:(round,phase)=>events.push([round,phase]),fetchImpl:async(_,opts)=>{
    count++;const body=JSON.parse(opts.body);
    return nativeResponse(count%2===1?'bad':'```json\n'+probeReply(body)+'\n```',{stream:body.isStream,usage});
  }});
  assert.equal(result.tools,true);assert.equal(count,4);
  assert.deepEqual(events,[[1,'start'],[1,'finish'],[2,'start'],[2,'finish'],[3,'start'],[3,'finish'],[4,'start'],[4,'finish']]);
});

test('ordinary requests without tools keep plain text and never require a tool envelope',async()=>{
  let count=0;
  const response=await fabrixCompletion({...request,tools:[]},connection,{fetchImpl:async()=>{count++;return nativeResponse('ordinary text',{stream:true});}});
  assert.equal(await readCompletion(response),'ordinary text');assert.equal(count,1);
});

test('diagnostics contain only fixed reasons, phase, attempt and actual successful HTTP status',()=>{
  assert.deepEqual(fabrixDiagnostic({phase:'retry',reason:'invalid_json',attempt:1,status:200,token:'private',content:'private'}),{phase:'retry',reason:'invalid_json',attempt:1,status:200});
  assert.equal(fabrixDiagnostic({phase:'retry',reason:'raw private response',attempt:1}),null);
  assert.equal(fabrixDiagnostic({phase:'private',reason:'invalid_json',attempt:1}),null);
});

test('Pi records each physical retry separately while final context usage describes only the accepted reply',async t=>{
  const oldFetch=globalThis.fetch,oldChrome=globalThis.chrome;
  t.after(()=>{globalThis.fetch=oldFetch;globalThis.chrome=oldChrome;});
  globalThis.chrome={storage:{session:{get:async()=>({credential:{...connection,provider:'fabrix',receivedAt:10},catalog:{credentialReceivedAt:10,models:[{name:connection.modelId}]}})}}};
  for(const firstUsage of [usage,undefined]) {
    let count=0,ledger,finalUsage;const executed=[],diagnostics=[];
    globalThis.fetch=async(_,opts)=>{
      count++; const body=JSON.parse(opts.body);
      if (body.systemPrompt.startsWith(COMPLETION_REVIEW_PROMPT)) return nativeResponse(JSON.stringify({decision:'reply',scope:'conversation',next_step:''}),{stream:true,usage});
      return nativeResponse(count===1?'bad':messageReply(body,'확인했습니다.'),{stream:true,usage:count===1?firstUsage:usage});
    };
    const text=await completeChat({provider:'fabrix',credentialReceivedAt:10,modelId:connection.modelId,messages:[{role:'user',content:'페이지를 읽지 않아도 됩니다. 알겠다고만 해줘.'}],tools},new AbortController().signal,undefined,u=>{finalUsage=u;},undefined,undefined,(...args)=>executed.push(args),undefined,e=>{ledger=recordUsage(ledger,{...e,requestId:'retry-test',provider:'fabrix'});},undefined,e=>diagnostics.push(e));
    assert.equal(text,'확인했습니다.');assert.deepEqual(executed,[]);assert.equal(count,3);
    assert.equal(finalUsage.total_tokens,120);
    const summary=usageSummary(ledger).total.fabrix;
    assert.equal(summary.calls,3);assert.equal(summary.measured,firstUsage?3:2);assert.equal(summary.total,firstUsage?360:240);
    assert.equal(summary.pending,0);assert.equal(diagnostics.length,2);
  }
});
