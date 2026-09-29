import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';

const source=await readFile(new URL('../browser-region.js',import.meta.url),'utf8');
const node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='readObservedPageRegion');
const body=source.slice(node.declaration.start,node.declaration.end);
const ref='r-00000000-0000-0000-0000-000000000000-1';
const safeURL=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.origin+u.pathname:null;}catch{return null;}};
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture({app=false,child=false,fault}={}){
  const operations=[];let scopeReads=0,cancelled=false;
  const documentId=child?'child-doc':'top-doc',raw=child?'https://child.test/frame':'https://example.test/page?private=SECRET';
  const details={text:'관찰 날짜 오늘\n현재 22 최저 17 최고 28',descriptors:[{ref:'must-not-return'}],elements:['must-not-return'],coverage:{nodeLimit:5000,queryFiltered:false},retrieval:{textBlocks:[],textRegions:[]},region_scope:{region_ref:ref,region_index:fault==='wrong_region_index'?2:1,read_only:true,partial:false}};
  const frame={frame:child?1:0,documentId,url:safeURL(raw),retrieval:{textRegions:[{index:1,region_ref:ref}]}};
  const observed={tabId:7,topDocumentId:'top-doc',url:'https://example.test/page',title:'Example',frames:[frame]};
  if(fault==='missing_top')delete observed.topDocumentId;
  if(fault==='missing_region')frame.retrieval.textRegions=[];
  if(fault==='ambiguous_region')observed.frames.push({...frame});
  if(fault==='wrong_tab')observed.tabId=8;
  const target={url:()=>raw,isDetached:()=>fault==='detached',evaluate:async(fn,arg)=>{operations.push({transport:'playwright',arg});assert.equal(fn.name,'collectSnapshot');if(fault==='cancel_after_read')cancelled=true;return fault==='node_stale'?{error:'region_stale'}:details;}};
  const task={tabId:7,latestObservation:observed,observedDocuments:new Map(app?[]:[[documentId,{}]]),app:app?{}:null,page:app?{frames:()=>child?[{},target]:[target]}:null};
  const context=vm.createContext({collectSnapshot:function collectSnapshot(){},observedDocumentScope:async()=>{
    scopeReads++;if(fault==='cancel_after_scope')cancelled=true;
    return [{frameId:0,documentId:fault==='top_changed'||fault==='after_changed'&&scopeReads>1?'replaced-top':'top-doc',result:{url:'https://example.test/page?private=SECRET'}},...(child?[{frameId:fault==='frame_moved'&&scopeReads>1?5:3,documentId:fault==='child_changed'?'new-child':documentId,result:{url:raw}}]:[])];},
    // The region is read through the bounded page script call; a loaded tab reaches chrome.scripting unchanged.
    pageScript:async operation=>{operations.push({transport:'isolated',target:operation.target,world:operation.world,args:operation.args});if(fault==='cancel_after_read')cancelled=true;return[{documentId:fault==='wrong_return_document'?'another-doc':documentId,result:fault==='node_stale'?{error:'region_stale'}:details}];},safeURL,task,isCancelled:()=>cancelled});
  vm.runInContext(body+'\nglobalThis.read=args=>readObservedPageRegion(task,args,safeURL,isCancelled);',context);
  return{read:context.read,operations,details,task};
}

test('host rereads only the observed top/frame document and returns no action refs or private URLs',async()=>{
  for(const app of [false,true])for(const child of [false,true]){
    const f=fixture({app,child}),before=structuredClone(f.task.latestObservation),result=await f.read({mode:'region',region_ref:ref});
    assert.equal(result.ok,true);assert.equal(result.dataKind,'page_region');assert.equal(result.frames[0].documentId,child?'child-doc':'top-doc');
    assert.equal(result.frames[0].text,f.details.text);assert.deepEqual(plain(result.frames[0].elements),[]);assert.equal(result.frames[0].descriptors,undefined);
    assert(!JSON.stringify(result).includes('SECRET'));assert(!JSON.stringify(result).includes('must-not-return'));
    assert.deepEqual(f.task.latestObservation,before);assert.equal(f.operations.length,1);
    if(!app)assert.deepEqual(plain(f.operations[0].target),{tabId:7,documentIds:[child?'child-doc':'top-doc']});
  }
});

test('wrong/missing/ambiguous observation and replaced document or frame are rejected',async()=>{
  for(const fault of ['missing_top','missing_region','ambiguous_region','wrong_tab','top_changed','after_changed','wrong_return_document','node_stale','wrong_region_index'])await assert.rejects(fixture({fault}).read({mode:'region',region_ref:ref}),/region_stale/,fault);
  for(const fault of ['child_changed','frame_moved'])await assert.rejects(fixture({child:true,fault}).read({mode:'region',region_ref:ref}),/region_stale/,fault);
  await assert.rejects(fixture({app:true,fault:'detached'}).read({mode:'region',region_ref:ref}),/region_stale/);
});

test('cancellation after any host await wins and malformed/action-bearing arguments are never dispatched',async()=>{
  for(const fault of ['cancel_after_scope','cancel_after_read'])await assert.rejects(fixture({fault}).read({mode:'region',region_ref:ref}),/cancelled/);
  for(const args of [{mode:'region'},{mode:'content',region_ref:ref},{mode:'region',region_ref:'c-action-ref'},{mode:'region',region_ref:ref,query:'other card'},{mode:'region',region_ref:ref,action:'click'}]){
    const f=fixture();await assert.rejects(f.read(args),/region_arguments_invalid/);assert.equal(f.operations.length,0);
  }
});
