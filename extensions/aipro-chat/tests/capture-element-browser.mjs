// Real Chrome: images for reading how a control looks. A mail star that only
// turns yellow is one of 60 rows; a 16-pixel icon is not readable at its own
// size. capture_page({ref}) captures that element enlarged, and marks=true
// numbers the observed controls on a viewport image, listed with their refs.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const rows = Array.from({length: 12}, (_, i) => `<div class="row" data-row="${i}"><button type="button" class="star" title="중요">☆</button><span>보낸사람${i}</span> <span>업무 메일 제목 ${i}</span></div>`).join('');
const page = `<!doctype html><html lang="ko"><title>받은 편지함</title><style>body{margin:0;font:14px sans-serif}.row{display:flex;gap:12px;padding:8px;border-bottom:1px solid #ddd}.star{border:0;background:none;font-size:14px;width:18px;height:18px;padding:0}.row.starred .star{color:#e6a700}</style>
<body><h1>받은 편지함</h1><div class="mails">${rows}</div><input type="password" aria-label="비밀번호" value="SECRET_VALUE_1">
<script>document.querySelector('[data-row="3"]').classList.add('starred');</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-capture-element-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, viewport: {width: 1000, height: 700}, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const url = `${origin}/mails`, tab = await context.newPage(); await tab.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  // Runs a tool with vision and keeps the attached image in the worker; returns the result and the image facts.
  const capture = args => worker.evaluate(async ({tabId, args}) => {
    let image;
    const {result} = await contentTest.runBrowserAgent('capture', {tabId}, 'capture_page', args, {vision: true, onCapture: async (_, value) => {image = value; return {availableInChat: true};}});
    if (!image) return {result};
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(image.data), character => character.charCodeAt(0))], {type: image.mimeType}));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let red = 0, yellow = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 200 && pixels[i + 1] < 40 && pixels[i + 2] < 70) red++;
      if (pixels[i] > 200 && pixels[i + 1] > 140 && pixels[i + 1] < 190 && pixels[i + 2] < 60) yellow++;
    }
    return {result, width: bitmap.width, height: bitmap.height, red, yellow};
  }, {tabId, args});

  await worker.evaluate(({tabId}) => contentTest.runBrowserAgent('capture', {tabId}, 'wait_page', {seconds: 0.1}), {tabId});
  const stars = (await worker.evaluate(({tabId}) => contentTest.runBrowserAgent('capture', {tabId}, 'browser_snapshot', {}), {tabId})).result.frames[0].elements.filter(el => el.role === 'button' && el.context?.some(c => /보낸사람3\b/.test(c.name || '')));
  assert.equal(stars.length, 1, 'the star of the fourth row');
  const shot = await capture({ref: stars[0].ref});
  assert.equal(shot.result.capture_mode, 'element', JSON.stringify(shot.result).slice(0, 400));
  assert.equal(shot.result.element.ref, stars[0].ref);
  assert(shot.result.image_scale >= 2, String(shot.result.image_scale));
  assert(shot.width >= 400, `${shot.width}x${shot.height}`);
  assert(shot.yellow > 50, `the enlarged star shows its color: ${shot.yellow} yellow pixels`);
  pass('a small control is captured on its own, enlarged, and its color can be read');

  const plain = await capture({full_page: false}), marked = await capture({full_page: false, marks: true});
  const numbered = (marked.result.visualTargets || []).filter(item => Number.isInteger(item.mark));
  assert(numbered.length >= 12 && numbered.length <= 40, String(numbered.length));
  assert.deepEqual(numbered.map(item => item.mark), numbered.map((_, index) => index + 1));
  assert(numbered.every(item => typeof item.ref === 'string' && item.bounds), 'each number is listed with its ref and bounds');
  assert.equal(plain.red, 0, 'no marks unless asked'); assert(marked.red > 500, String(marked.red));
  assert.deepEqual([marked.width, marked.height], [plain.width, plain.height], 'marks do not change the image size or its coordinates');
  pass('marks number the observed controls on a viewport image, listed with their refs');

  await assert.rejects(capture({full_page: true, marks: true}).then(value => {if (value.result?.error) throw new Error(value.result.error);}), /tool_arguments_invalid/);
  await assert.rejects(capture({ref: stars[0].ref, region: {x: 0, y: 0, width: 10, height: 10}}).then(value => {if (value.result?.error) throw new Error(value.result.error);}), /tool_arguments_invalid/);
  pass('marks need a viewport capture, and an element capture takes no region');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
