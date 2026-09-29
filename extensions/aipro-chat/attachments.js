import {imageFile} from './image-files.js';
import {supportsBrowserVision} from './skills.js';

import {ATTACHMENT_LIMITS} from './attachment-limits.js';
export {ATTACHMENT_LIMITS} from './attachment-limits.js';
const textExtensions = ['txt', 'md', 'mdx', 'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'json', 'css', 'scss', 'html', 'htm', 'xml', 'svg', 'yaml', 'yml', 'py', 'java', 'kt', 'go', 'rs', 'c', 'h', 'cpp', 'cs', 'sql', 'sh', 'vue', 'svelte', 'csv', 'log', 'toml'];
export const ATTACHMENT_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', '.pdf', '.docx', ...textExtensions.map(ext => `.${ext}`)].join(',');
export const PASTE_LIMITS = Object.freeze({characters: 2000, lines: 30});
export function clipboardAttachments(clipboard) {
  const files = [...(clipboard?.files || [])];
  if (files.length) return files;
  const text = clipboard?.getData('text/plain') || '';
  if (text.length < PASTE_LIMITS.characters && text.split(/\r?\n/).length < PASTE_LIMITS.lines) return null;
  return [new File([text], '붙여넣은 텍스트.txt', {type: 'text/plain'})];
}
export async function attachmentPayloads(files, count = 0, source = 'user-file', extractDocument) {
  if (files.length + count > ATTACHMENT_LIMITS.count) throw new Error('attachment_count');
  if (files.reduce((sum, file) => sum + file.size, 0) > ATTACHMENT_LIMITS.batchBytes) throw new Error('attachment_size');
  for (const file of files) {
    const kind = attachmentKind(file.name);
    if (file.size > ATTACHMENT_LIMITS[`${kind}Bytes`]) throw new Error('attachment_size');
  }
  const result = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = attachmentKind(file.name) === 'document';
    if (document) validateDocument(bytes, file.name);
    if (document && !extractDocument) throw new Error('attachment_document');
    const extracted = document ? await extractDocument(bytes.slice().buffer, file.name) : {};
    result.push({name: file.name, source, data: bytesBase64(bytes), ...extracted});
  }
  return result;
}
export const attachmentVision = (provider, modelId, model) => provider === 'aipro' ? supportsBrowserVision(modelId) : provider === 'chatgpt' && model?.supportsImages === true;
export function attachmentKind(name) {
  const ext = String(name || '').split('.').at(-1).toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (['pdf', 'docx'].includes(ext)) return 'document';
  if (textExtensions.includes(ext)) return 'text';
  throw new Error('attachment_type');
}
export function validateDocument(bytes, name) {
  if (bytes.length > ATTACHMENT_LIMITS.documentBytes) throw new Error('attachment_size');
  if (/\.pdf$/i.test(name)) {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('attachment_document');
    return;
  }
  // Bound ZIP expansion before passing a DOCX to the document parser.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {end = i; break;}
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('attachment_document');
  const count = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true);
  if (count > 5000 || offset >= end) throw new Error('attachment_size');
  let at = offset, total = 0; const names = new Set();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50 || view.getUint16(at + 8, true) & 1) throw new Error('attachment_document');
    const size = view.getUint32(at + 24, true), length = view.getUint16(at + 28, true);
    total += size;
    if (size > 8 * 1024 * 1024 || total > 20 * 1024 * 1024) throw new Error('attachment_size');
    if (at + 46 + length > end) throw new Error('attachment_document');
    names.add(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + length)));
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  if (!names.has('word/document.xml') || !names.has('[Content_Types].xml')) throw new Error('attachment_document');
}
export function bytesBase64(bytes) {
  let result = '';
  for (let start = 0; start < bytes.length; start += 8192) result += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(result);
}
export function decodeAttachment(payload) {
  const name = String(payload?.name || '').replaceAll('\\', '/').split('/').at(-1).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 180);
  const kind = attachmentKind(name);
  const source = payload?.source === 'user-paste' ? 'user-paste' : 'user-file';
  if (typeof payload.data !== 'string' || payload.data.length > Math.ceil(ATTACHMENT_LIMITS[`${kind}Bytes`] / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.data)) throw new Error('attachment_size');
  let bytes;
  try {bytes = Uint8Array.from(atob(payload.data), char => char.charCodeAt(0));} catch {throw new Error('attachment_invalid');}
  if (!bytes.length) throw new Error('attachment_empty');
  if (bytes.length > ATTACHMENT_LIMITS[`${kind}Bytes`]) throw new Error('attachment_size');
  if (kind === 'document') {
    validateDocument(bytes, name);
    const text = payload.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('attachment_document_empty');
    if (text.length > ATTACHMENT_LIMITS.textChars || new TextEncoder().encode(text).length > ATTACHMENT_LIMITS.extractedBytes) throw new Error('attachment_document_size');
    return {name, kind, bytes, source, text, mimeType: /\.pdf$/i.test(name) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  }
  if (kind === 'image') {
    let image;
    try {image = imageFile(payload.data);} catch {throw new Error('attachment_invalid');}
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw new Error('attachment_type');
    return {name, kind, bytes, source, mimeType: image.mimeType};
  }
  let text;
  try {text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);} catch {throw new Error('attachment_encoding');}
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('attachment_encoding');
  if (text.length > ATTACHMENT_LIMITS.textChars) throw new Error('attachment_size');
  if (!text.trim()) throw new Error('attachment_empty');
  return {name, kind, bytes, source, mimeType: 'text/plain', text};
}
export function attachmentIds(state) {
  return [...new Set([state.chat, ...Object.values(state.providerChats || {}), ...(state.chatHistory || [])].filter(Boolean)
    .flatMap(chat => [...(chat.draftAttachments || []), ...(chat.messages || []).flatMap(message => message.attachments || [])]).map(file => file.id))];
}
export const attachmentText = content => typeof content === 'string' ? content : (content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
