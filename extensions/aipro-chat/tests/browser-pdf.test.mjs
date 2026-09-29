import test from 'node:test';
import assert from 'node:assert/strict';
import {readCurrentPdf} from '../browser-pdf.js';
import {contentPacket} from '../browser-content.js';
import {refreshBrowserPolicy} from '../browser-policy.js';
import {evidenceKey} from '../evidence-key.js';

globalThis.chrome={storage:{managed:{get:async()=>({})}}};await refreshBrowserPolicy();
const selected={documentId:'doc-one',frameId:0,result:{url:'https://public.example.test/rules.pdf',contentType:'application/pdf'}};
const parsed={text:'[1쪽]\nFirst original\n\n[2쪽]\nSecond original',pageCount:2,pages:[{page:1,start:0,end:19,textAvailable:true},{page:2,start:21,end:41,textAvailable:true}]};
parsed.pages[0].end=parsed.text.indexOf('\n\n');parsed.pages[1].start=parsed.pages[0].end+2;parsed.pages[1].end=parsed.text.length;
const bytes=new TextEncoder().encode('%PDF-1.4\nSYNTHETIC');
const base=(extra={})=>({fetchImpl:async(_url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response(bytes,{headers:{'content-type':'application/pdf'}});},
  parse:async()=>structuredClone(parsed),inspect:async()=>structuredClone(selected),permitted:async()=>true,...extra});
