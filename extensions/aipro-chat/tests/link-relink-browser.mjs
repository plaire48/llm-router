// Real Chrome: a re-rendered result list replaces observed anchors with identical
// ones. Exactly one identical anchor may be followed; every other change is stale.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-relink-')), extension = resolve(profile, 'extension');
const html = `<!doctype html><html lang="ko"><title>검색 결과</title><body><main><h1>검색 결과</h1>
<ul id="list">${Array.from({length: 5}, (_, i) => `<li><a href="/dest/${i}?from=list">결과 제목 ${i}</a></li>`).join('')}</ul>
<div id="box"><button type="button" id="more">더보기</button></div></main>
<script>
window.rerender = () => {const list = document.getElementById('list'); list.innerHTML = list.innerHTML; const box = document.getElementById('box'); box.innerHTML = box.innerHTML;};
window.duplicate = () => {window.rerender(); document.getElementById('list').insertAdjacentHTML('beforeend', '<li><a href="/dest/2?from=list">결과 제목 2</a></li>');};
window.retarget = () => {window.rerender(); document.querySelector('a[href^="/dest/2"]').setAttribute('href', '/dest/9?from=list');};
window.retitle = () => {window.rerender(); document.querySelector('a[href^="/dest/2"]').textContent = '다른 제목';};
</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url.startsWith('/dest/') ? `<main><h1>도착 ${req.url}</h1></main>` : html);});
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
  const expected = `${origin}/dest/2?from=list`;
  async function scenario(name, change, attach) {
    const tab = await context.newPage(); await tab.goto(`${origin}/${name}-${attach}`);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, `${origin}/${name}-${attach}`);
    const id = `relink-${name}-${attach}`;
    const run = async (tool, args = {}) => (await worker.evaluate(({id, tabId, tool, args}) => contentTest.runBrowserAgent(id, {tabId}, tool, args), {id, tabId, tool, args})).result;
    // attach=true observes through the debugger, false through the page script.
    if (attach) assert.equal((await run('verify_page', {checks: [{kind: 'link_destination', ref: 'none', expected}]})).verified, false);
    const snapshot = await run('browser_snapshot', {query: '결과 제목 더보기'});
    const elements = snapshot.frames.flatMap(frame => frame.elements || []);
    const link = elements.find(el => el.name === '결과 제목 2'), button = elements.find(el => el.id === 'more');
    assert(link?.ref && button?.ref, JSON.stringify(elements).slice(0, 300));
    await tab.evaluate(change);
    return {tab, run, link, button, close: async () => {await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {}); await tab.close();}};
  }
  for (const attach of [true, false]) {
    let s = await scenario('rerender', 'window.rerender()', attach);
    const verified = await s.run('verify_page', {checks: [{kind: 'link_destination', ref: s.link.ref, expected}]});
    assert.equal(verified.verified, true, JSON.stringify(verified.checks)); assert.equal(verified.checks[0].relinked, true);
    await s.close();
    pass(`${attach ? 'debugger' : 'page script'} observation: an identical re-rendered link is verified and reported as relinked`);

    s = await scenario('click', 'window.rerender()', attach);
    const click = await s.run('click_element', {ref: s.link.ref});
    assert.equal(click.error, undefined, JSON.stringify({error: click.error, reason: click.reason}));
    await s.tab.waitForURL(expected, {timeout: 5000});
    await s.close();
    pass(`${attach ? 'debugger' : 'page script'} observation: clicking the re-rendered link opens the same address`);

    for (const [name, change, label] of [['duplicate', 'window.duplicate()', 'two identical links'], ['retarget', 'window.retarget()', 'a changed address'], ['retitle', 'window.retitle()', 'a changed title']]) {
      s = await scenario(name, change, attach);
      const refused = await s.run('verify_page', {checks: [{kind: 'link_destination', ref: s.link.ref, expected}]});
      assert.equal(refused.verified, false, label); assert.equal(refused.checks[0].reason, 'target_changed', label); assert.equal(refused.checks[0].relinked, undefined);
      await s.close();
      pass(`${attach ? 'debugger' : 'page script'} observation: ${label} stays stale`);
    }
    s = await scenario('button', 'window.rerender()', attach);
    const button = await s.run('click_element', {ref: s.button.ref});
    assert.equal(button.error, 'browser_stale', JSON.stringify({error: button.error}));
    await s.close();
    pass(`${attach ? 'debugger' : 'page script'} observation: a re-rendered button is never followed`);
  }
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
