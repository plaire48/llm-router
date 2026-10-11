// The context window as the user asked for it (2026-09-30): the tokens AI Pro reports at the end of the stream, against
// the window its model list gives, shown in the composer and used for the compaction.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {conversationModel} from '../runtime/conversation-context.mjs';
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

test('the composer gauge reads the recorded usage as the browser gauge does',()=>{
  const measured=contextMeterInfo({kind:'measured',used:23223,window:262144,prompt:23175,completion:48,reasoning:30,compactAt:213811});
  assert.deepEqual(pick(measured,['used','capacity','kind','source']),{used:23223,capacity:262144,kind:'measured',source:'마지막 응답 실측'});
  assert.deepEqual(measured.usage,{prompt_tokens:23175,completion_tokens:48,total_tokens:23223,completion_tokens_details:{reasoning_tokens:30}});
  assert.equal(measured.compactAt,196608);assert.equal(measured.compactLabel,'자동 요약 (75%)');assert.match(measured.note,/모델이 알려 준 요청 사용량/);
  const estimated=contextMeterInfo({kind:'estimated',used:41000,window:null});
  assert.deepEqual(pick(estimated,['kind','capacity','ratio','usage']),{kind:'estimated',capacity:null,ratio:null,usage:null});
  assert.equal(contextMeterInfo(undefined),null);assert.equal(contextMeterInfo({kind:'measured',used:-1}),null);
});


test('explicit include_usage refusal drops only that option once and preserves the selected catalog limits',async()=>{
  const bodies=[];
  const providers=createProviders({startLogin:async()=>({result:Promise.resolve({token:'private-token',models:[qwen]}),cancel(){}}),
    fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);bodies.push(body);
      return bodies.length===1?Response.json({error:{param:'stream_options',message:'include_usage unsupported'}},{status:400})
        :Response.json({choices:[{message:{content:'확인했습니다.'},finish_reason:'stop'}]});}});
  try{
    await providers.login('aipro');for(let i=0;i<30&&providers.status().pending;i++)await new Promise(resolve=>setImmediate(resolve));
    const result=await providers.complete([{role:'user',content:'요청'}],[],new AbortController().signal);
    assert.equal(result.usage,null);assert.equal(bodies.length,2);
    assert.equal(bodies[0].stream_options.include_usage,true);assert.equal(bodies[1].stream_options,undefined);
    assert.deepEqual(bodies[0].messages,bodies[1].messages);
    assert.equal(providers.status().models[0].contextLength,262144);
    await providers.complete([{role:'user',content:'다음 요청'}],[],new AbortController().signal);
    assert.equal(bodies.length,3);assert.equal(bodies[2].stream_options,undefined);
  }finally{providers.dispose();}
});

test('AI Pro catalog refresh uses context and preserves the separate input ceiling',async()=>{
  const token='e30.'+Buffer.from(JSON.stringify({sub:'fixture'})).toString('base64url')+'.signature';
  const providers=createProviders({startLogin:async()=>({result:Promise.resolve({token,models:[qwen]}),cancel(){}}),
    fetchImpl:async()=>Response.json({modelList:[{name:'catalog-512k',context:'524288',max_input_tokens:200000,max_output_tokens:4096}]})});
  try{
    await providers.login('aipro');for(let i=0;i<30&&providers.status().pending;i++)await new Promise(resolve=>setImmediate(resolve));
    await providers.refreshModels('aipro');
    const model=providers.status().models.find(model=>model.id==='catalog-512k');
    assert.equal(model.contextLength,524288);assert.equal(model.maxInputTokens,200000);
    assert.equal(contextBudget(conversationModel(model)).input,200000);
  }finally{providers.dispose();}
});
