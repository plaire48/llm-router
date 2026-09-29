import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, rm, writeFile, cp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';

const profile = await mkdtemp(resolve(tmpdir(), 'aipro-native-panel-'));
const extension = resolve(profile, 'extension');
const interactivePermission = process.env.NUBI_INTERACTIVE_PERMISSION === '1';
// A fresh Chrome window can navigate before Playwright attaches its route.
// Serve the dedicated-window fixture on a real local origin.
const server = createServer((request, response) => {
  response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  response.end('<!doctype html><title>Panel work target</title><main><h1>Dedicated panel skill target</h1><label>Name<input name="name"></label></main>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const workUrl = `http://127.0.0.1:${server.address().port}/panel`;
await cp(resolve(process.env.TEST_EXTENSION || 'dist'), extension, {recursive: true});
if (!interactivePermission) {
  // Chrome's native permission prompt needs a human in headed mode. The
  // unattended regression tests the real panel with an existing site grant.
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
}
const context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
const checks = [];
async function poll(fn, expected) {
  let value;
  for (let i = 0; i < (process.env.HEADED === '1' ? 2400 : 160); i++) {value = await fn(); if (value === expected) return; await new Promise(r => setTimeout(r, 50));}
  assert.equal(value, expected);
}
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // Preserve the existing current-page/navigation contract, then exercise the
  // dedicated-window mode independently below with the same native panel.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
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
  let {sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: false});
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
  await evaluate(`window.fetch=async url=>{if(String(url).endsWith('/api/models'))return Response.json({modelList:[{name:'GLM-5.2-NVFP4',display_name:'GLM',target:'chat'}]});throw Error('Unexpected UI fetch');};`);
  const executor = expression => worker.evaluate(expression.replaceAll('window.', 'globalThis.'));
  await executor(`window.fetch = async (url, options) => {
    if (String(url).endsWith('/api/models')) return Response.json({modelList:[{name:'GLM-5.2-NVFP4',display_name:'GLM',target:'chat'}]});
    window.panelRequest = JSON.parse(options.body);
    if (window.panelRequest.messages[0].content.startsWith("You are Nubi's completion-intent reviewer.")) return Response.json({choices:[{message:{content:JSON.stringify({decision:'reply',scope:'conversation',next_step:''})},finish_reason:'stop'}]});
    return new Response(new ReadableStream({start(controller) {window.panelStream = controller;}}), {headers:{'content-type':'text/event-stream'}});
  };`);
  const token = `header.${Buffer.from(JSON.stringify({exp: Date.now() / 1000 + 3600})).toString('base64url')}.signature`;
  await worker.evaluate(token => chrome.storage.session.set({credential: {mode: 'browser', token, receivedAt: 11}}), token);
  await poll(() => evaluate(`!!document.querySelector('#message-input')`), true);
  await poll(() => evaluate(`document.querySelector('[aria-label="모델 변경"]')?.innerText`), 'GLM');
  await poll(() => evaluate(`document.querySelector('#message-input')?.disabled === false`),true);
  await evaluate(`document.querySelector('#message-input').focus()`);
  await evaluate(`const nativeRequest=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=async options=>{window.testPermissionPending=true;try{return await nativeRequest(options);}finally{window.testPermissionPending=false;}};`);
  await command('Input.insertText', {text: '사이드 패널 테스트'});
  await poll(() => evaluate(`document.querySelector('[aria-label="전송"]')?.disabled === false`), true);
  await evaluate(`document.querySelector('[aria-label="전송"]').click()`);
  try {await poll(() => executor(`!!window.panelStream`), true);}
  catch(error){console.log(JSON.stringify({permissionPending:await evaluate('window.testPermissionPending===true'),modelCallStarted:await evaluate('!!window.panelStream')}));throw error;}
  // Read state from the other open view while the real side panel owns the request.
  const read = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
  assert.equal((await read()).chat.messages.at(-1).state, 'pending');
  const lease = await worker.evaluate(async () => (await chrome.storage.session.get('chatLease')).chatLease);
  assert(lease);
  checks.push('native side panel starts a request without being marked interrupted by the full-screen view');
  await ui.evaluate(()=>chrome.sidePanel.setOptions({enabled:false}));
  assert.equal((await worker.evaluate(()=>chrome.storage.session.get('chatLease'))).chatLease.cancelled,undefined);
  await executor(`window.panelStream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'사이드 패널 정상 응답'},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n'))`);
  await poll(async () => (await read()).chat.messages.at(-1).state, 'done');
  assert.equal((await read()).chat.messages.at(-1).content, '사이드 패널 정상 응답');
  assert.equal((await read()).busy, false);
  checks.push('closing the native side panel does not cancel the streamed answer; it completes in the worker');
  await ui.evaluate(()=>chrome.sidePanel.setOptions({enabled:true}));
  await ui.getByRole('button',{name:'Open native test panel',exact:true}).click();
  await poll(async()=>{target=(await cdp.send('Target.getTargets')).targetInfos.find(info=>info.url===url&&!info.attached);return !!target;},true);
  ({sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false}));
  await poll(()=>evaluate(`!!document.querySelector('#message-input')`),true);
  await evaluate(`window.fetch=async()=>Response.json({modelList:[{name:'GLM-5.2-NVFP4',display_name:'GLM',target:'chat'}]});`);

  await context.route('https://first.example.test/fixture-panel', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Panel target</title><main><h1>Native panel skill target</h1><label>Name<input name="name"></label></main>'}));
  const targetPage = await context.newPage(); await targetPage.goto('https://first.example.test/fixture-panel');
  await targetPage.bringToFront();
  await executor(`window.skillRequests = []; window.fetch = async (url, options) => {
    const body = JSON.parse(options.body); window.skillRequests.push(body);
    const last = body.messages.at(-1);
    const response = last.role !== 'tool'
      ? {choices:[{delta:{tool_calls:[{index:0,id:'panel-inspect',type:'function',function:{name:'inspect_dom',arguments:'{}'}}]},finish_reason:'tool_calls'}]}
      : {choices:[{delta:{content:'페이지 스킬 완료'},finish_reason:'stop'}]};
    return new Response('data: '+JSON.stringify(response)+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});
  };`);
  await poll(() => evaluate(`document.querySelector('[aria-label="스킬 선택"]')?.disabled === false`),true);
  await evaluate(`document.querySelector('[aria-label="추가"]').click()`);
  await evaluate(`document.querySelector('[aria-label="스킬 선택"]').click()`);
  await poll(() => evaluate(`!![...document.querySelectorAll('.skill-option')].find(el=>el.textContent.includes('소스 확인'))`), true);
  await evaluate(`[...document.querySelectorAll('.skill-option')].find(el=>el.textContent.includes('소스 확인')).click()`);
  await poll(() => evaluate(`!document.querySelector('[role="dialog"]')`), true);
  await poll(() => evaluate(`document.querySelector('#message-input')?.disabled === false`),true);
  await evaluate(`document.querySelector('#message-input').focus()`);
  await command('Input.insertText', {text: '페이지 소스를 확인해줘'});
  await poll(() => evaluate(`document.querySelector('[aria-label="전송"]')?.disabled === false`), true);
  if (interactivePermission) console.log('WAITING_SITE_PERMISSION');
  await evaluate(`document.querySelector('[aria-label="전송"]').click()`);
  await poll(async () => (await read()).chat.messages.length, 4);
  await poll(async () => (await read()).chat.messages.at(-1).state, 'done');
  assert.equal((await read()).page.url, 'https://first.example.test/fixture-panel');
  assert(await executor(`window.skillRequests.at(-1).messages.some(m=>m.role==='tool'&&m.content.includes('Native panel skill target'))`));
  checks.push('native side panel source skill automatically connects the active website and reads its DOM without the link icon');
  assert(await ui.evaluate(() => chrome.permissions.contains({origins:['http://*/*','https://*/*']})));
  const beforeNavigation = await executor('window.skillRequests.length');
  await context.route('https://second.example.test/next', route => route.fulfill({contentType:'text/html', body:'<!doctype html><title>Second target</title><main><h1>Second website skill target</h1></main>'}));
  await targetPage.goto('https://second.example.test/next');
  assert.equal(await executor('window.skillRequests.length'), beforeNavigation);
  checks.push('navigation alone does not collect page data or send a model request');
  await poll(() => evaluate(`document.querySelector('#message-input')?.disabled === false`),true);
  await evaluate(`document.querySelector('#message-input').focus()`);
  await command('Input.insertText', {text: '이동한 페이지 소스를 확인해줘'});
  await poll(() => evaluate(`document.querySelector('[aria-label="전송"]')?.disabled === false`), true);
  await evaluate(`document.querySelector('[aria-label="전송"]').click()`);
  await poll(async () => (await read()).chat.messages.length, 6);
  await poll(async () => (await read()).chat.messages.at(-1).state, 'done');
  assert.equal((await read()).page.url, 'https://second.example.test/next');
  assert(await executor(`window.skillRequests.at(-1).messages.some(m=>m.role==='tool'&&m.content.includes('Second website skill target'))`));
  checks.push('the already-open side panel reads a second origin with granted site access, without clicking the extension again');
  assert.equal((await ui.evaluate(() => chrome.runtime.sendMessage({type: 'NEW_CHAT'}))).ok, true);
  await poll(() => evaluate(`document.body.innerText.includes('페이지 스킬 완료')`), false);
  assert.equal((await ui.evaluate(() => chrome.runtime.sendMessage({type: 'SET_BROWSER_WORK_MODE', mode: 'window'}))).ok, true);
  await targetPage.goto(workUrl);
  await targetPage.getByLabel('Name').fill('User unsaved draft');
  await targetPage.bringToFront();
  const foreground = await worker.evaluate(() => chrome.windows.getLastFocused());
  await poll(() => evaluate(`document.querySelector('[aria-label="스킬 선택"]')?.disabled === false`),true);
  await evaluate(`document.querySelector('[aria-label="추가"]').click()`);
  await evaluate(`document.querySelector('[aria-label="스킬 선택"]').click()`);
  await poll(() => evaluate(`!![...document.querySelectorAll('.skill-option')].find(el=>el.textContent.includes('소스 확인'))`), true);
  await evaluate(`[...document.querySelectorAll('.skill-option')].find(el=>el.textContent.includes('소스 확인')).click()`);
  await poll(() => evaluate(`!document.querySelector('[role="dialog"]')`), true);
  await poll(() => evaluate(`document.querySelector('#message-input')?.disabled === false`),true);
  await evaluate(`document.querySelector('#message-input').focus()`);
  await command('Input.insertText', {text: '현재 페이지 소스를 확인해줘'});
  await poll(() => evaluate(`document.querySelector('[aria-label="전송"]')?.disabled === false`), true);
  await evaluate(`document.querySelector('[aria-label="전송"]').click()`);
  try {
    await poll(async () => (await read()).chat.messages.length, 2);
    await poll(async () => (await read()).chat.messages.at(-1).state, 'done');
  }
  catch (error) {console.log(JSON.stringify({panel: await evaluate('document.body.innerText'), message: (await read()).chat.messages.at(-1)})); throw error;}
  const completed = await read();
  assert(completed.workspace, JSON.stringify(completed.chat.messages.at(-1)));
  const {browserWorkspaces, page: connectedPage} = await worker.evaluate(() => chrome.storage.session.get(['browserWorkspaces', 'page']));
  const workspace = browserWorkspaces[completed.chat.sessionId];
  assert.equal(workspace.windowId, foreground.id);
  assert.equal((await worker.evaluate(() => chrome.windows.getLastFocused())).id, foreground.id);
  assert.equal(connectedPage.tabId, workspace.tabId);
  assert.equal(completed.page.url, workUrl);
  assert(await executor(`window.skillRequests.at(-1).messages.some(m=>m.role==='tool'&&m.content.includes('Dedicated panel skill target'))`));
  assert.equal(await targetPage.getByLabel('Name').inputValue(), 'User unsaved draft');
  checks.push('the same native side panel reads only the owned Nubi tab group and preserves the foreground user tab and its unsaved draft');
  const result = {version: await ui.evaluate(() => chrome.runtime.getManifest().version), nativeSidePanel: true, actualOptionalHostPermission: interactivePermission, fixtureSiteAccessPregranted: !interactivePermission, crossOriginNavigation: true, syntheticNetwork: true, realAiProVerified: false, senderDocumentIdPresent: !!lease.documentId, clientIdPresent: !!lease.clientId, checks};
  if (!process.env.TEST_EXTENSION) await writeFile('verification/side-panel-browser-results.json', JSON.stringify(result, null, 2)+'\n');
  console.log(JSON.stringify(result));
} finally {await context.close(); server.close(); await rm(profile, {recursive: true, force: true});}
