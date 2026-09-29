import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {contentPacket} from '../browser-content.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools,BUILTIN_SKILLS} from '../skills.js';
const source={url:'https://example.test/rules.pdf',sourceIdentity:['doc-a','https://example.test/rules.pdf'],frame:0,title:'Rules',method:'pdf_text',text:'Original rule paragraph. '.repeat(500)};
const setup=t=>{const c=createAnalysisCoordinator({signal:new AbortController().signal});t.after(()=>c.dispose());return c;};
test('short run-local content references resolve the exact original hash and retain changed-source rejection',async t=>{
 const c=setup(t),packet=await contentPacket(source),id=c.observe('read_page',{mode:'content'},packet);
 const input={mode:'content',content_ref:c.pageContentReference(id) || id,offset:packet.next_offset};
 const resolved=c.resolvePageContentRead(input);assert.equal(resolved.args.content_hash,packet.content_hash);assert.equal(resolved.args.frame,0);assert.equal(resolved.args.offset,5000);assert(!('content_ref' in resolved.args));
 const next=await contentPacket(source,resolved.args);assert.equal(next.ranges[0].start,5000);
 assert.equal((await contentPacket({...source,text:'Changed text'},resolved.args)).error,'browser_content_changed');
 assert.equal((await contentPacket({...source,sourceIdentity:['doc-b','https://example.test/other.pdf']},resolved.args)).error,'browser_content_changed');
 assert.equal(input.content_ref,c.pageContentReference(id));assert.equal(c.resolvePageContentRead({...input,frame:1}).error,'analysis_scope');
 assert.equal(c.resolvePageContentRead({...input,content_hash:'f'.repeat(64)}).error,'analysis_scope');
});
test('unknown, evicted, failed, truncated and non-content sources cannot supply a continuation hash',async t=>{
 const c=setup(t),packet=await contentPacket(source),valid=c.observe('read_page',{},packet),handle=c.pageContentReference(valid);
 for(const [tool,result] of [['verify_page',packet],['read_page',{...packet,ok:false,error:'read_failed'}],['read_page',{...packet,dataKind:'screen'}],['read_page',{...packet,extra:'x'.repeat(210000)}]]) {
  const id=c.observe(tool,{},result);assert.equal(c.resolvePageContentRead({mode:'content',content_ref:c.pageContentReference(id) || id}).error,'analysis_evidence_missing');
 }
 assert.equal(c.resolvePageContentRead({mode:'screen',content_ref:c.pageContentReference(valid) || valid}).error,'analysis_evidence_missing');
 for(let i=0;i<50;i++)c.observe('read_page',{},packet);
 for(const id of [valid,'ev_999'])assert.equal(c.resolvePageContentRead({mode:'content',content_ref:c.pageContentReference(id) || id}).error,'analysis_evidence_missing');
 const other=setup(t);other.observe('read_page',{},packet);assert.equal(other.resolvePageContentRead({mode:'content',content_ref:handle}).error,'analysis_evidence_missing');
});
test('runtime resolves a model content reference before the host read and retains the original source evidence',async()=>{
 const tools=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent')).filter(t=>t.function.name!=='update_plan');
 let round=0,id;const calls=[];
 const call=args=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_page',arguments:JSON.stringify(args)}}]});
 const result=await runAgent({messages:[{role:'user',content:'Read two consecutive parts of this source.'}],tools,harness:true,stepwise:false,signal:new AbortController().signal,
 completeAnalysis:async()=>assert.fail('No subagent needed'),execute:async(name,args)=>{assert.equal(name,'read_page');calls.push(structuredClone(args));return contentPacket(source,args);},
 complete:async wire=>{round++;if(round===1)return call({mode:'content'});if(round===2){const packet=JSON.parse(wire.findLast(m=>m.role==='tool').content);id=packet.content_ref;return call({mode:'content',content_ref:id,offset:packet.next_offset});}return {content:'Two source ranges read.'};},
 reviewGoal:async({evidence})=>{const pages=evidence.filter(e=>e.result.dataKind==='page_content');assert.equal(pages.length,2);assert.equal(pages[1].result.ranges[0].start,5000);assert.equal(pages[0].result.content_hash,pages[1].result.content_hash);return {status:'complete'};}});
 assert.equal(result.content,'Two source ranges read.');assert.match(id,/^c_/);assert.equal(calls.length,2);assert.equal(calls[1].content_hash,(await contentPacket(source)).content_hash);assert(!('content_ref' in calls[1]));
});

// Host reference rotation is never source progress.
test('content handles do not create artificial evidence changes',async()=>{
 const {evidenceKey}=await import('../evidence-key.js');
 const packet=await contentPacket(source);
 assert.equal(evidenceKey({...packet,content_ref:'c_1111111111111111_1'}),evidenceKey({...packet,content_ref:'c_2222222222222222_2'}));
 assert.notEqual(evidenceKey({content_ref:'business-a'}),evidenceKey({content_ref:'business-b'}));
});

test('source-date candidates preserve exact labels/ranges without promoting career or read dates',async()=>{
 const text='Profile\n본인참여 2025.02.06.\nCareer\n2022.01.~ Team A\n입력 2026.07.30 (21:51)\n수정 2026.07.30 (22:08)\n'+ 'x'.repeat(6000)+'\nPublished 2024-01-02';
 const packet=await contentPacket({...source,text});
 assert.deepEqual(packet.dated_labels.candidates.map(x=>x.text),['본인참여 2025.02.06','입력 2026.07.30','수정 2026.07.30']);
 for(const entry of packet.dated_labels.candidates)assert.equal(text.slice(entry.start,entry.end),entry.text);
 assert(packet.dated_labels.candidates.every(x=>x.end<=packet.ranges[0].end));
 assert.equal((await contentPacket({...source,text:'Career 2022.01.~ Team A'})).dated_labels,undefined);
});
