// DOM is needed only to decode SVG/Blob assets into a comparison sheet. The
// offscreen document never owns the agent or calls a model/browser tool.
let queue = Promise.resolve();
function withRenderer(message, signal, timeoutMs, failureCode, timeoutCode=failureCode) {
  const operation = queue.then(async () => {
    if (signal.aborted) throw new Error('cancelled');
    let timer, cancel, owned = false;
    try {
      const url = chrome.runtime.getURL('image-renderer.html');
      const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
      if (contexts.length && !contexts.some(context => context.documentUrl === url)) throw new Error(failureCode);
      if (!contexts.length) await chrome.offscreen.createDocument({url, reasons: ['BLOBS','WORKERS'], justification: 'Decode observed images or extract bounded text from the current PDF with bundled workers.'});
      owned = true;
      return await Promise.race([
        chrome.runtime.sendMessage({target: 'image-renderer', ...message}).then(reply => {
          if (!reply?.ok) throw new Error(['attachment_document','attachment_document_empty','attachment_document_size','attachment_document_password','attachment_document_timeout','pdf_render_page','pdf_render_size','pdf_render_timeout','pdf_render_failed'].includes(reply?.error)?reply.error:failureCode); return reply.result;
        }),
        new Promise((_, reject) => {
          cancel = () => reject(new Error('cancelled'));
          signal.addEventListener('abort', cancel, {once: true});
          if (signal.aborted) cancel();
          timer = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer); if (cancel) signal.removeEventListener('abort', cancel);
      if (owned) await chrome.offscreen.closeDocument().catch(() => {});
    }
  });
  queue = operation.catch(() => {}); return operation;
}
export const compareImages = (result, signal) => withRenderer({result},signal,65000,'image_unavailable');
export const extractCurrentPdf = (bytes, signal) => withRenderer({kind:'pdf',bytes},signal,125000,'attachment_document','attachment_document_timeout');
export const renderCurrentPdfPage = (bytes,{page},signal) => withRenderer({kind:'pdf-render',bytes,page},signal,35000,'pdf_render_failed','pdf_render_timeout');
