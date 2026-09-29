import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForRead, createReferenceReads} from '../read-deadline.js';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {documentToolDefinitions} from '../document-contract.js';
import {runAgent} from '../agent-runtime.js';
import {projectRequest} from '../project-tools.js';
const gate=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};};
const timeout=async promise=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('test hung')),500);timer.unref();})]);
const call=args=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_document',arguments:JSON.stringify(args)}}]});
const report=()=>({content:JSON.stringify({status:'partial',summary:'읽지 못한 구간이 있습니다.',findings:[],uncertainties:['원문 조회 지연'],next_step:'남은 범위를 더 작게 읽기'})});

test('ignored read cancellation cannot keep the serial executor locked; late settlement is ignored', async()=>{
  const late=gate(),reads=createReferenceReads();let signal,returned=false;
  const first=reads.run('one',s=>{signal=s;return late.promise;},{timeoutMs:10}).then(()=>{returned=true;});
  await assert.rejects(first,/read_timeout/);assert(signal.aborted);
  assert.equal(await reads.run('two',async()=>42),42);
  late.resolve('late value');await new Promise(r=>setImmediate(r));assert.equal(returned,false);
});
test('cancel releases a hanging reference read and never cancels a different request',async()=>{
  const reads=createReferenceReads(),first=gate();let aborted;
  const waiting=reads.run('one',s=>{aborted=s;return first.promise;},{timeoutMs:0});
  await new Promise(r=>setImmediate(r));reads.cancel('one');
  await assert.rejects(timeout(waiting),/cancelled/);assert(aborted.aborted);
  assert.equal(await reads.run('two',async()=>true),true);first.resolve('ignored');
  let called=false;const c=new AbortController();c.abort();
  await assert.rejects(waitForRead(()=>{called=true;},{signal:c.signal}),/cancelled/);assert.equal(called,false);
});
test('stalled child read returns actionable feedback without inventing evidence or replaying it',async t=>{
  let count=0,reads=0;const late=gate();const range={document_id:'doc',hash:'a'.repeat(64),start:0,end:100};
  const h=createAnalysisCoordinator({signal:new AbortController().signal,documents:[{id:'doc',hash:range.hash,name:'doc.txt'}],tools:documentToolDefinitions(),readTimeoutMs:10,run:runAgent,
    execute:async()=>{reads++;return late.promise;},complete:async wire=>{
      if(++count===1)return call({document_id:'doc',offset:0,length:100});
      assert.match(wire.at(-1).content,/read_timeout/);return report();
    }});t.after(()=>h.dispose());
  await h.execute('delegate_analysis',{tasks:[{role:'research',task:'read',done_when:'read the assigned span',evidence_ids:[],document_ids:['doc'],document_ranges:[range]}]});
  const out=(await timeout(h.collect())).results[0];assert.equal(out.report.status,'partial');assert.equal(reads,1);
  assert.deepEqual(out.document_progress[0].remaining,[range]);assert.equal(out.document_progress[0].read.length,0);
  late.resolve({ok:true,text:'late'});await new Promise(r=>setImmediate(r));
  const after=await h.collect({task_ids:[out.task_id]});assert.deepEqual(after.results[0].document_progress,out.document_progress);
});
test('cancel_analysis finishes even when a model callback ignores abort; late answer cannot revive it',async t=>{
  const late=gate(),started=gate(),trace=[];
  const h=createAnalysisCoordinator({signal:new AbortController().signal,run:runAgent,complete:async()=>{started.resolve();return late.promise;},onStep:e=>trace.push(e)});t.after(()=>h.dispose());
  h.observe('read_page',{}, {text:'sample'});
  const {tasks}=await h.execute('delegate_analysis',{tasks:[{role:'page',task:'read',done_when:'done',evidence_ids:['ev_1']}]});
  await started.promise;
  const result=await timeout(h.execute('cancel_analysis',{task_id:tasks[0].task_id}));assert.equal(result.status,'cancelled');
  const length=trace.length;late.resolve(report());await new Promise(r=>setTimeout(r,15));
  assert.equal(trace.length,length);assert.equal(h.status()[0].status,'cancelled');
});
test('project stream cleanup cannot hang on a broken cancellation implementation',async()=>{
  const fetchImpl=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(160001)));},cancel(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
  await assert.rejects(timeout(projectRequest('http://127.0.0.1:43219','info',{fetchImpl})),/project_invalid/);
});
