import assert from 'node:assert/strict';
import {chatgptToken, responsesSSE} from './fixtures/chatgpt.mjs';
import {chromium} from 'playwright';
import {mkdtemp, rm, writeFile, cp, readFile} from 'node:fs/promises';
import {zstdDecompressSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'chatgpt-native-panel-'));
const extension = resolve(profile, 'extension');
await cp(resolve(process.env.TEST_EXTENSION || 'dist'), extension, {recursive: true});
// Pregrant optional page origins only in the fixture copy. The native permission
// prompt requires separate interactive verification.
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://*/*', 'https://*/*');
await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
const checks = [];
async function poll(fn, expected) {
  let value;
  for (let i = 0; i < (process.env.HEADED === '1' ? 2400 : 160); i++) {value = await fn(); if (value === expected) return; await new Promise(r => setTimeout(r, 50));}
  assert.equal(value, expected);
}
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const url = `chrome-extension://${new URL(worker.url()).hostname}/index.html`;
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM', target: 'chat'}]})}));
  const ui = await context.newPage(); await ui.goto(url);
  await ui.evaluate(async () => {
    const {id} = await chrome.windows.getCurrent();
    const button = document.createElement('button'); button.textContent = 'Open native test panel';
    button.onclick = () => chrome.sidePanel.open({windowId: id}); document.body.append(button);
  });
  await ui.getByRole('button', {name: 'Open native test panel', exact: true}).click();
  const cdp = await context.browser().newBrowserCDPSession();
  let target;
  await poll(async () => {
    target = (await cdp.send('Target.getTargets')).targetInfos.find(info => info.url === url && !info.attached);
    return !!target;
  }, true);
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: false});
  let sequence = 0;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message), complete = pending.get(message.id);
    if (complete) {pending.delete(message.id); complete(message);}
  });
  async function command(method, params = {}) {
    const id = ++sequence;
    const result = new Promise(resolve => pending.set(id, resolve));
    await cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})});
    const response = await result; if (response.error) throw Error(JSON.stringify(response.error)); return response.result;
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const executor = expression => worker.evaluate(expression.replaceAll('window.', 'globalThis.'));
  await evaluate(`window.fetch = async () => Response.json({rate_limit:{primary_window:{used_percent:25,limit_window_seconds:18000,reset_at:Math.floor(Date.now()/1000)+7200}}});`);
  await executor(`window.fetch = async (url, options) => {
    if (String(url).endsWith('/wham/usage')) return new Response(JSON.stringify({rate_limit:{primary_window:{used_percent:25,limit_window_seconds:18000,reset_at:Math.floor(Date.now()/1000)+7200}}}),{headers:{'content-type':'application/json'}});
    if(window.panelRequest){window.reviewRequest=typeof options.body==='string'?options.body:Array.from(options.body);return new Response(${JSON.stringify(responsesSSE({text:JSON.stringify({decision:'reply',scope:'conversation',next_step:''})}))},{headers:{'content-type':'text/event-stream'}});}
    window.panelRequest = typeof options.body === 'string' ? options.body : Array.from(options.body);
    return new Response(new ReadableStream({start(controller) {window.panelStream = controller;}}), {headers:{'content-type':'text/event-stream'}});
  };`);
  await worker.evaluate(async token => {
    await chrome.storage.session.set({providerSessions:{chatgpt:{credential:{provider:'chatgpt',mode:'browser',token,refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,receivedAt:77}}}});
  },chatgptToken());
  // Activate the connection through the product's conversation switch. Merely
  // overwriting activeProvider leaves the old AI Pro conversation selected.
  assert.equal((await evaluate(`chrome.runtime.sendMessage({type:'SELECT_PROVIDER',provider:'chatgpt'})`)).ok,true);
  await poll(()=>evaluate(`document.querySelector('[aria-label="모델 변경"]')?.innerText`),'GPT-5.6 Sol');
  await evaluate(`document.querySelector('#message-input').focus()`);
  await command('Input.insertText',{text:'ChatGPT 사이드 패널 테스트'});
  await poll(()=>evaluate(`!document.querySelector('[aria-label="전송"]').disabled`),true);
  await evaluate(`document.querySelector('[aria-label="전송"]').click()`);
  try {await poll(()=>executor(`!!window.panelStream`),true);}
  catch(error){console.log(JSON.stringify(await ui.evaluate(async()=>{const state=(await chrome.runtime.sendMessage({type:'GET_STATE'})).data;return {busy:state.busy,authPresent:state.auth.present,provider:state.activeProvider,conversationProvider:state.chat.provider,lastState:state.chat.messages.at(-1)?.state};})));throw error;}
  const read=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
  assert.equal((await read()).chat.messages.at(-1).state,'pending');
  assert.equal((await read()).auth.provider,'chatgpt');
  const rawRequest=await executor('window.panelRequest');
  const request=JSON.parse(typeof rawRequest==='string'?rawRequest:zstdDecompressSync(Buffer.from(rawRequest)).toString());
  assert.equal(request.model,'gpt-5.6-sol');assert.equal(request.store,false);assert(request.instructions.includes('누비'));
  checks.push('native side panel sends ChatGPT Responses with its system instructions while the full-screen view stays open');
  await executor(`window.panelStream.enqueue(new TextEncoder().encode(${JSON.stringify(responsesSSE({text:'ChatGPT 사이드 패널 응답'}))}));window.panelStream.close();`);
  await poll(async()=>(await read()).chat.messages.at(-1).state,'done');
  assert.equal((await read()).chat.messages.at(-1).content,'ChatGPT 사이드 패널 응답');
  assert.equal((await read()).chat.messages.at(-1).usage.total_tokens,140);
  const rawReview=await executor('window.reviewRequest');
  const review=JSON.parse(typeof rawReview==='string'?rawReview:zstdDecompressSync(Buffer.from(rawReview)).toString());
  assert(review.instructions.startsWith("You are Nubi's completion-intent reviewer."));
  assert.equal((await read()).usage.total.chatgpt.total,280);
  assert.equal((await read()).usage.total.chatgpt.calls,2);
  checks.push('native side panel completes ChatGPT streaming and saves measured usage without interruption');
  await evaluate(`document.querySelector('[aria-label="사용량"]').click()`);
  await poll(()=>evaluate(`!!document.querySelector('.usage-dialog')?.innerText.includes('75% 남음')`),true);
  assert.equal(await evaluate(`document.querySelector('.usage-total strong').textContent`),'0');
  assert.equal(await evaluate(`document.querySelectorAll('.usage-total strong')[1].textContent`),'280');
  assert(await evaluate(`document.querySelector('.usage-dialog').scrollWidth<=document.querySelector('.usage-dialog').clientWidth`));
  const screenshot=await command('Page.captureScreenshot',{format:'png'});
  await writeFile('verification/usage-native-side-panel.png',Buffer.from(screenshot.data,'base64'));
  checks.push('native side panel usage shows separate provider totals and ChatGPT remaining quota without horizontal overflow');
  await ui.reload();assert.equal((await read()).chat.messages.at(-1).state,'done');
  checks.push('completed side panel response survives full-screen re-entry');
  const version=await worker.evaluate(()=>chrome.runtime.getManifest().version);
  const result={version,nativeSidePanel:true,checks,actualChatGPTAccountVerified:false,syntheticResponses:true,fixtureSiteAccessPregranted:true};
  await writeFile('verification/chatgpt-side-panel.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
