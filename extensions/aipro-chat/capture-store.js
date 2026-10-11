import {imageFile, imageFilename} from './image-files.js';
import {normalizeTraceId} from './agent-trace.js';
// Browser-produced PNGs and observed page images are attachments, never transcript text or diagnostics.
// IndexedDB keeps image bytes outside chrome.storage's small JSON quota.
export const CAPTURE_LIMITS = Object.freeze({bytes: 80 * 1024 * 1024, count: 80, base64: 6000000});
const databaseName = 'aipro-browser-captures';
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('captures', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('capture_save_failed'));
  });
}
async function transaction(mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    let value, failure;
    const tx = db.transaction('captures', mode);
    tx.oncomplete = () => {db.close(); resolve(value);};
    tx.onabort = tx.onerror = () => {db.close(); reject(failure || new Error('capture_save_failed'));};
    try {operation(tx.objectStore('captures'), result => {value = result;}, error => {failure = error; tx.abort();});}
    catch (error) {failure = error; tx.abort();}
  });
}
export function captureRecord({screenshot, image, requestId, provider, traceId}) {
  if (image?.mimeType !== 'image/png' || typeof image.data !== 'string' || image.data.length > CAPTURE_LIMITS.base64 ||
    !/^[a-z0-9-]{8,80}$/i.test(screenshot?.id || '') || !requestId || !['aipro', 'chatgpt', 'fabrix'].includes(provider)) throw new Error('capture_save_failed');
  const url = new URL(screenshot.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('capture_save_failed');
  const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) throw new Error('capture_save_failed');
  const header = new DataView(bytes.buffer), width = header.getUint32(16), height = header.getUint32(20);
  if (!width || !height || width > 32768 || height > 32768 || !Number.isFinite(screenshot.at)) throw new Error('capture_save_failed');
  const date = new Date(screenshot.at).toISOString().replace(/[:.]/g, '-');
  const metadata = {id: screenshot.id, source: 'browser-tab', host: url.host, width, height, capturedAt: screenshot.at,
    ...(['page','region'].includes(screenshot.mode) ? {mode: screenshot.mode} : {}),
    ...(normalizeTraceId(traceId) ? {traceId} : {}),
    bytes: bytes.length, filename: `browser-capture-${date}-${screenshot.id.slice(0, 8)}.png`};
  return {...metadata, requestId, provider, blob: new Blob([bytes], {type: 'image/png'})};
}
export async function saveCapture(input) {
  return saveRecord(captureRecord(input));
}
export function pageImageRecord({screenshot: image, image: payload, requestId, provider}) {
  const file = imageFile(payload?.data);
  const url = new URL(image.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    !/^[a-z0-9-]{8,80}$/i.test(image?.id || '') || !requestId || !['aipro', 'chatgpt', 'fabrix'].includes(provider) || !Number.isFinite(image.at)) throw new Error('capture_save_failed');
  const dimension = value => Number.isInteger(value) && value > 0 && value <= 65536 ? value : 0;
  return {id: image.id, source: 'page-image', host: url.host, width: dimension(image.width), height: dimension(image.height),
    label: String(image.label || '페이지 이미지').slice(0, 180), capturedAt: image.at, bytes: file.bytes.length,
    mimeType: file.mimeType, format: file.extension.toUpperCase(), filename: imageFilename(null, image.filename, file.extension),
    requestId, provider, blob: new Blob([file.bytes], {type: file.mimeType})};
}
export async function savePageImage(input) {return saveRecord(pageImageRecord(input));}
async function saveRecord(record) {
  return transaction('readwrite', (store, done, fail) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const others = request.result.filter(item => item.id !== record.id);
      if (others.length >= CAPTURE_LIMITS.count || others.reduce((sum, item) => sum + item.bytes, 0) + record.bytes > CAPTURE_LIMITS.bytes) return fail(new Error('capture_storage_full'));
      store.put(record);
      const {blob, requestId, provider, ...metadata} = record;
      done(metadata);
    };
  });
}
export async function readCapture(id) {
  return transaction('readonly', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => done(request.result?.blob || null);
  });
}
// Revalidate already attached screenshots without returning their bytes or
// treating a stored capture as a fresh observation of the current page.
export async function attachedScreenshotRecords(ids, {requestId, provider}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 4 || new Set(ids).size !== ids.length ||
    ids.some(id => typeof id !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(id)) ||
    !requestId || !['aipro', 'chatgpt', 'fabrix'].includes(provider)) return null;
  return transaction('readonly', (store, done) => {
    const records = new Array(ids.length); let remaining = ids.length;
    ids.forEach((id, index) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result;
        records[index] = record?.id === id && record.source === 'browser-tab' && record.requestId === requestId &&
          record.provider === provider && record.blob instanceof Blob && record.blob.type === 'image/png' &&
          record.blob.size > 0 && record.blob.size === record.bytes
          ? {id, availableInChat: true} : null;
        if (--remaining === 0) done(records.every(Boolean) ? records : null);
      };
    });
  });
}
export async function deleteCaptures(ids) {
  if (!ids?.length) return;
  return transaction('readwrite', store => {for (const id of ids) store.delete(id);});
}
export async function pruneCaptures(ids) {
  const retained = new Set(ids);
  return transaction('readwrite', store => {
    const request = store.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!retained.has(cursor.key)) store.delete(cursor.key);
      cursor.continue();
    };
  });
}
