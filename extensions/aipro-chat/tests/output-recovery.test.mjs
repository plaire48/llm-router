import test from 'node:test';
import assert from 'node:assert/strict';
import {zstdDecompressSync} from 'node:zlib';
import {completeChat, readCompletion} from '../src/api.js';
import {createOutputRecovery} from '../output-recovery.js';
import {chatgptToken, responsesSSE} from './fixtures/chatgpt.mjs';
import {connection, nativeResponse, toolReply, messageReply, conversation} from './fixtures/fabrix.mjs';

const signal = () => new AbortController().signal;
const usage = {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120};
const tools = [{type:'function',function:{name:'fill_form',description:'Write a requested section',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}}];
const call = (id, value) => ({id,type:'function',function:{name:'fill_form',arguments:JSON.stringify({value})}});
const response = (content, reason='stop', calls) => Response.json({choices:[{message:{content,...(calls?{tool_calls:calls}:{})},finish_reason:reason}],usage});
const request = {provider:'aipro',modelId:'test',model:{contextLength:128000},credentialReceivedAt:1,messages:[{role:'user',content:'내용을 작성하고 페이지에 반영해줘'}],tools};
function install(t, fetcher, provider='aipro') {
  const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;});
  const credential={...connection,provider,token:provider==='chatgpt'?chatgptToken():'synthetic-token',mode:'browser',receivedAt:1};
  globalThis.chrome={storage:{session:{get:async()=>({credential,catalog:{credentialReceivedAt:1,models:[{name:connection.modelId}]}})}},runtime:{sendMessage:async()=>({ok:true})}};
  globalThis.fetch=fetcher;
}