test('current PDF uses exact observed resource identity and page text; cached continuation has no extra fetch',async()=>{
  const task={tabId:10};let calls=0;
  const options=base({fetchImpl:async(...args)=>{calls++;return base().fetchImpl(...args);}});
  const source=await readCurrentPdf(task,selected,()=>false,options);
  assert.equal(source.method,'pdfjs_text');assert.equal(source.pageRanges[1].page,2);assert.match(source.pdf.raw_sha256,/^[a-f0-9]{64}$/);
  assert(source.sourceIdentity.includes(selected.documentId));assert(source.sourceIdentity.includes(selected.result.url));
  const packet=await contentPacket({...source,url:selected.result.url,frame:0});
  assert.equal(packet.pdf.page_count,2);assert.equal(packet.coverage.partial,true);assert.equal(packet.ranges[0].page_ranges.length,2);
  assert(!JSON.stringify(packet).includes('sourceIdentity'));assert.equal((await readCurrentPdf(task,selected,()=>false,options)).text,source.text);assert.equal(calls,1);
});
test('iframe PDF, missing document identity and private/auth resource addresses never fetch',async()=>{
  for(const value of [{...selected,frameId:4},{...selected,documentId:null},{...selected,result:{...selected.result,url:'https://public.example.test/rules.pdf?access_token=SECRET'}}]) {
    const result=await readCurrentPdf({},value,()=>false,base({fetchImpl:()=>assert.fail('No request')}));assert.equal(result.error,'page_content_pdf_unavailable');assert.equal(result.retryable,false);
  }
});
test('refetching unchanged PDF bytes after cache expiry does not manufacture external progress',async()=>{
  const task={};let fetches=0;
  const options=base({fetchImpl:async(...args)=>{fetches++;return base().fetchImpl(...args);}});
  const first=await readCurrentPdf(task,selected,()=>false,options);
  task.pdfContentCache.createdAt=Date.now()-120001;
  const again=await readCurrentPdf(task,selected,()=>false,options);
  assert.equal(fetches,2,'Actual second fetch, not a cache-return equality');
  assert(!Object.hasOwn(again.pdf,'fetched_at'));
  const packet=source=>contentPacket({...source,url:selected.result.url,frame:0});
  assert.equal(evidenceKey(await packet(first),{progress:true}),evidenceKey(await packet(again),{progress:true}));
});
test('permission and policy checks apply before fetch and before cached PDF reuse',async()=>{
  const task={};await readCurrentPdf(task,selected,()=>false,base());
  assert.equal((await readCurrentPdf(task,selected,()=>false,base({permitted:async()=>false}))).reason,'pdf_permission_missing');
  assert.equal((await readCurrentPdf({}, {...selected,result:{...selected.result,url:'https://auth.openai.com/rules.pdf'}},()=>false,base({fetchImpl:()=>assert.fail('Restricted')}))).reason,'pdf_source_restricted');
});
test('changed documents before fetch, after fetch and after parsing never enter the cache',async()=>{
  for(const changedAt of [1,2,3]) {
    let calls=0,parseCalls=0;const task={};
    const result=await readCurrentPdf(task,selected,()=>false,base({inspect:async()=>({...structuredClone(selected),documentId:++calls>=changedAt?'replacement':'doc-one'}),parse:async()=>{parseCalls++;return parsed;}}));
    assert.equal(result.error,'browser_stale');assert(!task.pdfContentCache);assert.equal(parseCalls,changedAt===3?1:0);
  }
});
test('redirected, HTML, denied, corrupt and oversized resource responses remain nonretryable gaps',async()=>{
  const cases=[['pdf_redirect_blocked',{redirected:true,ok:true}],['pdf_auth_required',new Response('',{status:403})],
    ['pdf_mime_invalid',new Response('Login',{headers:{'content-type':'text/html'}})],
    ['pdf_magic_invalid',new Response('NOTPDF',{headers:{'content-type':'application/pdf'}})],
    ['pdf_size_limit',new Response(bytes,{headers:{'content-type':'application/pdf','content-length':'9000000'}})]];
  for(const [reason,response] of cases) {const result=await readCurrentPdf({},selected,()=>false,base({fetchImpl:async()=>response}));assert.equal(result.reason,reason);assert.equal(result.retryable,false);}
});
test('stream length is enforced independently of declared length and stalled stream cancellation cannot hold completion',async()=>{
  let cancels=0;
  const response={ok:true,redirected:false,headers:new Headers({'content-type':'application/pdf'}),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(9*1024*1024)}),cancel:()=>{cancels++;return new Promise(()=>{});}})}};
  assert.equal((await readCurrentPdf({},selected,()=>false,base({fetchImpl:async()=>response}))).reason,'pdf_size_limit');assert.equal(cancels,1);
  const stalled={...response,body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})})}};
  assert.equal((await readCurrentPdf({},selected,()=>false,base({fetchImpl:async()=>stalled,fetchTimeoutMs:5}))).reason,'pdf_fetch_timeout');
});
test('empty scan/password/malformed parser metadata never become invented extracted evidence',async()=>{
  for(const [error,reason] of [['attachment_document_empty','pdf_text_unavailable'],['attachment_document_password','pdf_password_required'],['attachment_document','pdf_parse_failed']]) {
    const result=await readCurrentPdf({},selected,()=>false,base({parse:async()=>{throw Error(error);}}));assert.equal(result.reason,reason);
  }
  assert.equal((await readCurrentPdf({},selected,()=>false,base({parse:async()=>({...parsed,pages:[{...parsed.pages[0],end:9999}]})}))).reason,'pdf_parse_failed');
});
test('cancellation before fetch and while a parser ignores its signal propagates and cannot cache late output',async()=>{
  await assert.rejects(readCurrentPdf({},selected,()=>true,base({fetchImpl:()=>assert.fail('Cancelled')})),/cancelled/);
  let cancelled=false,release;const task={};
  const running=readCurrentPdf(task,selected,()=>cancelled,base({parse:()=>new Promise(resolve=>{release=resolve;cancelled=true;})}));
  await assert.rejects(running,/cancelled/);release(parsed);assert(!task.pdfContentCache);
});

