// Decode only passive image formats. Never turn a downloaded HTML response into
// an attachment or render remote markup in the extension document.
export const IMAGE_FILE_LIMIT = 20 * 1024 * 1024;
export const IMAGE_TYPES = Object.freeze({'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg'});
export function imageFile(data) {
  if (typeof data !== 'string' || data.length > Math.ceil(IMAGE_FILE_LIMIT / 3) * 4) throw new Error('image_too_large');
  let bytes; try {bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));} catch {throw new Error('image_unavailable');}
  if (!bytes.length || bytes.length > IMAGE_FILE_LIMIT) throw new Error('image_too_large');
  const starts = signature => signature.every((value, i) => bytes[i] === value);
  const ascii = new TextDecoder().decode(bytes.subarray(0, 256));
  let mimeType;
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) mimeType = 'image/png';
  else if (starts([255, 216, 255])) mimeType = 'image/jpeg';
  else if (/^GIF8[79]a/.test(ascii)) mimeType = 'image/gif';
  else if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') mimeType = 'image/webp';
  else if (ascii.slice(4, 8) === 'ftyp' && /avif|avis/.test(ascii.slice(8))) mimeType = 'image/avif';
  else {
    const text = new TextDecoder().decode(bytes);
    // SVG stays a Blob displayed through <img>, never inline HTML or an iframe.
    if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text) && !/<!DOCTYPE|<!ENTITY/i.test(text)) mimeType = 'image/svg+xml';
  }
  if (!mimeType) throw new Error('image_unavailable');
  return {bytes, mimeType, extension: IMAGE_TYPES[mimeType]};
}
export function imageFilename(source, label, extension) {
  let name = '';
  try {const url = new URL(source); if (['http:', 'https:'].includes(url.protocol)) name = decodeURIComponent(url.pathname.split('/').at(-1) || '');} catch {}
  name = (name || label || 'page-image').replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '-').replace(/[ .]+$/g, '').replace(/\.[a-z0-9]{1,8}$/i, '').slice(0, 100);
  if (!name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) name = 'page-image';
  return `${name}.${extension}`;
}
