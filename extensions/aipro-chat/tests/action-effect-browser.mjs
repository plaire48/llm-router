// Real Chrome: every action result says what the action changed on the page,
// compared with the observation the model acted on. A star that only changes a
// class, a dialog that opens and closes, a status line, fields that appear after
// a choice, a click into a field, a button that renames itself, a sort that
// only changes the order, and a button that does nothing (twice).
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const rows = Array.from({length: 12}, (_, i) => `<div class="row" data-row="${i}"><button type="button" class="star" aria-label="중요 표시">☆</button><span>보낸사람${i}</span> <span>업무 메일 제목 ${i}</span></div>`).join('');
const page = `<!doctype html><html lang="ko"><title>받은 편지함</title><style>body{margin:0;font:14px sans-serif}.row{display:flex;gap:12px;padding:6px}.row.starred .star{color:#e6a700}dialog{border:1px solid #333}</style>
<body><h1>받은 편지함</h1><div class="mails">${rows}</div>
<p><button type="button" id="options">옵션 열기</button> <button type="button" id="check">상태 확인</button> <button type="button" id="idle">아무 동작 없음</button> <button type="button" id="follow">팔로우</button></p>
<div role="status" id="status"></div>
<ul aria-label="할 일" id="todo"><li><button type="button">회의록</button></li><li><button type="button">보고서</button></li><li><button type="button">메일</button></li></ul><button type="button" id="sort">이름순 정렬</button>
<form aria-label="신청"><label>유형 <select id="kind"><option>개인</option><option>법인</option></select></label><div id="extra"></div></form>
<dialog id="dialog" aria-label="옵션"><p>표시할 항목을 고르세요</p><button type="button" id="close">닫기</button></dialog>
<script>
for (const star of document.querySelectorAll('.star')) star.addEventListener('click', () => {star.closest('.row').classList.toggle('starred'); star.setAttribute('aria-pressed', String(star.closest('.row').classList.contains('starred')));});
document.querySelector('#options').addEventListener('click', () => document.querySelector('#dialog').showModal());
document.querySelector('#close').addEventListener('click', () => document.querySelector('#dialog').close());
document.querySelector('#check').addEventListener('click', () => {document.querySelector('#status').textContent = '연결 상태 정상';});
document.querySelector('#sort').addEventListener('click', () => {const list = document.querySelector('#todo'); [...list.children].sort((a, b) => a.textContent.localeCompare(b.textContent, 'ko')).forEach(item => list.append(item));});
document.querySelector('#follow').addEventListener('click', event => {event.target.textContent = event.target.textContent === '팔로우' ? '팔로잉' : '팔로우';});
document.querySelector('#kind').addEventListener('change', event => {document.querySelector('#extra').innerHTML = event.target.value === '법인' ? '<label>사업자번호 <input name="biz"></label><label>대표자 <input name="ceo"></label>' : '';});
</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-action-effect-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, viewport: {width: 1000, height: 800}, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const url = `${origin}/mails`, tab = await context.newPage(); await tab.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  const run = (name, args = {}) => worker.evaluate(({tabId, name, args}) => contentTest.runBrowserAgent('effect', {tabId}, name, args).then(value => value.result), {tabId, name, args});
  const elements = result => (result.observation || result).frames.flatMap(frame => frame.elements || []);
  const find = (result, test) => {const found = elements(result).filter(test); assert.equal(found.length, 1, JSON.stringify(found.map(el => [el.role, el.name]))); return found[0];};

  let latest = await run('browser_snapshot');
  const star = find(latest, el => el.role === 'button' && el.context?.some(c => /보낸사람3\b/.test(c.name || '')));
  latest = await run('click_element', {ref: star.ref});
  assert.equal(latest.error, undefined, JSON.stringify(latest).slice(0, 300));
  const changed = latest.effect?.controlsChanged || [];
  assert.equal(changed.length, 1, JSON.stringify(latest.effect));
  assert.equal(changed[0].name, '중요 표시'); assert.equal(changed[0].to.pressed, true); assert.equal(changed[0].to.row, 'starred');
  assert.equal(changed[0].ref, find(latest, el => el.role === 'button' && el.context?.some(c => /보낸사람3\b/.test(c.name || ''))).ref, 'the change names the new ref');
  pass('a star that changes only a class and aria-pressed is reported as that row\'s changed control');

  latest = await run('click_element', {ref: find(latest, el => el.name === '아무 동작 없음').ref});
  assert.equal(latest.effect?.none, true, JSON.stringify(latest.effect)); assert.match(latest.effect.note, /may not have taken effect/);
  latest = await run('click_element', {ref: find(latest, el => el.name === '아무 동작 없음').ref});
  assert.equal(latest.effect?.repeated, 2, JSON.stringify(latest.effect)); assert.match(latest.effect.note, /Do not repeat them/);
  pass('a click that changes nothing says so, and a second one in a row says to stop repeating');

  latest = await run('click_element', {ref: find(latest, el => el.name === '옵션 열기').ref});
  assert.deepEqual(latest.effect?.dialogsOpened, ['dialog "옵션"'], JSON.stringify(latest.effect));
  latest = await run('click_element', {ref: find(latest, el => el.name === '닫기').ref});
  assert.deepEqual(latest.effect?.dialogsClosed, ['dialog "옵션"'], JSON.stringify(latest.effect));
  pass('a dialog that opens and closes is named in each effect');

  latest = await run('click_element', {ref: find(latest, el => el.name === '상태 확인').ref});
  assert.deepEqual(latest.effect?.alertsAdded, ['연결 상태 정상'], JSON.stringify(latest.effect));
  pass('a new status message is reported');

  latest = await run('select_option', {ref: find(latest, el => el.role === 'combobox' && el.name === '유형').ref, values: ['법인']});
  assert.equal(latest.effect?.controlsAdded?.count, 2, JSON.stringify(latest.effect));
  assert.deepEqual(latest.effect.controlsAdded.first.map(item => item.name), ['사업자번호', '대표자']);
  assert.equal(latest.effect.none, undefined);
  pass('fields that appear after a choice are listed with their refs');

  latest = await run('click_element', {ref: find(latest, el => el.name === '사업자번호').ref});
  assert.deepEqual([latest.effect?.focused?.role, latest.effect?.focused?.name], ['textbox', '사업자번호'], JSON.stringify(latest.effect));
  pass('a click that puts the cursor in a field reports that field, not no change');

  latest = await run('click_element', {ref: find(latest, el => el.name === '팔로우').ref});
  assert.deepEqual(latest.effect?.controlsRenamed?.map(item => [item.from, item.name]), [['팔로우', '팔로잉']], JSON.stringify(latest.effect));
  pass('a button that renames itself is one renamed control');

  latest = await run('click_element', {ref: find(latest, el => el.name === '이름순 정렬').ref});
  assert(latest.effect?.reordered?.controls >= 2, JSON.stringify(latest.effect)); assert.equal(latest.effect.none, undefined);
  pass('a sort that only changes the order is reported as reordered');

  assert(JSON.stringify(latest.effect).length < 1500);
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