test('length-ending tool responses never dispatch even parseable calls, and still report usage',async()=>{
  for(const stream of [false,true]) {
    const calls=[call('cut','do not execute')];let dispatched=0,reports=0;
    const value=stream?new Response(`data: ${JSON.stringify({choices:[{delta:{tool_calls:calls.map((item,index)=>({index,...item}))},finish_reason:'length'}]})}\n\ndata: ${JSON.stringify({choices:[],usage})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}}):response('','length',calls);
    await assert.rejects(readCompletion(value,undefined,undefined,undefined,undefined,()=>dispatched++,()=>reports++),error=>error.message==='output_limit'&&error.truncatedTools===true);
    assert.equal(dispatched,0);assert.equal(reports,1);
  }
});

test('an empty reasoning-only output is replanned before execution and completed writes are not replayed',async t=>{
  const bodies=[],writes=[],ledger=[];
  install(t,async(_,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);
    if(bodies.length===1)return response(null,'length');
    assert(body.messages.some(message=>message.role==='system'&&message.content.includes('Output recovery:')));
    if(bodies.length===2)return response('','tool_calls',[call('first','첫 문단')]);
    if(bodies.length===3)return response('','length',[{...call('discard','bad'),function:{name:'fill_form',arguments:'{"value":"unfinished'}}]);
    assert(body.messages.some(message=>message.role==='tool'&&message.tool_call_id==='first'));
    assert(!body.messages.some(message => message.tool_calls?.some(call => call.function.arguments.includes('unfinished'))));
    if(bodies.length===4)return response('','tool_calls',[call('second','다음 문단')]);
    return response('본문을 반영했습니다.');
  });
  const text=await completeChat(request,signal(),undefined,undefined,undefined,undefined,async(_,args)=>{writes.push(args.value);return {applied:1,verified:true};},undefined,event=>ledger.push(event));
  assert.equal(text,'본문을 반영했습니다.');assert.deepEqual(writes,['첫 문단','다음 문단']);
  assert.equal(bodies.length,5);assert.equal(ledger.filter(event=>event.phase==='report').length,5);
  assert.equal(new Set(ledger.filter(event=>event.phase==='start').map(event=>event.round)).size,5);
});

test('Qwen CLI continuation after a tool keeps one leading system message and the execution receipts', async t => {
  const bodies = [], writes = [];
  install(t, async (_, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    assert.equal(body.model, 'qwen3.8-27b');
    // Qwen3.8's official template rejects a system message after index zero.
    assert.equal(body.messages.filter(message => message.role === 'system').length, 1, 'System message must be at the beginning.');
    assert.equal(body.messages[0].role, 'system');
    if (bodies.length === 1) return response('', 'tool_calls', [call('written', '첫 문단')]);
    assert(body.messages.some(message => message.tool_call_id === 'written'));
    if (bodies.length === 2) return response(null, 'length');
    assert(body.messages[0].content.includes('누비'));
    assert(body.messages[0].content.includes('Output recovery:'));
    if (bodies.length === 3) return response('', 'tool_calls', [call('next', '둘째 문단')]);
    return response('두 문단을 반영했습니다.');
  });
  const result = await completeChat({...request, modelId: 'qwen3.8-27b'}, signal(), undefined, undefined, undefined, undefined,
    async (_, args) => {writes.push(args.value); return {applied: 1, verified: true};});
  assert.equal(result, '두 문단을 반영했습니다.');
  assert.deepEqual(writes, ['첫 문단', '둘째 문단']);
  assert.equal(bodies.length, 4);
});

test('visible text continues automatically across many progressing fragments with only final-request context usage',async t=>{
  let count=0,lastUsage;const chunks=[];
  install(t,async()=>{count++;const text=`문단 ${count}: 서로 다른 내용입니다.\n`;chunks.push(text);return response(text,count<15?'length':'stop');});
  const text=await completeChat({...request,tools:[]},signal(),undefined,value=>lastUsage=value);
  assert.equal(count,15);assert.equal(text,chunks.join(''));assert.deepEqual(lastUsage,usage);
});

test('only repeated output failures without progress stop; the user is not asked to split a task',async t=>{
  let count=0,writes=0;
  install(t,async()=>{count++;return response('','length');});
  await assert.rejects(completeChat(request,signal(),undefined,undefined,undefined,undefined,async()=>writes++),/output_limit/);
  assert.equal(count,3);assert.equal(writes,0);
});

test('overlapping continuation is de-duplicated and identical fragments cannot loop forever',async()=>{
  const part='한 번만 남겨야 하는 충분히 긴 문장입니다. 중복되지 않아야 합니다.\n';
  const recover=createOutputRecovery({signal:signal(),inputBudget:10000});let count=0;
  const answer=await recover([{role:'user',content:'작성해줘'}],[],async()=>++count===1?{content:part,finishReason:'length'}:{content:part+'다음 문장',finishReason:'stop'});
  assert.equal(answer.content,part+'다음 문장');
  count=0;
  await assert.rejects(recover([],[],async()=>{count++;return {content:part,finishReason:'length'};}),/output_limit/);
  assert.equal(count,4);
});

test('transport recovery is separate from output continuation; auth, cancel and filtering never retry',async t=>{
  let currentStatus, count=0;
  install(t,async()=>{count++;return new Response('',{status:currentStatus});});
  for(const status of [401,429,500]) {
    currentStatus=status;count=0;
    await assert.rejects(completeChat(request,signal()));assert.equal(count,status===401?1:4);
  }
  const abort=new AbortController();count=0;
  const recover=createOutputRecovery({signal:abort.signal,inputBudget:10000,onProgress:()=>abort.abort()});
  await assert.rejects(recover([],[],async()=>{count++;return {content:'첫 부분',finishReason:'length'};}),/cancelled/);assert.equal(count,1);
  await assert.rejects(createOutputRecovery({signal:signal(),inputBudget:10000})([],[],async()=>{throw new Error('response_filtered');}),/response_filtered/);
});

test('partial text survives a later transport interruption without replaying a request',async()=>{
  let count=0;
  const recover=createOutputRecovery({signal:signal(),inputBudget:10000});
  await assert.rejects(recover([],[],async()=>{
    if(++count===1)return {content:'앞부분 ',finishReason:'length'};
    throw Object.assign(new Error('network'),{partial:'뒷부분'});
  }),error=>error.message==='network'&&error.partial==='앞부분 뒷부분');assert.equal(count,2);
});

test('FabriX output limits recover at the agent layer without executing a truncated envelope',async t=>{
  let count=0,writes=0;const bodies=[];
  install(t,async(_,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);count++;
    if(count===1)return nativeResponse(toolReply(body,'fill_form',{value:'discarded'}),{stream:true,finish:'length',usage});
    if(count===2){assert(body.systemPrompt.includes('Output recovery:'));return nativeResponse(toolReply(body,'fill_form',{value:'small section'}),{stream:true,usage});}
    assert(conversation(body).some(message=>message.role==='tool'));
    return nativeResponse(messageReply(body,'작성했습니다.'),{stream:true,usage});
  },'fabrix');
  const text=await completeChat({...request,provider:'fabrix',modelId:connection.modelId},signal(),undefined,undefined,undefined,undefined,async(_,args)=>{assert.equal(args.value,'small section');writes++;return {applied:1,verified:true};});
  assert.equal(text,'작성했습니다.');assert.equal(count,3);assert.equal(writes,1);
});

test('ChatGPT length-ending calls are discarded and the agent requests a smaller complete step',async t=>{
  let count=0,writes=0;const bodies=[];
  install(t,async(_,options)=>{
    const body=JSON.parse(typeof options.body==='string'?options.body:zstdDecompressSync(options.body).toString());bodies.push(body);count++;
    const data=count===1?{tool:{name:'fill_form',arguments:{value:'discarded'}},status:'incomplete'}:count===2?{tool:{name:'fill_form',arguments:{value:'small section'}}}:{text:'작성했습니다.'};
    return new Response(responsesSSE(data),{headers:{'content-type':'text/event-stream'}});
  },'chatgpt');
  const text=await completeChat({...request,provider:'chatgpt',modelId:'gpt-5.6-sol'},signal(),undefined,undefined,undefined,undefined,async(_,args)=>{assert.equal(args.value,'small section');writes++;return {applied:1,verified:true};});
  assert.equal(text,'작성했습니다.');assert.equal(count,3);assert.equal(writes,1);assert(bodies[1].instructions.includes('Output recovery:'));
});
