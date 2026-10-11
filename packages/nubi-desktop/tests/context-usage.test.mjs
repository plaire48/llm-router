// The context window as the user asked for it (2026-09-30): the tokens AI Pro reports at the end of the stream, against
// the window its model list gives, shown in the composer and used for the compaction.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {conversationModel} from '../runtime/conversation-context.mjs';
import {readRunMetrics} from '../runtime/run-metrics.mjs';
import {contextBudget} from '../../../extensions/aipro-chat/context-manager.js';
import {contextMeterInfo} from '../ui/context-gauge.mjs';
import {createProviders} from '../../nubi-office/worker/providers.mjs';
installAgent(ProjectService);

const qwen={id:'qwen3.8-27b',label:'qwen3.8-27b',contextLength:262144};
const status=model=>()=>({connected:true,model:model.id,models:[model]});
const compactAt=model=>contextBudget(conversationModel(model)).trigger;
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>key in value).map(key=>[key,value[key]]));

test('the gauge takes the tokens the model reported at the end of its stream and the window of that model',async t=>{
  const {service}=await fixture(t);
  service.providers={status:status(qwen),dispose(){},async complete(){
    return {content:'안녕하세요! 테스트가 잘 전달되었습니다.',calls:[],usage:{prompt_tokens:23175,completion_tokens:48,total_tokens:23223,completion_tokens_details:{reasoning_tokens:30}}};
  }};
  const task=await service.createTask({request:'테스트입니다.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const {usage}=service.task(task.id).context;
  assert.deepEqual(pick(usage,['kind','used','window','prompt','completion','reasoning','compactAt','model']),
    {kind:'measured',used:23223,window:262144,prompt:23175,completion:48,reasoning:30,compactAt:compactAt(qwen),model:'qwen3.8-27b'});
  assert.equal(compactAt(qwen),196608,'the history is summarized at 75% of the whole window of the model (user decision 2026-10-04)');
});

test('an AI Pro stream that ends with its usage reaches the gauge through the Office provider',async t=>{
  const {service}=await fixture(t);
  // The stream the user pasted (2026-09-30): reasoning, the answer, a stop chunk, then a chunk with usage only.
  const chunks=[{choices:[{index:0,delta:{role:'assistant',reasoning_content:'인사에 답한다.'},finish_reason:null}]},{choices:[{index:0,delta:{content:'안녕하세요! 무엇을 도와드릴까요?'},finish_reason:null}]},
    {choices:[{index:0,delta:{},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:23175,total_tokens:23223,completion_tokens:48,completion_tokens_details:{reasoning_tokens:30}}}];
  const stream=chunks.map(chunk=>'data: '+JSON.stringify(chunk)+'\n\n').join('')+'data: [DONE]\n\n',bodies=[];
  const providers=createProviders({startLogin:async()=>({result:Promise.resolve({token:'private-token',models:[qwen]}),cancel(){}}),
    fetchImpl:async(url,options)=>{bodies.push(JSON.parse(options.body));return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});}});
  await providers.login('aipro');for(let i=0;i<30&&providers.status().pending;i++)await new Promise(resolve=>setImmediate(resolve));
  service.providers=providers;
  const task=await service.createTask({request:'테스트입니다.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.ok(bodies.length&&bodies.every(body=>body.stream_options?.include_usage===true),'every request asks for the usage');
  assert.deepEqual(pick(service.task(task.id).context.usage,['kind','used','window','prompt','completion','reasoning']),{kind:'measured',used:23223,window:262144,prompt:23175,completion:48,reasoning:30});
});

test('without a report the gauge is an estimate of what was sent and answered',async t=>{
  const {service}=await fixture(t);
  service.providers={status:status(qwen),dispose(){},async complete(){return {content:'확인했습니다.',calls:[]};}};
  const task=await service.createTask({request:'테스트입니다.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const {usage}=service.task(task.id).context;
  assert.equal(usage.kind,'estimated');assert.equal(usage.window,262144);assert.ok(usage.used>1000,'the instructions and tools count');
  assert.equal('prompt' in usage,false);
});

test('a large request the server fails is tried twice, then the history is summarized and the request sent once more',async t=>{
  const {service}=await fixture(t);service.recoveryOptions={model:{minTimeout:1}};
  // About 130K tokens of earlier conversation: under the point where it is summarized first, over the size of a large request.
  const model={id:'large-window',contextLength:200000},budget=contextBudget(conversationModel(model));
  const task=await service.createTask({request:'앞에서 정리한 내용을 이어서 확인해 줘.'});
  task.messages=Array.from({length:26},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:`Earlier discussion ${i} `+'reference details '.repeat(1100),at:new Date(Date.UTC(2026,8,30,0,i)).toISOString()}));
  service.store.set('task:'+task.id,task);
  let attempts=0,summaries=0;
  service.providers={status:status(model),dispose(){},async complete(messages){
    if(String(messages[0].content).startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify({goal:'앞의 논의를 이어서 확인한다',constraints:[],decisions:[],completed:[],pending:[],references:[]}),calls:[]};}
    if(++attempts<=2)throw Object.assign(new Error('upstream'),{status:503});
    return {content:'확인했습니다.',calls:[]};
  }};
  const {runId}=await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  assert.equal(attempts,3,'two attempts of the large request, one after the summary');assert.ok(summaries>=1);
  const {events}=readRunMetrics(service.store,{taskId:task.id,runId});
  const sizes=events.filter(e=>e.kind==='metric_model'&&e.purpose==='actor').map(e=>e.estimatedTokens);
  assert.ok(sizes[0]>=Math.min(100000,Math.floor(budget.input*.5))&&sizes[0]<=budget.trigger,`the first request is large and under the trigger: ${sizes[0]}`);
  assert.ok(sizes.at(-1)<sizes[0],'the request sent after the summary is smaller');
  assert.ok(service.task(task.id).context.compactions>=1);
});

test('the composer gauge reads the recorded usage as the browser gauge does',()=>{
  const measured=contextMeterInfo({kind:'measured',used:23223,window:262144,prompt:23175,completion:48,reasoning:30,compactAt:213811});
  assert.deepEqual(pick(measured,['used','capacity','kind','source']),{used:23223,capacity:262144,kind:'measured',source:'마지막 응답 실측'});
  assert.deepEqual(measured.usage,{prompt_tokens:23175,completion_tokens:48,total_tokens:23223,completion_tokens_details:{reasoning_tokens:30}});
  assert.equal(measured.compactAt,196608);assert.equal(measured.compactLabel,'자동 요약 (75%)');assert.match(measured.note,/모델이 알려 준 요청 사용량/);
  const estimated=contextMeterInfo({kind:'estimated',used:41000,window:null});
  assert.deepEqual(pick(estimated,['kind','capacity','ratio','usage']),{kind:'estimated',capacity:null,ratio:null,usage:null});
  assert.equal(contextMeterInfo(undefined),null);assert.equal(contextMeterInfo({kind:'measured',used:-1}),null);
});
