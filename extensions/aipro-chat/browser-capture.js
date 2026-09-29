// Page rasters are reading/export evidence, never viewport click coordinates.
// GPT-5.6 rejects an image of more than 30,000 patches of 32x32 pixels (about
// 30.7 million pixels) instead of shrinking it; stay well below that.
export const CAPTURE_MAX_PIXELS = 24 * 1024 * 1024;
const secretFields = 'input[type="password"],input[autocomplete^="cc-"],input[name*="token" i],textarea[name*="token" i],input[name*="secret" i],textarea[name*="secret" i],input[name*="api_key" i],textarea[name*="api_key" i]';

function layout() {
  const root = document.documentElement, body = document.body;
  return {width: innerWidth, height: innerHeight, scrollX, scrollY,
    documentWidth: Math.max(root.clientWidth, root.scrollWidth, root.offsetWidth, body?.clientWidth || 0, body?.scrollWidth || 0, body?.offsetWidth || 0),
    documentHeight: Math.max(root.clientHeight, root.scrollHeight, root.offsetHeight, body?.clientHeight || 0, body?.scrollHeight || 0, body?.offsetHeight || 0)};
}
function pngSize(bytes) {
  const magic = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || magic.some((value, index) => bytes[index] !== value)) throw new Error('capture_incomplete');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {width: header.getUint32(16), height: header.getUint32(20)};
}
function checkSize(width, height) {
  if (!width || !height || width > 32768 || height > 32768 || width * height > CAPTURE_MAX_PIXELS) throw new Error('capture_too_large');
}
export function captureRegion(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'height,width,x,y' ||
      !Object.values(value).every(Number.isSafeInteger) || value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1) throw new Error('tool_arguments_invalid');
  checkSize(value.width, value.height);
  return value;
}
export function screenshotOptions(value) {
  if (value === undefined) return {full_page: true};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['fullPage','region'].includes(key)) ||
      value.fullPage !== undefined && typeof value.fullPage !== 'boolean' || value.region !== undefined && value.fullPage !== false) throw new Error('tool_arguments_invalid');
  const region = captureRegion(value.region);
  return {full_page: value.fullPage !== false, ...(region ? {region} : {})};
}
async function withinCaptureDeadline(operation, deadline, cancelled) {
  if (cancelled()) throw new Error('cancelled');
  const remaining=deadline-Date.now();
  if (remaining<=0) throw new Error('capture_timeout');
  let timer, watcher;
  try{return await Promise.race([operation(),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('capture_timeout')),remaining);
    watcher=setInterval(()=>{if(cancelled())reject(new Error('cancelled'));},50);
  })]);}
  finally{clearTimeout(timer);clearInterval(watcher);}
}

