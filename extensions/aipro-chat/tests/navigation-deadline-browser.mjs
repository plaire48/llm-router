// Real Chrome: a navigation that the page never finishes must not hold the
// tool, and with it the run, without end. The tool answers at its deadline,
// says that the move was issued, and the page can be observed afterwards.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-deadline-')), extension = resolve(profile, 'extension');
const held = new Set();
const server = createServer((req, res) => {
  if (req.url.startsWith('/hang')) {held.add(res); return;} // Never answered.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="ko"><title>안내</title><body><main><h1>이용 안내 ${req.url}</h1><a href="/second">다음 화면</a></main></body></html>`);
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
    const value = await worker.evaluate(({tabId, tool, args, options}) => contentTest.runBrowserAgent('deadline', {tabId}, tool, args, options), {tabId, tool, args, options});
    return {...value, ms: Date.now() - started};
  };
  assert((await run('browser_snapshot')).result.frames.length > 0);
  const moved = await run('navigate_page', {url: origin + '/second'});
  assert.equal(moved.result.error, undefined, JSON.stringify(moved.result).slice(0, 300)); assert(moved.ms < 15000);
  pass('an ordinary navigation returns its observation');

  const hung = await run('navigate_page', {url: origin + '/hang'}, {navigationDeadlineMs: 2000});
  assert.equal(hung.result.error, 'script_timeout'); assert.equal(hung.result.navigationUnsettled, true); assert.equal(hung.result.actionIssued, true);
  assert.match(hung.result.instruction, /Observe the current page/); assert.equal(hung.tabId, tabId);
  assert(hung.ms >= 1900 && hung.ms < 6000, String(hung.ms));
  pass('a navigation that never finishes is answered at the deadline and says that it was issued');

  for (const response of held) response.destroy();
  await tab.goto(origin + '/guide').catch(() => {});
  const after = await Promise.race([run('browser_snapshot'), new Promise(done => setTimeout(() => done({stuck: true}), 25000))]);
  assert.notEqual(after.stuck, true, 'observation after a missed deadline must not wait without end');
  assert(after.result.frames?.length > 0 || typeof after.result.error === 'string', JSON.stringify(after.result).slice(0, 200));
  pass('the page can be observed after the deadline');

  const back = await Promise.race([run('go_back', {}, {navigationDeadlineMs: 8000}), new Promise(done => setTimeout(() => done({stuck: true}), 20000))]);
  assert.notEqual(back.stuck, true); assert(back.ms < 15000, String(back.ms));
  pass('a history move answers within its deadline');
  await worker.evaluate(() => contentTest.stopBrowserAgent('deadline')).catch(() => {});
  console.log(`DONE ${count}`);
} finally {
  for (const response of held) response.destroy();
  await context?.close().catch(() => {}); server.closeAllConnections?.(); server.close(); await rm(profile, {recursive: true, force: true});
}
