import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {hasModelOutput,isEvaluationRequest,trackModelEvidence} from '../scripts/evaluation-model-evidence.mjs';
import {ORIGIN} from '../core.js';
const packet=overrides=>({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'Observed answer'},finish_reason:'stop'}]}),...overrides});
const request=(model='qwen',url=ORIGIN+'/api/v1/chat/completions')=>({url:()=>url,method:()=> 'POST',postDataJSON:()=>({model})});
test('evaluation distinguishes validated JSON/SSE/tool output from errors and incomplete streams',async()=>{
  assert(await hasModelOutput(packet()));
  assert(await hasModelOutput(packet({body:JSON.stringify({choices:[{message:{tool_calls:[{id:'1',function:{name:'read_page',arguments:'{}'}}]},finish_reason:'tool_calls'}]})})));
  assert(await hasModelOutput(packet({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'})));
  for(const bad of [packet({status:401}),packet({body:'<html>SSO login</html>'}),packet({body:'{}'}),packet({body:'{"error":{"message":"private"}}'}),packet({contentType:'text/event-stream',body:'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'})])assert.equal(await hasModelOutput(bad),false);
});
test('evaluation binds model observations to the configured origin, endpoint, method and model',()=>{
  assert(isEvaluationRequest(request(),'qwen'));
  for(const r of [request('other'),request('qwen','https://other.example/api/v1/chat/completions'),{...request(),method:()=> 'GET'},{...request(),postDataJSON:()=>{throw Error();}}])assert(!isEvaluationRequest(r,'qwen'));
});
test('request dispatch alone is not a model response and listeners close after each trial',async()=>{
  const context=new EventEmitter(),tracker=trackModelEvidence(context,'qwen'),r=request();
  context.emit('request',r);assert.equal(tracker.requests,1);
  const s=await tracker.finish();assert.equal(s.modelResponses,0);assert.equal(context.listenerCount('request'),0);assert.equal(context.listenerCount('response'),0);
});
test('response tracking counts valid envelopes and keeps response text out of evidence',async()=>{
  const context=new EventEmitter(),tracker=trackModelEvidence(context,'qwen');
  for(const p of [packet(),packet({status:401,body:'private-token'}),packet({body:'{"error":{"message":"private"}}'})]) {
    const r=request();context.emit('request',r);
    context.emit('response',{request:()=>r,status:()=>p.status,headers:()=>({'content-type':p.contentType}),body:async()=>Buffer.from(p.body)});
  }
  const result=await tracker.finish();assert.deepEqual(result,{modelRequests:3,modelResponses:1,unverifiedResponses:2});assert(!JSON.stringify(result).includes('private'));
});
