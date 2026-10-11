import {attachmentPayloads} from '../attachments.js';
import {ATTACHMENT_LIMITS} from '../attachment-limits.js';

export function extractDocument(buffer, name) {
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID();
    const worker = new Worker(new URL('./document-worker.js', import.meta.url), {type: 'module'});
    const finish = (error, value) => {clearTimeout(timer); worker.terminate(); error ? reject(new Error(error)) : resolve(value);};
    const timer = setTimeout(() => finish('attachment_document_timeout'), ATTACHMENT_LIMITS.extractionMs);
    worker.onerror = () => finish('attachment_document');
    worker.onmessage = event => {
      if (event.data?.type !== 'nubi:document-result' || event.data.jobId !== jobId) return;
      event.data.error ? finish(event.data.error) : finish(null, {text: event.data.text});
    };
    worker.postMessage({type: 'nubi:document-read', jobId, buffer, name, assetBase: chrome.runtime.getURL('document-assets/')}, [buffer]);
  });
}
export const prepareFiles = (files, count, source) => attachmentPayloads(files, count, source, extractDocument);
