import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompletion} from '../completion-reader.js';
import {recoverModel} from '../model-recovery.js';
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const encode = text => new TextEncoder().encode(text);
const result = {choices:[{delta:{content:'확인했습니다.'},finish_reason:'stop'}]};
const bounded = promise => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve('hung'), 100))]);

test('completion returns after DONE even if stream cancellation never resolves', async () => {
  const response = new Response(new ReadableStream({start(c){c.enqueue(encode(frame(result)+'data: [DONE]\n\n'));}, cancel(){return new Promise(()=>{});}}), {headers:{'content-type':'text/event-stream'}});
  assert.equal(await bounded(readCompletion(response)), '확인했습니다.');
});
test('finish reason drains trailing usage briefly without waiting forever for DONE or EOF', async () => {
  let measured;
  const response = new Response(new ReadableStream({start(c){c.enqueue(encode(frame(result)+frame({choices:[],usage:{prompt_tokens:4,completion_tokens:2,total_tokens:6}})));}}), {headers:{'content-type':'text/event-stream'}});
  const answer = readCompletion(response,undefined,undefined,undefined,undefined,undefined,value=>{measured=value;},undefined,{drainMs:8});
  assert.equal(await bounded(answer), '확인했습니다.'); assert.equal(measured.total_tokens,6);
});
test('keepalive and empty events are not model progress; reasoning and tool deltas are', async () => {
  let progress=0;
  const content=': heartbeat\n\ndata: {}\n\n'+frame({choices:[{delta:{role:'assistant'}}]})+frame({choices:[{delta:{reasoning_content:'checking'}}]})+frame(result)+'data: [DONE]\n\n';
  await readCompletion(new Response(content,{headers:{'content-type':'text/event-stream'}}),undefined,undefined,undefined,undefined,undefined,undefined,()=>progress++);
  assert.equal(progress,2);
});
test('nonterminal reasoning cannot extend a model attempt forever; retry preserves prior work', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let attempts=0, firstSignal, activity, ready, delayed=0; const receipt={captured:true,clicks:1};
  const started=new Promise(resolve=>{ready=resolve;});
  const pending=recoverModel(scope=>{
    attempts++; assert.deepEqual(receipt,{captured:true,clicks:1});
    if(attempts>1)return 'recovered';
    firstSignal=scope.signal; activity=scope.activity; ready();
    return new Promise(()=>{});
  },{signal:new AbortController().signal,idleMs:40,attemptMs:25,slowMs:8,minTimeout:0,onSlow:()=>delayed++});
  await started;
  for(let i=0;i<6;i++){t.mock.timers.tick(4);activity();}
  t.mock.timers.tick(1);
  assert.equal(await pending,'recovered'); assert.equal(attempts,2); assert(firstSignal.aborted);
  assert.equal(delayed,0,'active reasoning is not idle waiting, while the hard attempt deadline still applies');
});

test('tool argument deltas count as progress but are delivered only after a valid terminal frame', async () => {
  let progress=0, delivered=0;
  const stream=frame({choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'verify_page',arguments:'{"checks":'}}]}}]})+
    frame({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'[]}'}}]},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n';
  await readCompletion(new Response(stream,{headers:{'content-type':'text/event-stream'}}),undefined,undefined,undefined,undefined,calls=>{
    delivered++;assert.deepEqual(JSON.parse(calls[0].function.arguments),{checks:[]});assert.equal(progress,2);
  },undefined,()=>progress++);
  assert.equal(delivered,1);
});
