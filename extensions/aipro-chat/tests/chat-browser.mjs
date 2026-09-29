import {conversationIntent} from './fixtures/completion-intent.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile, cp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-chat-stream-'));
const extension = resolve(profile,'extension'), output = resolve('verification');
const checks = [], errors = [];
let context, page, worker;
const usage = {prompt_tokens: 23175, total_tokens: 23223, completion_tokens: 48, completion_tokens_details: {reasoning_tokens: 30}};
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
const check = label => {checks.push(label); console.log(`PASS ${label}`);};
const state = () => page.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
async function poll(fn, expected) {
  for (let count = 0; count < 200; count++) {if (await fn() === expected) return; await new Promise(resolve => setTimeout(resolve, 50));}
  assert.equal(await fn(), expected);
}
const emit = value => worker.evaluate(value => globalThis.emitChat(value), value);
const delta = (value, finish_reason = null) => ({choices: [{index: 0, delta: value, finish_reason}]});
async function send(text) {
  const previous = await worker.evaluate(() => globalThis.chatStarts || 0);
  await page.getByRole('textbox', {name: '메시지', exact: true}).fill(text);
  await page.getByRole('button', {name: '전송', exact: true}).click();
  await poll(() => worker.evaluate(() => globalThis.chatStarts), previous + 1);
}
try {
  await mkdir(output, {recursive: true});
  await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('http://*/*','https://*/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chromium', executablePath: process.env.CHROME_BINARY || undefined, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  // Only synthetic API data is used. Full network request headers are tested in browser.mjs.
  await context.route('https://aipro.sdsdev.co.kr/**', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', target: 'chat', is_agent: false, context_length: 524288, max_input_tokens: 460800}]})}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async token => chrome.storage.session.set({credential: {mode: 'browser', token, receivedAt: 7}}), token);
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await worker.evaluate(conversationIntent => {
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (url, options) => {
      if (!String(url).endsWith('/chat/completions')) return realFetch(url, options);
      const body = JSON.parse(options.body);
      if (body.messages?.[0]?.content?.startsWith("You are Nubi's completion-intent reviewer.")) return Response.json({choices:[{message:{role:'assistant',content:conversationIntent},finish_reason:'stop'}]});
      const stream = new ReadableStream({
        start(controller) {
          globalThis.chatStream = controller;
          globalThis.chatStarts = (globalThis.chatStarts || 0) + 1;
          options.signal.addEventListener('abort', () => {globalThis.chatStream = null; controller.error(new DOMException('Aborted', 'AbortError'));}, {once: true});
        },
        cancel() {globalThis.chatStream = null; globalThis.cancelledStreams = (globalThis.cancelledStreams || 0) + 1;},
      });
      return new Response(stream, {headers: {'content-type': 'text/event-stream'}});
    };
    globalThis.emitChat = value => globalThis.chatStream.enqueue(new TextEncoder().encode(`data: ${value === '[DONE]' ? value : JSON.stringify(value)}\n\n`));
  }, conversationIntent);
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async () => (await state()).catalog?.models?.length, 1);
  await page.setViewportSize({width: 360, height: 800});
  await send('테스트');
  await page.getByText('응답 기다리는 중', {exact: true}).waitFor();
  await emit(delta({reasoning: 'synthetic-private-thought'}));
  await page.getByText('생각 중', {exact: true}).waitFor();
  assert(!(await page.locator('body').innerText()).includes('synthetic-private-thought'));
  await page.screenshot({path: resolve(output, 'chat-thinking-panel.png'), fullPage: true});
  check('waiting and reasoning phases are visible without displaying reasoning text');
  await emit(delta({content: '안녕하세요! 테스트가 잘 전달되었습니다.'}));
  await page.getByText('답변 작성 중', {exact: true}).waitFor();
  // The completion reviewer withholds an unverified first reply; progress stays visible.
  assert.equal(await page.locator('.message-body').filter({hasText: '안녕하세요!'}).count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path: resolve(output, 'chat-streaming-panel.png'), fullPage: true});
  assert(await page.getByRole('button', {name:'중지',exact:true}).isVisible());
  check('answer progress and stop remain visible in the 360px panel while the initial reply awaits review');
  await emit(delta({}, 'stop')); await emit({choices: [], usage}); await emit('[DONE]');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  await page.locator('.message-body').filter({hasText: '안녕하세요!'}).waitFor();
  assert.deepEqual((await state()).chat.messages.at(-1).usage, usage);
  assert.equal(await worker.evaluate(() => globalThis.cancelledStreams), 1);
  assert(!(await page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)))).includes('synthetic-private-thought'));
  await page.reload();
  await page.getByRole('button', {name: '컨텍스트 사용량', exact: true}).click();
  const detail = page.getByRole('dialog', {name: '컨텍스트', exact: true});
  await detail.waitFor();
  await detail.getByText('토큰 상세',{exact:true}).click();
  const text = await detail.innerText();
  for (const expected of ['23,223', '23,175', '48 토큰', '30 토큰', '출력 중 추론']) assert(text.includes(expected));
  await page.screenshot({path: resolve(output, 'chat-usage-panel.png'), fullPage: true});
  await page.keyboard.press('Escape');
  check('DONE completes without transport close and sample usage survives refresh with no double counting');
  await page.setViewportSize({width: 1100, height: 850});
  await send('긴 답변');
  const beforeRecovery=await worker.evaluate(()=>globalThis.chatStarts);
  await emit(delta({content: '출력 한도까지 생성된 답변입니다.'}, 'length'));
  await emit({choices: [], usage}); await emit('[DONE]');
  await poll(()=>worker.evaluate(()=>globalThis.chatStarts),beforeRecovery+1);
  await emit(delta({content:' 이어서 완성했습니다.'},'stop'));await emit({choices:[],usage});await emit('[DONE]');
  await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
  assert.equal((await state()).chat.messages.at(-1).content,'출력 한도까지 생성된 답변입니다. 이어서 완성했습니다.');
  assert.equal((await state()).chat.messages.at(-1).finishReason,'stop');
  await page.reload();
  assert.equal((await state()).chat.messages.at(-1).content,'출력 한도까지 생성된 답변입니다. 이어서 완성했습니다.');
  await page.screenshot({path: resolve(output, 'chat-length-desktop.png'), fullPage: true});
  check('output limits continue automatically without another user message and the complete answer survives reopening');
  await send('생각 중 중지');
  await emit(delta({reasoning_content: 'synthetic-cancel-thought'}));
  await page.getByText('생각 중', {exact: true}).waitFor();
  await page.getByRole('button', {name: '중지', exact: true}).click();
  await poll(async () => (await state()).chat.messages.at(-1)?.error, 'cancelled');
  assert.equal((await state()).busy, false);
  assert.equal((await state()).chat.messages.at(-1).content, '');
  assert.equal((await state()).chat.messages.at(-1).usage, null);
  await page.getByRole('button', {name: '재시도', exact: true}).click();
  await poll(() => worker.evaluate(() => !!globalThis.chatStream), true);
  await emit(delta({content: '다시 받은 답변'}, 'stop')); await emit('[DONE]');
  await poll(async () => (await state()).chat.messages.at(-1)?.state, 'done');
  check('cancel during reasoning releases the chat lease and retry succeeds');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'chat-browser-results.json'), JSON.stringify({synthetic: true, fixtureSiteAccessPregranted:true, realAiProVerified: false, assertions: checks, pageErrors: errors}, null, 2));
} finally {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
}
