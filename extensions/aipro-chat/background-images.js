// DOM is needed only to decode SVG/Blob assets into a comparison sheet. The
// offscreen document never owns the agent or calls a model/browser tool.
let queue = Promise.resolve();
export function compareImages(result, signal) {
  const operation = queue.then(async () => {
    if (signal.aborted) throw new Error('cancelled');
    let timer, cancel, owned = false;
    try {
      const url = chrome.runtime.getURL('image-renderer.html');
      const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
      if (contexts.length && !contexts.some(context => context.documentUrl === url)) throw new Error('image_unavailable');
      if (!contexts.length) await chrome.offscreen.createDocument({url, reasons: ['BLOBS'], justification: 'Decode observed image Blobs including SVG and render a numbered comparison PNG.'});
      owned = true;
      return await Promise.race([
        chrome.runtime.sendMessage({target: 'image-renderer', result}).then(reply => {
          if (!reply?.ok) throw new Error('image_unavailable'); return reply.result;
        }),
        new Promise((_, reject) => {
          cancel = () => reject(new Error('cancelled'));
          signal.addEventListener('abort', cancel, {once: true});
          if (signal.aborted) cancel();
          timer = setTimeout(() => reject(new Error('image_unavailable')), 65000);
        }),
      ]);
    } finally {
      clearTimeout(timer); if (cancel) signal.removeEventListener('abort', cancel);
      if (owned) await chrome.offscreen.closeDocument().catch(() => {});
    }
  });
  queue = operation.catch(() => {}); return operation;
}
