import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';

GlobalWorkerOptions.workerSrc = pdfWorkerURL;
const maxChars = 40000;
async function pdfText(buffer, assetBase) {
  const port = new Worker(pdfWorkerURL, {type: 'module'});
  GlobalWorkerOptions.workerPort = port;
  const task = getDocument({data: new Uint8Array(buffer), isEvalSupported: false, enableXfa: false, useWasm: false,
    useSystemFonts: false, useWorkerFetch: true, disableFontFace: true, stopAtErrors: true, verbosity: 0,
    cMapUrl: `${assetBase}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assetBase}standard_fonts/`});
  let doc;
  try {
    doc = await task.promise;
    if (doc.numPages > 150) throw new Error('attachment_document_size');
    const pages = []; let size = 0, foundText = false;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i), content = await page.getTextContent();
      const text = content.items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
      if (text) foundText = true;
      const section = `[${i}쪽]\n${text || '[읽을 수 있는 텍스트 없음]'}`;
      size += section.length; if (size > maxChars) throw new Error('attachment_document_size');
      pages.push(section); page.cleanup();
    }
    if (!foundText) throw new Error('attachment_document_empty');
    return pages.join('\n\n');
  } catch (error) {throw new Error(error.name === 'PasswordException' ? 'attachment_document_password' : error.message);}
  finally {await task.destroy(); port.terminate();}
}
self.onmessage = async ({data}) => {
  if (data?.type !== 'nubi:document-read') return;
  const reply = {type: 'nubi:document-result', jobId: data.jobId};
  try {
    const text = /\.pdf$/i.test(data.name) ? await pdfText(data.buffer, data.assetBase)
      // Mammoth's browser entry refuses external file access. Only raw text is used.
      : (await mammoth.extractRawText({arrayBuffer: data.buffer})).value;
    if (!text.trim()) throw new Error('attachment_document_empty');
    if (text.length > maxChars || new TextEncoder().encode(text).length > 128 * 1024) throw new Error('attachment_document_size');
    self.postMessage({...reply, text});
  } catch (error) {
    const code = ['attachment_document_empty', 'attachment_document_size', 'attachment_document_password'].includes(error.message) ? error.message : 'attachment_document';
    self.postMessage({...reply, error: code});
  }
};
