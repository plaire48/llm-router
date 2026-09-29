// Real Chrome: mail lists with many rows. Reported: on pages that show many rows
// the agent could not read the right row or click in it, and every step failed.
// Observed here: a checkbox or star in a row carried no row name (a table row
// started with the checkbox cell; list items and plain boxes had no name at all),
// and a clickable row that held a checkbox had no name either.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const mails = Array.from({length: 60}, (_, i) => ({from: i === 41 ? '인사팀' : `보낸사람${i}`, subject: i === 41 ? '10월 교육 일정 안내' : `업무 메일 제목 ${i}`, date: `09/${String(28 - (i % 20)).padStart(2, '0')}`}));
const script = `<script>window.clicks=[];document.addEventListener('click',e=>{const row=e.target.closest('[data-row]');if(row)clicks.push([row.dataset.row,e.target.tagName,e.target.className||e.target.type]);},true);</script>`;
const pages = {
  table: `<table><tbody>${mails.map((m, i) => `<tr data-row="${i}"><td><input type="checkbox" aria-label="선택"></td><td><button class="star" aria-label="중요">☆</button></td><td>${m.from}</td><td><a href="#read-${i}">${m.subject}</a></td><td>${m.date}</td></tr>`).join('')}</tbody></table>`,
  list: `<ul>${mails.map((m, i) => `<li class="item" data-row="${i}"><input type="checkbox"><button class="star">☆</button><span>${m.from}</span> <a href="#read-${i}">${m.subject}</a> <span>${m.date}</span></li>`).join('')}</ul>`,
  boxes: `<div class="mails">${mails.map((m, i) => `<div class="row" data-row="${i}" onclick="this.classList.add('opened')"><span class="chk"><input type="checkbox"></span><span class="from">${m.from}</span> <span class="subject">${m.subject}</span> <span class="date">${m.date}</span><textarea hidden>PRIVATE_DRAFT_${i}</textarea></div>`).join('')}</div>`,
};
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="ko"><title>받은 편지함</title><body><h1>받은 편지함</h1>${pages[req.url.slice(1).split('?')[0]] || ''}${script}</body></html>`);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-rows-')), extension = resolve(profile, 'extension');
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
  const named = (el, text) => el.name?.includes(text) || el.context?.some(c => c.name?.includes(text));
  for (const attach of [true, false]) for (const shape of Object.keys(pages)) {
    const mode = `${shape} ${attach ? 'debugger' : 'page script'}`, url = `${origin}/${shape}?mode=${attach}`;
    const tab = await context.newPage(); await tab.goto(url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
    const id = `rows-${shape}-${attach}`;
    const run = async (tool, args = {}) => (await worker.evaluate(({id, tabId, tool, args}) => contentTest.runBrowserAgent(id, {tabId}, tool, args), {id, tabId, tool, args})).result;
    if (attach) await run('verify_page', {checks: [{kind: 'text_present', expected: '받은 편지함'}]});

    const whole = await run('browser_snapshot');
    assert(!JSON.stringify(whole).includes('PRIVATE_DRAFT'), `${mode}: a field's text never enters a name`);
    const boxes = whole.frames[0].elements.filter(el => el.kind === 'checkbox');
    assert(boxes.length >= 40, `${mode}: ${boxes.length}`);
    assert(boxes.every(el => el.context?.some(c => c.name)), `${mode}: ${JSON.stringify(boxes.find(el => !el.context?.some(c => c.name)))}`);
    assert.equal(new Set(boxes.map(el => el.context.find(c => c.name).name)).size, boxes.length, `${mode}: every row checkbox is told apart`);
    pass(`${mode}: every checkbox carries the words of its own row`);

    const found = (await run('browser_snapshot', {query: '인사팀 10월 교육 일정 안내'})).frames[0].elements;
    const rowControls = found.filter(el => named(el, '인사팀'));
    assert(rowControls.some(el => el.kind === 'checkbox'), `${mode}: ${JSON.stringify(found.slice(0, 3))}`);
    assert(found.slice(0, 4).every(el => named(el, '인사팀') || named(el, '10월 교육')), `${mode}: the row's controls come first: ${JSON.stringify(found.slice(0, 4).map(el => [el.name, el.context]))}`);
    pass(`${mode}: a query by sender and subject finds that row's controls first`);

    const checkbox = rowControls.find(el => el.kind === 'checkbox');
    const clicked = await run('click_element', {ref: checkbox.ref});
    assert.equal(clicked.error, undefined, JSON.stringify({error: clicked.error, reason: clicked.reason}));
    assert.deepEqual(JSON.parse(await tab.evaluate(() => JSON.stringify([...document.querySelectorAll('input[type=checkbox]')].map((box, i) => box.checked ? i : -1).filter(i => i >= 0)))), [41]);
    if (shape === 'boxes') {
      const row = (await run('browser_snapshot', {query: '인사팀 10월 교육 일정 안내'})).frames[0].elements.find(el => el.kind !== 'checkbox' && named(el, '10월 교육'));
      assert(row, 'the clickable row itself is named by its words');
      const opened = await run('click_element', {ref: row.ref});
      assert.equal(opened.error, undefined, JSON.stringify({error: opened.error, reason: opened.reason}));
      assert.deepEqual(JSON.parse(await tab.evaluate(() => JSON.stringify([...document.querySelectorAll('.row.opened')].map(el => el.dataset.row)))), ['41']);
    }
    pass(`${mode}: the click lands in that row only`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {}); await tab.close();
  }
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
