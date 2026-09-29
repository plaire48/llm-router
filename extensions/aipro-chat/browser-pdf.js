import {browserURL} from './browser-url.js';
import {ATTACHMENT_LIMITS} from './attachment-limits.js';
import {extractCurrentPdf, renderCurrentPdfPage} from './background-images.js';
import {publicSourceURL} from './browser-public-url.js';
import pRetry from 'p-retry';

const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const unavailable=(reason,details={})=>({error:'page_content_pdf_unavailable',format:'pdf',retryable:false,reason,...details,
  instruction:'This current PDF could not be read as text. Do not repeat the unchanged PDF read or screenshots, invent its contents or claim full coverage. Keep the original user requirements. A different source is an optional recovery route, not a new requirement or mandatory plan step. If this exact PDF is required, report the limitation or request the original file; otherwise answer only what existing verified evidence supports.'});
const transientStatuses=new Set([408,429,500,502,503,504]);
function retryAfterMs(value) {
  if(!value)return 0;
  if(/^\d+(?:\.\d+)?$/.test(value.trim()))return Number(value)*1000;
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-Date.now()):0;
}
function waitForRetry(ms,signal) {
  return new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);resolve();};
    const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(Error(String(signal.reason||'cancelled')));};
    const timer=setTimeout(done,ms);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  });
}
const visualUnavailable=reason=>({...unavailable(reason),instruction:'This PDF page image was not supplied. Previously read text remains reference evidence, but diagrams and visual exceptions remain unverified. Do not repeat an unchanged failing render. Use another observed text source for needed facts or qualify the answer; never claim full visual coverage.'});
const parserReasons={attachment_document_empty:'pdf_text_unavailable',attachment_document_password:'pdf_password_required',
  attachment_document_size:'pdf_size_limit',attachment_document_timeout:'pdf_parse_timeout',attachment_document:'pdf_parse_failed'};
function abortable(operation,signal) {
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(Error(String(signal.reason||'cancelled')));
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted)cancel();
    Promise.resolve(operation).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
  });
}
function validPages(parsed) {
  return parsed&&typeof parsed.text==='string'&&parsed.text.length<=ATTACHMENT_LIMITS.textChars&&
    Number.isSafeInteger(parsed.pageCount)&&parsed.pageCount>0&&parsed.pageCount<=ATTACHMENT_LIMITS.documentPages&&
    Array.isArray(parsed.pages)&&parsed.pages.length===parsed.pageCount&&parsed.pages.every((p,i)=>p.page===i+1&&
      Number.isSafeInteger(p.start)&&Number.isSafeInteger(p.end)&&p.start===(i?parsed.pages[i-1].end+2:0)&&
      p.end>p.start&&p.end<=parsed.text.length&&typeof p.textAvailable==='boolean')&&parsed.pages.at(-1).end===parsed.text.length;
}

