import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';

// Trim transparent export padding and size the approved Korean wordmark for the header.
const source = `data:image/png;base64,${(await readFile('design/brand/nubi-wordmark-condensed.png')).toString('base64')}`;
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BINARY || undefined});
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = image.width; sourceCanvas.height = image.height;
    const sourceContext = sourceCanvas.getContext('2d'); sourceContext.drawImage(image, 0, 0);
    const {data} = sourceContext.getImageData(0, 0, image.width, image.height);
    let left = image.width, right = 0, top = image.height, bottom = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (data[(y * image.width + x) * 4 + 3] > 16) {left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);}
    }
    left = Math.max(0, left - 2); top = Math.max(0, top - 2); right = Math.min(image.width - 1, right + 2); bottom = Math.min(image.height - 1, bottom + 2);
    const canvas = document.createElement('canvas'); canvas.width = 336; canvas.height = 192;
    const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
    context.drawImage(image, left, top, right - left + 1, bottom - top + 1, 0, 0, canvas.width, canvas.height);
    return {image: canvas.toDataURL('image/webp', .97).split(',')[1], bounds: {left, top, right, bottom}};
  }, source);
  await writeFile('public/icons/nubi-wordmark.webp', Buffer.from(result.image, 'base64'));
  console.log(result.bounds);
} finally {await browser.close();}