// Coverage describes geometry and known omissions, not semantic completeness.
// Keep current refs in the tool result only; never persist them with the PNG.
export function captureCoverage(screenshot, observation) {
  const fullPage = screenshot.mode === 'page', region = screenshot.mode === 'region', frames = observation?.frames || [];
  const nested = frames.flatMap(frame => (frame.elements || []).filter(el => el.scroll).map(el => ({
    frame: frame.frame, ref: el.ref, ...el.scroll, inViewport: el.inViewport,
  })));
  const count = key => frames.reduce((sum, frame) => sum + (Number(frame.surfaces?.[key]) || 0), 0);
  const pendingImages = count('pendingImages'), failedImages = count('failedImages');
  const detailRecommended = fullPage && (screenshot.width > screenshot.viewportWidth || screenshot.height > screenshot.viewportHeight * 2);
  const partialDOM = !frames.length || frames.some(frame => frame.unavailable || frame.coverage?.domTruncated || frame.omittedControls > 0 || frame.coverage?.queryFiltered) ||
    ['unavailable', 'omitted', 'excluded'].some(key => observation?.frameCoverage?.[key] > 0);
  return {scope: fullPage ? 'rendered_document' : region ? 'viewport_region' : 'viewport', allContentVerified: false,
    detailRecommended,
    document: {width: screenshot.documentWidth, height: screenshot.documentHeight},
    captured: {x: fullPage ? 0 : screenshot.scrollX + (screenshot.region?.x || 0), y: fullPage ? 0 : screenshot.scrollY + (screenshot.region?.y || 0), width: screenshot.width, height: screenshot.height},
    pendingImages, failedImages, nestedScrollAreas: nested.slice(0, 12), omittedScrollAreas: Math.max(0, nested.length - 12),
    framesObserved: frames.length, observationPartial: partialDOM,
    next: pendingImages ? 'wait_then_reobserve' : nested.length ? 'inspect_relevant_scroll_area' : detailRecommended ? 'inspect_relevant_sections' : fullPage ? 'verify_required_content' : 'inspect_remaining_sections',
    instruction: 'This PNG covers only the captured rectangle at this moment. A long or wide overview may be reduced by the vision provider: use DOM text for precise reading and capture_page({full_page:false}) after scrolling to required details. Overview and region pixels are NOT viewport click coordinates; use a fresh uncropped viewport capture or semantic ref to act. Nested scroll refs belong to the accompanying observation. For required missing content use scroll_page(direction, ref), inspect its movement and fresh observation, then capture the next section. Keep overlapping sections; never repeat a blocked scroll unchanged. Pending images need a bounded wait and re-observation; a broken image is not loading. Virtual rows, collapsed content, covered areas and undiscovered frames may remain. Reaching a scroll boundary is not proof that all data or acceptance criteria were verified.'};
}
// Chrome draws a scrollbar, and a scaled display rounds sizes, so an image can
// differ from the measured page by a few pixels. Measured on a company PC: every
// capture of a mail app failed with "캡처 범위 확인" for such a difference. A
// difference within this margin is the same page; a larger one is not.
const sizeMatches = (actual, expected) => Math.abs(actual - expected) <= Math.max(32, Math.round(expected * 0.02));
const CAPTURE_BYTES = 6000000, SEGMENT_PIXELS = 16 * 1024 * 1024;
function toBase64(bytes) {
  if (typeof bytes.toString === 'function' && bytes.constructor?.name === 'Buffer') return bytes.toString('base64');
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
}
// A page too long or too large for one image is captured in sections that are
// joined into one image of the whole page, reduced in size when it would not
// fit the image budget. Secret fields stay masked in every section.
async function stitchedPage(page, before, shot, deadline, cancelled) {
  const width = before.documentWidth, height = before.documentHeight;
  const sectionHeight = Math.max(1, Math.min(8192, Math.floor(SEGMENT_PIXELS / width)));
  const sections = [];
  for (let y = 0; y < height; y += sectionHeight) {
    const clip = {x: 0, y, width, height: Math.min(sectionHeight, height - y)};
    const bytes = await withinCaptureDeadline(() => shot({fullPage: true, clip}), deadline, cancelled);
    sections.push({clip, bitmap: await createImageBitmap(new Blob([bytes], {type: 'image/png'}))});
  }
  let scale = Math.min(1, Math.sqrt(CAPTURE_MAX_PIXELS / (width * height)), 32000 / height, 32000 / width);
  for (let attempt = 0; attempt < 5; attempt++, scale *= 0.75) {
    if (cancelled()) throw new Error('cancelled');
    const outWidth = Math.max(1, Math.floor(width * scale)), outHeight = Math.max(1, Math.floor(height * scale));
    const canvas = new OffscreenCanvas(outWidth, outHeight), context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    for (const {clip, bitmap} of sections) context.drawImage(bitmap, 0, Math.round(clip.y * scale), outWidth, Math.max(1, Math.round((clip.y + clip.height) * scale) - Math.round(clip.y * scale)));
    const bytes = new Uint8Array(await (await canvas.convertToBlob({type: 'image/png'})).arrayBuffer());
    const data = toBase64(bytes);
    if (data.length <= CAPTURE_BYTES) {
      for (const {bitmap} of sections) bitmap.close?.();
      return {bytes, data, dimensions: {width: outWidth, height: outHeight}, scale, sections: sections.length};
    }
  }
  throw new Error('capture_too_large');
}
export async function captureBrowserPage(page, {fullPage = true, region, cancelled = () => false, deadlineMs = 16000} = {}) {
  if (typeof fullPage !== 'boolean') throw new Error('tool_arguments_invalid');
  const selected = captureRegion(region);
  if (selected && fullPage) throw new Error('tool_arguments_invalid');
  let deadline=Date.now()+deadlineMs;
  const masks = page.frames().map(frame => frame.locator(secretFields));
  const shot = options => page.screenshot({type: 'png', scale: 'css', style: 'nubi-action-pointer { visibility: hidden !important; }', mask: masks, maskColor: '#E5E8EB', timeout: Math.max(1000, deadline - Date.now()), ...options});
  for (let attempt = 0; attempt < 2; attempt++) {
    if (cancelled()) throw new Error('cancelled');
    const url = page.url(), before = await withinCaptureDeadline(()=>page.evaluate(layout),deadline,cancelled);
    if (selected && (selected.x + selected.width > before.width || selected.y + selected.height > before.height)) throw new Error('tool_arguments_invalid');
    const expected = {width: selected?.width || (fullPage ? before.documentWidth : before.width), height: selected?.height || (fullPage ? before.documentHeight : before.height)};
    if (!expected.width || !expected.height) throw new Error('capture_too_large');
    const whole = fullPage && (expected.width > 16384 || expected.height > 16384 || expected.width * expected.height > CAPTURE_MAX_PIXELS);
    if (!fullPage) checkSize(expected.width, expected.height);
    let bytes, data, dimensions, scale = 1, sections = 1, uncovered = false;
    if (!whole) {
      bytes = await withinCaptureDeadline(()=>shot({fullPage, ...(selected ? {clip: selected} : {})}),deadline,cancelled);
      dimensions = pngSize(bytes);
      if (!sizeMatches(dimensions.width, expected.width) || !sizeMatches(dimensions.height, expected.height)) {
        // A page image at least as large as the window is kept and reported with
        // its real size: the coverage then says which part of the measured page
        // it holds. Anything smaller is not a page image.
        if (!fullPage || dimensions.width < before.width - 32 || dimensions.height < before.height - 32) throw Object.assign(new Error('capture_incomplete'), {expected, actual: dimensions});
        uncovered = true;
      }
      data = toBase64(bytes);
    }
    if (whole || data.length > CAPTURE_BYTES) {
      uncovered = false;
      if (!fullPage) throw new Error('capture_too_large');
      // Joining sections takes longer than one capture.
      deadline = Math.max(deadline, Date.now() + 45000);
      ({bytes, data, dimensions, scale, sections} = await stitchedPage(page, before, shot, deadline, cancelled));
    }
    const after = await withinCaptureDeadline(()=>page.evaluate(layout),deadline,cancelled);
    if (cancelled()) throw new Error('cancelled');
    const keys = fullPage ? Object.keys(before) : ['width', 'height', 'scrollX', 'scrollY'];
    if (page.url() !== url || keys.some(key => before[key] !== after[key])) continue;
    return {screenshot: {id: crypto.randomUUID(), ...before, ...dimensions, viewportWidth: before.width, viewportHeight: before.height, mode: fullPage ? 'page' : selected ? 'region' : 'viewport',
      ...(scale < 1 ? {scale: Math.round(scale * 1000) / 1000} : {}), ...(sections > 1 ? {sections} : {}), ...(uncovered ? {documentCovered: false} : {}), ...(selected ? {region: selected} : {}), url, at: Date.now()},
      viewport: {width: before.width, height: before.height, scrollX: before.scrollX, scrollY: before.scrollY}, image: {data, mimeType: 'image/png'}};
  }
  throw Object.assign(new Error('browser_stale'), {reason: 'viewport_changed'});
}

