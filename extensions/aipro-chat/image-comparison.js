import {imageFile, IMAGE_FILE_LIMIT} from './image-files.js';

// Runs in the extension document. No website scripts, CSP or image URLs are
// involved. Only the finished, numbered PNG is returned to the agent context.
export async function imageComparison(result, signal) {
  const {files = [], candidates = []} = result;
  if (!candidates.length || candidates.length > 12 || files.length > 12) return {error: 'image_unavailable'};
  const canvas = document.createElement('canvas'), columns = Math.min(4, candidates.length);
  canvas.width = columns * 160; canvas.height = Math.ceil(candidates.length / columns) * 180;
  const context = canvas.getContext('2d'), rendered = []; let total = 0;
  context.fillStyle = '#f1f7fe'; context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, candidate] of candidates.entries()) {
    if (signal.aborted) throw new Error('cancelled');
    let url, timer, image;
    try {
      const source = files.find(file => file.ref === candidate.ref);
      if (!source || candidate.error) throw new Error('image_unavailable');
      const file = imageFile(source.data); total += file.bytes.length;
      if (total > IMAGE_FILE_LIMIT) throw new Error('image_too_large');
      url = URL.createObjectURL(new Blob([file.bytes], {type: file.mimeType}));
      image = new Image();
      await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('image_unavailable')), 5000);
        image.onload = resolve; image.onerror = () => reject(new Error('image_unavailable')); image.src = url;
      });
      const x = index % columns * 160 + 8, y = Math.floor(index / columns) * 180 + 8;
      const scale = Math.min(128 / image.naturalWidth, 128 / image.naturalHeight);
      context.fillStyle = '#ffffff'; context.fillRect(x, y, 144, 144);
      context.drawImage(image, x + (144 - image.naturalWidth * scale) / 2, y + (144 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
      context.fillStyle = '#191f28'; context.font = '16px sans-serif'; context.fillText(String(candidate.number), x + 66, y + 163);
      rendered.push(candidate);
    } catch {rendered.push({...candidate, error: 'image_unavailable'});}
    finally {clearTimeout(timer); if (url) URL.revokeObjectURL(url); if (image) image.src = '';}
  }
  if (signal.aborted) throw new Error('cancelled');
  if (!rendered.some(candidate => !candidate.error)) return {error: 'image_unavailable'};
  return {candidates: rendered, image: {mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1]},
    instruction: 'Numbered thumbnails of actual observed page assets. Match shapes/colors to the user description. This is not a screenshot or a click coordinate map. Use only successful refs. Attach a clear match; ask_user with 2-4 plausible image_refs if ambiguous. A filename is not visual proof. Never attach this comparison sheet as the requested original image.'};
}
