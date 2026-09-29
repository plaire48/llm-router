// Real Chrome: a page whose own files arrive slowly. Measured on a public library
// site: the new address and title were there, the navigation tool waited out its
// time and reported a failure that had issued nothing, with an empty observation.
// The tool now reports the page as opened and still loading, with what has loaded.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-slow-')), extension = resolve(profile, 'extension');
const held = new Set();
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/slow.js') {held.add(res); return;} // A file of the page itself that does not arrive.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (path === '/slow') return res.end(`<!doctype html><html lang="ko"><title>주간이용</title><body><main><h1>주간이용 안내</h1>
<table><tr><th>자료실</th><th>토요일</th></tr><tr><td>디지털도서관</td><td>09:00~18:00</td></tr></table><a href="/next">다음</a></main>
<script src="/slow.js"></script><p>늦게 나오는 안내</p></body></html>`);
  res.end(`<!doctype html><html lang="ko"><title>안내</title><body><main><h1>이용 안내 ${path}</h1><a href="/slow">주간이용</a></main></body></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp('dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const tab = await context.newPage(); await tab.goto(origin + '/guide');
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, origin + '/guide');
  const run = async (tool, args = {}, options = {}) => {
    const started = Date.now();
    const value = await worker.evaluate(({tabId, tool, args, options}) => contentTest.runBrowserAgent('slow', {tabId}, tool, args, options), {tabId, tool, args, options});
    return {...value, ms: Date.now() - started};
  };
  assert((await run('browser_snapshot')).result.frames.length > 0);
  const quick = await run('navigate_page', {url: origin + '/second'}, {navigationLoadMs: 3000});
  assert.equal(quick.result.error, undefined, JSON.stringify(quick.result).slice(0, 300));
  assert.equal(quick.result.navigationUnsettled, undefined); assert.equal(quick.result.instruction, undefined);
  assert(quick.result.observation.frames[0].text.includes('이용 안내'));
  pass('a page that finishes loading is reported as before');

  const slow = await run('navigate_page', {url: origin + '/slow'}, {navigationLoadMs: 3000});
  assert.equal(slow.result.error, undefined, JSON.stringify(slow.result).slice(0, 300));
  assert.equal(slow.result.navigationUnsettled, true);
  assert.match(slow.result.instruction, /still loading/); assert.match(slow.result.instruction, /Do not open the same address again/);
  assert.equal(slow.result.observation.url, origin + '/slow'); assert.equal(slow.result.observation.title, '주간이용');
  const top = slow.result.observation.frames[0];
  assert(!top.unavailable && top.text.includes('디지털도서관') && top.text.includes('09:00~18:00'), JSON.stringify(top).slice(0, 300));
  assert(!top.text.includes('늦게 나오는 안내'), 'what has not loaded is not invented');
  assert(top.elements.some(element => element.name === '다음'));
  assert(slow.ms >= 2500 && slow.ms < 9000, String(slow.ms));
  pass('a page that is still loading is reported as opened, with what has loaded so far');

  const checked = await run('verify_page', {checks: [{kind: 'text_present', expected: '디지털도서관'}, {kind: 'url_page_is', expected: origin + '/slow'}]});
  assert.equal(checked.result.verified, true, JSON.stringify(checked.result.checks));
  pass('the loaded part can be verified');

  const moved = await run('navigate_page', {url: origin + '/third'}, {navigationLoadMs: 3000});
  assert.equal(moved.result.error, undefined, JSON.stringify(moved.result).slice(0, 300));
  assert.equal(moved.result.observation.url, origin + '/third'); assert.equal(moved.result.navigationUnsettled, undefined);
  pass('the run moves on from a page that never finished');

  const back = await Promise.race([run('go_back', {}, {navigationLoadMs: 3000}), new Promise(done => setTimeout(() => done({stuck: true}), 20000))]);
  assert.notEqual(back.stuck, true); assert.equal(back.result.error, undefined, JSON.stringify(back.result).slice(0, 300));
  assert.equal(back.result.observation.url, origin + '/slow'); assert.equal(back.result.navigationUnsettled, true);
  assert(back.result.observation.frames[0].text.includes('디지털도서관'));
  pass('going back to the slow page reports it the same way');
  await worker.evaluate(() => contentTest.stopBrowserAgent('slow')).catch(() => {});
  console.log(`DONE ${count}`);
} finally {
  for (const response of held) response.destroy();
  await context?.close().catch(() => {}); server.closeAllConnections?.(); server.close(); await rm(profile, {recursive: true, force: true});
}
