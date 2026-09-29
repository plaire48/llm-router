import pdfWorkerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import {ATTACHMENT_LIMITS} from '../attachment-limits.js';
import {extractPdfText} from './pdf-text.js';

const maxChars = ATTACHMENT_LIMITS.textChars;
self.onmessage = async ({data}) => {
  if (data?.type !== 'nubi:document-read') return;
  const reply = {type: 'nubi:document-result', jobId: data.jobId};
  try {
    const text = /\.pdf$/i.test(data.name) ? (await extractPdfText(data.buffer, data.assetBase, pdfWorkerURL)).text
      // Mammoth's browser entry refuses external file access. Only raw text is used.
      : (await mammoth.extractRawText({arrayBuffer: data.buffer})).value;
    if (!text.trim()) throw new Error('attachment_document_empty');
    if (text.length > maxChars || new TextEncoder().encode(text).length > ATTACHMENT_LIMITS.extractedBytes) throw new Error('attachment_document_size');
    self.postMessage({...reply, text});
  } catch (error) {
    const code = ['attachment_document_empty', 'attachment_document_size', 'attachment_document_password'].includes(error.message) ? error.message : 'attachment_document';
    self.postMessage({...reply, error: code});
  }
};
