// Real Chrome: a time sheet filled in one request and applied, after approval,
// by the next request. Measured on the work-sheet task: the final review could not
// confirm "leave the other cells alone" after the apply, because the request that
// ran the approved action started a new browser task without the first
// observation of the fields or the record of which cells were written.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const days = ['09/22(월)', '09/23(화)', '09/24(수)', '09/25(목)', '09/26(금)', '09/27(토)', '09/28(일)'];
const tasks = Array.from({length: 30}, (_, i) => i === 22 ? '데이터 시스템 모니터링' : `업무 항목 ${String(i + 1).padStart(2, '0')}`);
const cell = (r, c) => `<input type="text" name="g${(r * 7 + c) * 7919 % 100003}" value="${r < 3 && c < 5 ? '8' : ''}" size="3">`;
const page = `<!doctype html><html lang="ko"><title>주간 공수</title><body><h2>주간 공수(MH) 입력</h2><form onsubmit="return false"><table><thead><tr><th rowspan="2">과제명</th><th colspan="7">9월 4주</th></tr><tr>${days.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>
${tasks.map((t, r) => `<tr><td>${t}</td>${days.map((_, c) => `<td>${cell(r, c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<button type="button" id="apply" onclick="document.querySelector('output').textContent='최종 반영 완료'">최종 반영</button> <output>반영 전</output></form></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-approval-baseline-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,runApprovedAction,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const url = `${origin}/sheet`, tab = await context.newPage(); await tab.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);

  // The first request observes the sheet, writes one cell and asks for approval.
  const prepared = await worker.evaluate(async tabId => {
    const id = crypto.randomUUID(), page = {tabId};
    const run = async (tool, args = {}, options) => (await contentTest.runBrowserAgent(id, page, tool, args, options)).result;
    await run('browser_snapshot');
    const cells = (await run('browser_snapshot', {query: '데이터 시스템 모니터링 09/24(수)'})).frames[0].elements;
    const target = cells.find(el => el.tag === 'input' && el.context?.some(c => c.name === '데이터 시스템 모니터링') && /09\/24/.test(el.column || ''));
    const filled = await run('fill_form', {fields: [{field_id: target.ref, value: '4'}]});
    const apply = filled.observation.frames[0].elements.find(el => el.name === '최종 반영') ||
      (await run('browser_snapshot', {query: '최종 반영'})).frames[0].elements.find(el => el.name === '최종 반영');
    let record;
    const asked = await run('request_approval', {ref: apply.ref}, {onApproval: r => {record = r; return Promise.resolve({requiresUserInput: true, questionId: 'q'});}});
    await contentTest.stopBrowserAgent();
    return {asked: asked.requiresUserInput === true, record};
  }, tabId);
  assert.equal(prepared.asked, true);
  assert(prepared.record.fieldBaseline?.marks?.length >= 200, String(prepared.record.fieldBaseline?.marks?.length));
  assert.equal(prepared.record.fieldBaseline.written.length, 1);
  assert(prepared.record.fieldBaseline.marks.every(([, mark]) => /^\d{1,7}:[a-f0-9]{16}$/.test(mark)), 'only one-way marks travel with the approval');
  pass('the approval carries the first marks of the fields and the written cell, never a value');

  // The next request runs the approved action and verifies the result.
  const after = await worker.evaluate(async ({tabId, record}) => {
    const id = crypto.randomUUID(), page = {tabId};
    const applied = (await contentTest.runApprovedAction(id, page, record)).result;
    const verified = (await contentTest.runBrowserAgent(id, page, 'verify_page', {checks: [{kind: 'text_present', expected: '최종 반영 완료'}]})).result;
    const whole = (await contentTest.runBrowserAgent(id, page, 'verify_page', {checks: [{kind: 'fields_unchanged', expected: 'true'}]})).result;
    await contentTest.stopBrowserAgent();
    return {applied: applied.actionIssued, verified: verified.verified, otherFields: verified.otherFields, whole: whole.checks[0]};
  }, {tabId, record: prepared.record});
  assert.equal(after.applied, true); assert.equal(after.verified, true);
  assert.deepEqual({kept: after.otherFields?.kept, written: after.otherFields?.written, changed: after.otherFields?.changed, passed: after.otherFields?.passed}, {kept: 30 * 7 - 1, written: 1, changed: 0, passed: true});
  assert.deepEqual({passed: after.whole.passed, kept: after.whole.kept, written: after.whole.written}, {passed: true, kept: 30 * 7 - 1, written: 1});
  assert.equal(await tab.locator('output').innerText(), '최종 반영 완료');
  pass('after the approved apply, a verification still shows that every other cell kept its first value');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
