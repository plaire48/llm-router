// Real Chrome: a query whose words the page does not use. Measured: the observation
// returned four controls and no text, the model took the page for empty and asked
// the user which page to use.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-unmatched-')), extension = resolve(profile, 'extension');
const html = `<!doctype html><html lang="ko"><title>검색 결과</title><body><main><h1>국립중앙박물관 검색 결과</h1>
<button id="filter">필터</button><ul><li><a href="/v1">반가사유상, 공감과 울림의 시작</a> 국립중앙박물관</li><li><a href="/v2">사유의 방 안내</a> 국립중앙박물관</li></ul></main></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url.startsWith('/empty') ? '<!doctype html><title>빈 화면</title><body><main></main></body>' : html);});
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
  for (const attach of [true, false]) {
    const mode = attach ? 'debugger' : 'page script', url = `${origin}/results?mode=${attach}`;
    const tab = await context.newPage(); await tab.goto(url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    const id = `unmatched-${attach}`;
    const run = async (tool, args = {}) => (await worker.evaluate(({id, tabId, tool, args}) => contentTest.runBrowserAgent(id, {tabId}, tool, args), {id, tabId, tool, args})).result;
    if (attach) {await run('browser_snapshot'); await run('navigate_page', {url: url + '&again=1'});}
    const missed = (await run('browser_snapshot', {query: '업로드 날짜 정렬 동영상'})).frames[0];
    assert.equal(missed.text, '', `${mode}: ${missed.text}`);
    assert(missed.queryUnmatched, `${mode}: ${JSON.stringify(Object.keys(missed))}`);
    assert(missed.queryUnmatched.pageTextCharacters > 20); assert(missed.queryUnmatched.controlsObserved >= 3);
    assert.match(missed.queryUnmatched.instruction, /not empty/); assert.match(missed.queryUnmatched.instruction, /without a query/);
    pass(`${mode}: a query that matches nothing says that the page is not empty`);
    const found = (await run('browser_snapshot', {query: '반가사유상'})).frames[0];
    assert.match(found.text, /반가사유상/); assert.equal(found.queryUnmatched, undefined);
    const whole = (await run('browser_snapshot')).frames[0];
    assert.match(whole.text, /사유의 방 안내/); assert.equal(whole.queryUnmatched, undefined);
    pass(`${mode}: a query that matches, and an observation without a query, are as before`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {}); await tab.close();

    const blank = await context.newPage(); await blank.goto(`${origin}/empty?mode=${attach}`);
    const blankId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, `${origin}/empty?mode=${attach}`);
    const empty = (await worker.evaluate(({id, tabId}) => contentTest.runBrowserAgent(id, {tabId}, 'browser_snapshot', {query: '정렬'}), {id: `blank-${attach}`, tabId: blankId})).result.frames[0];
    assert.equal(empty.queryUnmatched, undefined, 'a page without text is not called non-empty');
    pass(`${mode}: a page that has no text is not reported as unmatched`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), `blank-${attach}`).catch(() => {}); await blank.close();
  }
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
