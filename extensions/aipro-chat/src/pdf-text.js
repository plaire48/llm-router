import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {ATTACHMENT_LIMITS} from '../attachment-limits.js';

export const PDF_RENDER_LIMITS=Object.freeze({pixels:4_000_000,canvasPixels:12_000_000,imageBytes:4*1024*1024,edge:2000});
const renderSize=(width,height)=>{
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width*height>PDF_RENDER_LIMITS.pixels)throw Error('pdf_render_size');
};
class BoundedCanvasFactory {
  constructor(){this.canvases=new Map();}
  allocate(canvas,width,height){
    width=Math.ceil(width);height=Math.ceil(height);renderSize(width,height);
    const used=[...this.canvases.values()].reduce((sum,size)=>sum+size,0)-(this.canvases.get(canvas)||0)+width*height;
    if(used>PDF_RENDER_LIMITS.canvasPixels)throw Error('pdf_render_size');
    canvas.width=width;canvas.height=height;this.canvases.set(canvas,width*height);
  }
  create(width,height){const canvas=new OffscreenCanvas(1,1);this.allocate(canvas,width,height);return{canvas,context:canvas.getContext('2d')};}
  reset({canvas},width,height){if(!canvas)throw Error('pdf_render_failed');this.allocate(canvas,width,height);}
  destroy(entry){if(!entry.canvas)return;this.canvases.delete(entry.canvas);entry.canvas.width=entry.canvas.height=0;entry.canvas=entry.context=null;}
}

// This is a document reference image, not a browser screenshot or action map.
export async function renderPdfPage(buffer,assetBase,workerURL,{page:number}) {
  if(!Number.isSafeInteger(number)||number<1||number>ATTACHMENT_LIMITS.documentPages)throw Error('pdf_render_page');
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength>ATTACHMENT_LIMITS.documentBytes)throw Error('attachment_document_size');
  const port=new Worker(workerURL,{type:'module'});GlobalWorkerOptions.workerPort=port;
  let task,canvas,page;
  try {
    task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,enableXfa:false,useWasm:false,
      useSystemFonts:false,useWorkerFetch:true,disableFontFace:true,stopAtErrors:true,verbosity:0,
      CanvasFactory:BoundedCanvasFactory,canvasMaxAreaInBytes:16*1024*1024,
      cMapUrl:`${assetBase}cmaps/`,cMapPacked:true,standardFontDataUrl:`${assetBase}standard_fonts/`});
    const doc=await task.promise;
    if(doc.numPages>ATTACHMENT_LIMITS.documentPages)throw Error('attachment_document_size');
    if(number>doc.numPages)throw Error('pdf_render_page');
    page=await doc.getPage(number);const native=page.getViewport({scale:1});
    if(!Number.isFinite(native.width)||!Number.isFinite(native.height)||native.width<=0||native.height<=0)throw Error('pdf_render_size');
    const viewport=page.getViewport({scale:Math.min(1.5,PDF_RENDER_LIMITS.edge/Math.max(native.width,native.height))});
    const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);renderSize(width,height);
    canvas=new OffscreenCanvas(width,height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    const blob=await canvas.convertToBlob({type:'image/png'});
    if(blob.type!=='image/png'||blob.size>PDF_RENDER_LIMITS.imageBytes)throw Error('pdf_render_size');
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
    for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    // Text stays in the host's authoritative snapshot/page ranges.
    return{page:number,pageCount:doc.numPages,width,height,image:{mimeType:'image/png',data:btoa(binary)}};
  }catch(error){throw Error(error.name==='PasswordException'?'attachment_document_password':error.message);}
  finally{try{page?.cleanup();if(canvas)canvas.width=canvas.height=0;}finally{try{await task?.destroy();}finally{port.terminate();}}}
}

// Both user attachments and current-page PDFs use this text-only parser.
export async function extractPdfText(buffer, assetBase, workerURL) {
  const port = new Worker(workerURL, {type:'module'});
  GlobalWorkerOptions.workerPort = port;
  const task = getDocument({data:new Uint8Array(buffer), isEvalSupported:false, enableXfa:false, useWasm:false,
    useSystemFonts:false, useWorkerFetch:true, disableFontFace:true, stopAtErrors:true, verbosity:0,
    cMapUrl:`${assetBase}cmaps/`, cMapPacked:true, standardFontDataUrl:`${assetBase}standard_fonts/`});
  try {
    const doc = await task.promise;
    if(doc.numPages > ATTACHMENT_LIMITS.documentPages) throw Error('attachment_document_size');
    const sections=[], pages=[]; let size=0, found=false;
    for(let number=1;number<=doc.numPages;number++) {
      const page=await doc.getPage(number), content=await page.getTextContent();
      const body=content.items.map(item=>typeof item.str==='string'?item.str+(item.hasEOL?'\n':' '):'').join('').trim();
      if(body)found=true;
      const text=`[${number}쪽]\n${body||'[읽을 수 있는 텍스트 없음]'}`;
      if(number>1)size+=2;
      const start=size;size+=text.length;
      if(size>ATTACHMENT_LIMITS.textChars)throw Error('attachment_document_size');
      pages.push({page:number,start,end:size,textAvailable:!!body});sections.push(text);page.cleanup();
    }
    if(!found)throw Error('attachment_document_empty');
    const text=sections.join('\n\n');
    if(new TextEncoder().encode(text).length>ATTACHMENT_LIMITS.extractedBytes)throw Error('attachment_document_size');
    return {text,pages,pageCount:doc.numPages};
  } catch(error) {throw Error(error.name==='PasswordException'?'attachment_document_password':error.message);}
  finally {await task.destroy();port.terminate();}
}
