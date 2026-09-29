import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {createRunMetrics,readRunMetrics,measureRequest} from '../runtime/run-metrics.mjs';

async function store(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-metrics-')),value=new Store(directory);
  t.after(async()=>{value.close();await rm(directory,{recursive:true,force:true});});
  return value;
}
const messages=[{role:'system',content:'SYSTEM_BODY'},{role:'user',content:'USER_SECRET_BODY'},{role:'user',content:[{type:'text',text:'caption'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}];
const tools=[{type:'function',function:{name:'read_source',description:'d',parameters:{type:'object',properties:{}}}}];

test('request sizes separate system, tool schema and images without counting image bytes',()=>{
  const size=measureRequest(messages,tools);
  assert.equal(size.systemCharacters,'SYSTEM_BODY'.length+2);
  assert.equal(size.toolCharacters,JSON.stringify(tools).length);
  assert.equal(size.imageCount,1);
  assert.ok(size.messageCharacters<200,'image data is not counted as text');
  assert.ok(size.estimatedTokens>4096,'an image keeps its fixed token estimate');
});

test('model, tool and compaction events keep typed facts only',async t=>{
  const s=await store(t);let clock=1000;const metrics=createRunMetrics({store:s,taskId:'task-1',runId:'run-1',now:()=>clock});
  const model=metrics.beginModel({purpose:'planner',attempt:2,messages,tools,model:'fixture'});clock+=250;
  model.end({content:'ANSWER_BODY',finishReason:'stop',usage:{prompt_tokens:120,completion_tokens:30,prompt_tokens_details:{cached_tokens:100}},calls:[{function:{name:'read_source',arguments:'{"path":"SECRET_ARGUMENT"}'}}]});
  const failed=metrics.beginModel({purpose:'not-a-purpose',messages,tools,model:'fixture'});failed.fail('Upstream said: SECRET RAW ERROR');
  const tool=metrics.beginTool({tool:'read_source'});clock+=40;tool.end({path:'a.txt',content:'RESULT_BODY',image:{mimeType:'image/png',data:'BBBB'}});
  metrics.beginTool({tool:'wiki_query',scope:'child'}).end({error:'wiki_missing'});
  metrics.compaction({trigger:'overflow',beforeTokens:9000,afterTokens:4000});
  const {events,summary}=readRunMetrics(s,{taskId:'task-1',runId:'run-1'});
  assert.deepEqual(events.map(e=>e.kind),['metric_model','metric_model','metric_tool','metric_tool','metric_compaction']);
  assert.deepEqual(events.map(e=>e.sequence),[1,2,3,4,5]);
  assert.equal(events[0].purpose,'planner');assert.equal(events[0].attempt,2);assert.equal(events[0].elapsedMs,250);
  assert.deepEqual(events[0].usage,{prompt_tokens:120,completion_tokens:30,cached_tokens:100});
  assert.deepEqual(events[0].calls,['read_source']);
  assert.equal(events[1].purpose,'actor','unknown purposes fall back to actor');assert.equal(events[1].error,'unknown','raw error text is not stored');
  assert.equal(events[2].imageCount,1);assert.equal(events[2].resultCharacters,JSON.stringify({path:'a.txt',content:'RESULT_BODY'}).length);assert.equal(events[2].scope,'leader');
  assert.equal(events[3].scope,'child');assert.equal(events[3].error,'wiki_missing');
  assert.equal(events[4].trigger,'overflow');
  const stored=JSON.stringify(s.db.prepare('SELECT value FROM events').all());
  for(const secret of ['SYSTEM_BODY','USER_SECRET_BODY','ANSWER_BODY','SECRET_ARGUMENT','SECRET RAW ERROR','RESULT_BODY','AAAA','BBBB'])assert.ok(!stored.includes(secret),secret);
  assert.equal(summary.modelCalls,2);assert.equal(summary.retries,1);assert.equal(summary.toolCalls,2);assert.equal(summary.compactions,1);
  assert.equal(summary.byPurpose.planner.promptTokens,120);assert.equal(summary.byTool.read_source.calls,1);
  assert.equal(summary.cacheShare,100/120);assert.deepEqual(summary.toolErrors,{wiki_missing:1});assert.deepEqual(summary.modelErrors,{unknown:1});
  assert.ok(summary.fixedShare>0&&summary.fixedShare<=1);
});

test('a settled call is recorded once and other runs are not mixed in',async t=>{
  const s=await store(t),first=createRunMetrics({store:s,taskId:'task-1',runId:'run-1'}),second=createRunMetrics({store:s,taskId:'task-1',runId:'run-2'});
  const call=first.beginModel({purpose:'actor',messages,tools,model:'fixture'});call.end({content:''});call.end({content:''});call.fail('late');
  second.beginTool({tool:'read_source'}).end({});
  assert.equal(readRunMetrics(s,{taskId:'task-1',runId:'run-1'}).events.length,1);
  assert.equal(readRunMetrics(s,{taskId:'task-1',runId:'run-2'}).events.length,1);
  assert.equal(readRunMetrics(s,{taskId:'task-1'}).events.length,2);
});

test('a failing store never throws into the measured run',()=>{
  const broken={event(){throw new Error('disk full');},db:{prepare(){throw new Error('disk full');}}};
  const metrics=createRunMetrics({store:broken,taskId:'t',runId:'r'});
  assert.doesNotThrow(()=>{metrics.beginModel({purpose:'actor',messages,tools,model:'m'}).end({});metrics.beginTool({tool:'x'}).fail('e');metrics.compaction({trigger:'history',beforeTokens:1,afterTokens:1});});
  const circular={};circular.self=circular;
  assert.doesNotThrow(()=>createRunMetrics({store:broken,taskId:'t',runId:'r'}).beginTool({tool:'x'}).end(circular));
});

test('metric events older than thirty days are removed when a run starts; other events stay',async t=>{
  const s=await store(t),old=new Date(Date.now()-31*24*60*60*1000).toISOString(),insert=s.db.prepare('INSERT INTO events (at,kind,value) VALUES (?,?,?)');
  insert.run(old,'metric_model',JSON.stringify({taskId:'old',runId:'old',sequence:1}));
  insert.run(old,'task_created',JSON.stringify({id:'old'}));
  insert.run(new Date().toISOString(),'metric_tool',JSON.stringify({taskId:'new',runId:'new',sequence:1,tool:'x',elapsedMs:0}));
  createRunMetrics({store:s,taskId:'t',runId:'r'});
  assert.deepEqual(s.db.prepare('SELECT kind FROM events ORDER BY sequence').all().map(row=>row.kind),['task_created','metric_tool']);
});
