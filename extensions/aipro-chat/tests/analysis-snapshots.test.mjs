import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';
const hash='a'.repeat(64);
const report={status:'partial',summary:'담당 팀 확인, 예외 조건은 미확인',findings:[{text:'담당 팀은 개발팀',evidence_ids:['ev_1']}],uncertainties:['예외 조건 확인 필요'],next_step:'추가 문서 읽기'};
async function setup(t){
 let calls=0;
 const h=createAnalysisCoordinator({signal:new AbortController().signal,modelId:'QWEN3.8-27B-FP8-256K',run:runAgent,tools:[],execute:async()=>assert.fail('No host action'),complete:async wire=>{
  calls++;
  if(!wire.some(m=>m.role==='tool'))return {calls:[{id:'read',function:{name:'read_analysis_evidence',arguments:'{"evidence_id":"ev_1"}'}}]};
  return{content:JSON.stringify(report)};
 }});
 t.after(()=>h.dispose());
 h.observe('read_page',{}, {text:'담당 팀은 개발팀입니다.',provenance:{kind:'wiki',path:'team.md',hash,start:1,end:2},image:{mimeType:'image/png',data:'AAAA'}});
 const launched=await h.execute('delegate_analysis',{tasks:[{role:'page',task:'담당 팀과 예외 확인',constraints:'페이지 수정 금지',done_when:'원문과 불확실성 반환',evidence_ids:['ev_1']}]});
 const first=(await h.collect()).results[0];
 return{h,first,id:launched.tasks[0].task_id,calls:()=>calls};
}

test('editing a delivered report cannot change a sibling snapshot or the retained partial result',async t=>{
 const {h,first,id,calls}=await setup(t);const expected=structuredClone(first.report);
 const sibling=(await h.collect({task_ids:[id]})).results[0];
 first.report.status='complete';first.report.summary='사용자가 보고서 표시를 재가공';first.report.findings[0].text='확인하지 않은 결론';first.report.findings[0].evidence_ids.push('ev_fake');first.report.uncertainties.length=0;
 assert.deepEqual(sibling.report,expected);
 const recalled=(await h.collect({task_ids:[id]})).results[0];assert.deepEqual(recalled.report,expected);assert.equal(calls(),2);
});

test('returned evidence provenance and read ranges cannot alter later collection or evidence reads',async t=>{
 const {h,first,id}=await setup(t);const expected=structuredClone(first.evidence);
 first.evidence[0].provenance.hash='b'.repeat(64);first.evidence[0].provenance.path='different.md';first.evidence[0].read_ranges[0].end=1;
 const recalled=(await h.collect({task_ids:[id]})).results[0];assert.deepEqual(recalled.evidence,expected);
 const read=await h.execute('read_analysis_evidence',{evidence_id:'ev_1'});assert.equal(read.provenance.hash,hash);assert.equal(read.provenance.path,'team.md');
});

test('editing a raw evidence image or provenance cannot change the frozen observation',async t=>{
 const {h}=await setup(t);const original=await h.execute('read_analysis_evidence',{evidence_id:'ev_1',mode:'image'});const expected=structuredClone(original);
 original.provenance.hash='c'.repeat(64);original.image.data='CHANGED';original.ranges[0].end=1;
 assert.deepEqual(await h.execute('read_analysis_evidence',{evidence_id:'ev_1',mode:'image'}),expected);
});

async function documentCase(t,{adaptReturn=false,adaptObserver=false}={}){
 const {documentBindings,documentToolDefinitions,executeDocumentTool}=await import('../document-tools.js');
 const text='확인된 문서 원문입니다. '.repeat(30),file={id:'doc',name:'requirements.md',kind:'text',hash,blob:new Blob([text])};
 const bindings=documentBindings([{attachments:[file]}]);let observedRange;
 const h=createAnalysisCoordinator({signal:new AbortController().signal,modelId:'QWEN3.8-27B-FP8-256K',tools:documentToolDefinitions(),documents:bindings,
  execute:(name,args)=>executeDocumentTool({bindings,owner:{}},name,args,{load:async()=>file}),
  onEvidence:(_name,args,value)=>{if(adaptObserver){value.end=1;value.text='Edited by observer';args.offset=999;}},
  run:options=>runAgent({...options,execute:async(name,args)=>{const packet=await options.execute(name,args);observedRange=structuredClone(packet.ranges);if(adaptReturn){packet.ranges[0].end=1;packet.provenance.hash='d'.repeat(64);}return packet;}}),
  complete:async wire=>{
   const result=wire.findLast(m=>m.role==='tool');
   if(!result)return{calls:[{id:'doc-read',function:{name:'read_document',arguments:JSON.stringify({document_id:'doc',offset:0,length:text.length})}}]};
   const value=JSON.parse(result.content);
   return{content:JSON.stringify({...report,status:'complete',findings:[{text:'원문 확인',evidence_ids:[value.evidence_id]}],uncertainties:[],next_step:''})};
  }});
 t.after(()=>h.dispose());
 await h.execute('delegate_analysis',{tasks:[{role:'research',task:'배정 문서 확인',done_when:'원문 전체 읽기',document_ids:['doc'],document_ranges:[{document_id:'doc',hash,start:0,end:text.length}],evidence_ids:[]}]});
 const result=(await h.collect()).results[0];
 return{result,text,observedRange};
}

test('the full-document return path cannot mutate retained read ranges',async t=>{
 const {result,observedRange}=await documentCase(t,{adaptReturn:true});
 assert.deepEqual(result.evidence[0].read_ranges,observedRange);assert.equal(result.evidence[0].provenance.hash,hash);assert.equal(result.report.status,'complete');
});

test('an evidence observer cannot rewrite document coverage or the dispatched arguments',async t=>{
 const {result,text}=await documentCase(t,{adaptObserver:true});
 assert.equal(result.report.status,'complete');assert.deepEqual(result.document_progress[0].read,[{start:0,end:text.length}]);assert.deepEqual(result.document_progress[0].remaining,[]);
 assert(!result.evidence[0].read_excerpt.includes('Edited by observer'));
});
