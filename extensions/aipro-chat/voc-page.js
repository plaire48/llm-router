// Static, isolated-world functions. Never execute page-provided code or selectors.
export function collectVocPage() {
  const match=location.pathname.match(/\/(?:browse\/|servicedesk\/customer\/portal\/\d+\/)([A-Z][A-Z0-9_]{0,30}-\d{1,12})(?:\/|$)/);
  const title=document.querySelector('#summary-val, [data-test-id="issue.views.issue-base.foundation.summary.heading"], main h1, [role="main"] h1, h1');
  const root=document.querySelector('#issue-content, [data-test-id="issue.views.issue-base.foundation.issue-body"], main, [role="main"]');
  if(!match || !title || !root || document.querySelector('input[type="password"]')) return {error:'voc_invalid'};
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),lines=[];let node,total=0;
  while((node=walker.nextNode()) && total<120000) {
    const element=node.parentElement;if (!element || element.closest('script,style,noscript,input,textarea,select,[hidden],[aria-hidden="true"],nav,header,footer')) continue;
    if(!element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) continue;
    const text=node.textContent.replace(/\s+/g,' ').trim();if(!text)continue;lines.push(text);total+=text.length+1;
  }
  const attachments=[...root.querySelectorAll('a[href]')].filter(a=>a.checkVisibility()).map(a=>({name:(a.innerText||a.getAttribute('aria-label')||'첨부 파일').trim(),url:a.href}));
  return {sourceUrl:location.origin+location.pathname,key:match[1],title:title.innerText.trim(),body:lines.join('\n'),status:document.querySelector('#status-val,[data-test-id="issue.views.issue-base.foundation.status.status-field-wrapper"]')?.innerText||'',remoteUpdatedAt:document.querySelector('#updated-val time[datetime]')?.dateTime||null,attachments};
}
export async function fetchVocAttachment(expectedSource,url) {
  if(location.origin+location.pathname!==expectedSource) return {error:'page_changed'};
  const target=new URL(url);
  if(target.origin!==location.origin || target.search || target.hash || ![...document.querySelectorAll('a[href]')].some(a=>a.href===target.href)) return {error:'voc_attachment'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(target.href,{credentials:'same-origin',redirect:'error',signal:controller.signal,cache:'no-store'});
    if(!response.ok || Number(response.headers.get('content-length'))>5*1024*1024 || /html/i.test(response.headers.get('content-type')||'')) return {error:'voc_attachment'};
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024*1024){await reader.cancel();return {error:'voc_attachment'};}chunks.push(value);}
    if(location.origin+location.pathname!==expectedSource)return {error:'page_changed'};
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {base64:btoa(binary),type:response.headers.get('content-type')||'application/octet-stream'};
  } catch {return {error:'voc_attachment'};} finally {clearTimeout(timer);}
}
