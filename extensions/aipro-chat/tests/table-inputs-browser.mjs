// Real Chrome: a weekly time sheet with one row per task and one input per day.
// Reported from a company work system: entering MH into one task row failed
// again and again. Observed here: the observation stopped at 180 controls and
// never reached the row, and an input's description named its row but not its
// day, so the inputs of a row were alike.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const days = ['09/22(월)', '09/23(화)', '09/24(수)', '09/25(목)', '09/26(금)', '09/27(토)', '09/28(일)'];
const tasks = Array.from({length: 40}, (_, i) => i === 27 ? '데이터 시스템 모니터링' : `업무 항목 ${String(i + 1).padStart(2, '0')}`);
// Inputs carry opaque names, as generated grids do: nothing in them says the day.
const cell = (r, c) => `<input type="text" name="f${(r * 7 + c) * 7919 % 100003}" class="mh" value="${r < 3 && c < 5 ? '8' : ''}">`;
const sheet = `<table class="grid"><thead><tr><th rowspan="2">과제명</th><th colspan="7">9월 4주</th><th rowspan="2">합계</th></tr><tr>${days.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>
${tasks.map((t, r) => `<tr><td>${t}</td>${days.map((_, c) => `<td>${cell(r, c)}</td>`).join('')}<td class="sum">0</td></tr>`).join('')}</tbody></table>`;
const grid = `<div role="grid" aria-label="공수 그리드"><div role="row"><div role="columnheader" aria-colindex="1">과제명</div>${days.map((d, c) => `<div role="columnheader" aria-colindex="${c + 2}">${d}</div>`).join('')}</div>
${tasks.slice(26, 29).map((t, r) => `<div role="row"><div role="rowheader" aria-colindex="1">${t}</div>${days.map((_, c) => `<div role="gridcell" aria-colindex="${c + 2}">${cell(r + 26, c)}</div>`).join('')}</div>`).join('')}</div>`;
// A sheet larger than one observation: 120 rows, the named row far down.
const bigTasks = Array.from({length: 120}, (_, i) => i === 110 ? '품질 점검 회의' : `운영 항목 ${String(i + 1).padStart(3, '0')}`);
const big = `<table class="grid"><thead><tr><th rowspan="2">과제명</th><th colspan="7">9월 4주</th></tr><tr>${days.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>
${bigTasks.map((t, r) => `<tr><td>${t}</td>${days.map((_, c) => `<td><input type="text" name="b${r * 7 + c}"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
const page = body => `<!doctype html><html lang="ko"><title>IWMS 공수 입력</title><body><div id="gnb">${Array.from({length: 30}, (_, i) => `<a href="/m${i}">메뉴 ${i}</a>`).join('')}</div><h2>주간 공수(MH) 입력</h2><form>${body}<button type="button" id="apply">최종 반영</button></form></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page(req.url.startsWith('/grid') ? grid : req.url.startsWith('/big') ? big : sheet));});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-table-inputs-')), extension = resolve(profile, 'extension');
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
    const mode = attach ? 'debugger' : 'page script', url = `${origin}/sheet?mode=${attach}`;
    const tab = await context.newPage(); await tab.goto(url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
    const id = `table-${attach}`;
    const run = async (tool, args = {}, options = {}) => (await worker.evaluate(({id, tabId, tool, args, options}) => contentTest.runBrowserAgent(id, {tabId}, tool, args, options), {id, tabId, tool, args, options})).result;
    if (attach) await run('verify_page', {checks: [{kind: 'text_present', expected: '주간 공수'}]});

    // 40 rows of 7 inputs and 30 menu links: all of it fits one observation now
    // (grouped lines within a budget), where 180 controls used to cut it off.
    const whole = (await run('browser_snapshot')).frames[0];
    assert.equal(whole.omittedControls, 0, JSON.stringify(whole.coverage));
    const rowInputs = whole.elements.filter(el => el.tag === 'input' && el.context?.some(c => c.name === '데이터 시스템 모니터링'));
    assert.deepEqual(rowInputs.map(el => el.column.split(' / ')[1]), days);
    pass(`${mode}: the whole sheet fits one observation, with every day of the named row`);

    const found = (await run('browser_snapshot', {query: '데이터 시스템 모니터링 09/24(수)'})).frames[0];
    const inputs = found.elements.filter(el => el.tag === 'input');
    const target = inputs.find(el => el.context?.some(c => c.name === '데이터 시스템 모니터링') && /09\/24\(수\)/.test(el.column || ''));
    assert(target, JSON.stringify(inputs.slice(0, 3)));
    assert.equal(target.column, '9월 4주 / 09/24(수)');
    assert.equal(inputs[0].ref, target.ref, 'the cell named by row and day comes first');
    assert.equal(new Set(inputs.filter(el => el.context?.some(c => c.name === '데이터 시스템 모니터링')).map(el => el.column)).size, 7, 'every day of the row is told apart');
    pass(`${mode}: an input names its row and its day, and a query by both finds it first`);

    const filled = await run('fill_form', {fields: [{field_id: target.ref, value: '8'}]});
    assert.equal(filled.error, undefined, JSON.stringify({error: filled.error, reason: filled.reason}));
    const expectedName = `f${(27 * 7 + 2) * 7919 % 100003}`;
    assert.equal(await tab.locator(`input[name="${expectedName}"]`).inputValue(), '8');
    assert.equal(await tab.evaluate(() => [...document.querySelectorAll('input.mh')].filter(input => input.value === '8').length), 16, 'only that cell was written');
    pass(`${mode}: the value lands in that row and day only`);

    // A review sees the verification, not always an observation holding that
    // cell: the result names the row and the day of each checked field.
    const again = (await run('browser_snapshot', {query: '데이터 시스템 모니터링 09/24(수)'})).frames[0].elements
      .find(el => el.tag === 'input' && el.context?.some(c => c.name === '데이터 시스템 모니터링') && /09\/24\(수\)/.test(el.column || ''));
    const verified = await run('verify_page', {checks: [{kind: 'field_value', ref: again.ref, expected: '8'}]});
    assert.equal(verified.verified, true, JSON.stringify(verified.checks));
    assert.deepEqual({row: verified.checks[0].target?.row, column: verified.checks[0].target?.column}, {row: '데이터 시스템 모니터링', column: '9월 4주 / 09/24(수)'});
    assert(!JSON.stringify(verified.checks).includes('"8"'), 'the value itself is not returned');
    pass(`${mode}: a verification names the row and day of the field it read`);

    // "Leave the other cells alone" over a sheet larger than one observation:
    // one check covers every field except the one this run wrote.
    if (attach) {
      const kept = await run('verify_page', {checks: [{kind: 'fields_unchanged', expected: 'true'}]});
      assert.equal(kept.verified, true, JSON.stringify(kept.checks));
      assert.deepEqual({kept: kept.checks[0].kept, written: kept.checks[0].written, changed: kept.checks[0].changed}, {kept: 40 * 7 - 1, written: 1, changed: 0});
      await tab.evaluate(() => {document.querySelectorAll('input.mh')[3].value = '7';});
      const touched = await run('verify_page', {checks: [{kind: 'fields_unchanged', expected: 'true'}]});
      assert.equal(touched.verified, false); assert.equal(touched.checks[0].changed, 1); assert.equal(touched.checks[0].reason, 'value_changed');
      await tab.evaluate(() => {document.querySelectorAll('input.mh')[3].value = '8';});
      pass(`${mode}: one check shows that every field but the written one kept its value, and catches another change`);
    }

    const gridURL = `${origin}/grid?mode=${attach}`;
    await run('navigate_page', {url: gridURL});
    const cells = (await run('browser_snapshot', {query: '데이터 시스템 모니터링'})).frames[0].elements.filter(el => el.tag === 'input');
    assert(cells.some(el => el.column === '09/24(수)'), JSON.stringify(cells.slice(0, 2)));
    assert.equal(new Set(cells.map(el => el.column)).size, 7);
    pass(`${mode}: an ARIA grid names the day of each input too`);

    // 120 rows do not fit. The observation says how to reach the rest. The
    // user's request, kept in the extension, reaches the reader that runs apart
    // from the page's scripts; the reader among the page's scripts never gets it,
    // and a query by the row's name reaches the row there.
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {});
    await tab.goto(`${origin}/big?mode=${attach}`);
    const bigId = `${id}-big`, request = {hint: '품질 점검 회의 행의 09/24(수)에 3 MH 입력해 줘'};
    const runBig = async (tool, args = {}, options = {}) => (await worker.evaluate(({bigId, tabId, tool, args, options}) => contentTest.runBrowserAgent(bigId, {tabId}, tool, args, options), {bigId, tabId, tool, args, options})).result;
    const farRow = frame => frame.elements.filter(el => el.tag === 'input' && el.context?.some(c => c.name === '품질 점검 회의')).length;
    const cut = (await runBig('browser_snapshot')).frames[0];
    assert(cut.omittedControls > 0, String(cut.omittedControls));
    assert.match(cut.coverage.controlsHint, /query naming its row, column or label/);
    assert.equal(farRow(cut), 0, 'without the request the far row is left out');
    assert.equal(farRow((await runBig('browser_snapshot', {}, request)).frames[0]), 7, 'the isolated reader brings the row the request names');
    await runBig('wait_page', {seconds: 0.1});
    assert.equal(farRow((await runBig('browser_snapshot', {}, request)).frames[0]), 0, 'the request never enters a reader among the page scripts');
    assert.equal(farRow((await runBig('browser_snapshot', {query: '품질 점검 회의'})).frames[0]), 7);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), bigId).catch(() => {});
    pass(`${mode}: a sheet that does not fit says how to reach the rest, and the row the request names can be reached`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {}); await tab.close();
  }
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
