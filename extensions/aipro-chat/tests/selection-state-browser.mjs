// Real Chrome: an applied tab, option or navigation entry states its selection
// as aria-selected or aria-current, and a result link hides its query in the
// observation. Both must be verifiable; a link marked only by a class must say
// that it exposes no state instead of failing the same way on every retry, and
// can be checked by the state word in its class.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-selection-')), extension = resolve(profile, 'extension');
const html = `<!doctype html><html lang="ko"><title>뉴스 검색</title><body>
<nav aria-label="검색 종류"><a href="/all" id="all">전체 보기</a> <a href="/news" id="news" aria-current="page">뉴스 보기</a></nav>
<div role="tablist" aria-label="정렬"><a role="tab" href="/news?sort=rel" id="rel" aria-selected="false">관련도순</a> <a role="tab" href="/news?sort=date" id="date" aria-selected="true">최신순</a></div>
<div aria-label="기간"><a href="/news?p=all" id="pall">전체 기간</a> <a href="/news?p=1w" id="p1w" class="on" style="font-weight:bold">최근 일주일</a></div>
<main><h1>뉴스 검색 결과</h1><p>적용된 기간: 최근 일주일</p>
<ul><li><a href="/article/7?utm_source=list&amp;session=PRIVATE_TRACKING" id="article">첫 번째 기사 제목</a></li></ul></main></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);});
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
    const mode = attach ? 'debugger' : 'page script', url = `${origin}/news?mode=${attach}`;
    const tab = await context.newPage(); await tab.goto(url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    const id = `selection-${attach}`;
    const run = async (tool, args = {}) => (await worker.evaluate(({id, tabId, tool, args}) => contentTest.runBrowserAgent(id, {tabId}, tool, args), {id, tabId, tool, args})).result;
    if (attach) await run('verify_page', {checks: [{kind: 'text_present', expected: '뉴스 검색 결과'}]});
    const observe = async () => (await run('browser_snapshot', {})).frames.flatMap(frame => frame.elements || []);
    let elements = await observe();
    const ref = key => {const found = elements.find(el => el.id === key); assert(found?.ref, `${key}: ${JSON.stringify(elements.map(el => el.id))}`); return found.ref;};
    assert.equal(elements.find(el => el.id === 'news').current, true); assert.equal(elements.find(el => el.id === 'date').selected, true);

    const applied = await run('verify_page', {checks: [{kind: 'control_state', ref: ref('date'), expected: 'true'}, {kind: 'control_state', ref: ref('rel'), expected: 'false'},
      {kind: 'control_state', ref: ref('news'), expected: 'true'}]});
    assert.equal(applied.verified, true, JSON.stringify(applied.checks));
    pass(`${mode}: a selected tab and the current navigation entry are verified by control_state`);

    elements = await observe();
    const wrong = await run('verify_page', {checks: [{kind: 'control_state', ref: ref('rel'), expected: 'true'}]});
    assert.equal(wrong.verified, false); assert.equal(wrong.checks[0].reason, undefined, JSON.stringify(wrong.checks));
    pass(`${mode}: an unselected tab does not pass as selected`);

    elements = await observe();
    const bare = await run('verify_page', {checks: [{kind: 'control_state', ref: ref('p1w'), expected: 'true'}]});
    assert.equal(bare.verified, false); assert.equal(bare.checks[0].reason, 'check_target_incompatible');
    assert.deepEqual(bare.checks[0].exposedStates, []); assert.match(bare.checks[0].instruction, /text_present/);
    assert.deepEqual(bare.checks[0].stateWords, {own: ['on'], row: []}); assert.match(bare.checks[0].instruction, /control_state with one of them/);
    pass(`${mode}: a link marked only by a class reports that it exposes no state, with the state word in its class`);

    elements = await observe();
    const word = await run('verify_page', {checks: [{kind: 'control_state', ref: ref('p1w'), expected: 'on'}, {kind: 'control_state', ref: ref('pall'), expected: 'on'}]});
    assert.deepEqual(word.checks.map(check => check.passed), [true, false], JSON.stringify(word.checks));
    pass(`${mode}: the class state word checks the applied period and not the other one`);

    elements = await observe();
    const shown = elements.find(el => el.id === 'article').destination;
    assert.equal(shown, `${origin}/article/7`); assert(!JSON.stringify(elements).includes('PRIVATE_TRACKING'));
    // link_destination with the shown destination is compared as a display reference; its own query is compared exactly.
    const display = await run('verify_page', {checks: [{kind: 'link_destination', ref: ref('article'), expected: shown}]});
    assert.equal(display.verified, true, JSON.stringify(display.checks)); assert.equal(display.checks[0].queryCompared, false);
    elements = await observe();
    const exact = await run('verify_page', {checks: [{kind: 'link_destination', ref: ref('article'), expected: `${shown}?utm_source=other`}]});
    assert.equal(exact.verified, false); assert.equal(exact.checks[0].reason, 'url_query_mismatch');
    elements = await observe();
    const page = await run('verify_page', {checks: [{kind: 'link_page_is', ref: ref('article'), expected: shown}, {kind: 'text_present', expected: '적용된 기간: 최근 일주일'}]});
    assert.equal(page.verified, true, JSON.stringify(page.checks));
    assert.equal(page.checks[0].queryCompared, false); assert(!JSON.stringify(page.checks).includes('PRIVATE_TRACKING'));
    elements = await observe();
    const other = await run('verify_page', {checks: [{kind: 'link_page_is', ref: ref('article'), expected: `${origin}/article/8`}]});
    assert.equal(other.verified, false); assert.equal(other.checks[0].reason, 'url_path_mismatch');
    pass(`${mode}: the shown destination of a link with a hidden query is verified, an invented query is not`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {}); await tab.close();
  }
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
