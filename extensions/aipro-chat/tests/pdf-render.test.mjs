import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ATTACHMENT_LIMITS} from '../attachment-limits.js';

const source=(await readFile(new URL('../src/pdf-text.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
function core({pageCount=2,width=600,height=800,blobSize=10,renderError=false,allocation,documentError}={}) {
 const effects=[],ports=[],canvases=[];let options;
 const page={getViewport:({scale})=>({width:width*scale,height:height*scale}),render:()=>({promise:(async()=>{effects.push('render');if(allocation)allocation(options.CanvasFactory);if(renderError)throw Error('render_failed');})()}),getTextContent:()=>{throw Error('visual render must not duplicate or reject authoritative dense text');},cleanup:()=>effects.push('page-cleanup')};
 const document={numPages:pageCount,getPage:async n=>{effects.push(['getPage',n]);return page;}};
 const context=vm.createContext({ATTACHMENT_LIMITS,ArrayBuffer,Uint8Array,btoa,TextEncoder,OffscreenCanvas:class{
  constructor(w,h){this.width=w;this.height=h;canvases.push(this);}getContext(){return{};}
  async convertToBlob(){return{type:'image/png',size:blobSize,arrayBuffer:async()=>new Uint8Array([137,80,78,71,13,10,26,10]).buffer};}},
  Worker:class{constructor(url){this.url=url;ports.push(this);}terminate(){effects.push('worker-terminated');}},GlobalWorkerOptions:{},getDocument:opts=>{options=opts;return{promise:documentError?Promise.reject(documentError):Promise.resolve(document),destroy:async()=>effects.push('document-destroyed')};}});
 vm.runInContext(source,context);return{render:(n=1)=>context.renderPdfPage(new ArrayBuffer(1),'asset/','worker',{page:n}),effects,ports,canvases,options:()=>options};
}
test('one requested page is rendered without re-extracting text and PDF workers/canvas are released',async()=>{
 const f=core(),r=await f.render(2);assert.equal(r.page,2);assert.equal(r.pageCount,2);assert.equal(r.width,900);assert.equal(r.height,1200);assert.equal(r.text,undefined);assert.equal(r.image.mimeType,'image/png');
 assert.deepEqual(f.effects,[['getPage',2],'render','page-cleanup','document-destroyed','worker-terminated']);assert(f.canvases.every(c=>!c.width&&!c.height));assert.equal(f.options().isEvalSupported,false);assert.equal(f.options().enableXfa,false);assert.equal(f.options().useWasm,false);
});
test('page bounds, byte budget and invalid geometry reject without retained workers',async()=>{
 for(const n of [0,-1,1.5,2001]){const f=core();await assert.rejects(f.render(n),/pdf_render_page/);assert.equal(f.ports.length,0);}
 for(const config of [{pageCount:2001},{pageCount:1},{width:Infinity},{width:0}]){const f=core(config);await assert.rejects(f.render(2),/attachment_document_size|pdf_render_page|pdf_render_size/);assert.equal(f.effects.at(-1),'worker-terminated');}
});
test('edge, output PNG and all auxiliary canvas allocations remain bounded',async()=>{
 const f=core({width:4000,height:4000}),r=await f.render();assert.equal(r.width,2000);assert.equal(r.height,2000);
 const over=core({blobSize:4194305});await assert.rejects(over.render(),/pdf_render_size/);assert.equal(over.effects.at(-1),'worker-terminated');
 const scratch=core({allocation:Factory=>{const factory=new Factory();for(let i=0;i<4;i++)factory.create(2000,2000);}});await assert.rejects(scratch.render(),/pdf_render_size/);assert.equal(scratch.effects.at(-1),'worker-terminated');
});
test('render/password failures dispose parser worker and document',async()=>{
 for(const config of [{renderError:true},{documentError:Object.assign(Error('private'),{name:'PasswordException'})}]){const f=core(config);await assert.rejects(f.render(),/render_failed|attachment_document_password/);assert.equal(f.effects.at(-2),'document-destroyed');assert.equal(f.effects.at(-1),'worker-terminated');}
});

async function queueFixture(callback){
 const previous=globalThis.chrome,calls=[];let reply;
 globalThis.chrome={runtime:{getURL:name=>'extension/'+name,getContexts:async()=>[],sendMessage:message=>{calls.push(message.kind||'image');return new Promise(r=>{reply=r;});}},offscreen:{createDocument:async()=>calls.push('open'),closeDocument:async()=>calls.push('close')}};
 const api=await import('../background-images.js?pdfRender='+Math.random());
 const ready=async()=>{for(let i=0;i<50&&!reply;i++)await new Promise(r=>setTimeout(r,0));assert(reply);};
 try{await callback({api,calls,ready,resolve:result=>{const r=reply;reply=null;r({ok:true,result});}});}finally{if(previous===undefined)delete globalThis.chrome;else globalThis.chrome=previous;}
}
test('PDF page render shares serial image/extraction queue and cancels a queued job before dispatch',()=>queueFixture(async({api,calls,ready,resolve})=>{
 const render=api.renderCurrentPdfPage('AA==',{page:1},new AbortController().signal),c=new AbortController();
 const skipped=api.extractCurrentPdf('AA==',c.signal).then(()=>assert.fail('cancelled extraction resumed'),e=>assert.equal(e.message,'cancelled'));c.abort();
 const image=api.compareImages({},new AbortController().signal);await ready();assert.deepEqual(calls,['open','pdf-render']);resolve({page:1});await render;await skipped;await ready();assert.deepEqual(calls,['open','pdf-render','close','open','image']);resolve({image:{mimeType:'image/png'}});await image;assert.equal(calls.at(-1),'close');
}));
test('in-flight cancellation closes offscreen parser and cannot return a late image or start a replay',()=>queueFixture(async({api,calls,ready,resolve})=>{
 const c=new AbortController(),pending=api.renderCurrentPdfPage('AA==',{page:1},c.signal);await ready();c.abort();await assert.rejects(pending,/cancelled/);assert.deepEqual(calls,['open','pdf-render','close']);resolve({image:{mimeType:'image/png',data:'LATE'}});await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls,['open','pdf-render','close']);
}));

const parserSource=(await readFile(new URL('../browser-pdf-parser.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
function parserFixture(){
 const workers=[],timers=[];const context=vm.createContext({ATTACHMENT_LIMITS,Uint8Array,atob,crypto,chrome:{runtime:{getURL:n=>n}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},Worker:class{
  constructor(url,options){this.url=url;this.options=options;workers.push(this);}postMessage(payload,transfer){this.payload=payload;this.transfer=transfer;}terminate(){this.terminated=(this.terminated||0)+1;}
 }});vm.runInContext(parserSource+'\nglobalThis.renderBrowserPdfPage=renderBrowserPdfPage;',context);return{context,workers,timers};
}
test('render worker protocol binds nonce/transferred snapshot and terminates on deadline without accepting late PNG',async()=>{
 const f=parserFixture(),pending=f.context.renderBrowserPdfPage(btoa('%PDF-bound-snapshot'),{page:2}),w=f.workers[0];assert.equal(w.options.type,'module');assert.equal(w.payload.type,'nubi:pdf-render');assert.equal(w.payload.page,2);assert.equal(w.transfer[0],w.payload.buffer);assert.equal(f.timers[0].ms,30000);
 w.onmessage({data:{jobId:'other',result:{image:{data:'wrong'}}}});assert.equal(w.terminated,undefined);
 f.timers[0].fn();await assert.rejects(pending,/pdf_render_timeout/);assert.equal(w.terminated,1);
 w.onmessage({data:{jobId:w.payload.jobId,result:{image:{data:'late'}}}});assert.equal(w.terminated,1);
});
test('invalid encoding/page is rejected before worker creation and matching worker result is returned once',async()=>{
 const f=parserFixture();await assert.rejects(f.context.renderBrowserPdfPage('A',{page:1}),/attachment_document/);await assert.rejects(f.context.renderBrowserPdfPage('AA==',{page:0}),/pdf_render_page/);assert.equal(f.workers.length,0);
 const pending=f.context.renderBrowserPdfPage('AA==',{page:1}),w=f.workers[0];const expected={page:1,image:{mimeType:'image/png',data:'png'}};w.onmessage({data:{jobId:w.payload.jobId,result:expected}});assert.equal(await pending,expected);assert.equal(w.terminated,1);
});
