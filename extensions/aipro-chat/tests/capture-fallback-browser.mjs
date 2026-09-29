// Real Chrome: a page too long for one image. Reported from a company work
// system: the capture step ended in an error. The whole page is captured in
// sections, joined into one image and reduced to fit the image budget.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const rows = Array.from({length: 1400}, (_, i) => `<tr><td>업무 항목 ${i + 1}</td>${Array.from({length: 7}, () => '<td><input size="3"></td>').join('')}</tr>`).join('');
const html = `<!doctype html><html lang="ko"><title>긴 공수표</title><body style="margin:0"><h1>주간 공수 입력</h1><table style="width:3000px">${rows}</table></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url.startsWith('/short') ? '<!doctype html><title>짧은 화면</title><body><h1>짧은 화면</h1></body>' : html);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-capture-fallback-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp('dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, viewport: {width: 1200, height: 800}, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const tab = await context.newPage(); await tab.goto(origin + '/long');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, origin + '/long');
  const run = async (tool, args = {}) => (await worker.evaluate(({tabId, tool, args}) => contentTest.runBrowserAgent('capture-fallback', {tabId}, tool, args, {vision: true}), {tabId, tool, args})).result;
  const pageSize = JSON.parse(await tab.evaluate(() => JSON.stringify({width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight})));
  assert(pageSize.width * pageSize.height > 32 * 1024 * 1024, JSON.stringify(pageSize));
  await run('browser_snapshot');
  const full = await run('capture_page');
  assert.equal(full.error, undefined, JSON.stringify({error: full.error, reason: full.reason}));
  assert.equal(full.capture_mode, 'page');
  const ratio = pageSize.height / pageSize.width, imageRatio = full.height / full.width;
  assert(Math.abs(ratio - imageRatio) / ratio < 0.02, JSON.stringify({pageSize, image: [full.width, full.height]}));
  assert(full.width * full.height <= 32 * 1024 * 1024 && full.image.data.length <= 6000000);
  assert(full.image_scale > 0 && full.image_scale < 1, String(full.image_scale)); assert.match(full.scale_note, /reduced to fit one image/);
  const png = Buffer.from(full.image.data, 'base64');
  assert.equal(png.readUInt32BE(16), full.width); assert.equal(png.readUInt32BE(20), full.height);
  // The last rows are in the image: its bottom band is not blank.
  const pixels = await tab.evaluate(async data => {const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, 40), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, bitmap.height - 40, bitmap.width, 40, 0, 0, bitmap.width, 40);
    const values = context.getImageData(0, 0, Math.min(400, bitmap.width), 40).data; let dark = 0; for (let i = 0; i < values.length; i += 4) if (values[i] < 128) dark++; return dark;}, full.image.data);
  assert(pixels > 20, `bottom band dark pixels ${pixels}`);
  pass('a page too large for one image is captured whole, joined from sections and reduced to fit');
  const explicit = await run('capture_page', {full_page: false});
  assert.equal(explicit.capture_mode, 'viewport'); assert.equal(explicit.width, 1200);
  await run('navigate_page', {url: origin + '/short'});
  const short = await run('capture_page');
  assert.equal(short.capture_mode, 'page');
  pass('a requested viewport capture and a page that fits are captured as before');
  await worker.evaluate(() => contentTest.stopBrowserAgent('capture-fallback')).catch(() => {});
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
