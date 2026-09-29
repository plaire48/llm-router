// Real Chrome: a page replaces the built-in collections with its own. Measured on a
// public library site whose scripts declare a site-wide `function Map()` with put/get:
// every observation through the debugger came back unavailable, in seventeen of
// seventeen attempts, so the agent could read the page only as plain text.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-builtins-')), extension = resolve(profile, 'extension');
const page = (title, script) => `<!doctype html><html lang="ko"><title>${title}</title><body><script>${script}</script><main><h1>${title}</h1>
<table><caption>자료실 이용시간</caption><tr><th>자료실</th><th>토요일</th></tr><tr><td>디지털도서관</td><td>09:00~18:00</td></tr></table>
<form><label>검색어 <input id="keyword" name="keyword"></label>
<label><input type="checkbox" id="weekend" name="weekend" checked> 주말 포함</label>
<button type="button" id="search" onclick="document.getElementById('result').textContent='검색 완료'">검색</button></form>
<p id="result" role="status"></p><iframe title="안내" srcdoc="<p>별도 안내</p><button>닫기</button>"></iframe></main></body></html>`;
const pages = {
  // The measured case: a site utility that takes the name of the built-in.
  '/own-map': page('이용시간 안내', `function Map(){this.items={};} Map.prototype.put=function(k,v){this.items[k]=v;}; Map.prototype.get=function(k){return this.items[k];};`),
  // Every collection and the static helpers replaced, as old helper libraries do.
  '/own-all': page('이용시간 안내', `window.Map=function(){};window.Set=function(){};window.WeakMap=function(){};window.WeakSet=function(){};
    Array.from=function(list){var out=[];for(var i=0;i<(list.length||0);i++)out.push(list[i]);return out;};
    Object.entries=function(){return [];};Object.fromEntries=function(){return {};};`),
  '/plain': page('이용시간 안내', ''),
};
let mutations = 0;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/mutations') {mutations++; res.end('ok'); return;}
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(pages[path] || pages['/plain']);
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
  const first = await context.newPage(); await first.goto(origin + '/plain');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  for (const path of ['/own-map', '/own-all', '/plain']) for (const attach of [true, false]) {
    const mode = `${path} ${attach ? 'debugger' : 'page script'}`, url = `${origin}${path}?mode=${attach}`;
    const tab = await context.newPage(); await tab.goto(url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    const id = `builtins-${path}-${attach}`;
    const run = async (tool, args = {}) => (await worker.evaluate(({id, tabId, tool, args}) => contentTest.runBrowserAgent(id, {tabId}, tool, args), {id, tabId, tool, args})).result;
    if (attach) await run('verify_page', {checks: [{kind: 'text_present', expected: '이용시간 안내'}]});
    // The test's own Playwright loses objects returned from such a page, so it asks for text.
    const before = JSON.parse(await tab.evaluate(() => JSON.stringify({frames: document.querySelectorAll('iframe').length, nodes: [...document.querySelectorAll('*')].map(el => el.tagName + (el.id ? '#' + el.id : ''))})));
    const snapshot = await run('browser_snapshot');
    const top = snapshot.frames.find(frame => frame.frame === 0);
    assert(top && !top.unavailable, `${mode}: ${JSON.stringify(snapshot.frames.map(frame => ({frame: frame.frame, unavailable: frame.unavailable})))}`);
    const elements = snapshot.frames.flatMap(frame => frame.elements || []);
    const ref = key => {const found = elements.find(el => el.id === key); assert(found?.ref, `${mode} ${key}: ${JSON.stringify(elements.map(el => el.id || el.name))}`); return found.ref;};
    assert(top.text.includes('디지털도서관') && top.text.includes('09:00~18:00'), `${mode}: ${top.text}`);
    assert(snapshot.frames.every(frame => !frame.unavailable), `${mode}: the inner frame is read too`);
    pass(`${mode}: the page and its frame are observed`);

    const checked = await run('verify_page', {checks: [{kind: 'text_present', expected: '디지털도서관'}, {kind: 'control_state', ref: ref('weekend'), expected: 'true'}, {kind: 'field_unchanged', ref: ref('keyword'), expected: 'true'}]});
    assert.equal(checked.verified, true, `${mode}: ${JSON.stringify(checked.checks || checked)}`);
    pass(`${mode}: text, control state and an untouched field are verified`);

    const again = await run('browser_snapshot');
    const filled = await run('fill_form', {fields: [{field_id: again.frames.flatMap(frame => frame.elements || []).find(el => el.id === 'keyword').ref, value: '주말 이용'}]});
    assert.equal(filled.error, undefined, `${mode}: ${JSON.stringify({error: filled.error, reason: filled.reason})}`);
    const after = (filled.observation || await run('browser_snapshot')).frames.flatMap(frame => frame.elements || []);
    const clicked = await run('click_element', {ref: after.find(el => el.id === 'search').ref});
    assert.equal(clicked.error, undefined, `${mode}: ${JSON.stringify({error: clicked.error, reason: clicked.reason})}`);
    assert.equal(await tab.locator('#result').innerText(), '검색 완료');
    assert.equal(await tab.locator('#keyword').inputValue(), '주말 이용');
    pass(`${mode}: a field is filled and a button is clicked`);

    // Reading must leave the page as it was: nothing added, and the page keeps its own Map.
    const left = JSON.parse(await tab.evaluate(() => JSON.stringify({frames: document.querySelectorAll('iframe').length, nodes: [...document.querySelectorAll('*')].map(el => el.tagName + (el.id ? '#' + el.id : '')),
      own: typeof window.Map === 'function' && !/\[native code\]/.test(Function.prototype.toString.call(window.Map))})));
    assert.equal(left.frames, before.frames, `${mode}: no frame is left behind`);
    // The product's own action pointer is shown on purpose after a click.
    const shown = nodes => nodes.filter(name => name !== 'NUBI-ACTION-POINTER');
    assert.deepEqual(shown(left.nodes), shown(before.nodes), `${mode}: no element is left behind`);
    assert.equal(left.own, path !== '/plain', `${mode}: the page's own Map is untouched`);
    pass(`${mode}: the page is left as it was`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {});
    await tab.close();
  }
  console.log(`${count} checks passed`);
} finally {
  await context?.close().catch(() => {});
  server.close();
  await rm(profile, {recursive: true, force: true}).catch(() => {});
}
