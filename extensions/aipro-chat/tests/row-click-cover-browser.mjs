// Real Chrome: clicks in mail-list rows that another element covers. Reported
// from a mail app: "the click keeps being blocked", then a retry with Enter.
// Shapes: a transparent link stretched over the row, the row's own layer over
// its link, a link that takes no pointer events, a fixed toolbar and a
// sticky table header over the row, tools a row shows on hover (beside, over
// the middle, over all of it), a checkbox drawn over by its own box, and a mail
// whose subject ends with an approval word. The row must open, and a different
// control (delete, sort) must never be pressed.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const mails = Array.from({length: 40}, (_, i) => ({from: i === 27 ? '인사팀' : `보낸사람${i}`, subject: i === 27 ? '10월 교육 일정 안내' : `업무 메일 제목 ${i}`}));
const record = `<script>window.events=[];document.addEventListener('click',e=>{const row=e.target.closest('[data-row]');events.push({row:row?.dataset.row??null,tag:e.target.tagName,cls:String(e.target.className||''),trusted:e.isTrusted});},true);</script>`;
const tools = style => `<style>.row{position:relative;display:flex;gap:12px;padding:10px;border-bottom:1px solid #ddd;cursor:pointer}.tools{display:none;position:absolute;${style};background:#fff}.row:hover .tools{display:flex}.delete{flex:1}</style>
${mails.map((m, i) => `<div class="row" data-row="${i}" onclick="this.dataset.opened='1'"><span class="from">${m.from}</span><span class="subject" style="flex:1">${m.subject}</span><span class="date">09/28</span><span class="tools"><button class="delete" onclick="event.stopPropagation();this.closest('.row').dataset.deleted='1'">삭제</button></span></div>`).join('')}`;
const shapes = {
  // An unlabeled link stretched over the row covers the subject link.
  stretched: {page: `<style>.row{position:relative;display:flex;gap:12px;padding:8px;border-bottom:1px solid #ddd}.cover{position:absolute;inset:0;z-index:1}</style>
${mails.map((m, i) => `<div class="row" data-row="${i}"><a class="cover" href="#open-${i}" aria-hidden="true" tabindex="-1"></a><span class="from">${m.from}</span><a class="subject" href="#open-${i}">${m.subject}</a></div>`).join('')}`, opens: '#open-27'},
  // Such a link that goes elsewhere but is named after the mail still opens it.
  stretchedname: {page: `<style>.row{position:relative;display:flex;gap:12px;padding:8px;border-bottom:1px solid #ddd}.cover{position:absolute;inset:0;z-index:1}</style>
${mails.map((m, i) => `<div class="row" data-row="${i}"><a class="cover" href="#read-${i}" aria-hidden="true" tabindex="-1" aria-label="${m.subject} 열기"></a><span class="from">${m.from}</span><a class="subject" href="#open-${i}">${m.subject}</a></div>`).join('')}`, opens: '#read-27'},
  // A covering link for another action is not pressed in the subject's place.
  stretchedother: {page: `<style>.row{position:relative;display:flex;gap:12px;padding:8px;border-bottom:1px solid #ddd}.cover{position:absolute;inset:0;z-index:1}</style>
${mails.map((m, i) => `<div class="row" data-row="${i}"><a class="cover" href="#spam-${i}" aria-hidden="true" tabindex="-1" aria-label="스팸 신고"></a><span class="from">${m.from}</span><a class="subject" href="#open-${i}">${m.subject}</a></div>`).join('')}`, refused: {kind: 'same_row', name: '스팸 신고'}},
  // The row draws a layer over its own link (::after), and the list handles clicks.
  rowlayer: {page: `<style>li.row{position:relative;list-style:none;padding:8px;border-bottom:1px solid #ddd}li.row::after{content:'';position:absolute;inset:0}</style>
<ul class="mails">${mails.map((m, i) => `<li class="row" data-row="${i}"><span class="from">${m.from}</span> <a href="#open-${i}">${m.subject}</a></li>`).join('')}</ul>
<script>document.querySelector('.mails').addEventListener('click',e=>{const row=e.target.closest('li');if(row){row.dataset.opened='1';location.hash='open-'+row.dataset.row;}});</script>`, opens: '#open-27', opened: true},
  // A link that takes no pointer events: the row under it handles the click.
  nopointer: {page: `<style>.row{padding:8px;border-bottom:1px solid #ddd;cursor:pointer}.row a{pointer-events:none}</style>
${mails.map((m, i) => `<div class="row" data-row="${i}" onclick="this.dataset.opened='1'"><span class="from">${m.from}</span> <a href="#open-${i}">${m.subject}</a></div>`).join('')}`, opened: true},
  // A fixed toolbar sits over the row.
  toolbar: {page: `<style>body{margin:0}.bar{position:fixed;top:0;left:0;right:0;height:64px;background:#fff;border-bottom:1px solid #999;z-index:5}.list{padding-top:64px}.row{padding:10px;border-bottom:1px solid #ddd}</style>
<div class="bar"><button id="delete-selected">선택 삭제</button></div><div class="list">${mails.map((m, i) => `<div class="row" data-row="${i}"><a href="#open-${i}">${m.from} · ${m.subject}</a></div>`).join('')}</div>`,
  before: () => {const row = document.querySelector('[data-row="27"]'); scrollTo(0, row.getBoundingClientRect().top + scrollY - 10);}, opens: '#open-27'},
  // A sticky table header with a sort button sits over the row.
  sticky: {page: `<style>.scroller{height:300px;overflow:auto}th{position:sticky;top:0;background:#fff;z-index:2;height:40px}td{padding:10px}</style>
<div class="scroller"><table><thead><tr><th><button class="sort">정렬</button> 보낸사람</th><th>제목</th></tr></thead><tbody>${mails.map((m, i) => `<tr data-row="${i}" style="cursor:pointer" onclick="this.dataset.opened='1'"><td>${m.from}</td><td>${m.subject}</td></tr>`).join('')}</tbody></table></div>`,
  before: () => {const scroller = document.querySelector('.scroller'), row = document.querySelector('[data-row="27"]'); scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 10;}, opened: true},
  // Tools shown on hover: beside the words, over the middle, over all of the row.
  hover: {page: tools('right:0;top:0;bottom:0'), opened: true},
  hoverwide: {page: tools('left:20%;right:20%;top:0;bottom:0'), opened: true},
  hoverall: {page: tools('inset:0'), refused: {kind: 'inside_target', name: '삭제'}},
  // A styled checkbox: its own box is drawn over the native input.
  checkbox: {page: `<style>.row{display:flex;gap:12px;padding:8px;border-bottom:1px solid #ddd}.chk{position:relative;display:inline-block;width:18px;height:18px}.chk input{margin:0;width:18px;height:18px}.box{position:absolute;inset:0;border:1px solid #333;background:#fff}</style>
${mails.map((m, i) => `<div class="row" data-row="${i}"><label class="chk"><input type="checkbox" aria-label="선택"><span class="box"></span></label><span class="from">${m.from}</span><span class="subject">${m.subject}</span></div>`).join('')}`, checkbox: true},
  // A star that only turns yellow: its row gains a class, the star keeps its text.
  // After one click the row must read as starred, so nobody clicks it again.
  star: {page: `<style>.row{display:flex;gap:12px;padding:8px;border-bottom:1px solid #ddd}.row.starred .star{color:#e6a700}</style><div class="mails">
${mails.map((m, i) => `<div class="row" data-row="${i}"><button type="button" class="star" title="중요">☆</button><span class="from">${m.from}</span> <span class="subject">${m.subject}</span></div>`).join('')}</div>
<script>document.querySelector('.mails').addEventListener('click',e=>{if(e.target.closest('.star'))e.target.closest('.row').classList.toggle('starred');});</script>`,
    pick: el => el.role === 'button' && ['☆', '중요'].includes(el.name) && named(el, '인사팀'),
    check: async run => {
      const snapshot = await run('browser_snapshot', {query: '인사팀 10월 교육 일정 안내'});
      const elements = snapshot.frames?.[0]?.elements || [];
      if (!elements.length) console.log('SNAPSHOT', JSON.stringify(snapshot).slice(0, 1500));
      const star = elements.find(el => el.role === 'button' && ['☆', '중요'].includes(el.name) && named(el, '인사팀'));
      assert.deepEqual(star?.context?.find(c => c.name?.includes('인사팀'))?.state, ['starred'], JSON.stringify(star || elements.slice(0, 3)).slice(0, 900));
    }},
  // A long mail caption that ends with an approval word only opens the mail.
  approval: {page: `<div class="list">${mails.map((m, i) => `<div data-row="${i}"><a class="mail" href="#open-${i}">${m.from} · ${i === 27 ? '[결재] 2026년 10월 휴가 신청 승인' : m.subject}</a></div>`).join('')}</div>`,
    query: '인사팀 휴가 신청 승인', words: '휴가 신청', opens: '#open-27'},
};
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="ko"><title>받은 편지함</title><body><h1>받은 편지함</h1>${shapes[req.url.slice(1).split('?')[0]]?.page || ''}${record}</body></html>`);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-row-cover-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
const named = (el, text) => el.name?.includes(text) || el.context?.some(c => c.name?.includes(text));
const only = new Set(process.argv.slice(2));
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, viewport: {width: 1000, height: 600}, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const failures = [];
  for (const [shape, spec] of Object.entries(shapes)) {
    if (only.size && !only.has(shape)) continue;
    const url = `${origin}/${shape}`;
    const tab = await context.newPage(); await tab.goto(url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
    const id = `cover-${shape}`;
    const run = async (tool, args = {}) => (await worker.evaluate(({id, tabId, tool, args}) => contentTest.runBrowserAgent(id, {tabId}, tool, args), {id, tabId, tool, args})).result;
    try {
      await run('verify_page', {checks: [{kind: 'text_present', expected: '받은 편지함'}]});
      const found = (await run('browser_snapshot', {query: spec.query || '인사팀 10월 교육 일정 안내'})).frames[0].elements;
      const target = found.find(spec.pick || (el => named(el, spec.words || '10월 교육') && (spec.checkbox ? el.kind === 'checkbox' && named(el, '인사팀') : el.kind !== 'checkbox')));
      assert(target, `${shape}: ${JSON.stringify(found.slice(0, 3))}`);
      if (spec.before) await tab.evaluate(spec.before);
      const clicked = await run('click_element', {ref: target.ref});
      const events = JSON.parse(await tab.evaluate(() => JSON.stringify(events)));
      assert(!events.some(event => /delete|sort/.test(event.cls) || event.tag === 'BUTTON' && !spec.pick), `${shape}: another control was pressed: ${JSON.stringify(events)}`);
      assert(!/spam/.test(new URL(tab.url()).hash), `${shape}: another link was followed`);
      assert.equal(await tab.evaluate(() => document.querySelectorAll('[data-deleted]').length), 0, `${shape}: nothing was deleted`);
      if (spec.refused) {
        assert.equal(clicked.reason, 'script_obscured', `${shape}: ${JSON.stringify({error: clicked.error, reason: clicked.reason})}`);
        assert.equal(clicked.actionIssued, false);
        assert.equal(clicked.blocker?.kind, spec.refused.kind, JSON.stringify(clicked.blocker));
        assert.equal(clicked.blocker?.name, spec.refused.name);
        assert.equal(events.length, 0, JSON.stringify(events));
        assert.equal(new URL(tab.url()).hash, '', 'no link was followed');
        pass(`${shape}: a target covered everywhere by another control is not clicked, and the result names that control`);
      } else {
        assert.equal(clicked.error, undefined, `${shape}: ${JSON.stringify({error: clicked.error, reason: clicked.reason, blocker: clicked.blocker, instruction: clicked.instruction})}`);
        assert(events.length >= 1 && events.every(event => event.row === '27') && events.some(event => event.trusted), `${shape}: ${JSON.stringify(events)}`);
        if (spec.opens) assert.equal(new URL(tab.url()).hash, spec.opens);
        if (spec.opened) assert.deepEqual(JSON.parse(await tab.evaluate(() => JSON.stringify([...document.querySelectorAll('[data-opened]')].map(el => el.dataset.row)))), ['27']);
        if (spec.check) await spec.check(run);
        if (spec.checkbox) assert.deepEqual(JSON.parse(await tab.evaluate(() => JSON.stringify([...document.querySelectorAll('input[type=checkbox]')].map((box, i) => box.checked ? i : -1).filter(i => i >= 0)))), [27]);
        pass(`${shape}: the row is acted on with one trusted click and nothing else is pressed`);
      }
    } catch (error) {failures.push(error); console.log(`FAIL ${shape}: ${String(error.message).split('\n')[0].slice(0, 400)}`);}
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {}); await tab.close();
  }
  if (failures.length) throw failures[0];
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
