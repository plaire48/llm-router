import {ATTACHMENT_LIMITS} from './attachment-limits.js';
function runPdfWorker(bytes,render) {
  return new Promise((resolve,reject)=>{
    if(typeof bytes!=='string'||bytes.length>Math.ceil(ATTACHMENT_LIMITS.documentBytes/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(bytes))return reject(Error('attachment_document_size'));
    if(render&&(!Number.isSafeInteger(render.page)||render.page<1||render.page>ATTACHMENT_LIMITS.documentPages))return reject(Error('pdf_render_page'));
    let buffer;try{buffer=Uint8Array.from(atob(bytes),char=>char.charCodeAt(0)).buffer;}catch{return reject(Error('attachment_document'));}
    if(buffer.byteLength>ATTACHMENT_LIMITS.documentBytes)return reject(Error('attachment_document_size'));
    const worker=new Worker(chrome.runtime.getURL('browser-document-worker.js'),{type:'module'}),jobId=crypto.randomUUID();
    let finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);worker.terminate();error?reject(Error(error)):resolve(result);};
    const timer=setTimeout(()=>finish(render?'pdf_render_timeout':'attachment_document_timeout'),render?30000:ATTACHMENT_LIMITS.extractionMs);
    worker.onerror=()=>finish(render?'pdf_render_failed':'attachment_document');
    worker.onmessage=({data})=>{if(data?.jobId!==jobId)return;finish(data.error,data.result);};
    worker.postMessage({type:render?'nubi:pdf-render':'nubi:pdf-read',...(render?{page:render.page}:{}),jobId,buffer,assetBase:chrome.runtime.getURL('document-assets/'),
      workerURL:chrome.runtime.getURL('document-assets/pdf.worker.mjs')},[buffer]);
  });
}
export const parseBrowserPdf=bytes=>runPdfWorker(bytes);
export const renderBrowserPdfPage=(bytes,options)=>runPdfWorker(bytes,options);
