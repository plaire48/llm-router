import {imageComparison} from './image-comparison.js';
import {parseBrowserPdf,renderBrowserPdfPage} from './browser-pdf-parser.js';
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'image-renderer' || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js')) return;
  const pdf=message.kind==='pdf'||message.kind==='pdf-render';
  const operation=message.kind==='pdf-render'?renderBrowserPdfPage(message.bytes,{page:message.page}):message.kind==='pdf'?parseBrowserPdf(message.bytes):imageComparison(message.result,new AbortController().signal);
  operation.then(result => reply({ok: true, result}), error => reply({ok: false,error:pdf?(['attachment_document_empty','attachment_document_size','attachment_document_password','attachment_document_timeout','pdf_render_page','pdf_render_size','pdf_render_timeout','pdf_render_failed'].includes(error.message)?error.message:message.kind==='pdf-render'?'pdf_render_failed':'attachment_document'):undefined}));
  return true;
});
