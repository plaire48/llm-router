import {extractPdfText,renderPdfPage} from './src/pdf-text.js';
self.onmessage=async ({data})=>{
  if(!['nubi:pdf-read','nubi:pdf-render'].includes(data?.type))return;
  try {
    const result=await(data.type==='nubi:pdf-render'?renderPdfPage(data.buffer,data.assetBase,data.workerURL,{page:data.page}):extractPdfText(data.buffer,data.assetBase,data.workerURL));
    self.postMessage({jobId:data.jobId,result});
  } catch(error) {
    const code=['attachment_document_empty','attachment_document_size','attachment_document_password','pdf_render_page','pdf_render_size'].includes(error.message)?error.message:data.type==='nubi:pdf-render'?'pdf_render_failed':'attachment_document';
    self.postMessage({jobId:data.jobId,error:code});
  }
};
