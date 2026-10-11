import {parentPort,workerData} from 'node:worker_threads';
try {
  const {extractDocument}=await import('./document-extract.mjs');
  const document=await extractDocument(Buffer.from(workerData.bytes),workerData.filename,workerData.contentType);
  parentPort.postMessage({document});
} catch(error) {
  parentPort.postMessage({error:['document_format','document_empty','document_limit'].includes(error.message)?error.message:error.name==='PasswordException'?'document_password':'document_read_failed'});
}
