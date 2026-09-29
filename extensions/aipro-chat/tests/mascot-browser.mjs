import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-mascot-'));
const extension = resolve(profile, 'extension');
await cp(resolve('dist'), extension, {recursive: true});
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://*/*', 'https://*/*');
await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
context.setDefaultTimeout(12000);
const checks = [], errors = [], motionSamples = [];
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
let release, fail = false, failedResponseReleased = false;
try {
  await mkdir('verification', {recursive: true});
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', context_length: 524288}]})}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', async route => {
    if (route.request().postDataJSON().messages[0]?.content?.startsWith("You are Nubi's completion-intent reviewer.")) return route.fulfill({json:{choices:[{message:{content:JSON.stringify({decision:'reply',scope:'conversation',next_step:''})},finish_reason:'stop'}]}});
    // Hold the first response for the working-state screenshot. Once released,
    // retries must receive the same error instead of waiting on a second gate.
    if (!fail || !failedResponseReleased) await new Promise(resolve => {release = () => {if (fail) failedResponseReleased = true; resolve();};});
    await route.fulfill(fail ? {status: 502, contentType: 'application/json', body: '{"error":"synthetic upstream failure"}'} : {contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: '내용을 확인했습니다.'}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}})});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width: 360, height: 800});
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const state = () => page.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
  const mascot = page.locator('.nubi-logo .agent-mark');
  const welcome = page.locator('.welcome-emblem .agent-mark');
  const input = page.getByRole('textbox', {name: '메시지', exact: true});
  const button = name => page.getByRole('button', {name, exact: true});
  async function poll(fn, expected, attempts = 240) {let value; for (let i = 0; i < attempts; i++) {value = await fn(); if (value === expected) return; await new Promise(r => setTimeout(r, 50));} assert.equal(value, expected);}
  const style = (locator, property) => locator.evaluate((el, key) => getComputedStyle(el)[key], property);
  async function flyingWhileFocused(label, duration, selectors) {
    const samples = await page.evaluate(async ({duration, selectors}) => {
      const birds = selectors.map(selector => document.querySelector(selector));
      const series = birds.map(() => []), started = performance.now();
      do {
        await new Promise(requestAnimationFrame);
        birds.forEach((bird, index) => {
          const body = getComputedStyle(bird), wing = getComputedStyle(bird.querySelector('.bird-wing'));
          series[index].push({play: body.animationPlayState, wingPlay: wing.animationPlayState,
            wing: Number(wing.opacity), y: new DOMMatrixReadOnly(body.transform).m42,
            focused: document.activeElement?.matches('.composer textarea')});
        });
      } while (performance.now() - started < duration);
      return series.map((values, index) => ({selector: selectors[index], frames: values.length,
        allRunning: values.every(value => value.play === 'running' && value.wingPlay === 'running'),
        allFocused: values.every(value => value.focused),
        minWing: Math.min(...values.map(value => value.wing)), maxWing: Math.max(...values.map(value => value.wing)),
        minY: Math.min(...values.map(value => value.y)), maxY: Math.max(...values.map(value => value.y))}));
    }, {duration, selectors});
    for (const sample of samples) {
      assert(sample.allRunning && sample.allFocused, `${label}: ${JSON.stringify(sample)}`);
      assert(sample.minWing < .2 && sample.maxWing > .7, `${label}: wings must visibly flap`);
      assert(sample.maxY - sample.minY > 2, `${label}: body must lift and land`);
    }
    motionSamples.push({label, duration, samples});
    check(label);
  }
  const settings = () => page.getByRole('dialog', {name: '설정', exact: true});
  async function accountInSettings(name) {
    assert.equal(await page.locator('.cx-kit-topbar').getByRole('button', {name, exact: true}).count(), 0);
    if (!await settings().isVisible()) await button('설정').click();
    const account = settings().getByRole('button', {name, exact: true});
    assert.equal(await account.getAttribute('data-icon-only'), 'true');
    assert.equal(await account.locator('.visually-hidden').count(), 1);
    const bounds = await account.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await button('설정').waitFor();
  assert.equal(await page.getByRole('button', {name: /배경 움직임/}).count(), 0);
  await page.evaluate(() => localStorage.setItem('aipro:motion-paused', 'true'));
  await page.reload(); await button('설정').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('aipro:motion-paused')), null);
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'running');
  await accountInSettings('로그인');
  await button('로그인').click();
  await page.getByRole('dialog', {name: '모델 선택', exact: true}).getByRole('tab', {name: 'AI Pro', exact: true}).waitFor();
  await page.getByRole('dialog', {name: '모델 선택', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  await poll(() => button('설정').evaluate(el => document.activeElement === el), true);
  await page.waitForTimeout(1400);
  await welcome.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  assert.equal(await welcome.getAttribute('aria-hidden'), 'true');
  const alpha = await welcome.locator('.bird-sad').evaluate(img => {const c = document.createElement('canvas'); c.width = c.height = 512; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 512, 512); return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(256, 256, 1, 1).data[3]];});
  assert.equal(alpha[0], 0); assert(alpha[1] >= 250);
  assert.deepEqual(manifest.icons, manifest.action.default_icon);
  for (const size of [16, 32, 48, 128]) {
    const file = await readFile(resolve(extension, manifest.icons[size])); assert.equal(file.readUInt32BE(16), size); assert.equal(file.readUInt32BE(20), size);
  }
  check('all expression frames load locally with transparent art and the toolbar PNG sizes stay valid');
  const welcomeBox = await welcome.boundingBox();
  await page.mouse.move(welcomeBox.x + welcomeBox.width / 2, welcomeBox.y + welcomeBox.height / 2);
  await poll(() => welcome.getAttribute('data-mood'), 'celebrate');
  assert.equal(await style(welcome.locator('.bird-smile'), 'opacity'), '1');
  await page.waitForTimeout(400);
  await page.screenshot({path: 'verification/mascot-login-smile.png'});
  await poll(() => welcome.getAttribute('data-mood'), 'idle');
  check('hover greeting returns to flight without moving the pointer away');
  await page.mouse.move(1, 400);
  await poll(() => welcome.getAttribute('data-mood'), 'idle');
  check('toolbar has no motion toggle; legacy pause is removed and settings login opens provider tabs');
  await page.waitForTimeout(20500);
  await poll(() => welcome.getAttribute('data-mood'), 'sleep');
  assert.equal(await style(welcome.locator('.bird-blink'), 'opacity'), '1');
  assert.equal(await style(welcome.locator('.bird-dream'), 'opacity'), '1');
  assert.equal(await style(welcome.locator('.bird-dream'), 'width'), await style(welcome, 'width'));
  await page.screenshot({path: 'verification/mascot-sleep.png'});
  await page.keyboard.press('Tab');
  await poll(() => welcome.getAttribute('data-mood'), 'idle');
  check('20 seconds of inactivity closes the eyes with breathing and Z marks; keyboard interaction wakes the bird');
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic-mascot-token', receivedAt: 1}}));
  await input.waitFor();
  await poll(async () => (await state()).catalog?.models?.length, 1);
  await page.getByRole('heading', {name: '누비에게 무엇을 맡길까요?', exact: true}).waitFor();
  await page.waitForTimeout(1200);
  for (const width of [320, 360, 1100]) {
    await page.setViewportSize({width, height: 800});
    await accountInSettings('로그아웃');
    await page.screenshot({path: `verification/mascot-toolbar-${width}.png`});
    await settings().getByRole('button', {name: '닫기', exact: true}).click();
  }
  check('icon-only logout stays inside settings without horizontal overflow at 320, 360 and 1100 pixels');
  await input.focus();
  await flyingWhileFocused('wide empty chat keeps the logo and welcome bird flying while typing', 8200, ['.nubi-logo .agent-mark', '.welcome-emblem .agent-mark']);
  await page.screenshot({path: 'verification/mascot-focused-wide.png'});
  await page.setViewportSize({width: 360, height: 800});
  await input.fill('간단히 답해주세요.');
  await flyingWhileFocused('side panel keeps the logo and welcome bird flying with a draft focused', 8200, ['.nubi-logo .agent-mark', '.welcome-emblem .agent-mark']);
  // Playwright fill does not emit keydown; use a real key to leave the idle nap.
  await input.press('ArrowLeft');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.welcome-emblem .bird-wing')).opacity) > .7);
  await page.screenshot({path: 'verification/mascot-focused-wing.png'});
  await input.fill('간단히 답해주세요.');
  await button('전송').click();
  await poll(() => Promise.resolve(!!release), true);
  await button('설정').click();
  assert.equal(await button('로그아웃').isDisabled(), true);
  await settings().getByRole('button', {name: '닫기', exact: true}).click();
  await input.focus();
  await poll(() => mascot.getAttribute('data-mood'), 'working');
  await flyingWhileFocused('working bird keeps flapping during a pending response with composer focus', 3000, ['.nubi-logo .agent-mark']);
  release(); release = null;
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  await poll(() => mascot.getAttribute('data-mood'), 'celebrate');
  const reply = page.locator('.message-assistant .agent-mark').last();
  assert.equal(await reply.getAttribute('data-mood'), 'celebrate');
  assert.equal(await style(mascot.locator('.bird-smile'), 'opacity'), '1');
  assert.equal(await style(reply.locator('.bird-smile'), 'opacity'), '1');
  assert.equal(await style(mascot, 'animationPlayState'), 'running');
  await page.screenshot({path: 'verification/mascot-complete-focused.png'});
  await page.waitForTimeout(4400);
  assert.equal(await reply.getAttribute('data-mood'), 'still');
  await page.reload(); await input.waitFor();
  assert.equal(await reply.getAttribute('data-mood'), 'still');
  check('running tasks disable logout; completion smile remains visible with composer focus for 4.2 seconds and does not replay on reload');
  fail = true;
  await input.fill('실패 상태 확인');
  await button('전송').click();
  await poll(() => Promise.resolve(!!release), true);
  release(); release = null;
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'error', 600);
  await poll(() => mascot.getAttribute('data-mood'), 'sad');
  assert.equal(await style(mascot.locator('.bird-sad'), 'opacity'), '1');
  assert.equal(await style(reply.locator('.bird-sad'), 'opacity'), '1');
  await page.locator('.message-user').last().click();
  await page.waitForTimeout(1000);
  await page.screenshot({path: 'verification/mascot-error.png'});
  const error = (await state()).chat.messages.at(-1).error;
  assert(error);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await poll(() => page.locator('html').getAttribute('data-motion'), 'paused');
  assert.equal(await style(mascot.locator('.bird-sad'), 'opacity'), '1');
  const animations = await page.locator('.agent-mark, .agent-mark *').evaluateAll(elements => elements.map(el => getComputedStyle(el).animationName));
  assert(animations.every(name => name === 'none'), JSON.stringify(animations));
  assert.equal((await state()).chat.messages.at(-1).error, error);
  check('failure shows sad eyes and tears alongside the actual error; OS reduced motion keeps the expression and stops all decorative animations');
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await input.fill('로그아웃 직전 작성한 초안');
  // Do not wait for the draft debounce: the account action must flush it.
  await button('설정').click(); await button('로그아웃').click();
  await page.getByRole('dialog', {name: '모델 선택', exact: true}).waitFor();
  await page.getByRole('dialog', {name: '모델 선택', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  assert.equal((await state()).auth.present, false);
  assert.equal((await state()).chat.draft, '로그아웃 직전 작성한 초안');
  assert.equal(await worker.evaluate(async () => !!(await chrome.storage.session.get('credential')).credential), false);
  await accountInSettings('로그인');
  await page.reload(); await button('설정').waitFor();
  await page.locator('.message-user').first().waitFor();
  await button('설정').click();
  assert.equal((await state()).chat.draft, '로그아웃 직전 작성한 초안');
  await button('로그인').click();
  await page.getByRole('dialog', {name: '모델 선택', exact: true}).getByRole('tab', {name: 'AI Pro', exact: true}).waitFor();
  await page.getByRole('dialog', {name: '모델 선택', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic-mascot-token-2', receivedAt: 2}}));
  await input.waitFor();
  assert.equal(await input.inputValue(), '로그아웃 직전 작성한 초안');
  check('logout clears credentials but saves an immediate draft; history survives reload and the draft returns after reconnection');
  assert.deepEqual(errors, []);
  await writeFile('verification/mascot-browser.json', JSON.stringify({version: manifest.version, checks, motionSamples, errors, syntheticAuthAndResponses: true, liveProvidersVerified: false}, null, 2) + '\n');
} finally {release?.(); await context.close(); await rm(profile, {recursive: true, force: true});}
