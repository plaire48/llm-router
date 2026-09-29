import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {build} from 'esbuild';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-rich-editor-')), extension = resolve(profile, 'extension');
const checks = [], errors = [];
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
let context, worker;
const editorHTML = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>교육 안내 작성</title>
<style>body{font:14px/1.8 sans-serif;color:#191f28;background:#f5f8fc;margin:0;padding:28px}main{max-width:760px;margin:auto}header{font-size:14px;color:#4e5968;margin-bottom:16px}.toolbar{display:flex;gap:8px;align-items:center;padding:12px;border-radius:16px 16px 0 0;background:#e8f1fe}button,select{font:inherit;padding:8px 12px;border:0;border-radius:8px;background:white;color:inherit}button:focus-visible,select:focus-visible{outline:2px solid #1b64da}.tiptap,article{background:white;padding:24px 28px;min-height:240px;border-radius:0 0 16px 16px;outline:none}.tiptap p,article p{margin:0 0 14px}.tiptap h2,article h2{font-size:24px;line-height:1.5;margin:0 0 18px;color:#1b64da}footer{display:flex;justify-content:space-between;margin-top:16px}output{color:#4e5968}#publish{background:#e8f1fe;color:#1b64da}section{margin-top:24px}article{border-radius:16px}</style>
<main><header>교육 안내 초안</header><div role="toolbar" aria-label="본문 서식" class="toolbar"><button id="heading">소제목</button><button id="bold" aria-label="굵게"><b>B</b></button><button id="underline" aria-label="밑줄"><u>U</u></button><label>글자 크기 <select id="size" aria-label="글자 크기"><option value="14px">14</option><option value="18px">18</option><option value="24px">24</option></select></label></div>
<div id="editor"></div><footer><output id="status">작성 중</output><div><button id="preview">미리보기</button><button id="publish">등록</button></div></footer><section id="preview-panel" hidden><header>미리보기</header><article id="preview-body"></article></section></main><script src="/editor.js"></script></html>`;
try {
  await mkdir('verification', {recursive: true}); await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,readApprovalDraft,ready:()=>serial(()=>{})};\n');
  const fixture = await build({entryPoints: ['tests/fixtures/rich-editor.js'], bundle: true, write: false, format: 'iife', platform: 'browser'});
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://editor.example.test/**', route => route.fulfill(route.request().url().endsWith('/editor.js') ?
    {contentType: 'application/javascript', body: fixture.outputFiles[0].text} : {contentType: 'text/html; charset=utf-8', body: editorHTML}));
  await context.route('https://mail.example.test/**', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>본문 프레임</title><iframe title="본문 편집기" src="https://editor.example.test/" style="border:0;width:100%;height:900px"></iframe>'}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testBrowserAgent.ready());
  // This suite covers the explicit current-tab workflow; workspace suites cover the default.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode:'current'}));
  const page = await context.newPage(); await page.setViewportSize({width: 1000, height: 950}); await page.goto('https://mail.example.test/');
  await page.frameLocator('iframe').getByRole('textbox', {name: '게시글 본문'}).waitFor();
  const frame = page.frames().find(frame => frame.url().includes('editor.example.test'));
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://mail.example.test/').id);
  const run = async (name, args = {}) => (await worker.evaluate(({tabId, name, args}) => testBrowserAgent.runBrowserAgent('rich-editor', {tabId}, name, args), {tabId, name, args})).result;
  const script = code => run('run_playwright', {code});
  const ref = (result, name = '게시글 본문') => {
    const item = (result.observation || result).frames.flatMap(frame => frame.elements || []).find(item => item.name === name);
    assert(item, name); return item.ref;
  };
  const jsRef = (result, name) => JSON.stringify(ref(result, name));
  let result = await run('browser_snapshot');
  result = await script(`return await browser.ref(${jsRef(result)}).editorState();`);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.actionIssued, false);
  assert.equal(result.value.mode, 'rich'); assert.equal(result.value.runs[0].style.fontSize, '14px');
  const originalText = result.value.text;
  assert.equal((await frame.evaluate(() => fixtureState.updates)), 0);
  check('editorState observes a cross-origin schema editor and computed typography without modifying its document');

  result = await script(`await browser.ref(${jsRef(result)}).selectText("교육 일정 안내", {expectedDigest:${JSON.stringify(result.value.digest)}}); await browser.ref(${jsRef(result, '소제목')}).click();`);
  assert.equal(result.yielded, true); assert.deepEqual(result.execution.commands.map(command => command.method), ['selectText']);
  assert.equal(await frame.locator('h2').count(), 0);
  result = await run('click_element', {ref: ref(result, '소제목')});
  assert.equal(result.ok, true, JSON.stringify(result));
  result = await run('verify_page', {checks: [{kind: 'text_style', ref: ref(result), expected: '교육 일정 안내', format: {block: 'h2', fontSize: '24px', bold: true}}, {kind: 'text_present', expected: '초안 저장됨'}]});
  assert.equal(result.verified, true, JSON.stringify(result));
  check('a native heading action follows a selection checkpoint and passes independent semantic and CSS checks');

  const choose = async text => {
    result = await script(`return await browser.ref(${jsRef(result)}).editorState(${JSON.stringify(text)});`);
    assert.equal(result.value.matchCount, 1);
    result = await script(`return await browser.ref(${jsRef(result)}).selectText(${JSON.stringify(text)}, {expectedDigest:${JSON.stringify(result.value.digest)}});`);
    assert.equal(result.value.selected, true, JSON.stringify(result));
  };
  await choose('10월 8일 목요일 오후 2시');
  assert.equal(await frame.evaluate(() => getSelection().toString()), '10월 8일 목요일 오후 2시');
  result = await run('press_key', {ref: ref(result), key: 'ControlOrMeta+B'});
  assert.equal(result.ok, true, JSON.stringify(result));
  const keyEvidence = await frame.evaluate(() => ({keys: fixtureState.keys, selection: getSelection().toString(), doc: readEditorDocument(), platform: navigator.platform}));
  result = await run('verify_page', {checks: [{kind: 'text_style', ref: ref(result), expected: '10월 8일 목요일 오후 2시', format: {bold: true}}, {kind: 'text_style', ref: ref(result), expected: '일시:', format: {bold: false}}]});
  assert.equal(result.verified, true, JSON.stringify({result, keyEvidence}));
  result = await script(`return await browser.ref(${jsRef(result)}).editorState("일시: 10월 8일 목요일 오후 2시");`);
  assert.equal(result.value.runs.length, 2); assert.equal(result.value.runs[0].style.bold, false); assert.equal(result.value.runs[1].style.bold, true);
  result = await run('verify_page', {checks: [{kind: 'text_style', ref: ref(result), expected: '일시: 10월 8일 목요일 오후 2시', format: {bold: true}}]});
  assert.equal(result.verified, false, 'A partly bold line is not a completely bold line');
  check('trusted keyboard formatting changes only the selected phrase and mixed formatting cannot pass a false verification');

  await choose('참석 전 자료를 확인해 주세요.');
  result = await run('click_element', {ref: ref(result, '밑줄')});
  result = await run('verify_page', {checks: [{kind: 'text_style', ref: ref(result), expected: '참석 전 자료를 확인해 주세요.', format: {underline: true}}]});
  assert.equal(result.verified, true, JSON.stringify(result));
  await choose('참석 전 자료를 확인해 주세요.');
  result = await run('select_option', {ref: ref(result, '글자 크기'), values: ['18px']});
  result = await run('verify_page', {checks: [{kind: 'text_style', ref: ref(result), expected: '참석 전 자료를 확인해 주세요.', format: {underline: true, fontSize: '18px'}}, {kind: 'text_style', ref: ref(result), expected: '문의는 교육 담당자에게 알려주세요.', format: {underline: false, bold: false, fontSize: '14px'}}]});
  assert.equal(result.verified, true, JSON.stringify(result));
  result = await script(`return await browser.ref(${jsRef(result)}).editorState();`);
  assert.equal(result.value.text, originalText);
  const documentBefore = await frame.evaluate(() => readEditorDocument());
  assert(documentBefore.content.some(block => block.type === 'heading'));
  assert(JSON.stringify(documentBefore).includes('"fontSize":"18px"'));
  assert((await frame.evaluate(() => fixtureState.keys)).some(key => key.trusted && key.key.toLowerCase() === 'b'));
  check('native underline and size controls update the real editor model while preserving every word and the untouched closing paragraph');

  result = await run('click_element', {ref: ref(result, '미리보기')});
  assert.equal(await frame.locator('#preview-body h2').innerText(), '교육 일정 안내');
  assert.equal(await frame.locator('#preview-body u').innerText(), '참석 전 자료를 확인해 주세요.');
  assert.equal(await frame.locator('#preview-body u').evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); return getComputedStyle(walker.nextNode().parentElement).fontSize;
  }), '18px');
  await page.screenshot({path: resolve('verification/rich-editor-preview.png'), fullPage: true});
  result = await run('click_element', {ref: ref(result, '등록')});
  assert.equal(result.error, 'approval_required', JSON.stringify(result));
  assert.equal(await frame.evaluate(() => fixtureState.published), 0);
  await worker.evaluate(() => testBrowserAgent.stopBrowserAgent());
  await page.reload(); await page.frameLocator('iframe').getByRole('textbox', {name: '게시글 본문'}).waitFor();
  const reloadedFrame = page.frames().find(frame => frame.url().includes('editor.example.test'));
  assert.deepEqual(await reloadedFrame.evaluate(() => readEditorDocument()), documentBefore);
  check('the website preview and autosaved JSON retain formatting after reload, and publishing still requires HITL');

  result = await run('browser_snapshot');
  result = (await worker.evaluate(async ({tabId, ref}) => testBrowserAgent.runBrowserAgent('rich-editor', {tabId}, 'request_approval', {ref}, {
    onApproval: record => {globalThis.richApproval = record; return {requiresUserInput: true};},
  }), {tabId, ref: ref(result, '등록')})).result;
  assert.equal(result.requiresUserInput, true);
  assert.equal(await worker.evaluate(async () => {
    return (await testBrowserAgent.readApprovalDraft(richApproval)).length;
  }), 1);
  const approvedText = await reloadedFrame.getByRole('textbox', {name: '게시글 본문'}).innerText();
  await reloadedFrame.getByRole('button', {name: '소제목', exact: true}).click();
  assert.equal(await reloadedFrame.locator('.tiptap h2').count(), 0);
  assert.equal(await reloadedFrame.getByRole('textbox', {name: '게시글 본문'}).innerText(), approvedText);
  assert.equal(await worker.evaluate(async () => {
    try {await testBrowserAgent.readApprovalDraft(richApproval); return 'unexpected-success';} catch (error) {return error.message;}
  }), 'approval_changed');
  check('a style-only change invalidates the previous final-action approval even when all words are unchanged');
  await worker.evaluate(() => testBrowserAgent.stopBrowserAgent());

  // Static helpers also handle open shadow roots and reject ambiguous/stale
  // selections. The fixture owns changes, not the agent's page realm.
  await page.goto('https://editor.example.test/');
  await page.evaluate(() => {
    const host = document.createElement('div'); document.body.append(host);
    host.attachShadow({mode: 'open'}).innerHTML = '<div contenteditable="true" role="textbox" aria-label="추가 본문"><p>하나 <b>강조</b> 문장</p><p>반복 반복</p><span hidden>숨긴 글</span></div><textarea aria-label="일반 텍스트">서식 없는 본문</textarea><div role="textbox" aria-label="단순 본문" contenteditable="plaintext-only">일반 본문</div>';
  });
  result = await run('browser_snapshot');
  result = await script(`return await browser.ref(${jsRef(result, '추가 본문')}).editorState();`);
  assert(!result.value.text.includes('숨긴 글'));
  const digest = result.value.digest;
  result = await script(`return await browser.ref(${jsRef(result, '추가 본문')}).selectText("하나 강조 문장", {expectedDigest:${JSON.stringify(digest)}});`);
  assert.equal(result.value.selected, true, JSON.stringify(result));
  assert.equal(await page.evaluate(() => getSelection().toString()), '하나 강조 문장');
  result = await script(`return await browser.ref(${jsRef(result, '추가 본문')}).selectText("반복", {expectedDigest:${JSON.stringify(digest)}});`);
  assert.equal(result.reason, 'editor_ambiguous');
  result = await script(`return await browser.ref(${jsRef(result, '추가 본문')}).selectText("없는 문장", {expectedDigest:${JSON.stringify(digest)}});`);
  assert.equal(result.reason, 'editor_text_missing');
  await page.getByRole('textbox', {name: '추가 본문', exact: true}).evaluate(el => el.appendChild(document.createTextNode(' 추가')));
  result = await script(`return await browser.ref(${jsRef(result, '추가 본문')}).selectText("강조", {expectedDigest:${JSON.stringify(digest)}});`);
  assert.equal(result.reason, 'browser_stale');
  for (const name of ['일반 텍스트', '단순 본문']) {
    result = await script(`return await browser.ref(${jsRef(result, name)}).editorState();`); assert.equal(result.value.mode, 'plain');
  }
  check('selection spans inline marks in shadow roots, omits hidden text, rejects duplicates/missing/changed text, and distinguishes plain editors');
  assert.deepEqual(errors, []);
  await writeFile('verification/rich-editor-browser.json', JSON.stringify({checks, errors, actualBrowser: true, editor: '@tiptap/core@3.31.3', modelInvoked: false, liveCompanyEditor: false}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
