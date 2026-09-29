import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, cp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chatgptToken, responsesSSE} from './fixtures/chatgpt.mjs';
import {connection, models, nativeResponse, messageReply} from './fixtures/fabrix.mjs';
import {forbidLoginDebugger, assertNoLoginDebugger} from './helpers/no-login-debugger.mjs';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {ATTACHMENT_LIMITS} from '../attachment-limits.js';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-files-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], requests = [];
const conversationDecision = JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''});
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
const aiproModels = [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2', context_length: 524288}, {name: 'QWEN3.8-27B-FP8-256K', display_name: 'Qwen3.8', context_length: 262144}];
let context, page, worker;
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
const rpc = (type, value = {}) => page.evaluate(async ({type, value}) => {
  const reply = await chrome.runtime.sendMessage({type, ...value}); if (!reply.ok) throw new Error(reply.error); return reply.data;
}, {type, value});
const state = () => rpc('GET_STATE');
async function poll(fn, expected) {let value; for (let i = 0; i < 200; i++) {value = await fn(); if (value === expected) return; await new Promise(resolve => setTimeout(resolve, 50));} assert.deepEqual(value, expected);}
const input = () => page.locator('input[type=file][aria-label="첨부 파일 선택"]');
const textFile = {name: 'guide.ts', mimeType: 'text/plain', buffer: Buffer.from('export const headline = "첨부 자료 기반 소개";\n// source-attachment-marker\n// <script>window.attachmentExecuted = true</script>')};
async function upload(files) {await input().setInputFiles(files); await poll(() => page.getByRole('button', {name: '파일 첨부', exact: true, includeHidden: true}).isEnabled(), true);}
async function send(text) {
  const before = (await state()).chat.messages.at(-1)?.id;
  await page.getByRole('textbox', {name: '메시지', exact: true}).fill(text);
  await page.getByRole('button', {name: '전송', exact: true}).click();
  try {await poll(async () => {const reply = (await state()).chat.messages.at(-1); return reply?.id !== before && reply?.state === 'done';}, true);} catch (error) {const latest = await state(); console.error({provider: latest.activeProvider, error: latest.chat.messages.at(-1)?.error, requests: requests.map(request => request.provider)}); throw error;}
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chromium', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({json: {modelList: aiproModels}});
    const body = route.request().postDataJSON();
    if (body.messages[0].content.startsWith(COMPLETION_REVIEW_PROMPT)) return route.fulfill({json: {choices: [{message: {content: conversationDecision}, finish_reason: 'stop'}]}});
    requests.push({provider: 'aipro', body});
    return route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices: [{delta: {content: '첨부 자료를 참고했습니다.'}, finish_reason: 'stop'}]})}\n\ndata: [DONE]\n\n`});
  });
  await context.route('https://chatgpt.com/backend-api/codex/responses', async route => {
    const body = route.request().postDataJSON();
    if (body.instructions.startsWith(COMPLETION_REVIEW_PROMPT)) return route.fulfill({contentType: 'text/event-stream', body: responsesSSE({text: conversationDecision})});
    requests.push({provider: 'chatgpt', body});
    return route.fulfill({contentType: 'text/event-stream', body: responsesSSE({text: '첨부 이미지를 확인했습니다.'})});
  });
  await context.route('https://fabrix.example.test/**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({json: models});
    const body = route.request().postDataJSON();
    if (body.systemPrompt.startsWith(COMPLETION_REVIEW_PROMPT)) {
      const response = nativeResponse(conversationDecision, {stream: body.isStream});
      return route.fulfill({contentType: response.headers.get('content-type'), body: await response.text()});
    }
    requests.push({provider: 'fabrix', body});
    const response = nativeResponse(messageReply(body, '첨부 소스를 확인했습니다.'), {stream: body.isStream});
    return route.fulfill({contentType: response.headers.get('content-type'), body: await response.text()});
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 7}}), token);
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async () => (await state()).catalog?.models?.length, 2);
}
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true}); await forbidLoginDebugger(extension);
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await launch();
  await rpc('SAVE_MODELS', {credentialReceivedAt: 7, payload: {modelList: [aiproModels[0]]}, status: 200});
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 200;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e8f1fe'; ctx.fillRect(0, 0, 360, 200);
    ctx.fillStyle = '#189bb0'; ctx.beginPath(); ctx.arc(180, 88, 46, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#191f28'; ctx.font = '18px sans-serif'; ctx.fillText('Reference image', 114, 165);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const picture = {name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')};
  await upload([textFile, picture]);
  await poll(async () => (await state()).chat.draftAttachments?.length, 2);
  const originalId = (await state()).chat.sessionId;
  const fileIds = (await state()).chat.draftAttachments.map(file => file.id);
  const ownership = await page.evaluate(async ({id, conversationId}) => {
    const {readAttachment} = await import(chrome.runtime.getURL('attachment-store.js'));
    return readAttachment(id, {provider: 'chatgpt', conversationId}).then(() => 'leaked', error => error.message);
  }, {id: fileIds[0], conversationId: originalId});
  assert.equal(ownership, 'attachment_missing');
  assert.equal(requests.length, 0);
  assert(await page.getByRole('button', {name: '전송', exact: true}).isDisabled());
  await page.getByText('이미지 지원 모델을 선택해주세요.', {exact: true}).waitFor();
  const blocked = await page.evaluate(async conversationId => chrome.runtime.sendMessage({type: 'START_CHAT', text: '확인', conversationId}), originalId);
  assert.equal(blocked.error, 'attachment_vision'); assert.equal((await state()).chat.messages.length, 0);
  check('selecting files stores them locally without a model call; unsupported image sends preserve the draft');
  for (const [width, height] of [[320, 740], [360, 800], [1100, 850]]) {
    await page.setViewportSize({width, height});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const sendBox = await page.getByRole('button', {name: '전송', exact: true}).boundingBox();
    assert(sendBox.x + sendBox.width <= width && sendBox.y + sendBox.height <= height);
    await page.screenshot({animations: 'disabled', path: `verification/attachments-draft-${width}.png`});
    await page.getByRole('button', {name: 'reference.png 미리보기', exact: true}).click();
    const viewer = page.getByRole('dialog', {name: 'reference.png', exact: true}); await viewer.waitFor();
    await poll(() => viewer.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    await page.screenshot({animations: 'disabled', path: `verification/attachments-preview-${width}.png`});
    await page.keyboard.press('Escape'); await viewer.waitFor({state: 'hidden'});
    assert(await page.getByRole('button', {name: 'reference.png 미리보기', exact: true}).evaluate(button => document.activeElement === button));
  }
  await page.getByRole('button', {name: 'guide.ts 미리보기', exact: true}).click();
  const codeViewer = page.getByRole('dialog', {name: 'guide.ts', exact: true});
  await codeViewer.getByRole('region').waitFor(); assert(await codeViewer.locator('.code-line-number').count() > 1);
  await page.setViewportSize({width: 320, height: 740});
  const sourceScroll = await codeViewer.getByRole('region').evaluate(pre => {
    pre.scrollLeft = pre.scrollWidth;
    return {overflow: getComputedStyle(pre).overflowX, moved: pre.scrollLeft, clipped: pre.scrollWidth > pre.clientWidth};
  });
  assert.equal(sourceScroll.overflow, 'auto'); assert(sourceScroll.clipped && sourceScroll.moved > 0, 'long source lines remain readable in a narrow panel');
  await page.screenshot({animations: 'disabled', path: 'verification/attachment-code-320.png'});
  assert.equal(await page.evaluate(() => window.attachmentExecuted), undefined);
  const downloadEvent = page.waitForEvent('download'); await codeViewer.getByRole('button', {name: '첨부 파일 다운로드'}).click();
  const download = await downloadEvent; assert.equal(download.suggestedFilename(), 'guide.ts'); assert.equal(await download.failure(), null);
  assert.equal(await readFile(await download.path(), 'utf8'), textFile.buffer.toString()); await page.keyboard.press('Escape');
  await page.setViewportSize({width: 1100, height: 850});
  check('responsive previews, syntax highlighting, focus restoration and downloaded source bytes work without executing the file');
  await page.reload(); await poll(async () => (await state()).chat.draftAttachments?.length, 2);
  await rpc('NEW_CHAT', {conversationId: originalId}); await poll(async () => (await state()).chat.sessionId !== originalId, true);
  await rpc('SELECT_CONVERSATION', {id: originalId, conversationId: (await state()).chat.sessionId});
  await poll(async () => (await state()).chat.draftAttachments?.length, 2);
  await context.close(); await launch(); await poll(async () => (await state()).chat.draftAttachments?.length, 2);
  await page.getByRole('button', {name: 'reference.png 미리보기', exact: true}).click();
  await poll(() => page.getByRole('dialog').locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true); await page.keyboard.press('Escape');
  check('draft-only conversations and IndexedDB file bytes survive navigation, reload and a full browser restart');
  const beforeInvalid = (await state()).chat.draftAttachments.map(file => file.id);
  await upload([textFile, textFile, textFile]);
  await page.getByText('한 번에 파일 4개까지 첨부할 수 있습니다.', {exact: true}).waitFor();
  assert.deepEqual((await state()).chat.draftAttachments.map(file => file.id), beforeInvalid);
  await upload({name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('bad')});
  await page.getByText('이미지, PDF, Word(docx) 또는 텍스트 소스를 선택해주세요.', {exact: true}).waitFor();
  await upload({name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(ATTACHMENT_LIMITS.textChars + 1, 65)});
  assert.deepEqual((await state()).chat.draftAttachments.map(file => file.id), beforeInvalid);
  await upload({name: 'binary.txt', mimeType: 'text/plain', buffer: Buffer.from([255, 0, 2])});
  await page.getByText('UTF-8 텍스트 파일을 선택해주세요.', {exact: true}).waitFor();
  assert.deepEqual((await state()).chat.draftAttachments.map(file => file.id), beforeInvalid);
  check('unsupported, oversized and binary selections do not replace existing attachments');
  await poll(async () => (await state()).settings.modelId, 'GLM-5.2-NVFP4');
  await send('자료와 이미지에 맞게 정리해줘');
  const sent = requests.at(-1).body;
  assert.equal(sent.model, 'QWEN3.8-27B-FP8-256K');
  assert.equal((await state()).settings.modelId, 'GLM-5.2-NVFP4');
  assert(JSON.stringify(sent).includes('source-attachment-marker')); assert(JSON.stringify(sent).includes('reference.png'));
  assert(sent.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.image_url?.url === `data:image/png;base64,${png}`)));
  assert(!JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null))).includes('source-attachment-marker'));
  assert.deepEqual((await state()).chat.messages.find(message => message.role === 'user').attachments.map(file => file.id), fileIds);
  assert.equal((await state()).chat.draftAttachments.length, 0);
  check('AI Pro receives exact image and source contents through the Pi loop; local transcript stores references only');
  await rpc('SELECT_MODEL', {name: 'GLM-5.2-NVFP4'}); await send('설명만 이어가');
  const historical = JSON.stringify(requests.at(-1).body);
  assert.equal(requests.at(-1).body.model, 'QWEN3.8-27B-FP8-256K');
  assert(historical.includes(png)); assert(historical.includes('source-attachment-marker'));
  await page.screenshot({animations: 'disabled', path: 'verification/attachments-chat-1100.png'});
  check('a selected text model automatically routes image history to Qwen and preserves source text');
  await worker.evaluate(async ({gpt, connection}) => chrome.storage.session.set({providerSessions: {
    chatgpt: {credential: {provider: 'chatgpt', mode: 'browser', token: gpt, expiresAt: Date.now() + 3600000, receivedAt: 8}},
    fabrix: {credential: {...connection, provider: 'fabrix', mode: 'api', receivedAt: 9}},
  }}), {gpt: chatgptToken(), connection});
  await rpc('SELECT_PROVIDER', {provider: 'chatgpt'});
  await poll(async () => (await state()).catalog?.models?.some(model => model.supportsImages), true);
  await upload(picture); await send('');
  const gptFile = (await state()).chat.messages.find(message => message.role === 'user').attachments[0].id;
  const gptBody = requests.findLast(request => request.provider === 'chatgpt').body;
  assert(gptBody.input.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'input_image' && part.image_url === `data:image/png;base64,${png}`)));
  assert(!JSON.stringify(gptBody).includes('source-attachment-marker'));
  await rpc('SELECT_PROVIDER', {provider: 'fabrix'}); await poll(async () => (await state()).catalog?.models?.length, models.length);
  await rpc('SELECT_MODEL', {name: connection.modelId}); await upload(textFile); await send('첨부 소스를 설명해줘');
  const fabrixBody = requests.findLast(request => request.provider === 'fabrix').body;
  assert(JSON.stringify(fabrixBody).includes('source-attachment-marker')); assert(!JSON.stringify(fabrixBody).includes(png));
  await upload(picture); await page.getByText('이미지 지원 모델을 선택해주세요.', {exact: true}).waitFor();
  assert(await page.getByRole('button', {name: '전송', exact: true}).isDisabled());
  await page.getByRole('button', {name: 'reference.png 제거', exact: true}).click(); await poll(async () => (await state()).chat.draftAttachments.length, 0);
  check('ChatGPT receives input_image, FabriX receives text only, and provider histories remain isolated');
  await rpc('SELECT_PROVIDER', {provider: 'aipro'});
  assert.equal((await state()).chat.sessionId, originalId);
  await rpc('DELETE_CONVERSATION', {id: originalId, conversationId: originalId});
  const missing = await page.evaluate(async ids => {
    const {readAttachment} = await import(chrome.runtime.getURL('attachment-store.js'));
    return Promise.all(ids.map(id => readAttachment(id).then(() => false, () => true)));
  }, fileIds);
  assert(missing.every(Boolean));
  const otherProviderPreserved = await page.evaluate(async id => {
    const {readAttachment} = await import(chrome.runtime.getURL('attachment-store.js')); return (await readAttachment(id)).provider;
  }, gptFile);
  assert.equal(otherProviderPreserved, 'chatgpt');
  await assertNoLoginDebugger(worker); assert.deepEqual(errors, []);
  check('deleting a conversation removes its file bytes; attachment flows never attach a debugger');
  await writeFile('verification/attachments-browser.json', JSON.stringify({synthetic: true, actualChrome: true, actualModel: false, fixtureSiteAccessPregranted: true, assertions: checks, errors}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
