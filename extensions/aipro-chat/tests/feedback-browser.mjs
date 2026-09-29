import {clickComposerAction} from './helpers/composer-actions.mjs';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-feedback-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], toastPositions = [];
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
const reply = '## 오늘의 작업\n\n페이지 내용을 확인하고 필요한 부분을 정리했습니다.\n\n> 저장 결과는 화면에서 다시 확인하세요.\n\n```javascript\nconst message = "안녕하세요";\nconsole.log(message);\n```\n\n| 항목 | 상태 |\n| --- | --- |\n| 제목 | 확인 완료 |\n| 본문 | 입력 완료 |';
const code = 'const message = "안녕하세요";\nconsole.log(message);';
let context, ui, worker, release, failModels = false;
const check = message => {checks.push(message); console.log(`PASS ${message}`);};
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const toast = () => ui.locator('.cx-toast .toast__text');
async function expectToast(text) {
  await ui.waitForFunction(text => document.querySelectorAll('.cx-toast').length === 1 && document.querySelector('.cx-toast .toast__text')?.textContent === text, text);
  const type = await toast().evaluate(el => {const s = getComputedStyle(el); return {font: s.fontFamily, size: s.fontSize, line: s.lineHeight, weight: s.fontWeight};});
  assert(type.font.includes('Noto Sans KR')); assert.equal(type.size, '14px'); assert.equal(type.line, '22px'); assert.equal(type.weight, '400');
}
async function dismiss() {const close = ui.getByRole('button', {name: '알림 닫기', exact: true}); if (await close.count()) await close.click();}
async function capture(name) {await ui.screenshot({path: resolve(`verification/feedback-${name}.png`)});}
async function fit() {assert(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));}
async function expectTopToast(surface) {
  await ui.waitForFunction(() => {
    const box = document.querySelector('.cx-toast')?.getBoundingClientRect();
    const inset = innerWidth <= 600 ? 12 : 24;
    return box && Math.abs(box.top - inset) < 1 && box.left >= 0 && box.right <= innerWidth && box.bottom < innerHeight / 2;
  });
  const position = await ui.locator('.cx-toast').evaluate(el => {
    const {x, y, width, height} = el.getBoundingClientRect();
    return {viewport: {width: innerWidth, height: innerHeight}, x, y, width, height, inModal: !!el.closest('[role="dialog"]')};
  });
  assert.equal(position.inModal, surface === 'modal');
  assert(Math.abs(position.x + position.width / 2 - position.viewport.width / 2) < 1);
  toastPositions.push({surface, ...position});
}
try {
  await mkdir('verification', {recursive: true}); await cp(resolve(process.env.TEST_EXTENSION || 'dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*'); // Fixture copy only.
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(12000);
  await context.route('https://work.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<title>업무 요청</title><h1>업무 요청</h1><label>제목<input aria-label="제목"></label>'}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({contentType: 'application/json', body: JSON.stringify(failModels ? {unexpected: []} : {modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', context_length: 524288}, {name: 'QWEN3.8-27B-FP8-256K', display_name: 'Qwen3.8-27B', context_length: 262144}]})});
    if (route.request().postDataJSON().messages[0]?.content?.startsWith("You are Nubi's completion-intent reviewer.")) return route.fulfill({json:{choices:[{message:{content:JSON.stringify({decision:'reply',scope:'conversation',next_step:''})},finish_reason:'stop'}]}});
    await new Promise(resolve => {release = resolve;});
    return route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices: [{delta: {content: reply}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 40, total_tokens: 140}})}\n\ndata: [DONE]\n\n`});
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // This suite checks detailed execution UI; ordinary mode is covered by debug-plan-ui-browser.
  await worker.evaluate(() => chrome.storage.local.set({debugMode: true}));
  const url = `chrome-extension://${new URL(worker.url()).hostname}/index.html`;
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); // Isolated test profile only.
  await worker.evaluate(token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 22}}), token);
  const portal = await context.newPage(); await portal.goto('https://work.example.test/form');
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message)); await ui.goto(url); await ui.setViewportSize({width: 360, height: 800});
  await ui.getByRole('button', {name: '모델 변경', exact: true}).waitFor();
  await portal.bringToFront(); const sourceTab = await worker.evaluate(async () => (await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0].id);
  const chatTab = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({sourceTab, chatTab}) => chrome.storage.session.set({chatSourceTabs: {[chatTab]: sourceTab}}), {sourceTab, chatTab});
  await ui.bringToFront();
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('업무 정리 예시를 보여줘');
  assert.notEqual(await ui.locator('.composer').evaluate(el => getComputedStyle(el).boxShadow), 'none');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await ui.locator('.reply-status').waitFor(); await capture('pending');
  while (!release) await new Promise(resolve => setTimeout(resolve, 25)); release();
  await ui.waitForFunction(() => !document.querySelector('.reply-status'));
  await ui.getByRole('button', {name: '코드 복사', exact: true}).waitFor();
  const answerCopy = ui.locator('.message-actions .copy-control button');
  await answerCopy.click(); await expectToast('답변을 복사했습니다.');
  assert.equal(await ui.evaluate(() => navigator.clipboard.readText()), reply);
  assert.match(await answerCopy.getAttribute('aria-label'), /복사 완료$/);
  assert.equal(await answerCopy.evaluate(el => el === document.activeElement), true);
  await expectTopToast('chat');
  // A late kit stylesheet must not restore its default bottom anchor. The
  // visible notice stays top-centered through resizing and modal portals.
  const kitToastStyle = await readFile('node_modules/@e2e/cx-design-system/reference/styles/toast.css', 'utf8');
  await ui.addStyleTag({content: kitToastStyle.match(/\.cx-toast-region\s*\{[^}]+\}/)[0]});
  for (const width of [360, 800, 1280, 390]) {
    await ui.setViewportSize({width, height: 844});
    await expectTopToast('chat');
    assert.equal(await ui.locator('.cx-toast-region').evaluate(el => el.computedStyleMap().get('bottom').toString()), 'auto');
    assert.equal(await ui.locator('.cx-toast-region').evaluate(el => getComputedStyle(el).transform), 'none');
    assert.equal(await ui.locator('.cx-toast').count(), 1);
  }
  await ui.setViewportSize({width:360,height:800});
  check('late kit positioning cannot restore bottom anchoring; one top-centered toast survives 360, 390, 800 and 1280px resizing');
  await capture('copy-panel');
  await dismiss(); await ui.getByRole('button', {name: '코드 복사', exact: true}).click(); await expectToast('코드를 복사했습니다.');
  assert.equal(await ui.evaluate(() => navigator.clipboard.readText()), code);
  check('answer and code buttons write the exact text to Chrome clipboard, show a check and one CX toast without moving focus');
  await ui.getByRole('textbox', {name: '메시지', exact: true}).focus();
  await ui.locator('.cx-toast').waitFor({state: 'detached'});
  await ui.getByRole('button', {name: '코드 복사', exact: true}).waitFor();
  check('success feedback expires and the original copy control returns');
  // Deferred/denied clipboard is a controlled fault. Successful copies above
  // and the retry below use the real browser Clipboard API.
  await ui.evaluate(() => {
    window.realWrite = navigator.clipboard.writeText.bind(navigator.clipboard); window.copyCalls = 0;
    navigator.clipboard.writeText = () => {window.copyCalls++; return new Promise((resolve, reject) => {window.rejectCopy = reject;});};
  });
  await answerCopy.click(); await answerCopy.evaluate(el => el.click());
  assert.equal(await ui.evaluate(() => window.copyCalls), 1); assert.equal(await answerCopy.getAttribute('aria-busy'), 'true');
  assert.equal(await toast().count(), 0);
  await ui.evaluate(() => window.rejectCopy(new DOMException('Synthetic denial', 'NotAllowedError')));
  await expectToast('복사하지 못했습니다. 다시 시도해 주세요.');
  await ui.getByRole('textbox', {name: '메시지', exact: true}).focus(); await ui.locator('.cx-toast').waitFor({state: 'detached'});
  assert.equal(await ui.locator('.message-actions .copy-error').innerText(), '복사 실패. 다시 눌러주세요.');
  assert(!await answerCopy.getAttribute('aria-label').then(value => value.includes('완료')));
  await ui.evaluate(() => {navigator.clipboard.writeText = window.realWrite;});
  await answerCopy.click(); await expectToast('답변을 복사했습니다.'); assert.equal(await ui.evaluate(() => navigator.clipboard.readText()), reply); assert.equal(await ui.locator('.copy-error').count(), 0);
  check('pending copy cannot duplicate or claim success; denied copy keeps a visible retry path after its toast expires');
  await dismiss(); await ui.getByRole('button', {name: '설정', exact: true}).click(); await ui.getByText('연결 진단', {exact: true}).click();
  await ui.getByRole('button', {name: '진단 복사', exact: true}).click(); await expectToast('진단을 복사했습니다.');
  const diagnostic = JSON.parse(await ui.evaluate(() => navigator.clipboard.readText())); assert.equal(diagnostic.provider, 'aipro'); assert(!JSON.stringify(diagnostic).includes(token));
  assert.equal(diagnostic.product, 'nubi'); assert.equal(diagnostic.version, 'Beta 1.0.0');
  assert.equal(diagnostic.extensionVersion, manifest.version);
  assert.equal(await ui.locator('.cx-toast').evaluate(el => !!el.closest('[role="dialog"]')), true);
  await expectTopToast('modal');
  await capture('copy-modal');
  await ui.getByRole('button', {name: '알림 닫기', exact: true}).focus(); await ui.keyboard.press('Escape');
  if (await ui.locator('.cx-toast').count()) await ui.keyboard.press('Escape');
  await ui.locator('.cx-toast').waitFor({state: 'detached'}); assert.equal(await ui.getByRole('dialog', {name: '설정', exact: true}).count(), 1);
  await ui.getByRole('dialog', {name: '설정', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  check('diagnostic copy is sanitized and the common toast stays keyboard-operable inside the modal without closing it');
  await ui.getByRole('button', {name: '모델 변경', exact: true}).click(); await capture('model-panel');
  const selected = ui.locator('.model-option[aria-pressed="true"]');
  assert.equal(await selected.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 241, 254)');
  await ui.getByRole('button', {name: 'GLM-5.2-512K', exact: true}).click(); await expectToast('모델을 적용했습니다.'); assert.equal((await state()).settings.modelId, 'GLM-5.2-NVFP4');
  await dismiss();
  const openedCatalog = ui.waitForResponse(response => response.url().endsWith('/api/models'));
  await ui.getByRole('button', {name: '모델 변경', exact: true}).click(); await openedCatalog;
  await ui.waitForFunction(() => {const button = document.querySelector('.provider-account-actions [data-action="refresh"]'); return button && !button.disabled;});
  failModels = true;
  const failedCatalog = ui.waitForResponse(response => response.url().endsWith('/api/models'));
  await ui.getByRole('button', {name: '모델 목록 새로고침', exact: true}).click();
  await failedCatalog;
  await ui.waitForFunction(() => {const button = document.querySelector('.provider-account-actions [data-action="refresh"]'); return button && !button.disabled;});
  await ui.getByRole('dialog', {name: '모델 선택', exact: true}).getByRole('alert').waitFor(); assert.equal(await toast().count(), 0);
  failModels = false; await ui.getByRole('button', {name: '모델 목록 새로고침', exact: true}).click(); await expectToast('모델 목록을 불러왔습니다.'); await dismiss();
  await ui.getByRole('dialog', {name: '모델 선택', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  check('model selection uses CX selected color and only successful changes/refreshes announce completion');
  await clickComposerAction(ui, '현재 페이지 연결'); await expectToast('페이지를 연결했습니다.');
  assert.equal(await ui.getByRole('button', {name: '현재 페이지 연결', exact: true, includeHidden: true}).getAttribute('aria-pressed'), 'true');
  await dismiss(); await clickComposerAction(ui, '현재 페이지 연결'); await expectToast('페이지 연결을 해제했습니다.'); assert.equal((await state()).page, null);
  await dismiss(); await clickComposerAction(ui, '현재 페이지 연결'); await expectToast('페이지를 연결했습니다.'); await dismiss();
  check('the page icon toggles a real fixture connection and its selected state matches storage');
  await clickComposerAction(ui, '스킬 선택'); await ui.getByRole('button', {name: '스킬 등록', exact: true}).click();
  await ui.getByRole('textbox', {name: '이름', exact: true}).fill('업무 정리'); await ui.getByRole('textbox', {name: '지침', exact: true}).fill('현재 화면을 읽고 필요한 업무를 간단히 정리합니다.');
  await ui.evaluate(() => {window.realMessage = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = message => message.type === 'SAVE_SKILL' ? Promise.resolve({ok: false, error: 'storage_failed'}) : window.realMessage(message);});
  await ui.getByRole('button', {name: '저장', exact: true}).click(); await ui.getByRole('dialog', {name: '스킬 등록', exact: true}).getByRole('alert').waitFor();
  assert.equal(await ui.getByRole('textbox', {name: '이름', exact: true}).inputValue(), '업무 정리'); assert.equal(await toast().count(), 0);
  await ui.evaluate(() => {chrome.runtime.sendMessage = window.realMessage;}); await ui.getByRole('button', {name: '저장', exact: true}).click(); await ui.getByRole('dialog', {name: '스킬 등록', exact: true}).waitFor({state: 'detached'}); await expectToast('스킬을 저장했습니다.');
  assert.equal(await ui.getByRole('button', {name: '스킬 선택', exact: true, includeHidden: true}).getAttribute('data-active'), 'true');
  assert((await state()).skills.some(skill => skill.name === '업무 정리')); await dismiss();
  check('skill save confirms persistence, applies its accent and retains draft with no success message on failure');
  // The trace fixture checks presentation only, not execution of these tools.
  await worker.evaluate(async () => {const {chat} = await chrome.storage.local.get('chat'); chat.messages.at(-1).trace = [{tool: 'inspect_dom', status: 'done'}, {tool: 'fill_form', status: 'done'}, {tool: 'verify_form', status: 'error'}]; await chrome.storage.local.set({chat});});
  await ui.locator('.agent-trace li[data-tool="verify_form"][data-status="error"]').waitFor({state:'attached'});
  await ui.locator('.agent-trace > summary').click(); assert.equal(await ui.locator('.agent-step-done').count(), 2); assert.equal(await ui.locator('.agent-step-error').count(), 1);
  assert.equal(await ui.locator('.agent-trace li[data-status="done"]').first().getByText('완료', {exact: true}).count(), 1);
  for (const [width, height] of [[360, 800], [1100, 850], [320, 640]]) {
    await ui.setViewportSize({width, height}); await fit(); await ui.getByRole('textbox', {name: '메시지', exact: true}).focus();
    const box = await ui.locator('.composer').boundingBox(); assert(box.y + box.height <= height && height - box.y - box.height <= 17);
    await capture(`chat-${width}x${height}`);
    await answerCopy.click(); await expectToast('답변을 복사했습니다.'); await expectTopToast('chat');
    await capture(`toast-chat-${width}x${height}`); await dismiss();
    await ui.getByRole('button', {name: '설정', exact: true}).click(); await ui.getByText('연결 진단', {exact: true}).click();
    await ui.getByRole('button', {name: '진단 복사', exact: true}).click(); await expectToast('진단을 복사했습니다.'); await expectTopToast('modal');
    await capture(`toast-modal-${width}x${height}`); await dismiss();
    await ui.getByRole('dialog', {name: '설정', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  }
  check('chat and modal toasts stay at the viewport top center at 320, 360 and 1100px without overflow');
  await ui.setViewportSize({width: 1100, height: 850}); await ui.getByRole('button', {name: '사용량', exact: true}).click();
  assert.equal(await ui.locator('.usage-provider[data-active="true"] summary').getAttribute('aria-label'), 'AI Pro 토큰 상세'); await capture('usage');
  await ui.getByRole('dialog', {name: '사용량', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  await ui.emulateMedia({reducedMotion: 'reduce'}); assert(await ui.locator('.composer').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) <= .001));
  await ui.getByRole('button', {name: '모델 변경', exact: true}).click();
  await ui.getByRole('button', {name: '모델 목록 새로고침', exact: true}).click();
  await expectToast('모델 목록을 불러왔습니다.'); await expectTopToast('modal');
  assert.equal(await ui.getByRole('dialog', {name: '모델 선택', exact: true}).evaluate(el => getComputedStyle(el).animationName), 'none');
  await dismiss();
  await ui.getByRole('dialog', {name: '모델 선택', exact: true}).getByRole('button', {name: '닫기', exact: true}).click();
  await ui.reload(); await ui.getByRole('button', {name: '추가', exact: true}).waitFor(); assert.equal(await ui.getByRole('button', {name: '스킬 선택', exact: true, includeHidden: true}).getAttribute('data-active'), 'true');
  assert.equal((await state()).settings.modelId, 'GLM-5.2-NVFP4'); assert.deepEqual(errors, []);
  check('trace statuses use icons plus text, cards remain readable across three widths, reduced motion and reload preserve the correct UI state');
  await writeFile('verification/feedback-browser.json', JSON.stringify({version: manifest.version, checks, toastPositions, actualClipboardSuccess: true, syntheticClipboardFailure: true, syntheticModelResponses: true, fixtureSiteAccessPregranted: true, actualCompanyVerified: false}, null, 2));
} catch (error) {console.error({errors, state: ui ? await state().then(value => ({auth: value.auth, last: value.chat.messages.at(-1)})).catch(() => null) : null}); if (ui) await capture('failure').catch(() => {}); throw error;}
finally {release?.(); await context?.close(); await rm(profile, {recursive: true, force: true});}
