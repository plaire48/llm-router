import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {DesktopUsage,desktopUsage} from '../runtime/usage.mjs';
import {createProviders} from '../../nubi-office/worker/providers.mjs';
import {chatgptToken,responsesSSE} from '../../../extensions/aipro-chat/tests/fixtures/chatgpt.mjs';
import {workspaceContextMeterInfo} from '../ui/context-gauge.mjs';
installAgent(ProjectService);
const model={id:'gpt-5.6-sol',name:'gpt-5.6-sol',contextLength:262144};
const counters={input_tokens:23175,output_tokens:48,total_tokens:23223,input_tokens_details:{cached_tokens:20000},output_tokens_details:{reasoning_tokens:30}};
async function setup(t,stream){
 const {service}=await fixture(t);const ledger=desktopUsage(service);
 const providers=createProviders({chatGPTLogin:async()=>({result:Promise.resolve({provider:'chatgpt',token:chatgptToken(),expiresAt:Date.now()+3600000}),cancel(){}}),
  chatGPTModels:()=>({payload:{modelList:[{name:model.id,context_length:model.contextLength}]}}),
  fetchImpl:async()=>new Response(stream,{headers:{'content-type':'text/event-stream'}}),
  onUsageStart:meta=>ledger.start(meta),onUsageFinish:(id,usage)=>ledger.finish(id,usage)});
 await providers.login('chatgpt');for(let i=0;i<30&&providers.status().pending;i++)await new Promise(r=>setImmediate(r));
 service.providers=providers;return {service,providers,ledger};
}
test('ChatGPT Responses counters reach the Desktop donut and persisted app ledger through Pi',async t=>{
 const {service,ledger}=await setup(t,responsesSSE({text:'안녕하세요!',usage:counters}));
 const task=await service.createTask({request:'안녕'});await service.startAgent({taskId:task.id});await service.agent.promise;
 const info=workspaceContextMeterInfo({task:service.task(task.id),model});
 assert.equal(info.kind,'measured');assert.equal(info.used,23223);assert.equal(info.capacity,262144);assert.equal(info.usage.completion_tokens_details.reasoning_tokens,30);
 const stats=ledger.summary().usage.total.chatgpt;assert(stats.measured>0);assert.equal(stats.total,23223*stats.measured);assert.equal(stats.pending,0);
 ledger.close();const reopened=new DesktopUsage(service.storageRoot);assert.deepEqual(reopened.summary().usage.total.chatgpt,stats);reopened.close();
});
test('ChatGPT failed terminal events retain reported tokens without marking the answer successful',async t=>{
 const stream='data: '+JSON.stringify({type:'response.failed',response:{id:'fixture',status:'failed',usage:counters,error:{code:'server_error'}}})+'\n\n';
 const {providers,ledger}=await setup(t,stream);
 await assert.rejects(providers.complete([{role:'user',content:'test'}],[],new AbortController().signal),/upstream/);
 const stats=ledger.summary().usage.total.chatgpt;assert.equal(stats.total,23223);assert.equal(stats.measured,1);assert.equal(stats.pending,0);assert.equal(stats.cached,20000);assert.equal(stats.reasoning,30);
});
test('ChatGPT omitted usage remains unmeasured instead of adopting SDK default zero',async t=>{
 const {providers,ledger}=await setup(t,responsesSSE({usage:null}));
 const result=await providers.complete([{role:'user',content:'test'}],[],new AbortController().signal);
 assert.equal(result.usage,null);const stats=ledger.summary().usage.total.chatgpt;assert.equal(stats.calls,1);assert.equal(stats.measured,0);assert.equal(stats.pending,0);
});

test('while the first actor is pending the donut shows the actual request estimate, then measured tokens',async t=>{
 const {service}=await fixture(t);let release,entered;
 const pending=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 service.providers={status:()=>({provider:'chatgpt',connected:true,model:model.id,models:[model]}),dispose(){},async complete(){entered();await pending;return {content:'안녕하세요!',calls:[],usage:{prompt_tokens:23175,completion_tokens:48,total_tokens:23223}};}};
 const task=await service.createTask({request:'안녕'});await service.startAgent({taskId:task.id});
 try{await started;const info=workspaceContextMeterInfo({task:service.task(task.id),model});assert.equal(info.kind,'estimated');assert(info.used>0);assert.equal(info.source,'전송 문맥 추정');}
 finally{release();await service.agent.promise;}
 assert.equal(workspaceContextMeterInfo({task:service.task(task.id),model}).kind,'measured');
});
