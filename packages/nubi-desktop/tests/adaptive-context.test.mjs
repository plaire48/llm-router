import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contextBudget, contextTokens, createRunContext} from '../../../extensions/aipro-chat/context-manager.js';
import {parseModelList, windowTokens} from '../../../extensions/aipro-chat/core.js';

const summary={goal:'기존 작업 계속',constraints:[],decisions:[],completed:[],pending:['다음 결과 확인'],references:[]};
const pair=(id,text)=>[{role:'assistant',content:'',tool_calls:[{id,type:'function',function:{name:'read_source',arguments:'{}'}}]},
  {role:'tool',tool_call_id:id,content:JSON.stringify({text})}];
const validPairs=wire=>{
  const ids=new Set();
  for(const message of wire){for(const call of message.tool_calls||[])ids.add(call.id);
    if(message.role==='tool')assert.ok(ids.delete(message.tool_call_id),'result must follow its matching call');}
  assert.equal(ids.size,0,'no orphan call');
};

for(const capacity of [262144,524288,1048576]){
  test(`${capacity} window reserves output and scales trigger, retained history and summary chunks`,()=>{
    const budget=contextBudget({contextLength:capacity});
    assert.equal(budget.input+budget.output,capacity);
    assert.equal(budget.trigger,Math.floor(budget.input*.9));
    assert.equal(budget.recentTokens,Math.min(96000,Math.floor(budget.input*.2)));
    assert.equal(budget.summaryInput,Math.min(120000,Math.floor(budget.input*.2)));
    assert.ok(budget.trigger>budget.recentTokens+budget.summaryOutput);
  });
  test(`${capacity} long run preserves latest result, literal requirements and current host receipts`,async()=>{
    const budget=contextBudget({contextLength:capacity}),saved=[],invocations=[];
    const latest=pair('latest','검증된 현재 결과'),host={role:'user',contextOnly:true,content:'Host receipt: interrupted; do not replay command'};
    const original=[{role:'system',content:'작업 지침'},...pair('older','x'.repeat((budget.trigger+2000)*4)),...latest,host];
    const frozen=structuredClone(original),requirement='발송하지 마세요. 승인된 명령을 다시 실행하지 마세요.';
    const context=createRunContext({model:{contextLength:capacity},tools:[],goal:'원래 요청',requirements:[requirement],signal:new AbortController().signal,
      invoke:async(messages,options)=>{assert.equal(options.summary,true);invocations.push(messages);return {content:JSON.stringify(summary)};},save:async value=>saved.push(value)});
    const result=await context.prepare(original);
    assert.ok(invocations.length>=3,'chunked reduction, not one enormous summary request');
    assert.ok(invocations.every(wire=>contextTokens(wire)<budget.input));
    assert.ok(invocations.every(wire=>!JSON.stringify(wire).includes('검증된 현재 결과')),'unread latest result is never summarized');
    assert.ok(result.some(m=>m.content===requirement));
    assert.deepEqual(result.slice(-3),[...latest,host]);validPairs(result);
    assert.deepEqual(original,frozen);assert.equal(saved.length,1,'commit only the completed source span');
    assert.ok(saved[0].afterTokens<saved[0].beforeTokens);
    assert.ok(saved[0].afterTokens<budget.input);
  });
}

test('catalog capacity aliases and numeric strings are separate from max input tokens',()=>{
  for(const field of ['context','context_length','context_window','max_model_len','max_context_length']){
    const model={name:'catalog-name',[field]:'524288',max_input_tokens:200000};
    assert.equal(windowTokens(model),524288);
    const selected=parseModelList({modelList:[model]})[0];
    assert.equal(selected.contextLength,524288);assert.equal(selected.maxInputTokens,200000);
    const budget=contextBudget(selected);assert.equal(budget.input,200000);assert.equal(budget.trigger,180000);
  }
  assert.equal(windowTokens({max_input_tokens:1000000}),null);
  assert.equal(windowTokens({context:0,context_length:-1}),null);
  assert.equal(contextBudget({}).capacity,null);
  assert.equal(contextBudget({}).trigger,90000);
});

test('measured prefix uses actual prompt count and only estimates newly appended results',()=>{
  const wire=[{role:'system',content:'rules'},{role:'user',content:'x'.repeat(8000)}],tools=[];
  const context=createRunContext({model:{contextLength:262144},tools,signal:new AbortController().signal});
  context.record({prompt_tokens:800,completion_tokens:48,total_tokens:848},wire,tools);
  assert.equal(context.size(wire),800,'prompt count is not the total including the previous answer');
  const tail=[{role:'assistant',content:'previous answer'},...pair('json','x'.repeat(20000))];
  assert.equal(context.size([...wire,...tail]),800+contextTokens(tail)-contextTokens([]),'new JSON must not inherit an old Korean/prose multiplier');
});

test('an edited prefix, switched tool schema and missing usage invalidate exact measurement',()=>{
  const wire=[{role:'user',content:'hello'}],tools=[];
  const context=createRunContext({model:{contextLength:524288},tools,signal:new AbortController().signal});
  context.record({prompt_tokens:2000,completion_tokens:0,total_tokens:2000},wire,tools);
  assert.equal(context.size(wire),2000);
  assert.equal(context.size([{role:'user',content:'edited'}]),contextTokens([{role:'user',content:'edited'}]));
  const changed=[{type:'function',function:{name:'different',parameters:{type:'object'}}}];
  assert.equal(context.size(wire,changed),contextTokens(wire,changed));
  context.record(null,wire);assert.equal(context.size(wire),contextTokens(wire));
  context.record({prompt_tokens:2000,completion_tokens:5,total_tokens:2000},wire);
  assert.equal(context.size(wire),contextTokens(wire),'inconsistent counters are not trusted');
});

test('failed or cancelled reductions do not commit a partial multi-chunk memory',async()=>{
  for(const cancelled of [false,true]){
    const controller=new AbortController(),budget=contextBudget({contextLength:262144}),saved=[];let calls=0;
    const context=createRunContext({model:{contextLength:262144},tools:[],signal:controller.signal,
      invoke:async()=>{calls++;if(calls===2){if(cancelled)controller.abort();throw Error(cancelled?'cancelled':'upstream');}return {content:JSON.stringify(summary)};},save:value=>saved.push(value)});
    const wire=[...pair('old','x'.repeat((budget.input+1000)*4)),...pair('latest','current')];
    await assert.rejects(context.prepare(wire,true),cancelled?/cancelled/:/upstream/);assert.equal(saved.length,0);
  }
});


test('a large advertised window with a small actual input ceiling uses the small-input policy',()=>{
  const budget=contextBudget({contextLength:1048576,maxInputTokens:16000});
  assert.equal(budget.capacity,1048576);assert.equal(budget.input,16000);
  assert.equal(budget.trigger,12000);assert.equal(budget.recentTokens,4800);
  assert.equal(budget.summaryInput,16000);
  assert.equal(contextBudget({maxInputTokens:200000}).trigger,150000,'unknown total window stays conservative');
});
