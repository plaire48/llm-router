import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-settings-a11y-'));
const extension = resolve(process.env.TEST_EXTENSION || 'dist');
const context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
const warnings = [], errors = [], checks = [];
const settingSections = ['OpenWiki 폴더', '서버 연결', '녹화와 예약', '작업 예약', '실행 조건', '조직 정책', '프롬프트 바로가기', '첨부파일 설정', 'MCP 연결', '연결 진단', '사이트 위키', '데이터 보관'];
try {
  await mkdir('verification', {recursive: true});
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K'}]})}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  // Inspect the copy payload without reading or changing the host clipboard.
  await page.addInitScript(() => {navigator.clipboard.writeText = async text => {window.copiedDiagnostic = text;};});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Log.enable');
  cdp.on('Log.entryAdded', ({entry}) => {if (/aria-hidden|accessibility tree/i.test(entry.text)) warnings.push(entry.text);});
  const state = () => page.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
  async function poll(fn, expected) {let value;for(let i=0;i<200;i++){value=await fn();if(value===expected)return;await new Promise(r=>setTimeout(r,50));}assert.equal(value,expected);}
  const dialog = () => page.getByRole('dialog', {name: '설정', exact: true});
  const settings = () => page.getByRole('button', {name: '설정', exact: true});
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  for (const width of [360, 1100]) {
    await page.setViewportSize({width, height: 800});
    for (const [label, icon] of [['AI Pro', 'aipro.svg'], ['ChatGPT', 'openai.svg']]) {
      const button = page.getByRole('button', {name: label, exact: true}), logo = button.locator('img');
      assert.equal(await logo.getAttribute('alt'), ''); assert((await logo.getAttribute('src')).endsWith(icon));
      await poll(() => logo.evaluate(img => img.complete && img.naturalWidth > 0), true);
      const alignment = await button.evaluate(el => {
        const outer = el.getBoundingClientRect(), label = el.querySelector('.provider-label').getBoundingClientRect();
        return {offset: Math.abs((outer.left + outer.width / 2) - (label.left + label.width / 2)), logoBackground: getComputedStyle(el.querySelector('img')).backgroundColor};
      });
      assert(alignment.offset < 1); assert.equal(alignment.logoBackground, 'rgba(0, 0, 0, 0)');
    }
    await page.screenshot({path: `verification/login-providers-${width}.png`});
    await settings().click();
    await poll(async () => JSON.stringify(await dialog().locator('summary').allTextContents()), JSON.stringify(settingSections));
    assert.equal(await dialog().locator('input:visible, select:visible, textarea:visible').count(), 1);
    const debug = dialog().getByRole('checkbox', {name: '디버그 모드', exact: true});
    assert(await debug.isVisible());
    assert.equal(await debug.isChecked(), false);
    assert.equal(await dialog().getByText('AI Pro 연결 설정', {exact: true}).count(), 0);
    await page.screenshot({path: `verification/settings-collapsed-${width}.png`});
    for (const label of ['프롬프트 바로가기', '첨부파일 설정', 'MCP 연결']) {
      const section = dialog().locator('summary').filter({hasText: label});
      await section.focus(); await section.press('Enter');
      assert(await section.evaluate(el => el.parentElement.open));
      await section.press('Enter');
      assert.equal(await section.evaluate(el => el.parentElement.open), false);
    }
    const routines = dialog().locator('summary').filter({hasText: /^녹화와 예약$/});
    await routines.focus();await routines.press('Enter');
    assert(await routines.evaluate(el => el.parentElement.open));
    assert.equal(await dialog().getByRole('region',{name:'작업 녹화'}).count(),1);
    for (const label of ['작업 예약', '조직 정책']) {
      const section = dialog().locator('summary').filter({hasText: new RegExp('^'+label+'$')});
      await section.focus();await section.press('Enter');
      assert(await section.evaluate(el => el.parentElement.open));
      if (label === '작업 예약') {
        const conditions = dialog().locator('summary').filter({hasText: /^실행 조건$/});
        await conditions.focus();await conditions.press('Enter');
        assert(await conditions.evaluate(el => el.parentElement.open));
        await conditions.press('Enter');
        assert.equal(await conditions.evaluate(el => el.parentElement.open), false);
        await section.focus();
      }
      await section.press('Enter');assert.equal(await section.evaluate(el => el.parentElement.open),false);
    }
    await routines.focus();await routines.press('Enter');assert.equal(await routines.evaluate(el => el.parentElement.open),false);
    const wiki=dialog().locator('.browser-knowledge-settings > summary');
    await wiki.focus();await wiki.press('Enter');
    const enabled=dialog().getByRole('checkbox',{name:'위키 제안과 활용'});
    await enabled.click();await poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('browserKnowledge')).browserKnowledge.enabled),false);await poll(()=>enabled.isChecked(),false);
    await enabled.click();await poll(()=>worker.evaluate(async()=>(await chrome.storage.local.get('browserKnowledge')).browserKnowledge.enabled),true);await poll(()=>enabled.isChecked(),true);
    await wiki.focus();await wiki.press('Enter');
    const diagnostics = dialog().locator('.diagnostics > summary');
    await diagnostics.focus(); await diagnostics.press('Enter');
    await page.getByRole('button', {name: '진단 복사', exact: true}).click();
    await poll(() => page.evaluate(() => !!window.copiedDiagnostic), true);
    assert.equal(JSON.parse(await page.evaluate(() => window.copiedDiagnostic)).credentialReceived, false);
    await dialog().locator('.storage-help > summary').click();
    await dialog().getByText('대화와 이미지는 이 브라우저에 저장됩니다.', {exact: true}).waitFor();
    await dialog().getByText('로그인 정보는 브라우저를 종료하면 삭제됩니다.', {exact: true}).waitFor();
    await cdp.send('Accessibility.getFullAXTree');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press('Tab');
    assert(await dialog().evaluate(el => el.contains(document.activeElement)));
    await page.screenshot({path: `verification/settings-${width}.png`, fullPage: true});
    await diagnostics.focus();
    await page.keyboard.press('Escape');
    await dialog().waitFor({state: 'hidden'});
    await poll(() => settings().evaluate(el => el === document.activeElement), true);
    await page.reload(); await settings().click();
    await poll(async () => JSON.stringify(await dialog().locator('summary').allTextContents()), JSON.stringify(settingSections));
    await page.keyboard.press('Escape');
    checks.push(`${width}px login logos load locally and settings keep the OpenWiki section plus file/workflow/schedule/policy and diagnostics/data retention with keyboard, copy, focus return and reload`);
  }
  await worker.evaluate(async () => {
    await chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic-private-credential', receivedAt: 7, expiresAt: Date.now() + 3600000}});
  });
  await poll(async () => (await state()).auth.present, true);
  await page.getByRole('button', {name: '모델 변경', exact: true}).waitFor();
  await settings().click();
  assert.equal(await page.getByRole('button', {name: '연결 해제', exact: true}).isVisible(), false);
  await dialog().locator('.diagnostics > summary').click();
  await page.getByRole('button', {name: '진단 복사', exact: true}).click();
  await poll(() => page.evaluate(() => window.copiedDiagnostic ? JSON.parse(window.copiedDiagnostic).credentialReceived : false), true);
  assert(!(await page.evaluate(() => window.copiedDiagnostic)).includes('synthetic-private-credential'));
  await page.screenshot({path: 'verification/settings-connected.png', fullPage: true});
  await dialog().locator('.diagnostics > summary').focus();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: '설정', exact: true}).click();
  await page.getByRole('button', {name: '로그아웃', exact: true}).click();
  await page.getByRole('dialog', {name: '모델 선택', exact: true}).waitFor();
  assert.equal((await state()).auth.present, false);
  assert.equal(await dialog().count(), 0);
  assert.deepEqual(warnings, []); assert.deepEqual(errors, []);
  checks.push('diagnostics retain sanitized copy; settings logout returns to provider choices without accessibility warnings');
  const result = {version: await page.evaluate(() => chrome.runtime.getManifest().version), checks, warnings, pageErrors: errors, syntheticBrowser: true, realAiProVerified: false, clipboardStubbed: true};
  if (!process.env.TEST_EXTENSION) await writeFile('verification/accessibility-browser-results.json', JSON.stringify(result, null, 2)+'\n');
  console.log(JSON.stringify(result));
} finally {await context.close(); await rm(profile, {recursive: true, force: true});}
