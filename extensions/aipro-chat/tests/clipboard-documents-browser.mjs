import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pdfFile, wordFile} from './fixtures/documents.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-documents-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], requests = [], network = [];
let context, page;
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
const state = () => page.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
async function poll(fn, expected) {let value; for (let i = 0; i < 400; i++) {value = await fn(); if (value === expected) return; await new Promise(resolve => setTimeout(resolve, 50));} assert.deepEqual(value, expected);}
async function upload(files) {await page.locator('.attachment-input').setInputFiles(files); await poll(() => page.getByRole('button', {name: '파일 첨부', exact: true, includeHidden: true}).isEnabled(), true);}
const paste = value => page.evaluate(value => {
  const transfer = new DataTransfer();
  if (value.text != null) transfer.setData('text/plain', value.text);
  if (value.image) transfer.items.add(new File([Uint8Array.from(atob(value.image), char => char.charCodeAt(0))], '붙여넣은 이미지.png', {type: 'image/png'}));
  return document.querySelector('#message-input').dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: transfer}));
}, value);
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chromium', executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000); context.on('request', request => {if (/^https?:/.test(request.url())) network.push(request.url());});
  await context.route('https://aipro.sdsdev.co.kr/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({json: {modelList: [{name: 'QWEN3.8-27B-FP8-256K', display_name: 'Qwen3.8', context_length: 262144}]}});
    const body = route.request().postDataJSON();
    if (body.messages[0].content.startsWith(COMPLETION_REVIEW_PROMPT)) return route.fulfill({json: {choices: [{message: {content: JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''})}, finish_reason: 'stop'}]}});
    requests.push(body);
    return route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices: [{delta: {content: '참고 자료를 확인했습니다.'}, finish_reason: 'stop'}]})}\n\ndata: [DONE]\n\n`});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
  await worker.evaluate(async token => chrome.storage.session.set({credential: {provider: 'aipro', token, receivedAt: 7}}), token);
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async () => (await state()).catalog?.models?.length, 1);
  await page.getByRole('textbox', {name: '메시지', exact: true}).fill('자료를 비교해줘');
  assert.equal(await paste({text: '짧은 문장'}), true);
  assert.equal((await state()).chat.draftAttachments?.length || 0, 0);
  const longText = 'clipboard-reference-marker\n' + '누비 참고 문장입니다.\n'.repeat(40);
  assert.equal(await paste({text: longText}), false);
  await poll(async () => (await state()).chat.draftAttachments?.length, 1);
  assert.equal((await state()).chat.draftAttachments[0].source, 'user-paste');
  assert.equal(await page.getByRole('textbox', {name: '메시지', exact: true}).inputValue(), '자료를 비교해줘');
  const image = await page.evaluate(() => {const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 40; canvas.getContext('2d').fillRect(0, 0, 40, 40); return canvas.toDataURL('image/png').split(',')[1];});
  assert.equal(await paste({image}), false); await poll(async () => (await state()).chat.draftAttachments?.length, 2);
  await page.getByRole('button', {name: '붙여넣은 텍스트.txt 미리보기'}).click();
  const pastedViewer = page.getByRole('dialog', {name: '붙여넣은 텍스트.txt', exact: true});
  assert((await pastedViewer.getByRole('region').textContent()).includes('clipboard-reference-marker')); await page.keyboard.press('Escape');
  assert.equal(requests.length, 0);
  check('long clipboard text and copied image become previewable attachments while short paste keeps native input behavior');
  await upload(pdfFile());
  await upload(await wordFile());
  const attached = (await state()).chat.draftAttachments;
  if (attached.length !== 4) console.error((await page.locator('body').innerText()).slice(-600));
  assert.equal(attached.length, 4); assert.equal(attached.filter(file => file.kind === 'document').length, 2);
  assert(!JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null))).includes('Word reference marker'));
  for (const [name, text] of [['계획.pdf', 'PDF reference marker: quarterly plan'], ['문서.docx', 'Word reference marker: 누비 문서 초안']]) {
    await page.getByRole('button', {name: `${name} 미리보기`, exact: true}).click();
    const viewer = page.getByRole('dialog', {name, exact: true}); await viewer.locator('.attachment-document').waitFor();
    assert((await viewer.locator('pre').innerText()).includes(text));
    await page.evaluate(() => {navigator.clipboard.writeText = async value => {window.copiedReference = value;};});
    await viewer.getByRole('button', {name: '내용 복사', exact: true}).click();
    assert((await page.evaluate(() => window.copiedReference)).includes(text));
    await viewer.getByRole('button', {name: '내용 복사 완료', exact: true}).waitFor();
    await page.keyboard.press('Escape');
  }
  const docx = await wordFile(); await page.getByRole('button', {name: '문서.docx 미리보기', exact: true}).click();
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', {name: '첨부 파일 다운로드'}).click();
  const download = await downloadEvent; assert.equal(await download.failure(), null);
  const original = await readFile(await download.path());
  const stored = await page.evaluate(async () => {const {chat} = await chrome.storage.local.get('chat'); const {readAttachment} = await import(chrome.runtime.getURL('attachment-store.js')); const file = await readAttachment(chat.draftAttachments.find(file => file.name.endsWith('.docx')).id); return [...new Uint8Array(await file.blob.arrayBuffer())];});
  assert.deepEqual(original, Buffer.from(stored)); await page.keyboard.press('Escape');
  check('bundled parsers read real PDF and Korean DOCX locally, preview extracted text and preserve original download bytes');
  if (await page.getByRole('button', {name: '알림 닫기', exact: true}).isVisible()) await page.getByRole('button', {name: '알림 닫기', exact: true}).click();
  for (const width of [320, 360, 1100]) {
    await page.setViewportSize({width, height: 850}); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', {name: '붙여넣은 텍스트.txt 미리보기', exact: true}).focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '문서.docx 미리보기');
    const visible = await page.getByRole('button', {name: '문서.docx 미리보기', exact: true}).evaluate(button => {const bounds = button.getBoundingClientRect(), list = button.closest('.attachment-list').getBoundingClientRect(); return bounds.left >= list.left && bounds.right <= list.right;});
    assert(visible, 'keyboard focus reveals offscreen attachments');
    await page.getByRole('textbox', {name: '메시지', exact: true}).focus();
    await page.mouse.move(4, 100);
    await page.locator('.composer .attachment-list').evaluate(list => {list.scrollLeft = 0;});
    const cards = await page.locator('.composer .attachment-chip').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect(), symbol = card.querySelector('.attachment-symbol').getBoundingClientRect(), label = getComputedStyle(card.querySelector('.attachment-name'));
      return {height: box.height, top: box.top, symbolWidth: symbol.width, symbolHeight: symbol.height, font: label.fontFamily, fontSize: label.fontSize};
    }));
    assert.equal(new Set(cards.map(card => JSON.stringify(card))).size, 1, 'all attachment types share geometry and typography');
    await page.screenshot({animations: 'disabled', path: `verification/clipboard-documents-${width}.png`});
    await page.locator('.composer').screenshot({animations: 'disabled', path: `verification/attachment-composer-${width}.png`});
    await page.getByRole('button', {name: '문서.docx 미리보기', exact: true}).click();
    await page.getByRole('dialog', {name: '문서.docx', exact: true}).locator('pre').waitFor();
    await assertModalTypography(page.getByRole('dialog', {name: '문서.docx', exact: true}));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({animations: 'disabled', path: `verification/document-preview-${width}.png`});
    await page.keyboard.press('Escape');
  }
  check('all attachment types align in one compact row and share preview typography and actions at 320, 360 and 1100 pixels');
  await page.reload(); await poll(async () => (await state()).chat.draftAttachments?.length, 4);
  assert.equal(await page.getByRole('textbox', {name: '메시지', exact: true}).inputValue(), '자료를 비교해줘');
  await page.getByRole('button', {name: '전송', exact: true}).click(); await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  const body = JSON.stringify(requests.at(-1));
  for (const marker of ['clipboard-reference-marker', 'PDF reference marker', 'Word reference marker', '누비 문서 초안', 'Document text only', image]) assert(body.includes(marker), marker.slice(0, 40));
  assert(network.every(url => url.startsWith('https://aipro.sdsdev.co.kr/')));
  check('pasted content and extracted documents survive reload and reach the model with explicit text-only provenance');
  await upload(pdfFile(''));
  await page.getByText('문서에서 텍스트를 찾지 못했습니다. 필요한 부분을 이미지로 첨부해주세요.', {exact: true}).waitFor();
  assert.equal((await state()).chat.draftAttachments.length, 0);
  await upload({name: 'broken.docx', mimeType: docx.mimeType, buffer: Buffer.from('not a zip')});
  await page.getByText('문서를 읽지 못했습니다. PDF 또는 Word(docx) 파일을 확인해주세요.', {exact: true}).waitFor();
  assert.equal((await state()).chat.draftAttachments.length, 0);
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['drop-reference-marker'], 'dropped.txt', {type: 'text/plain'}));
    document.querySelector('.composer').dispatchEvent(new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true}));
  });
  await poll(async () => (await state()).chat.draftAttachments?.[0]?.name, 'dropped.txt');
  assert.deepEqual(errors, []);
  check('no-text PDF and corrupt Word show actionable errors without storing junk; dropped files use the same attachment path');
  await writeFile('verification/clipboard-documents-browser.json', JSON.stringify({syntheticModel: true, actualChrome: true, syntheticClipboardAndDropEvents: true, nativeClipboardNotVerified: true, assertions: checks, errors}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
