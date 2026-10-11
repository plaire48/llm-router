import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readRunMetrics} from '../runtime/run-metrics.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000,maxOutputTokens:4096}]});
const plan={intent:{goal:'확인',constraints:[],outcomes:['결과를 전달한다'],workflowIds:[],skillPaths:[]},steps:[{text:'자료 확인',expected_outcome:'근거를 확인한다',status:'in_progress'},{text:'답변',expected_outcome:'결과를 전달한다',status:'pending'}]};
const ready=messages=>({content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[]});

test('each model call is recorded with the purpose of its call site and each tool with its size',async t=>{
  const {service}=await fixture(t,{scriptedReview:true,scriptedPlanning:true});let actor=0;
  service.providers={status,dispose(){},async complete(messages){
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify(plan),calls:[],usage:{prompt_tokens:300,completion_tokens:40}};
    if(messages[0].content.startsWith(REVIEW_PROMPT))return ready(messages);
    return ++actor===1?{...call('wiki_query',{query:'welcome'}),usage:{prompt_tokens:9000,completion_tokens:20,prompt_tokens_details:{cached_tokens:8000}}}:{content:'환영 화면은 app.txt를 사용합니다.',calls:[]};
  }};
  const task=await service.createTask({request:'환영 화면이 쓰는 파일을 알려 줘'}),{runId}=await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  const {events,summary}=readRunMetrics(service.store,{taskId:task.id,runId});
  assert.deepEqual(events.filter(e=>e.kind==='metric_model').map(e=>e.purpose),['actor','planner','actor','reviewer']);
  const tools=events.filter(e=>e.kind==='metric_tool');
  assert.ok(tools.some(e=>e.tool==='wiki_query'&&e.scope==='leader'&&e.resultCharacters>0&&e.error===null));
  assert.ok(tools.some(e=>e.tool==='update_plan'));
  assert.equal(summary.byPurpose.actor.calls,2);assert.equal(summary.byPurpose.actor.cachedTokens,8000);
  assert.equal(summary.promptTokens,9300);assert.ok(summary.fixedShare>0.5,'system and tool schema dominate a short request');
  assert.ok(!JSON.stringify(events).includes('환영 화면'),'no request or answer text in telemetry');
});

test('a retried model call records every attempt and a failed tool records its code',async t=>{
  const {service}=await fixture(t);service.recoveryOptions={model:{minTimeout:1}};let actor=0;
  service.providers={status,dispose(){},async complete(){
    actor++;
    if(actor===1)throw Object.assign(new Error('upstream'),{status:503});
    if(actor===2)return call('read_source',{path:'missing.txt'});
    return {content:'파일을 찾지 못했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'missing.txt를 읽어 줘'}),{runId}=await service.startAgent({taskId:task.id});await service.agent.promise;
  const {events,summary}=readRunMetrics(service.store,{taskId:task.id,runId});
  const actors=events.filter(e=>e.kind==='metric_model'&&e.purpose==='actor');
  assert.deepEqual(actors.slice(0,2).map(e=>[e.attempt,e.error===null]),[[1,false],[2,true]]);
  assert.equal(summary.retries,1);
  assert.ok(events.some(e=>e.kind==='metric_tool'&&e.tool==='read_source'&&typeof e.error==='string'));
});

test('a history compaction is recorded with its trigger',async t=>{
  const {service}=await fixture(t);
  const task=await service.createTask({request:'Original user goal'});
  task.messages=Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',content:'Historical project discussion '+i+' '+'reference details '.repeat(500)}));service.store.set('task:'+task.id,task);
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:64000,maxOutputTokens:4096}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation'))return {content:JSON.stringify({goal:'Original user goal',constraints:[],decisions:[],completed:[],pending:[],references:[]}),calls:[]};
    return {content:'확인했습니다.',calls:[]};
  }};
  const {runId}=await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  const {events}=readRunMetrics(service.store,{taskId:task.id,runId});
  assert.ok(events.some(e=>e.kind==='metric_model'&&e.purpose==='summary'));
  const compaction=events.find(e=>e.kind==='metric_compaction');
  assert.equal(compaction.trigger,'history');assert.ok(compaction.beforeTokens>compaction.afterTokens);
});
