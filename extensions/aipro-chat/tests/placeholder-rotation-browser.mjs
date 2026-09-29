// Real Chrome: a search box whose only name is a rotating placeholder must stay
// usable, while a control whose authored name changes must still be refused.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-placeholder-')), extension = resolve(profile, 'extension');
const html = `<!doctype html><html lang="ko"><title>포털</title><body><main><h1>포털</h1>
<form onsubmit="event.preventDefault();result.textContent='검색: '+query.value"><input id="query" type="search" placeholder="추천 검색어 0"><button type="submit">검색</button></form>
<button type="button" id="action" aria-label="저장">실행</button><output id="result"></output></main>
<script>let n=0;setInterval(()=>{query.placeholder='추천 검색어 '+(++n);},150);</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  await cp('dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const page = await context.newPage(); await page.goto(origin);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  const tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === origin + '/').id, origin);
  const run = async (name, args = {}) => (await worker.evaluate(({tabId, name, args}) => contentTest.runBrowserAgent('placeholder', {tabId}, name, args), {tabId, name, args})).result;
  const snapshot = await run('browser_snapshot', {query: '검색'});
  const field = snapshot.frames[0].elements.find(el => el.id === 'query'); assert(field?.ref, JSON.stringify(snapshot).slice(0, 400));
  await page.waitForTimeout(500);
  const fill = await run('fill_form', {fields: [{field_id: field.ref, value: '국립중앙박물관 관람시간'}]});
  assert.equal(fill.error, undefined, JSON.stringify({error: fill.error, reason: fill.reason}));
  assert.equal(await page.locator('#query').inputValue(), '국립중앙박물관 관람시간');
  console.log('PASS a field named only by a rotating placeholder accepts input through its observed ref');
  const again = await run('browser_snapshot', {query: '저장'});
  const action = again.frames[0].elements.find(el => el.id === 'action'); assert(action?.ref);
  await page.locator('#action').evaluate(el => el.setAttribute('aria-label', '삭제'));
  const click = await run('click_element', {ref: action.ref});
  assert.equal(click.error, 'browser_stale', JSON.stringify({error: click.error}));
  console.log('PASS a control whose authored name changed is still refused');
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
