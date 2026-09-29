import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {inspectModelList} from '../core.js';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-catalog-refresh-'));
const extension = resolve(profile, 'extension');
const full = JSON.parse(await readFile('tests/fixtures/aipro-models.json', 'utf8'));
const subset = {modelList: full.modelList.filter(model => ['glm-5.2', 'QWEN3-CODER-480B-A35B-INSTRUCT-FP8-128K_rag', 'QWEN3-CODER-128K_general', 'qwen3.8-27b', 'gpt-oss-120b'].includes(model.name))};
const token = `header.${Buffer.from(JSON.stringify({sub: 'synthetic-catalog-refresh', exp: Date.now() / 1000 + 3600})).toString('base64url')}.signature`;
const checks = [], errors = []; let context, ui, requests = 0, mode = 'full';
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
async function poll(fn, expected) {let actual; for (let i = 0; i < 160; i++) {actual = await fn(); if (actual === expected) return; await new Promise(resolve => setTimeout(resolve, 50));} assert.equal(actual, expected);}
const check = value => {checks.push(value); console.log('PASS', value);};
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  const catalogVersion = Number((await readFile(resolve(extension, 'core.js'), 'utf8')).match(/MODEL_CATALOG_VERSION = (\d+)/)[1]);
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(12000);
  await context.route('https://aipro.sdsdev.co.kr/api/models', async route => {
    requests++;
    const request = route.request();
    assert.equal(request.method(), 'GET');
    assert.equal(new URL(request.url()).search, '');
    assert.equal(request.headers().authorization, `Bearer ${token}`);
    assert.equal(request.headers().cookie, undefined);
    assert.equal(request.headers()['x-reasoning'], 'true');
    await route.fulfill({status: mode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'error' ? {error: 'synthetic unavailable'} : mode === 'five' ? subset : full)});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async ({token, catalogVersion, normalized}) => {
    const receivedAt = Date.now();
    await chrome.storage.session.set({credential: {provider: 'aipro', token, mode: 'browser', receivedAt, expiresAt: Date.now() + 3600000}, catalog: {requestVersion: catalogVersion, credentialReceivedAt: receivedAt, models: normalized.models, error: null, fetchedAt: Date.now(), diagnostics: {status: 200, summary: normalized.summary}}});
    await chrome.storage.local.set({settings: {modelId: 'qwen3.8-27b', loginRoute: 'cli', mode: 'browser'}});
  }, {token, catalogVersion, normalized: inspectModelList(subset)});
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const trigger = ui.getByRole('button', {name: '모델 변경', exact: true});
  await trigger.waitFor(); assert.equal((await state()).catalog.models.length, 5); assert.equal(requests, 0);
  // Observe every painted frame, including a toast carried into an opening
  // dialog. Waiting for animationend alone misses a jump inside the panel.
  await ui.evaluate(() => {
    window.toastFrames = [];
    const sample = () => {
      const toast = document.querySelector('.cx-toast');
      if (toast) {
        const box = toast.getBoundingClientRect();
        const panel = toast.closest('[role="dialog"]');
        window.toastFrames.push({x: box.x, y: box.y, width: box.width, viewport: innerWidth,
          inModal: !!panel, panelTransform: panel ? getComputedStyle(panel).transform : null});
      }
      window.toastFrameId = requestAnimationFrame(sample);
    };
    sample();
  });
  check('a fresh populated cache reproduces the five reported CLI/rag/general labels');
  await trigger.click();
  await poll(() => requests, 1); await poll(async () => (await state()).catalog.models.length, 10);
  const options = ui.locator('.model-options').getByRole('button');
  await poll(() => options.count(), 10);
  assert.deepEqual(new Set(await options.allTextContents()), new Set(full.modelList.map(model => model.display_name)));
  assert.equal((await state()).settings.modelId, 'qwen3.8-27b');
  assert.equal((await state()).catalog.diagnostics.summary.excluded.target, 0);
  check('opening the picker bypasses the five-item cache and shows all ten API names, including names without underscores');
  await ui.setViewportSize({width: 360, height: 800});
  const refresh = ui.getByRole('dialog', {name: '모델 선택'}).getByRole('button', {name: '모델 목록 새로고침', exact: true});
  assert.equal(await refresh.count(), 1);
  await poll(() => refresh.isEnabled(), true);
  await ui.getByRole('textbox', {name: '모델 검색'}).fill('_CLI'); await poll(() => options.count(), 3);
  await ui.getByRole('textbox', {name: '모델 검색'}).fill(''); await poll(() => options.count(), 10);
  const dialog = ui.getByRole('dialog', {name: '모델 선택'});
  assert.doesNotMatch(await dialog.innerText(), /서버 수신|표시\s*\d|전체\s*\d|검색\s*\d/);
  const placement = await refresh.evaluate(el => {
    const actions = el.closest('.provider-account-actions'), panel = el.closest('[role="dialog"]');
    const a = actions.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return {inFooter: !!actions.closest('footer'), rightGap: p.right - a.right, belowCenter: a.top > p.top + p.height / 2};
  });
  assert(placement.inFooter && placement.belowCenter && placement.rightGap >= 0 && placement.rightGap <= 32);
  await mkdir('verification', {recursive: true});
  assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ui.screenshot({path: 'verification/model-catalog-refresh-360.png'});
  check('search is the only display filter and a visible icon refreshes even a non-empty catalog');
  mode = 'error'; await refresh.click(); await poll(() => requests, 2); await poll(async () => (await state()).catalog.error, 'upstream');
  assert.equal((await state()).catalog.models.length, 10); assert.equal((await state()).settings.modelId, 'qwen3.8-27b');
  check('a failed refresh preserves the prior models and selected model');
  mode = 'five'; await poll(() => refresh.isEnabled(), true); await refresh.click();
  await poll(() => requests, 3); await poll(async () => (await state()).catalog.error, null); await poll(() => options.count(), 5);
  assert.equal((await state()).catalog.diagnostics.summary.received, 5);
  assert.equal((await state()).catalog.diagnostics.summary.usable, 5);
  assert.equal(await refresh.count(), 1);
  check('an actual five-item API response is reported as received five and displayed five, without invented models');
  await ui.keyboard.press('Escape'); mode = 'full'; await trigger.click();
  await poll(() => requests, 4); await poll(() => options.count(), 10);
  await ui.setViewportSize({width: 1100, height: 850});
  await ui.getByRole('button', {name: '모델 목록 새로고침', exact: true}).click();
  await poll(() => requests, 5); await poll(() => refresh.isEnabled(), true);
  await ui.locator('.cx-toast').waitFor();
  await ui.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await ui.screenshot({path: 'verification/model-catalog-refresh-1100.png'});
  const toastFrames = await ui.evaluate(() => {cancelAnimationFrame(window.toastFrameId); return window.toastFrames;});
  const misplaced = toastFrames.filter(box => Math.abs(box.y - (box.viewport <= 600 ? 12 : 24)) >= 1 ||
    box.x < 0 || box.x + box.width > box.viewport || Math.abs(box.x + box.width / 2 - box.viewport / 2) >= 1);
  await writeFile('verification/model-toast-frames.json', JSON.stringify({frames: toastFrames, misplaced}, null, 2));
  assert(toastFrames.some(frame => frame.inModal && frame.viewport === 360));
  assert(toastFrames.some(frame => frame.inModal && frame.viewport === 1100));
  assert.equal(misplaced.length, 0, `Toast moved with the dialog: ${JSON.stringify(misplaced.slice(0, 3))}`);
  check('model feedback stays at the viewport top through opening animations and resizing');
  await ui.keyboard.press('Escape'); await ui.reload(); await trigger.waitFor();
  assert.equal((await state()).settings.modelId, 'qwen3.8-27b'); assert.equal(requests, 5);
  assert.deepEqual(errors, []);
  check('reopening refreshes again; reloading the app preserves the selected model and valid catalog');
  await writeFile('verification/model-catalog-refresh-browser.json', JSON.stringify({version: manifest.version, checks, requests, errors, actualBrowser: true, syntheticAPI: true, companyAPI: false}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
