import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-debugger-')), extension = resolve(profile, 'extension');
const checks = [], errors = [];
let context, worker;
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const elements = value => value.frames.flatMap(frame => frame.elements || []);
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), `
    globalThis.testBrowserAgent = {runBrowserAgent, stopBrowserAgent, handle, recoverChat, onDebuggerDetached};
    globalThis.debuggerAttaches = 0;
    const originalAttach = chrome.debugger.attach.bind(chrome.debugger);
    chrome.debugger.attach = (...args) => {globalThis.debuggerAttaches++; return originalAttach(...args);};
  `);
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://portal.example.test/**', route => route.fulfill({contentType: 'text/html', body: `<title>Observation fixture</title>
    <h1>Project dashboard</h1><button id="open" onclick="window.clicked=event.isTrusted">Open details</button>
    <label>Password<input type="password" value="never-observe-this"></label>
    <div id="shadow"></div><iframe title="Editor" src="https://editor.example.test/"></iframe>
    <script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>Subject<input aria-label="Subject"></label>';</script>`}));
  await context.route('https://editor.example.test/**', route => route.fulfill({contentType: 'text/html', body: `<title>Editor</title><label>Body<textarea aria-label="Body" oninput="window.inputTrusted=event.isTrusted"></textarea></label>`}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  for (let i = 0; !await worker.evaluate(() => !!globalThis.testBrowserAgent) && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await worker.evaluate(() => !!globalThis.testBrowserAgent), true, 'Production worker and test hooks loaded');
  const page = await context.newPage(); await page.goto('https://portal.example.test/');
  await page.frameLocator('iframe').getByLabel('Body').waitFor();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://portal.example.test/').id);
  let requestId = 'read-only';
  const run = (name, args = {}) => worker.evaluate(({requestId, tabId, name, args}) => testBrowserAgent.runBrowserAgent(requestId, {tabId}, name, args), {requestId, tabId, name, args});
  const stop = () => worker.evaluate(id => testBrowserAgent.stopBrowserAgent(id), requestId);
  const attaches = () => worker.evaluate(() => debuggerAttaches);
  const detached = async () => {
    for (let i = 0; i < 100; i++) {
      if (!await worker.evaluate(async id => {try {await chrome.debugger.sendCommand({tabId:id}, 'Page.getFrameTree'); return true;} catch {return false;}}, tabId)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('Target debugger remains attached');
  };
  let snapshot;
  for (const name of ['read_page', 'inspect_dom', 'browser_snapshot']) {
    snapshot = (await run(name)).result;
    assert.deepEqual(elements(snapshot).map(el => el.name).sort(), ['Body', 'Open details', 'Subject']);
    assert(!JSON.stringify(snapshot).includes('never-observe-this'));
  }
  assert((await run('list_tabs')).result.tabs.some(tab => Number(tab.tab_id) === tabId));
  assert.equal(await attaches(), 0);
  check('DOM reads, snapshots and tab discovery include iframe/shadow controls without attaching a debugger');
  await stop(); await detached();
  assert.equal(await worker.evaluate(async id => (await chrome.scripting.executeScript({target:{tabId:id, allFrames:true}, world:'ISOLATED', func:()=>!!globalThis.__nubiBrowserObservationV1})).some(item=>item.result), tabId), false);
  check('ending a read-only request clears document references without ever starting a debugger');

  requestId = 'promote-exact-node';
  snapshot = (await run('browser_snapshot')).result;
  let result = await run('click_element', {ref: elements(snapshot).find(el=>el.name==='Open details').ref});
  assert.equal(result.result.ok, true, JSON.stringify(result)); assert.equal(await page.evaluate(()=>window.clicked), true);
  assert.equal(await attaches(), 1);
  assert.equal(await page.locator('[data-nubi-action-target]').count(), 0);
  await stop(); await detached();
  check('the first real click attaches once, binds the original observed node and dispatches a trusted click');

  requestId = 'promote-frame-fields';
  snapshot = (await run('browser_snapshot')).result;
  result = await run('fill_form', {fields: ['Subject','Body'].map(name=>({field_id:elements(snapshot).find(el=>el.name===name).ref,value:`${name} draft`}))});
  assert.equal(result.result.verified, true, JSON.stringify(result));
  assert.equal(await page.getByLabel('Subject').inputValue(), 'Subject draft');
  assert.equal(await page.frameLocator('iframe').getByLabel('Body').inputValue(), 'Body draft');
  assert.equal(await page.frames().find(frame=>frame.url().startsWith('https://editor.')).evaluate(()=>window.inputTrusted), true);
  await stop(); await detached();
  check('content-script references promote across shadow roots and a cross-origin frame with trusted input retained');

  requestId = 'replaced-node';
  snapshot = (await run('browser_snapshot')).result;
  await page.evaluate(()=>{window.clicked=false;const old=document.querySelector('#open');old.replaceWith(old.cloneNode(true));});
  result = await run('click_element', {ref: elements(snapshot).find(el=>el.name==='Open details').ref});
  assert.equal(result.result.error, 'browser_stale', JSON.stringify(result)); assert.equal(await page.evaluate(()=>window.clicked), false);
  await stop(); await detached();
  check('a replacement with the same label and id is rejected instead of receiving the old action');

  requestId = 'reloaded-document';
  snapshot = (await run('browser_snapshot')).result;
  await page.reload();
  result = await run('click_element', {ref: elements(snapshot).find(el=>el.name==='Open details').ref});
  assert.equal(result.result.error, 'browser_stale', JSON.stringify(result)); assert.equal(await page.evaluate(()=>!!window.clicked), false);
  await stop(); await detached();
  check('same-URL reload invalidates document-bound references');

  requestId = 'banner-cancel';
  await run('run_playwright', {code:"return await page.title();"});
  await worker.evaluate(async ({requestId,tabId})=>{
    await chrome.storage.session.set({chatLease:{id:requestId,clientId:'test-owner'}});
    // Deliver Chrome's documented event to the production handler. This does
    // not pretend to click the browser's native banner in a headless test.
    testBrowserAgent.onDebuggerDetached({tabId},'canceled_by_user');
  }, {requestId,tabId});
  await detached();
  assert.equal(await worker.evaluate(async()=> (await chrome.storage.session.get('chatLease')).chatLease.cancelled), true);
  const count = await attaches(); result = await run('browser_snapshot');
  assert.equal(result.result.error, 'cancelled'); assert.equal(await attaches(), count);
  check('a user-cancel detach event cancels the matching lease, closes the connection and rejects reattachment');

  for (const phase of ['finish', 'recover']) {
    requestId = `storage-failure-${phase}`;
    await run('run_playwright', {code:"return await page.title();"});
    const failed = await worker.evaluate(async ({requestId,phase})=>{
      await chrome.storage.session.set({chatLease:{id:requestId,clientId:'test-owner',until:0}});
      const originalGet=chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get=()=>Promise.reject(new Error('test-storage-failure'));
      try {
        if(phase==='finish') await testBrowserAgent.handle({type:'FINISH_CHAT',requestId,clientId:'test-owner',content:'Done'},{id:chrome.runtime.id,url:chrome.runtime.getURL('index.html')});
        else await testBrowserAgent.recoverChat({},'test-owner');
        return false;
      } catch(error) {return error.message==='test-storage-failure';}
      finally {chrome.storage.local.get=originalGet;}
    }, {requestId,phase});
    assert.equal(failed, true); await detached();
    check(`${phase} detaches before storage access even when persistence fails`);
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await mkdir('verification', {recursive: true});
  await writeFile('verification/browser-debugger-result.json', JSON.stringify({checks, errors, realBrowserActions:true, syntheticPages:true, detachEventSimulated:true, nativeBannerClicked:false, actualCompanyPageVerified:false},null,2));
} finally {await context?.close(); await rm(profile,{recursive:true,force:true});}
