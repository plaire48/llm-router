import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-popups-')), extension = resolve(profile, 'extension');
const checks = [], errors = [];
let context, worker;
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('https://*.example.test/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  // Test-only entry into the production executor. No model or credentials are
  // involved; every browser action runs through the shipped CRX/QuickJS path.
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testBrowserAgent = {runBrowserAgent, stopBrowserAgent, browserAgentContext, ready: () => serial(() => {})};\n');
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://portal.example.test/**', route => route.fulfill({contentType: 'text/html', body: `<title>Portal</title>
    <button id="popup" onclick="const w=window.open('','nubi-compose','popup,width=600,height=500'); setTimeout(()=>w.location='https://mail.example.test/draft',1600)">Open compose</button>
    <button id="delayed" onclick="window.delayedClicked=true;setTimeout(()=>{window.delayedOpened=!!window.open('https://mail.example.test/late','_blank')},1400)">Delayed tab</button>
    <button id="reuse" onclick="window.open('https://mail.example.test/reused','nubi-compose','popup,width=600,height=500').focus()">Reuse compose</button>
    <output id="result"></output><script>addEventListener('message',event=>{if(event.origin==='https://mail.example.test'&&event.data==='saved')document.querySelector('#result').textContent='Draft saved';});</script>`}));
  await context.route('https://mail.example.test/**', route => route.fulfill({contentType: 'text/html', body: `<title>Compose</title><label>Subject<input aria-label="Subject"></label><button onclick="if(opener&&!opener.closed)opener.postMessage('saved','https://portal.example.test');window.close()">Save draft</button><button onclick="window.open('https://mail.example.test/nested','_blank','popup,width=500,height=500')">Nested draft</button>`}));
  await context.route('https://unrelated.example.test/**', route => route.fulfill({contentType: 'text/html', body: '<title>Unrelated</title><p>Unrelated page</p>'}));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  // Direct executor probes have no chat lease. Finish the worker's startup
  // recovery before attaching, just as normal queued chat requests do.
  await worker.evaluate(() => testBrowserAgent.ready());
  const portal = await context.newPage(); await portal.goto('https://portal.example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'https://portal.example.test/').id);
  let requestId = 'popup-regression';
  const run = (name, args = {}) => worker.evaluate(({requestId, tabId, name, args}) => globalThis.testBrowserAgent.runBrowserAgent(requestId, {tabId}, name, args), {requestId, tabId, name, args});
  let result = await run('run_playwright', {code: `await page.getByRole('button',{name:'Open compose',exact:true}).click(); await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Window draft'); return await page.getByRole('textbox',{name:'Subject',exact:true}).inputValue();`});
  assert.equal(result.result.ok, true, JSON.stringify(result)); assert.equal(result.result.yielded, true); assert.equal(result.result.completed, false); assert.notEqual(result.tabId, tabId);
  const popupId = result.tabId;
  let popup = context.pages().find(page => page.url() === 'https://mail.example.test/draft');
  assert(popup); assert.equal(await popup.getByLabel('Subject').inputValue(), '');
  assert.deepEqual(result.result.execution.commands.map(command => command.method), ['click']);
  result = await run('run_playwright', {code: `await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Window draft'); return await page.getByLabel('Subject').inputValue();`});
  assert.equal(result.result.value, 'Window draft'); assert.equal(await popup.getByLabel('Subject').inputValue(), 'Window draft');
  check('a delayed blank popup yields fresh evidence before any queued input; the next script fills its observed field');
  result = await run('list_tabs');
  assert(result.result.tabs.some(tab => Number(tab.tab_id) === popupId));
  assert.equal(await worker.evaluate(async id => (await chrome.windows.get((await chrome.tabs.get(id)).windowId)).type, popupId), 'popup');
  check('tab discovery includes Chrome popup windows, not only normal windows');
  await run('switch_tab', {tab_id: String(tabId)});
  result = await run('run_playwright', {code: `await page.getByRole('button',{name:'Reuse compose',exact:true}).click(); await page.getByLabel('Subject').fill('Reused draft'); return await page.url();`});
  assert.equal(result.result.yielded, true, JSON.stringify(result)); assert.equal(result.tabId, popupId);
  assert.equal(await popup.getByLabel('Subject').inputValue(), '');
  result = await run('run_playwright', {code: `await page.getByLabel('Subject').fill('Reused draft'); return await page.url();`});
  assert.equal(result.result.value, 'https://mail.example.test/reused');
  check('an existing named popup is reused and its newly committed document becomes the script target');
  await worker.evaluate(requestId => globalThis.testBrowserAgent.stopBrowserAgent(requestId), requestId);
  requestId = 'popup-resumed';
  const resume = await worker.evaluate(({requestId, tabId}) => globalThis.testBrowserAgent.runBrowserAgent(requestId, {tabId}, 'browser_snapshot'), {requestId, tabId: popupId});
  assert.equal(resume.result.title, 'Compose');
  result = await run('run_playwright', {code: `await page.getByRole('button',{name:'Save draft',exact:true}).click(); return await page.title();`});
  assert.equal(result.tabId, tabId, JSON.stringify(result)); assert.equal(result.result.observation.title, 'Portal');
  assert.equal(await portal.locator('#result').textContent(), 'Draft saved');
  check('after detaching and resuming, closing a child window returns to its known opener and verifies the saved state');
  result = await run('browser_snapshot');
  const delayedRef = result.result.frames.flatMap(frame => frame.elements || []).find(el => el.name === 'Delayed tab').ref;
  const unrelated = await context.newPage(); await unrelated.goto('https://unrelated.example.test/');
  result = await run('click_element', {ref: delayedRef});
  assert(result.result.observation?.url === 'https://mail.example.test/late', JSON.stringify({result, tabs: await worker.evaluate(() => chrome.tabs.query({})), fixture: await portal.evaluate(() => ({clicked: window.delayedClicked, opened: window.delayedOpened}))}));
  check('reference-based clicks follow a tab created 1.4 seconds later instead of an unrelated tab');
  const before = await run('browser_snapshot');
  assert(before.result.frames.some(frame => frame.elements.some(el => el.name === 'Subject')));
  result = await run('run_playwright', {code: `for(let i=0;i<65;i++) await page.getByLabel('Subject').fill(String(i)); return await page.getByLabel('Subject').inputValue();`});
  assert.equal(result.result.ok, true, JSON.stringify(result)); assert.equal(result.result.value, '64'); assert.equal(result.result.calls, 66);
  check('one real browser script completes 65 sequential form writes and reads the retained final value');
  const middleId = result.tabId;
  result = await run('run_playwright', {code: `await page.getByRole('button',{name:'Nested draft',exact:true}).click(); await page.getByLabel('Subject').fill('Nested draft');`});
  assert.equal(result.result.ok, true, JSON.stringify(result));
  const childId = result.tabId;
  const savedContext = await worker.evaluate(requestId => testBrowserAgent.browserAgentContext(requestId), requestId);
  await worker.evaluate(async ({requestId, middleId}) => {await testBrowserAgent.stopBrowserAgent(requestId); await chrome.tabs.remove(middleId);}, {requestId, middleId});
  requestId = 'nested-resumed';
  result = await worker.evaluate(({requestId, childId, savedContext}) => testBrowserAgent.runBrowserAgent(requestId, {tabId: childId, browserContext: savedContext}, 'browser_snapshot'), {requestId, childId, savedContext});
  assert.equal(result.result.title, 'Compose');
  result = await run('run_playwright', {code: `await page.getByRole('button',{name:'Save draft',exact:true}).click(); return await page.title();`});
  // Chromium can close the target before Playwright acknowledges the click.
  // Keep that outcome uncertain, but restore observation and continue without
  // replaying the click or getting stuck on the closed intermediate window.
  assert(result.result.ok || result.result.error === 'browser_stale' && result.result.actionIssued, JSON.stringify(result));
  assert.equal(result.tabId, tabId); assert.equal(result.result.observation.title, 'Portal');
  result = await run('run_playwright', {code: 'return await page.title();'});
  assert.equal(result.result.ok, true, JSON.stringify(result)); assert.equal(result.result.value, 'Portal');
  check('a nested popup retains its parent chain across resume and skips a closed intermediate window');
  await run('switch_tab', {tab_id: String(tabId)});
  const opened = context.waitForEvent('page');
  const pending = run('run_playwright', {code: `await page.getByRole('button',{name:'Open compose',exact:true}).click(); await page.getByLabel('Subject').fill('must not be written');`});
  const cancelledPopup = await opened;
  await worker.evaluate(requestId => globalThis.testBrowserAgent.stopBrowserAgent(requestId), requestId);
  result = await pending; assert.equal(result.result.error, 'cancelled', JSON.stringify(result));
  await cancelledPopup.waitForURL('https://mail.example.test/draft');
  assert.equal(await cancelledPopup.getByLabel('Subject').inputValue(), '');
  check('stopping while a blank popup loads prevents the queued form write and leaves the user window open');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await mkdir('verification', {recursive: true});
  await writeFile('verification/browser-popups-result.json', JSON.stringify({checks, errors, realBrowserActions: true, syntheticPages: true, actualCompanyPageVerified: false}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