// No model-supplied URL: selected is an actual scripting result from this task's current top document.
export async function readCurrentPdf(task,selected,cancelled,{fetchImpl=fetch,parse=extractCurrentPdf,fetchTimeoutMs=15000,
  inspect=async()=>{
    const [record]=await chrome.scripting.executeScript({target:{tabId:task.tabId,documentIds:[selected.documentId]},world:'ISOLATED',
      func:()=>({url:location.href,contentType:document.contentType})});return record;
  },permitted=url=>chrome.permissions.contains({origins:[new URL(url).origin+'/*']})}={}) {
  if(!selected?.documentId||selected.frameId!==0||selected.result?.contentType!=='application/pdf')return unavailable('pdf_document_identity_unavailable');
  let url;
  try {url=browserURL(selected.result.url);url.hash='';}catch{return unavailable('pdf_source_restricted');}
  if([...url.searchParams.keys()].some(key=>/token|auth|password|secret|credential|signature|api[_-]?key/i.test(key)))return unavailable('pdf_private_url');
  const same=async()=>{
    if(cancelled())throw Error('cancelled');
    try {
      const record=await inspect(),current=browserURL(record?.result?.url);current.hash='';
      return record.documentId===selected.documentId&&record.frameId===0&&record.result.contentType==='application/pdf'&&current.href===url.href;
    }catch(error){if(error.message==='cancelled')throw error;return false;}
  };
  if(!await same())return {error:'browser_stale'};
  if(!await permitted(url.href))return unavailable('pdf_permission_missing');
  if(cancelled())throw Error('cancelled');
  const cache=task.pdfContentCache;
  if(cache?.documentId===selected.documentId&&cache.url===url.href&&Date.now()-cache.createdAt<120000)return cache.source;
  task.pdfContentCache=null;
  const controller=new AbortController();let reader;
  const timer=setTimeout(()=>controller.abort('pdf_read_timeout'),135000);
  const cancelTimer=setInterval(()=>{if(cancelled())controller.abort('cancelled');},50);
  let fetchTimer,requestAttempts=0,httpStatus;
  try {
    const fetchBudget=Math.min(15000,Math.max(1,fetchTimeoutMs)),fetchStarted=performance.now();
    fetchTimer=setTimeout(()=>controller.abort('pdf_fetch_timeout'),fetchBudget);
    // Retry only observed transient HTTP responses for this public read-only GET. Fetch TypeErrors
    // cannot reliably distinguish network failures from blocked redirects/CORS, so do not retry them.
    const response=await pRetry(async attempt=>{
      controller.signal.throwIfAborted();
      if(cancelled())throw Error('cancelled');
      if(attempt>1) {
        if(!await abortable(same(),controller.signal))throw Error('browser_stale');
        if(!await abortable(permitted(url.href),controller.signal))throw Error('pdf_permission_missing');
      }
      controller.signal.throwIfAborted();
      if(cancelled())throw Error('cancelled');
      requestAttempts++;
      httpStatus=undefined;
      const received=await abortable(fetchImpl(url.href,{credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal);
      httpStatus=Number.isInteger(received.status)?received.status:undefined;
      if(received.redirected||received.url&&new URL(received.url).href!==url.href)return received;
      if(!received.ok&&transientStatuses.has(received.status)) {
        void received.body?.cancel().catch(()=>{});
        throw Object.assign(Error('pdf_http_error'),{httpStatus:received.status,retryAfter:retryAfterMs(received.headers.get('retry-after'))});
      }
      return received;
    },{retries:2,minTimeout:250,maxTimeout:1000,factor:2,randomize:true,maxRetryTime:fetchBudget,signal:controller.signal,
      shouldRetry:async({error,retryDelay})=>{
        if(!transientStatuses.has(error.httpStatus))return false;
        const delay=Math.max(retryDelay,error.retryAfter);
        if(delay>=fetchBudget-(performance.now()-fetchStarted))return false;
        if(delay>retryDelay)await waitForRetry(delay-retryDelay,controller.signal);
        return true;
      }});
    if(response.redirected||response.url&&new URL(response.url).href!==url.href)return unavailable('pdf_redirect_blocked');
    if(!response.ok)return unavailable([401,403].includes(response.status)?'pdf_auth_required':'pdf_http_error',{http_status:response.status,request_attempts:requestAttempts});
    if(!/^(?:application\/pdf|application\/octet-stream)(?:\s*;|$)/i.test(response.headers.get('content-type')||''))return unavailable('pdf_mime_invalid');
    const sizeHint=Number(response.headers.get('content-length'));
    if(sizeHint>ATTACHMENT_LIMITS.documentBytes)return unavailable('pdf_size_limit');
    if(!response.body?.getReader)return unavailable('pdf_body_unavailable');
    reader=response.body.getReader();const chunks=[];let size=0;
    while(true) {
      if(cancelled())throw Error('cancelled');
      const {done,value}=await abortable(reader.read(),controller.signal);if(done)break;size+=value.length;
      if(size>ATTACHMENT_LIMITS.documentBytes)return unavailable('pdf_size_limit');chunks.push(value);
    }
    clearTimeout(fetchTimer);fetchTimer=null;
    if(!await abortable(same(),controller.signal))return {error:'browser_stale'};
    if(!await abortable(permitted(url.href),controller.signal))return unavailable('pdf_permission_missing');
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')return unavailable('pdf_magic_invalid');
    let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));
    const rawHash=await digest(bytes),parsed=await abortable(parse(btoa(binary),controller.signal),controller.signal);
    if(cancelled()||controller.signal.reason==='cancelled')throw Error('cancelled');
    if(controller.signal.aborted)return unavailable('pdf_parse_timeout');
    if(!await abortable(same(),controller.signal))return {error:'browser_stale'};
    if(!await abortable(permitted(url.href),controller.signal))return unavailable('pdf_permission_missing');
    if(!validPages(parsed)||new TextEncoder().encode(parsed.text).length>ATTACHMENT_LIMITS.extractedBytes)return unavailable('pdf_parse_failed');
    if(parsed.text.length>2000000)return unavailable('pdf_size_limit');
    let title=url.pathname.split('/').at(-1)||'PDF';try{title=decodeURIComponent(title);}catch{}
    const source={text:parsed.text,title:title.slice(0,180),
      documentId:selected.documentId,sourceIdentity:[selected.documentId,url.href,rawHash],pageRanges:parsed.pages,
      pdf:{raw_sha256:rawHash,bytes:size,page_count:parsed.pageCount,pages_without_text:parsed.pages.filter(p=>!p.textAvailable).length,
        parser:'pdfjs-dist'},method:'pdfjs_text',coverage:{partial:true,extractionComplete:true,
        textOnly:true,scope:'Fresh resource snapshot fetched from the current observed PDF URL. Page ranges are extracted text only; images, layout, tables, OCR and form fields are not verified. Reading a range does not establish whole-PDF coverage or browser actions.'}};
    task.pdfContentCache={documentId:selected.documentId,url:url.href,createdAt:Date.now(),source,bytes:btoa(binary)};return source;
  }catch(error) {
    if(cancelled()||error.message==='cancelled'||controller.signal.reason==='cancelled')throw Error('cancelled');
    if(error.message==='browser_stale')return {error:'browser_stale'};
    const reason=['pdf_http_error','pdf_permission_missing'].includes(error.message)?error.message:parserReasons[error.message]||
      (controller.signal.reason==='pdf_fetch_timeout'?'pdf_fetch_timeout':controller.signal.aborted?'pdf_parse_timeout':'pdf_fetch_failed');
    return unavailable(reason,{request_attempts:requestAttempts,...(httpStatus!==undefined?{http_status:httpStatus}:{})});
  }finally {clearTimeout(timer);clearTimeout(fetchTimer);clearInterval(cancelTimer);void reader?.cancel().catch(()=>{});}
}

