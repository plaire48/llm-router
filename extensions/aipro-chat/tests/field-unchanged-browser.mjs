// Real Chrome: a request says "leave the memo as it is". Observations never
// show field values, so neither the model nor the review can compare before
// and after. The host can: field_unchanged passes when the field holds what it
// held when the run first observed it and no action of the run aimed at it.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-unchanged-')), extension = resolve(profile, 'extension');
const html = `<!doctype html><html lang="ko"><title>신청 설정</title><body><main><h1>신청 설정</h1><form>
<label>제목 <input id="title" name="title" value=""></label>
<label>참석 유형 <select id="kind" name="kind"><option value="site" selected>현장</option><option value="online">온라인</option></select></label>
<label>현장 메모 <textarea id="memo" name="memo">기존 메모: 장비 점검 PRIVATE_MEMO_VALUE</textarea></label>
<label><input type="checkbox" id="notify" name="notify" checked> 알림 받기</label>
<button type="button" id="open">열기</button></form></main></body></html>`;
// One screen for several records: the address differs only in its query. Unlabelled
// fields share their name, and a field that appears later sits before the memo.
const record = seq => `<!doctype html><html lang="ko"><title>기록 ${seq}</title><body><main><h1>기록 ${seq}</h1><form>
<input id="late" name="late" value="" hidden>
<input class="cell" value="첫째 ${seq}"><input class="cell" value="둘째 ${seq}"><input class="cell" value="셋째 ${seq}">
<label>비고 <textarea name="note">비고 ${seq} PRIVATE_NOTE</textarea></label>
<button type="button" id="show" onclick="document.getElementById('late').hidden=false">추가 입력란 보기</button></form></main></body></html>`;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(url.pathname === '/record' ? record(url.searchParams.get('seq')) : html);
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
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  for (const attach of [true, false]) {
    const mode = attach ? 'debugger' : 'page script', url = `${origin}/settings?mode=${attach}`;
    const tab = await context.newPage(); await tab.goto(url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    const id = `unchanged-${attach}`;
    const run = async (tool, args = {}) => (await worker.evaluate(({id, tabId, tool, args}) => contentTest.runBrowserAgent(id, {tabId}, tool, args), {id, tabId, tool, args})).result;
    if (attach) await run('verify_page', {checks: [{kind: 'text_present', expected: '신청 설정'}]});
    const observe = async () => {const snapshot = await run('browser_snapshot'); return {snapshot, elements: snapshot.frames.flatMap(frame => frame.elements || [])};};
    let {snapshot, elements} = await observe();
    const ref = key => {const found = elements.find(el => el.id === key); assert(found?.ref, `${key}: ${JSON.stringify(elements.map(el => el.id))}`); return found.ref;};
    assert(!JSON.stringify(snapshot).includes('valueMark'), 'the mark stays in the host');
    assert(!JSON.stringify(snapshot).includes('PRIVATE_MEMO_VALUE'), 'the value is never read out');
    pass(`${mode}: the observation shows neither the value nor its mark`);

    const kept = await run('verify_page', {checks: [{kind: 'field_unchanged', ref: ref('memo'), expected: 'true'}, {kind: 'field_unchanged', ref: ref('notify'), expected: 'true'}]});
    assert.equal(kept.verified, true, JSON.stringify(kept.checks)); assert.equal(kept.checks[0].compared, 'first_observation');
    assert(!JSON.stringify(kept).includes('PRIVATE_MEMO_VALUE')); assert(!JSON.stringify(kept).includes('valueMark'));
    pass(`${mode}: an untouched field and an untouched checkbox are verified as unchanged`);

    ({elements} = await observe());
    const filled = await run('fill_form', {fields: [{field_id: ref('title'), value: '가을 교육'}]});
    assert.equal(filled.error, undefined, JSON.stringify({error: filled.error, reason: filled.reason}));
    ({elements} = await observe());
    const after = await run('verify_page', {checks: [{kind: 'field_value', ref: ref('title'), expected: '가을 교육'}, {kind: 'field_unchanged', ref: ref('memo'), expected: 'true'}]});
    assert.equal(after.verified, true, JSON.stringify(after.checks));
    pass(`${mode}: after another field was filled the memo is still verified as unchanged`);

    ({elements} = await observe());
    const written = await run('verify_page', {checks: [{kind: 'field_unchanged', ref: ref('title'), expected: 'true'}]});
    assert.equal(written.verified, false); assert.equal(written.checks[0].reason, 'field_written');
    pass(`${mode}: a field that the run wrote to cannot pass as left alone`);

    await tab.evaluate(() => {document.getElementById('memo').value = '바뀐 메모';});
    ({elements} = await observe());
    const changed = await run('verify_page', {checks: [{kind: 'field_unchanged', ref: ref('memo'), expected: 'true'}]});
    assert.equal(changed.verified, false); assert.equal(changed.checks[0].reason, 'value_changed');
    assert.match(changed.checks[0].instruction, /do not write a value/);
    pass(`${mode}: a value changed by the page is reported as changed`);

    ({elements} = await observe());
    const button = await run('verify_page', {checks: [{kind: 'field_unchanged', ref: ref('open'), expected: 'true'}]});
    assert.equal(button.verified, false); assert.equal(button.checks[0].reason, 'check_target_incompatible');
    await assert.rejects(run('verify_page', {checks: [{kind: 'field_unchanged', ref: ref('memo'), expected: 'false'}]}).then(result => {if (result.error) throw Error(result.error); return result;}));
    pass(`${mode}: a control that is not a field, or another expected value, is refused`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {}); await tab.close();

    // A review of the first version: fields were told apart by label and by their
    // position among the fields that an observation returned.
    const records = await context.newPage(); await records.goto(`${origin}/record?seq=1&mode=${attach}`);
    const recordTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, `${origin}/record?seq=1&mode=${attach}`);
    const recordId = `records-${attach}`;
    const act = async (tool, args = {}) => (await worker.evaluate(({id, tabId, tool, args}) => contentTest.runBrowserAgent(id, {tabId}, tool, args), {id: recordId, tabId: recordTab, tool, args})).result;
    if (attach) await act('verify_page', {checks: [{kind: 'text_present', expected: '기록 1'}]});
    const fields = snapshot => snapshot.frames.flatMap(frame => frame.elements || []).filter(el => ['field', 'select', 'checkbox', 'radio'].includes(el.kind));
    const whole = fields(await act('browser_snapshot'));
    assert.equal(whole.length, 4, JSON.stringify(whole.map(el => [el.name, el.tag])));
    assert(!JSON.stringify(whole).includes('fieldPlace') && !JSON.stringify(whole).includes('valueMark'));
    // A search returns the fields in another order, or only some of them.
    const found = fields(await act('browser_snapshot', {query: '비고'}));
    const note = found.find(el => el.tag === 'textarea'); assert(note, JSON.stringify(found.map(el => el.tag)));
    const afterSearch = await act('verify_page', {checks: [{kind: 'field_unchanged', ref: note.ref, expected: 'true'}]});
    assert.equal(afterSearch.verified, true, JSON.stringify(afterSearch.checks));
    pass(`${mode}: a field found by a search is the field that was first observed`);

    // A field that appears before the others must not renumber them.
    let now = await act('browser_snapshot');
    await act('click_element', {ref: now.frames.flatMap(frame => frame.elements || []).find(el => el.id === 'show').ref});
    now = await act('browser_snapshot');
    const shown = fields(now); assert.equal(shown.length, 5, JSON.stringify(shown.map(el => [el.name, el.tag, el.id])));
    const stayed = await act('verify_page', {checks: shown.filter(el => el.id !== 'late').map(el => ({kind: 'field_unchanged', ref: el.ref, expected: 'true'}))});
    assert.equal(stayed.verified, true, JSON.stringify(stayed.checks)); assert.equal(stayed.checks.length, 4);
    pass(`${mode}: a field that appears later does not renumber the unlabelled fields after it`);

    // Writing the second unlabelled field leaves the first and the third alone.
    now = await act('browser_snapshot');
    const cells = fields(now).filter(el => el.tag === 'input' && el.id !== 'late');
    const wrote = await act('fill_form', {fields: [{field_id: cells[1].ref, value: '고친 값'}]});
    assert.equal(wrote.error, undefined, JSON.stringify({error: wrote.error, reason: wrote.reason}));
    now = await act('browser_snapshot');
    const again = fields(now).filter(el => el.tag === 'input' && el.id !== 'late');
    const each = [];
    for (const cell of again) each.push((await act('verify_page', {checks: [{kind: 'field_unchanged', ref: (fields(await act('browser_snapshot')).filter(el => el.tag === 'input' && el.id !== 'late'))[again.indexOf(cell)].ref, expected: 'true'}]})).checks[0]);
    assert.deepEqual(each.map(check => check.passed ? 'kept' : check.reason), ['kept', 'field_written', 'kept'], JSON.stringify(each));
    pass(`${mode}: of three fields with one label only the written one is reported`);

    // The same screen for another record: its fields are other fields.
    const moved = await act('navigate_page', {url: `${origin}/record?seq=2&mode=${attach}`});
    assert.equal(moved.error, undefined, JSON.stringify(moved).slice(0, 200));
    const second = fields(await act('browser_snapshot'));
    const other = await act('verify_page', {checks: second.map(el => ({kind: 'field_unchanged', ref: el.ref, expected: 'true'}))});
    assert.equal(other.verified, true, JSON.stringify(other.checks));
    assert(!JSON.stringify(other).includes('PRIVATE_NOTE'));
    pass(`${mode}: another record on the same screen is compared with its own first values`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), recordId).catch(() => {}); await records.close();
  }
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
