import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runAgent} from '../agent-runtime.js';
import {BUILTIN_SKILLS, browserTools} from '../skills.js';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-form-reconciliation-'));
const extension = resolve(profile, 'extension');
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<title>입력 결과 검사</title><form aria-label="업무 양식">' +
    Array.from({length: 20}, (_, i) => `<label>항목 ${i + 1}<input id="field-${i}"></label>`).join('') +
    '</form><script>window.writes=0;addEventListener("input",()=>writes++);</script>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let context, worker, page, tabId;
const checks = [], failures = [];
const fields = result => (result.observation || result).frames.flatMap(frame => frame.elements || []).filter(el => el.id?.startsWith('field-'));
const run = (id, name, args = {}) => worker.evaluate(async ({id, tabId, name, args}) =>
  (await testForms.runBrowserAgent(id, {tabId}, name, args)).result, {id, tabId, name, args});
async function scenario(name, fn) {
  try {await page.reload(); await fn(name); checks.push(name); console.log(`PASS ${name}`);}
  catch (error) {failures.push({name, error: error.message}); console.error(`FAIL ${name}: ${error.message}`);}
  finally {await worker.evaluate(id => testForms.stopBrowserAgent(id), name);}
}
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testForms={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  page = await context.newPage(); await page.goto(origin);
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testForms.ready);
  tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === origin + '/').id, origin);

  await scenario('twenty fields reconcile a lost receipt without replay', async id => {
    let round = 0, writes = 0;
    const call = (name, args = {}) => ({content: '', calls: [{id: String(round), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
    await runAgent({messages: [{role: 'user', content: '20개 항목에 각각 항목 번호를 입력해줘.'}],
      tools: browserTools({}, BUILTIN_SKILLS[0]), stepwise: true, signal: new AbortController().signal,
      complete: async (messages, _, state) => {
        const result = JSON.parse(messages.findLast(message => message.role === 'tool')?.content || '{}');
        if (++round === 1) return call('browser_snapshot');
        if (round === 2) return call('fill_form', {fields: fields(result).map((el, i) => ({field_id: el.ref, value: String(i + 1)}))});
        if (round === 3) {assert.equal(result.recovery.execution, 'unknown'); return call('browser_snapshot');}
        if (round === 4) return call('verify_page', {checks: fields(result).slice(0, 8).map((el, i) => ({kind: 'field_value', ref: el.ref, expected: String(i + 1)}))});
        if (round === 5) {
          assert.equal(state.verificationPending, true);
          return call('verify_page', {checks: fields(result).map((el, i) => ({kind: 'field_value', ref: el.ref, expected: String(i + 1)}))});
        }
        assert.equal(round, 6); assert.equal(result.verified, true, JSON.stringify(result)); assert.equal(state.verificationPending, false);
        return {content: '20개 입력을 확인했습니다.', calls: null};
      }, execute: async (name, args) => {
        const result = await run(id, name, args);
        if (name === 'fill_form') {writes++; assert.equal(result.applied, 20); throw new Error('lost receipt');}
        return result;
      }});
    assert.equal(writes, 1); assert.equal(await page.evaluate(() => window.writes), 20);
    assert.deepEqual(await page.locator('input').evaluateAll(inputs => inputs.map(input => input.value)), Array.from({length: 20}, (_, i) => String(i + 1)));
  });

  await scenario('detached text input cannot report retained values', async id => {
    await page.locator('#field-0').evaluate(el => el.addEventListener('input', () => {
      const replacement = el.cloneNode(); replacement.value = ''; el.replaceWith(replacement);
    }, {once: true}));
    const observed = await run(id, 'browser_snapshot');
    const result = await run(id, 'fill_form', {fields: [{field_id: fields(observed)[0].ref, value: '초안'}]});
    assert.equal(await page.locator('#field-0').inputValue(), '');
    assert.equal(await page.evaluate(() => window.writes), 1);
    assert.equal(result.verified, false, JSON.stringify({verified: result.verified, matched: result.matched}));
    assert.equal(result.error, 'fill_not_retained');
    assert.equal((await run(id, 'verify_form')).ok, false);
  });

  await scenario('a replaced checkbox cannot satisfy a retained fill receipt', async id => {
    await page.locator('#field-0').evaluate(el => el.type = 'checkbox');
    const observed = await run(id, 'browser_snapshot');
    const result = await run(id, 'fill_form', {fields: [{field_id: fields(observed)[0].ref, value: 'true'}]});
    assert.equal(result.verified, true);
    await page.locator('#field-0').evaluate(el => {
      const replacement = el.cloneNode(); replacement.checked = false; el.replaceWith(replacement);
    });
    const verified = await run(id, 'verify_form');
    assert.equal(verified.ok, false); assert.equal(verified.error, 'fill_not_retained');
    assert.equal(await page.locator('#field-0').isChecked(), false);
    assert.equal(await page.evaluate(() => window.writes), 1);
  });

  await scenario('duplicate input targets are rejected before any write', async id => {
    const observed = await run(id, 'browser_snapshot'), ref = fields(observed)[0].ref;
    const result = await run(id, 'fill_form', {fields: [{field_id: ref, value: '첫 번째'}, {field_id: ref, value: '두 번째'}]});
    assert.equal(await page.evaluate(() => window.writes), 0);
    assert.equal(await page.locator('#field-0').inputValue(), '');
    assert.equal(result.error, 'fill_invalid'); assert.equal(result.actionIssued, false);
  });
  await mkdir('verification', {recursive: true});
  await writeFile('verification/form-reconciliation-browser.json', JSON.stringify({actualBrowser: true, actualModel: false, checks, failures}, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await context?.close(); await new Promise(done => server.close(done)); await rm(profile, {recursive: true, force: true});
}