// A bounded source illustration, never a viewport or a coordinate certificate.
export async function readCurrentPdfPage(task,selected,args,cancelled,{render=renderCurrentPdfPage,renderTimeoutMs=35000,...options}={}) {
  if(!Number.isSafeInteger(args.page)||args.page<1||args.page>ATTACHMENT_LIMITS.documentPages||!/^[a-f0-9]{64}$/.test(args.raw_sha256||''))return {error:'tool_arguments_invalid'};
  const source=await readCurrentPdf(task,selected,cancelled,options);
  if(source.error)return source;
  if(source.pdf.raw_sha256!==args.raw_sha256)return {error:'browser_content_changed',instruction:'The PDF source changed. Read its text and source hash again before requesting a page image.'};
  if(args.page>source.pdf.page_count)return {error:'tool_arguments_invalid'};
  const snapshot=task.pdfContentCache;
  if(!snapshot?.bytes)return visualUnavailable('pdf_snapshot_unavailable');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort('pdf_render_timeout'),Math.min(35000,Math.max(1,renderTimeoutMs)));
  const cancelTimer=setInterval(()=>{if(cancelled())controller.abort('cancelled');},50);
  try {
    const result=await abortable(render(snapshot.bytes,{page:args.page},controller.signal),controller.signal);
    if(cancelled())throw Error('cancelled');
    const checked=await abortable(readCurrentPdf(task,selected,cancelled,options),controller.signal);
    if(checked.error)return checked;
    if(checked.pdf.raw_sha256!==args.raw_sha256)return {error:'browser_content_changed'};
    const png=result?.image;
    if(result?.page!==args.page||result.pageCount!==source.pdf.page_count||!Number.isSafeInteger(result.width)||!Number.isSafeInteger(result.height)||
      result.width<1||result.height<1||result.width*result.height>4000000||png?.mimeType!=='image/png'||
      typeof png.data!=='string'||png.data.length>Math.ceil(4194304/3)*4||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png.data))return visualUnavailable('pdf_render_invalid');
    const identity={url:publicSourceURL(snapshot.url),raw_sha256:args.raw_sha256,page:args.page,page_count:source.pdf.page_count,documentId:selected.documentId};
    const range=source.pageRanges.find(page=>page.page===args.page);
    return {ok:true,dataKind:'pdf_page_reference',source:identity,
      text:source.text.slice(range.start,Math.min(range.end,range.start+12000)),textTruncated:range.end-range.start>12000,
      referenceImage:{dataUrl:`data:image/png;base64,${png.data}`,mimeType:'image/png',width:result.width,height:result.height,source:identity},
      coverage:{partial:true,pages:[args.page],page_count:source.pdf.page_count},
      scope:'One PDF source page illustration. Not the current browser screen, screenshot, action coordinates, OCR or whole-document coverage. Inspect relevant diagrams, legends and exceptions together with text; do not infer unseen details or automatic task completion.'};
  }catch(error) {
    if(cancelled()||error.message==='cancelled'||controller.signal.reason==='cancelled')throw Error('cancelled');
    return visualUnavailable(controller.signal.aborted?'pdf_render_timeout':'pdf_render_failed');
  }finally {clearTimeout(timer);clearInterval(cancelTimer);}
}
