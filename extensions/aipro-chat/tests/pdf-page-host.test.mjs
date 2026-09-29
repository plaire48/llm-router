import test from 'node:test';
import assert from 'node:assert/strict';
import {readCurrentPdf,readCurrentPdfPage} from '../browser-pdf.js';
import {readPdfPageReference} from '../browser-content.js';
import {browserTools,BUILTIN_SKILLS} from '../skills.js';
import {refreshBrowserPolicy} from '../browser-policy.js';
globalThis.chrome={storage:{managed:{get:async()=>({})}}};await refreshBrowserPolicy();
const selected={documentId:'one',frameId:0,result:{url:'https://docs.example.test/rules.pdf',contentType:'application/pdf'}};
const bytes=new TextEncoder().encode('%PDF-1.4\nreference fixture');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB6kAAAAASUVORK5CYII=';
const result={page:1,pageCount:1,width:1,height:1,image:{mimeType:'image/png',data:png}};
const options=(extra={})=>({fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'application/pdf'}}),
 parse:async()=>({text:'[1쪽]\nRefer to the shaded exception.',pageCount:1,pages:[{page:1,start:0,end:34,textAvailable:true}]}),
 inspect:async()=>selected,permitted:async()=>true,render:async input=>{assert.deepEqual(Buffer.from(input,'base64'),Buffer.from(bytes));return result;},...extra});
// Build offsets from the actual text, avoiding a manually guessed contract.
const base=extra=>{const o=options(extra);if(!extra?.parse)o.parse=async()=>{const text='[1쪽]\nRefer to the shaded exception.';return{text,pageCount:1,pages:[{page:1,start:0,end:text.length,textAvailable:true}]};};return o;};
async function setup(extra){const task={},o=base(extra),source=await readCurrentPdf(task,selected,()=>false,o);assert(!source.error);return{task,o,args:{page:1,raw_sha256:source.pdf.raw_sha256}};}
test('PDF illustration uses same bytes and page hash without screenshot or actionable refs',async()=>{
 const {task,o,args}=await setup();const r=await readCurrentPdfPage(task,selected,args,()=>false,o);
 assert.equal(r.ok,true);assert.equal(r.dataKind,'pdf_page_reference');assert.equal(r.source.raw_sha256,args.raw_sha256);
 assert.equal(r.referenceImage.source.documentId,'one');assert.equal(r.referenceImage.dataUrl,'data:image/png;base64,'+png);
 assert(!('image' in r));assert(!('screenshot_id' in r));assert(!('visualTargets' in r));assert(!('refs' in r));assert(r.coverage.partial);
});
test('changed source, document and revoked permission cannot release page image',async()=>{
 for(const change of ['hash','document','permission','expired']) {
  const {task,o,args}=await setup();let mutated=false;
  o.render=async()=>{mutated=true;if(change==='expired')task.pdfContentCache.createdAt=0;return result;};
  if(change==='expired')o.fetchImpl=async()=>new Response(mutated?new TextEncoder().encode('%PDF-1.4 changed'):bytes,{headers:{'content-type':'application/pdf'}});
  if(change==='hash')args.raw_sha256='0'.repeat(64);
  if(change==='document')o.inspect=async()=>mutated?{...selected,documentId:'new'}:selected;
  if(change==='permission')o.permitted=async()=>!mutated;
  const r=await readCurrentPdfPage(task,selected,args,()=>false,o);assert(r.error,change);assert(!r.referenceImage,change);
 }
});
test('invalid page or renderer identity, oversized output and timeout do not become visual evidence',async()=>{
 const {task,o,args}=await setup();assert.equal((await readCurrentPdfPage(task,selected,{...args,page:2},()=>false,o)).error,'tool_arguments_invalid');
 for(const malformed of [{...result,page:2},{...result,width:4000001},{...result,image:{mimeType:'image/png',data:'bad'}},{...result,pageCount:2}]) {
  const r=await readCurrentPdfPage(task,selected,args,()=>false,{...o,render:async()=>malformed});assert.equal(r.reason,'pdf_render_invalid');assert(!r.referenceImage);
 }
 const r=await readCurrentPdfPage(task,selected,args,()=>false,{...o,renderTimeoutMs:5,render:()=>new Promise(()=>{})});assert.equal(r.reason,'pdf_render_timeout');
});
test('cancelled rendering cannot release a late image',async()=>{
 const {task,o,args}=await setup();let cancelled=false;
 await assert.rejects(readCurrentPdfPage(task,selected,args,()=>cancelled,{...o,render:async()=>{cancelled=true;return result;}}),/cancelled/);
});
test('vision unavailable neither reads nor renders and schema advertises only supported path',async()=>{
 assert.equal((await readPdfPageReference({}, {},()=>true,()=>false,false)).error,'vision_unavailable');
 const skill=BUILTIN_SKILLS.find(s=>s.id==='browser-agent');
 const reader=vision=>browserTools({},skill,'gpt-5.6-luna',{vision,visionModel:vision?{name:'authenticated-vision',input:['image','text']}:null}).find(t=>t.function.name==='read_page').function;
 assert(reader(true).parameters.properties.mode.enum.includes('pdf_page'));assert(!reader(false).parameters.properties.mode.enum.includes('pdf_page'));
});

test('unchanged hash after a cache refresh does not falsely invalidate a rendered source page',async()=>{
 const {task,o,args}=await setup();o.render=async()=>{task.pdfContentCache.createdAt=0;return result;};
 assert.equal((await readCurrentPdfPage(task,selected,args,()=>false,o)).ok,true);
});
