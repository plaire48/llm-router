import assert from 'node:assert/strict';
import {mkdtemp, cp, rm, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const root = await mkdtemp(resolve(tmpdir(), 'nubi-installed-upgrade-'));
const extension = resolve(root, 'extension'), profile = resolve(root, 'profile');
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
let context, ui, worker, id;
const errors = [];
const rpc = (type, values = {}) => ui.evaluate(async ({type, values}) => chrome.runtime.sendMessage({type, ...values}), {type, values});
const state = async () => (await rpc('GET_STATE')).data;
const button = name => ui.getByRole('button', {name, exact: true});
async function poll(fn, expected) {
  let value;
  for (let i=0;i<200;i++) {value=await fn(); if (value===expected) return; await new Promise(r=>setTimeout(r,50));}
  assert.equal(value,expected);
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/**', route => route.fulfill({json: route.request().url().endsWith('/api/models')
    ? {modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K', context_length: 524288}]}
    : {choices: [{message: {role: 'assistant', content: '이전 배포본의 답변입니다.'}, finish_reason: 'stop'}], usage: {prompt_tokens: 20, completion_tokens: 10, total_tokens: 30}}}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  id = new URL(worker.url()).hostname;
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${id}/index.html`);
  await button('대화 이력').waitFor();
}
try {
  assert(process.env.PREVIOUS_EXTENSION_ZIP, 'Previous released ZIP is required');
  execFileSync('unzip', ['-q', process.env.PREVIOUS_EXTENSION_ZIP, '-d', extension]);
  await launch();
  const from = await ui.evaluate(() => chrome.runtime.getManifest().version), oldId = id;
  await worker.evaluate(token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 1}}), token);
  await poll(async () => (await state()).catalog?.models?.length, 1);
  const original = (await state()).chat;
  await ui.evaluate(chat => chrome.storage.local.set({chat: {...chat, messages: [
    {id:'upgrade-user',role:'user',content:'업데이트 전에 남긴 대화',createdAt:Date.now()},
    {id:'upgrade-assistant',role:'assistant',content:'이전 배포본의 답변입니다.',state:'done',createdAt:Date.now(),model:'GLM-5.2-NVFP4',usage:{inputTokens:20,outputTokens:10,totalTokens:30}},
  ]}}), original);
  await ui.getByText('이전 배포본의 답변입니다.', {exact:true}).waitFor();
  const previousChat = (await state()).chat.sessionId;
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('이전 대화의 초안');
  await button('새 대화').click(); await poll(async () => (await state()).chat.messages.length, 0);
  assert.equal((await rpc('DRAFT', {value: '업데이트 후에도 남길 초안'})).ok, true);
  const keys = ['activeProvider', 'chat', 'chatHistory', 'providerChats', 'settings', 'usageLedger'];
  const before = await ui.evaluate(keys => chrome.storage.local.get(keys), keys);
  await context.close(); context = null;
  await rm(extension, {recursive: true, force: true});
  await cp(resolve('dist'), extension, {recursive: true});
  await launch();
  assert.equal(id, oldId);
  const to = await ui.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(to, '1.4.3');
  const after = await ui.evaluate(keys => chrome.storage.local.get(keys), keys);
  // New default fields may be introduced, but existing stored fields are retained.
  for (const key of keys) {
    if (key === 'settings') {for (const [field,value] of Object.entries(before.settings)) assert.deepEqual(after.settings[field],value,`settings.${field}`);}
    else assert.deepEqual(after[key], before[key], key);
  }
  assert.equal((await state()).auth.present, false, 'Browser restart clears session credentials');
  assert.equal((await state()).chat.draft, '업데이트 후에도 남길 초안');
  await button('대화 이력').click();
  await ui.getByRole('dialog', {name: '대화 이력', exact: true}).getByRole('button', {name: '업데이트 전에 남긴 대화 열기', exact: true}).click();
  await poll(async () => (await state()).chat.sessionId, previousChat);
  assert.equal((await state()).chat.draft, '이전 대화의 초안');
  await ui.getByText('이전 배포본의 답변입니다.', {exact: true}).waitFor();
  for (const width of [320,360,1100]) {
    await ui.setViewportSize({width,height:800});
    await button('설정').click();
    await ui.getByRole('dialog', {name:'설정',exact:true}).getByRole('button', {name:'로그인',exact:true}).waitFor();
    await ui.screenshot({path:`verification/release-upgrade-${width}.png`, animations:'disabled'});
    await ui.getByRole('dialog', {name:'설정',exact:true}).getByRole('button', {name:'닫기',exact:true}).click();
  }
  await ui.reload(); await button('대화 이력').waitFor();
  assert.equal((await state()).chat.sessionId, previousChat);
  assert.equal((await state()).chat.draft, '이전 대화의 초안');
  assert.deepEqual(errors,[]);
  const result = {passed:true,from,to,sameExtensionId:true,actualChromeRelaunch:true,storedFieldsPreserved:keys,historySelectable:true,reloadPreserved:true,sessionCredentialsCleared:true,errors,syntheticStoredChat:true,syntheticProvider:true,liveAccountVerified:false};
  await writeFile('verification/release-upgrade.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} catch (error) {
  if (ui && !ui.isClosed()) {
    const current = await state();
    console.error(JSON.stringify({chat:current.chat, report:current.report, errors}));
    await ui.screenshot({path:'verification/release-upgrade-failure.png'});
  }
  throw error;
} finally {await context?.close(); await rm(root,{recursive:true,force:true});}