async function pngCanvas(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
  return {bitmap, width: bitmap.width, height: bitmap.height};
}
async function canvasPNG(canvas) {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({type: 'image/png'})).arrayBuffer());
  return {bytes, data: toBase64(bytes), dimensions: pngSize(bytes)};
}
// A small element is enlarged, up to three times and 1200 pixels wide: a star's
// color or a 16-pixel icon is not readable at its own size.
export async function enlargeCapture(image, factor) {
  if (!(factor > 1)) return null;
  const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
  const {bitmap, width, height} = await pngCanvas(bytes);
  try {
    const canvas = new OffscreenCanvas(Math.round(width * factor), Math.round(height * factor)), context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const {data, dimensions} = await canvasPNG(canvas);
    return {image: {data, mimeType: 'image/png'}, dimensions};
  } finally {bitmap.close?.();}
}
// Numbered boxes over the observed controls in a viewport image, each number
// listed with its ref in the result. The list, not the drawing, is what ties an
// element to a ref; the numbers help find icons and unlabeled controls.
export async function markCapture(image, marks) {
  const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
  const {bitmap, width, height} = await pngCanvas(bytes);
  try {
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const scaleX = width / Math.max(1, marks.viewportWidth), scaleY = height / Math.max(1, marks.viewportHeight);
    context.lineWidth = 2; context.font = 'bold 12px sans-serif'; context.textBaseline = 'top';
    for (const {mark, bounds} of marks.items) {
      const x = Math.round(bounds.x * scaleX), y = Math.round(bounds.y * scaleY), w = Math.round(bounds.width * scaleX), h = Math.round(bounds.height * scaleY);
      context.strokeStyle = '#E4002B'; context.strokeRect(x, y, w, h);
      const label = String(mark), labelWidth = Math.ceil(context.measureText(label).width) + 6;
      const labelY = y >= 16 ? y - 16 : y + h <= height - 16 ? y + h : y;
      context.fillStyle = '#E4002B'; context.fillRect(x, labelY, labelWidth, 16);
      context.fillStyle = '#FFFFFF'; context.fillText(label, x + 3, labelY + 2);
    }
    const {data} = await canvasPNG(canvas);
    return {data, mimeType: 'image/png'};
  } finally {bitmap.close?.();}
}