test('transient public PDF HTTP errors retry within one fetch budget and recover without repeated parsing',async()=>{
  for(const status of [408,429,500,502,503,504]) {
    let calls=0,parses=0;
    const result=await readCurrentPdf({},selected,()=>false,base({fetchImpl:async(...args)=>++calls===1?new Response('',{status}):base().fetchImpl(...args),parse:async()=>{parses++;return parsed;}}));
    assert.equal(result.method,'pdfjs_text');assert.equal(calls,2);assert.equal(parses,1);
  }
});
test('exhausted transient HTTP errors preserve bounded attempts and status without response body details',async()=>{
  let calls=0;
  const result=await readCurrentPdf({},selected,()=>false,base({fetchImpl:async()=>{calls++;return new Response('private diagnostic body',{status:503});}}));
  assert.equal(calls,3);assert.equal(result.reason,'pdf_http_error');assert.equal(result.http_status,503);assert.equal(result.request_attempts,3);assert.equal(result.retryable,false);
  assert(!JSON.stringify(result).includes('private diagnostic body'));assert.match(result.instruction,/not a new requirement/);
});
test('permanent, auth, MIME and parse errors never retry and HTTP status remains available',async()=>{
  for(const status of [400,401,403,404,410,501]) {
    let calls=0;
    const result=await readCurrentPdf({},selected,()=>false,base({fetchImpl:async()=>{calls++;return new Response('',{status});}}));
    assert.equal(calls,1);assert.equal(result.http_status,status);assert.equal(result.request_attempts,1);
  }
  for(const options of [
    {fetchImpl:async()=>new Response('HTML',{headers:{'content-type':'text/html'}})},
    {parse:async()=>{throw Error('attachment_document');}},
    {fetchImpl:async()=>{throw new TypeError('Failed to fetch');}},
  ]) {
    let calls=0;const fetchImpl=options.fetchImpl||base().fetchImpl;
    const result=await readCurrentPdf({},selected,()=>false,base({...options,fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}}));
    assert.equal(calls,1);assert.equal(result.error,'page_content_pdf_unavailable');
  }
});
test('Retry-After exceeding shared fetch deadline stops without an early retry',async()=>{
  let calls=0;
  const result=await readCurrentPdf({},selected,()=>false,base({fetchTimeoutMs:1000,fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'60'}});}}));
  assert.equal(calls,1);assert.equal(result.http_status,429);assert.equal(result.reason,'pdf_http_error');
});
test('cancellation, document replacement and permission revocation stop HTTP recovery before another GET',async()=>{
  for(const change of ['cancel','document','permission']) {
    let failed=false,calls=0;const task={};
    const operation=readCurrentPdf(task,selected,()=>change==='cancel'&&failed,base({
      fetchImpl:async()=>{calls++;failed=true;return new Response('',{status:503});},
      inspect:async()=>({...selected,documentId:change==='document'&&failed?'replacement':selected.documentId}),
      permitted:async()=>!(change==='permission'&&failed),
    }));
    if(change==='cancel')await assert.rejects(operation,/cancelled/);
    else {const result=await operation;assert.equal(change==='document'?result.error:result.reason,change==='document'?'browser_stale':'pdf_permission_missing');}
    assert.equal(calls,1);assert(!task.pdfContentCache);
  }
});
test('permission revoked while parsing cannot expose or cache PDF content',async()=>{
  let permitted=true;const task={};
  const result=await readCurrentPdf(task,selected,()=>false,base({permitted:async()=>permitted,parse:async()=>{permitted=false;return parsed;}}));
  assert.equal(result.reason,'pdf_permission_missing');assert(!task.pdfContentCache);
});
test('Retry-After is honored inside budget and a later stalled GET cannot reset the shared deadline',async()=>{
  let calls=0;const started=performance.now();
  const recovered=await readCurrentPdf({},selected,()=>false,base({fetchTimeoutMs:2500,fetchImpl:async(...args)=>{
    calls++;if(calls===1)return new Response('',{status:429,headers:{'retry-after':'1'}});
    assert(performance.now()-started>=950,'Do not issue an early retry');return base().fetchImpl(...args);
  }}));
  assert.equal(recovered.method,'pdfjs_text');assert.equal(calls,2);
  calls=0;const deadlineStarted=performance.now();
  const exhausted=await readCurrentPdf({},selected,()=>false,base({fetchTimeoutMs:600,fetchImpl:async()=>{
    if(++calls===1)return new Response('',{status:503});return new Promise(()=>{});
  }}));
  assert.equal(exhausted.reason,'pdf_fetch_timeout');assert.equal(calls,2);assert(performance.now()-deadlineStarted<1000);
});
test('redirected transient responses never enter HTTP retry even with a matching status',async()=>{
  let calls=0;
  const result=await readCurrentPdf({},selected,()=>false,base({fetchImpl:async()=>{calls++;return {redirected:true,ok:false,status:503};}}));
  assert.equal(result.reason,'pdf_redirect_blocked');assert.equal(calls,1);
});
