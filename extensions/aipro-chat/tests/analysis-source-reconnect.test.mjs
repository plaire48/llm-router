import test from 'node:test';import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
const hash='a'.repeat(64),id='handoff_00000000-0000-4000-8000-000000000001';
const handoffs={version:1,records:[{version:1,id,status:'done',brief:{role:'research',task:'Compare source',constraints:'Read only',done_when:'Cite current source',effort:'standard'},documents:[],ranges:[],progress:[],sources:[{key:'source_1',kind:'project',tool:'read_source',read:true,binding:{projectId:'p1',url:'',resource:''},locator:{kind:'source',path:'src/a.js',hash,document_id:'',unit:'',start:1,end:3}},{key:'source_2',kind:'page',tool:'read_page',read:true,binding:{projectId:'',url:'https://example.test/a',resource:''}}]}]};
const tools=['read_page','read_source'].map(name=>({type:'function',function:{name}}));
test('explicit handoff reattachment reads current authorized sources and returns fresh evidence without writes or workers',async t=>{
 const calls=[];const h=createAnalysisCoordinator({signal:new AbortController().signal,handoffs,tools,execute:async(name,args)=>{calls.push({name,args});return name==='read_page'?{url:'https://example.test/a',text:'current',documentId:'new-document'}:{ok:true,projectId:'p1',text:'current source',provenance:{kind:'source',path:'src/a.js',hash,start:1,end:3}};},complete:()=>assert.fail()});t.after(()=>h.dispose());
 const r=await h.execute('read_analysis_handoff',{handoff_id:id,source_keys:['source_1','source_2']});assert.deepEqual(r.refreshed.map(x=>x.status),['hash_matched','fresh_observation']);assert.equal(h.status().length,0);assert.deepEqual(calls.map(c=>c.name),['read_source','read_page']);
 assert((await h.execute('read_analysis_evidence',{evidence_id:r.refreshed[0].evidence_id})).text.includes('current source'));
});
test('changed project identity never becomes source evidence and cancelled handoffs trigger no reads',async t=>{
 let calls=0;const h=createAnalysisCoordinator({signal:new AbortController().signal,handoffs,tools,execute:async()=>{calls++;return{ok:true,projectId:'other',provenance:{kind:'source',path:'src/a.js',hash,start:1,end:3}};}});t.after(()=>h.dispose());
 const r=await h.execute('read_analysis_handoff',{handoff_id:id,source_keys:['source_1']});assert.deepEqual(r.refreshed,[{key:'source_1',status:'source_changed'}]);assert.equal(calls,1);
 const cancelled=structuredClone(handoffs);cancelled.records[0].status='cancelled';const c=createAnalysisCoordinator({signal:new AbortController().signal,handoffs:cancelled,tools,execute:()=>assert.fail()});t.after(()=>c.dispose());
 assert.equal((await c.execute('read_analysis_handoff',{handoff_id:id,source_keys:['source_1']})).refreshBlocked,'cancelled');
});
