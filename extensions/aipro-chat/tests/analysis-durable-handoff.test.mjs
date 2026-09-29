import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';
import {documentToolDefinitions} from '../document-contract.js';
import {normalizeAnalysisHandoff,normalizeAnalysisHandoffs,storeAnalysisHandoff,readAnalysisHandoff,analysisHandoffReminder,cancelAnalysisHandoffs} from '../analysis-handoff.js';
const hash='a'.repeat(64);
const call=(name,args)=>({calls:[{id:crypto.randomUUID(),function:{name,arguments:JSON.stringify(args)}}]});
const answer={content:JSON.stringify({status:'partial',summary:'앞부분 확인',findings:[{text:'조건 A',evidence_ids:['ev_1']}],uncertainties:['뒷부분 미확인'],next_step:'남은 범위 읽기'})};
const brief={role:'research',task:'긴 문서의 조건 비교 '+ '세부 기준 '.repeat(80),constraints:'원문을 수정하지 말고 예외를 보존하세요',done_when:'각 조건의 근거와 미해결 항목 반환',effort:'standard'};
const record=(n=1)=>({version:1,id:`handoff_00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,status:'running',brief,
 documents:[{id:'doc1',hash}],ranges:[{document_id:'doc1',hash,start:0,end:6}],progress:[{document_id:'doc1',hash,start:0,end:6,read:[{start:0,end:3}],remaining:[{start:3,end:6}],review_needed:true}],sources:[]});
test('durable handoff retains full constraints/ranges and rejects changed or missing document versions without executing',()=>{
 const original=record();original.secret='PRIVATE';const state=storeAnalysisHandoff(null,original);
 assert.equal(state.records[0].brief.task,brief.task);assert.equal(state.records[0].brief.constraints,brief.constraints);assert(!JSON.stringify(state).includes('PRIVATE'));
 assert.equal(readAnalysisHandoff(state,original.id,[{id:'doc1',hash}]).recovery,'needs_fresh_evidence');
 for (const docs of [[],[{id:'doc1',hash:'b'.repeat(64)}]])assert.equal(readAnalysisHandoff(state,original.id,docs).recovery,'source_changed');
 const returned=readAnalysisHandoff(state,original.id,[{id:'doc1',hash}]);returned.record.brief.constraints='changed';returned.record.progress[0].read[0].end=6;
 assert.equal(state.records[0].brief.constraints,brief.constraints);assert.equal(state.records[0].progress[0].read[0].end,3);
 assert.equal(readAnalysisHandoff(cancelAnalysisHandoffs(state),original.id,[{id:'doc1',hash}]).recovery,'cancelled');
 assert.match(analysisHandoffReminder(state),/read_analysis_handoff/);
});
test('handoffs are bounded, schema checked and redacted while the newest record survives retention',()=>{
 let state;for(let n=1;n<=30;n++)state=storeAnalysisHandoff(state,record(n));
 assert.equal(state.records.length,12);assert.equal(state.omittedAtLeast,18);assert.equal(state.records[0].id,record(30).id);
 assert.deepEqual(normalizeAnalysisHandoffs(state),state);
 assert.equal(normalizeAnalysisHandoff({...record(),brief:{...brief,constraints:'x'.repeat(801)}}),null);
 assert.throws(()=>storeAnalysisHandoff(state,{...record(),ranges:[{document_id:'other',hash,start:0,end:6}]}),/analysis_handoff_invalid/);
 const redacted=storeAnalysisHandoff(null,{...record(),brief:{...brief,constraints:'Bearer secret'}});
 assert.equal(redacted.records[0].redacted,true);assert(!JSON.stringify(redacted).includes('secret'));
 assert.equal(readAnalysisHandoff(redacted,record().id,[{id:'doc1',hash}]).recovery,'redacted_brief');
});
test('coordinator commits the full brief before model calls and preserves actual partial document progress',async t=>{
 let saved,release,calls=0,first=true;
 const barrier=new Promise(resolve=>{release=resolve;});
 const h=createAnalysisCoordinator({signal:new AbortController().signal,modelId:'test',run:runAgent,tools:documentToolDefinitions(),documents:[{id:'doc1',hash}],
  onHandoff:async value=>{if(first){first=false;await barrier;}saved=storeAnalysisHandoff(saved,value);},
  execute:async(name,args)=>{assert.equal(name,'read_document');assert.equal(args.document_id,'doc1');return {ok:true,text:'abc',start:0,end:3,provenance:{document_id:'doc1',hash,path:'source.txt',start:0,end:3,unit:'characters'}};},
  complete:async wire=>{calls++;return wire.some(m=>m.role==='tool')?answer:call('read_document',{document_id:'doc1',offset:0,length:3});}});
 t.after(()=>h.dispose());
 const tasks=await h.execute('delegate_analysis',{tasks:[{...brief,evidence_ids:[],document_ids:['doc1'],document_ranges:record().ranges}]});
 await new Promise(r=>setTimeout(r,10));assert.equal(calls,0);assert.equal(saved,undefined);release();
 const result=await h.collect();assert.equal(result.results[0].report.status,'partial');assert.equal(calls,2);
 const latest=saved.records[0];assert.equal(latest.id,tasks.tasks[0].task_id.replace('analysis_','handoff_'));
 assert.equal(latest.brief.task,brief.task.trim());assert.deepEqual(latest.progress[0].remaining,[{start:3,end:6}]);
 assert.equal(latest.report.status,'partial');assert.equal(latest.sources[0].locator.hash,hash);assert(!JSON.stringify(latest).includes('"abc"'));assert(!JSON.stringify(latest).includes('ev_1'));
 h.dispose();
 const next=createAnalysisCoordinator({signal:new AbortController().signal,documents:[{id:'doc1',hash:'b'.repeat(64)}],handoffs:saved,execute:()=>assert.fail('No automatic read'),complete:()=>assert.fail('No automatic inference')});
 t.after(()=>next.dispose());
 const recovered=await next.execute('read_analysis_handoff',{handoff_id:latest.id});assert.equal(recovered.recovery,'source_changed');assert.equal(recovered.record.brief.constraints,brief.constraints);assert.equal(next.status().length,0);
});
test('failed checkpoint storage prevents a child model call instead of claiming durable recovery',async t=>{
 let calls=0;
 const h=createAnalysisCoordinator({signal:new AbortController().signal,modelId:'test',run:runAgent,tools:[],execute:async()=>assert.fail(),complete:async()=>{calls++;return answer;},onHandoff:async()=>{throw Error('quota');}});
 t.after(()=>h.dispose());h.observe('read_page',{}, {text:'observed'});
 await h.execute('delegate_analysis',{tasks:[{role:'page',task:'read',done_when:'cite evidence',evidence_ids:['ev_1']}]});
 const result=await h.collect();assert.equal(calls,0);assert.equal(result.results[0].status,'failed');assert.equal(result.results[0].error,'analysis_handoff_failed');assert.equal(result.results[0].handoff_error,'analysis_handoff_failed');
});
test('cancel interrupts a stalled checkpoint without starting the queued worker',async t=>{
 let calls=0;
 const h=createAnalysisCoordinator({signal:new AbortController().signal,run:runAgent,tools:[],complete:async()=>{calls++;return answer;},onHandoff:()=>new Promise(()=>{}),readTimeoutMs:1000});
 t.after(()=>h.dispose());h.observe('read_page',{}, {text:'observed'});
 const launched=await h.execute('delegate_analysis',{tasks:[{role:'page',task:'read',done_when:'cite',evidence_ids:['ev_1']}]});
 const result=await h.execute('cancel_analysis',{task_id:launched.tasks[0].task_id});
 assert.equal(result.status,'cancelled');assert.equal(calls,0);
});
