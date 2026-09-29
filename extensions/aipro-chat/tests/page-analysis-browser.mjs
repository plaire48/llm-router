import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-analysis-')), extension = resolve(profile, 'extension');
const legacy = process.env.EXPECT_ANALYSIS_FAILURES === '1', checks = [], findings = [];
let context, worker;
const check = (name, result, pass) => {
  findings.push({name, ok: result.ok, verified: result.verified, error: result.error, reason: result.reason});
  assert.equal(pass(result), !legacy, `${name}: ${JSON.stringify(result)}`);
  checks.push(name); console.log(`PASS ${legacy ? 'reproduced: ' : ''}${name}`);
};
const elements = result => (result.observation || result).frames.flatMap(frame => frame.elements || []);
const byId = (result, id) => elements(result).find(element => element.id === id);
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://analysis.example.test/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  await context.route('https://analysis.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `
    <title>페이지 분석</title><label>담당 팀<input id="team" disabled value="개발팀"></label>
    <label>초안<textarea id="draft" readonly>확인할 초안</textarea></label>
    <button id="view" title="상세 보기">보기</button><p id="status">읽기 <strong>준비</strong> 완료</p><p>교<strong>육</strong>안내</p>
    <p id="later">정보 불러오는 중</p><input type="password" id="secret" value="PRIVATE_PASSWORD">
    <script>window.writes=0;document.addEventListener('input',()=>window.writes++);</script>`}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testBrowserAgent.ready());
  const page = await context.newPage(); await page.goto('https://analysis.example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://analysis.example.test/').id);
  await worker.evaluate(() => {globalThis.attachCount = 0; const attach = chrome.debugger.attach.bind(chrome.debugger); chrome.debugger.attach = (...args) => {attachCount++; return attach(...args);};});
  const run = async (name, args = {}) => (await worker.evaluate(({tabId, name, args}) => testBrowserAgent.runBrowserAgent('analysis', {tabId}, name, args), {tabId, name, args})).result;
  let snapshot = await run('browser_snapshot');
  let result = await run('verify_page', {checks: [{kind: 'text_present', expected: '읽기 준비 완료'}, {kind: 'url_is', expected: 'https://analysis.example.test/'}]});
  check('visible text split across DOM nodes verifies without a debugger', result, value => value.verified === true);
  assert.equal(await worker.evaluate(() => attachCount), legacy ? 1 : 0);
  if (!legacy) assert(result.observation.frames[0].text.includes('교육안내'));

  snapshot = await run('browser_snapshot');
  result = await run('verify_page', {checks: [{kind: 'field_value', ref: byId(snapshot, 'team').ref, expected: '개발팀'}]});
  check('disabled fields remain readable during result verification', result, value => value.verified === true);

  await page.evaluate(() => {window.loadTimer = setTimeout(() => {document.querySelector('#later').textContent = '정보 불러오기 완료';}, 2800);});
  result = await run('verify_page', {checks: [{kind: 'text_present', expected: '정보 불러오기 완료'}]});
  check('read-only verification waits for a delayed visible result', result, value => value.verified === true);
  await page.evaluate(() => clearTimeout(window.loadTimer));

  const script = await run('run_playwright', {code: 'return await browser.snapshot();'});
  assert.equal(script.ok, true); const returnedRef = byId(script.value, 'view').ref;
  result = await run('run_playwright', {code: `return await browser.ref(${JSON.stringify(returnedRef)}).innerText();`});
  check('a returned script snapshot keeps usable refs in its final observation', result, value => value.ok === true && value.value === '보기');

  result = await run('run_playwright', {code: 'return {enabled: await page.getByLabel("담당 팀").isEnabled(), readonly: !(await page.getByLabel("초안").isEditable()), id: await page.getByTitle("상세 보기").getAttribute("id")};'});
  check('common Playwright read-only inspection methods are supported', result, value => value.ok === true && value.value?.enabled === false && value.value.readonly && value.value.id === 'view');

  snapshot = await run('browser_snapshot');
  result = await run('run_playwright', {code: `return await browser.ref(${JSON.stringify(byId(snapshot, 'team').ref)}).inputValue();`});
  check('observed disabled controls can be inspected without attempting an action', result, value => value.ok === true && value.value === '개발팀');
  if (!legacy) {
    snapshot = await run('browser_snapshot'); const oldRef = byId(snapshot, 'draft').ref;
    await run('browser_snapshot');
    result = await run('run_playwright', {code: `await browser.ref(${JSON.stringify(oldRef)}).fill('DO_NOT_WRITE');`});
    assert.equal(result.reason, 'browser_stale'); assert.equal(result.actionIssued, false);
    result = await run('run_playwright', {code: 'return await page.locator("#secret").getAttribute("value");'});
    assert.equal(result.reason, 'script_secret_field'); assert(!JSON.stringify(result).includes('PRIVATE_PASSWORD'));
    result = await run('run_playwright', {code: 'return await page.getByTitle("상세 보기").getAttribute("data-token");'});
    assert.equal(result.reason, 'script_attribute');
    snapshot = await run('browser_snapshot');
    result = await run('run_playwright', {code: `await browser.ref(${JSON.stringify(byId(snapshot, 'team').ref)}).fill('DO_NOT_WRITE');`});
    assert.equal(result.reason, 'script_disabled'); assert.equal(result.actionIssued, false);
    checks.push('old refs and protected fields remain guarded; inspection performs no writes');

    snapshot = await run('browser_snapshot'); const replacedRef = byId(snapshot, 'draft').ref;
    await page.locator('#draft').evaluate(el => el.replaceWith(el.cloneNode(true)));
    result = await run('verify_page', {checks: [{kind: 'field_value', ref: replacedRef, expected: '확인할 초안'}]});
    assert.equal(result.reason, 'browser_stale'); assert(byId(result, 'draft').ref);
    result = await run('verify_page', {checks: [{kind: 'field_value', ref: byId(result, 'draft').ref, expected: '확인할 초안'}]});
    assert.equal(result.verified, true);
    checks.push('a replaced field returns fresh refs and only verification is retried');

    await page.evaluate(() => {const article = document.createElement('article'); article.innerHTML = '<p>' + '설명 '.repeat(200) + '문단의 마지막 근거</p><p>대상 설명</p><p>특별 기준 37건</p>'; document.body.append(article);});
    snapshot = await run('read_page'); assert(snapshot.frames[0].text.includes('문단의 마지막 근거'));
    snapshot = await run('browser_snapshot', {query: '특별 기준'});
    assert.equal(snapshot.frames[0].textFiltered, true); assert(snapshot.frames[0].text.includes('특별 기준 37건')); assert(!snapshot.frames[0].text.includes('문단의 마지막 근거'));
    checks.push('long paragraphs retain their ending and focused reading supplies compact excerpts');
  }
  assert.equal(await page.evaluate(() => window.writes), 0);
  assert.equal(await page.locator('#draft').inputValue(), '확인할 초안');
  if (!legacy) {
    const pending = run('verify_page', {checks: [{kind: 'text_present', expected: '존재하지 않는 결과'}]});
    await page.waitForTimeout(300); await worker.evaluate(() => testBrowserAgent.stopBrowserAgent('analysis'));
    assert.equal((await pending).error, 'cancelled');
    checks.push('cancellation interrupts verification waiting without starting another action');
  } else await worker.evaluate(() => testBrowserAgent.stopBrowserAgent('analysis'));
  await mkdir('verification', {recursive: true});
  await writeFile(`verification/page-analysis-${legacy ? 'before' : 'after'}.json`, JSON.stringify({version: manifest.version, legacy, checks, findings, actualBrowser: true, syntheticSite: true, liveModel: false}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
