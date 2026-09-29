import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';

// Render the approved transparent master at Chrome's icon sizes.
// Provider logos remain separate from the agent's own identity.
const source = `data:image/png;base64,${(await readFile('design/brand/bird-master.png')).toString('base64')}`;
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BINARY || undefined});
try {
  const page = await browser.newPage();
  for (const [name, input] of [['bird', source], ...await Promise.all(['blink', 'wing', 'smile', 'sad'].map(async name => [name, `data:image/png;base64,${(await readFile(`design/brand/bird-${name}.png`)).toString('base64')}`]))]) {
  for (const size of name === 'bird' ? [16, 32, 48, 128, 512] : [512]) {
    const data = await page.evaluate(async ({source, size}) => {
      const img = new Image(); img.src = source; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
      context.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL(size === 512 ? 'image/webp' : 'image/png', .94).split(',')[1];
    }, {source: input, size});
    await writeFile(size === 512 ? `public/icons/agent-${name}.webp` : `public/icons/agent-${size}.png`, Buffer.from(data, 'base64'));
  }
  }
} finally {await browser.close();}
