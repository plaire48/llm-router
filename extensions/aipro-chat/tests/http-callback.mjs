import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

// These are browser HTTP requests, fulfilled by the installed extension.
// Playwright mocks only AI Pro HTTPS pages. No localhost listener is started.
const origin = 'https://aipro.sdsdev.co.kr';
const ssoOrigin = 'https://epsso.samsung.net';
const extension = resolve('dist');
const profile = await mkdtemp(resolve(tmpdir(), 'aipro-http-callback-'));
const output = resolve('verification/http-callback-results.json');
const token = `header.${Buffer.from(JSON.stringify({sub: 'synthetic-http-callback', exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
const code = 'synthetic-http-opaque-code';
const assertions = [], responseEvidence = [], pageErrors = [], requestEvidence = [];
let context, ui, version;

const check = label => { assertions.push(label); console.log(`PASS ${label}`); };
async function poll(fn, expected, label) {
  const deadline = Date.now() + 15000;
  let actual;
  while (Date.now() < deadline) {
    actual = await fn();
    if (actual === expected) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(actual, expected, label);
}
async function rpc(type) {
  const response = await ui.evaluate(type => chrome.runtime.sendMessage({type}), type);
  assert.equal(response.ok, true, type);
  return response.data;
}
const state = () => rpc('GET_STATE');
const session = () => ui.evaluate(() => chrome.storage.session.get(null));
async function begin() {
  await rpc('LOGOUT');
  await rpc('START_LOGIN');
  const current = await session();
  const {attempt} = current;
  assert(attempt && current.receiverTab === attempt.tabId);
  await ui.evaluate(() => { window.callbackResponseEvents = []; });
  await ui.evaluate(tabId => chrome.debugger.sendCommand({tabId}, 'Network.enable'), attempt.tabId);
  await poll(() => context.pages().some(page => page.url().startsWith(`${origin}/auth/vscode/login?port=${attempt.port}`)), true, 'AI Pro fixture loaded');
  const page = context.pages().find(page => page.url().startsWith(`${origin}/auth/vscode/login?port=${attempt.port}`));
  await page.waitForLoadState('domcontentloaded');
  return {page, attempt};
}
async function submitForm(page, url, values) {
  await page.evaluate(({url, values}) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    for (const [name, value] of Object.entries(values)) {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = name; input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }, {url, values});
  await page.waitForURL(url);
  return documentResponse(page);
}
async function documentResponse(page) {
  await poll(async () => (await page.locator('body').innerText()).startsWith('{'), true, 'HTTP JSON document rendered');
  const body = JSON.parse(await page.locator('body').innerText());
  const response = await ui.evaluate(() => window.callbackResponseEvents.filter(event => event.resourceType === 'Document').at(-1));
  assert(response, 'Chrome Network.responseReceived observes the fulfilled HTTP response');
  return {...response, body};
}

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium', executablePath: process.env.CHROME_BINARY || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  context.on('page', page => page.on('pageerror', error => pageErrors.push(error.name)));
  context.on('request', request => {
    const url = new URL(request.url());
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) requestEvidence.push({event: 'request', host: url.hostname, method: request.method(), resourceType: request.resourceType()});
  });
  context.on('requestfailed', request => {
    const url = new URL(request.url());
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) requestEvidence.push({event: 'requestfailed', host: url.hostname, method: request.method(), error: request.failure()?.errorText});
  });
  await context.route(`${origin}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/vscode/login') return route.fulfill({status: 200, contentType: 'text/html', headers: {'Referrer-Policy': 'origin'}, body: '<!doctype html><title>Synthetic AI Pro</title><body>Login callback fixture</body>'});
    if (url.pathname === '/api/models') return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({modelList: []})});
    return route.abort();
  });
  await context.route(`${ssoOrigin}/**`, route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Synthetic EP SSO</title>'}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  ui = await context.newPage();
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.evaluate(() => {
    window.callbackTransportEvents = [];
    window.callbackResponseEvents = [];
    window.callbackDetachEvents = [];
    chrome.debugger.onDetach.addListener((source, reason) => window.callbackDetachEvents.push({tabId: source.tabId, reason}));
    chrome.debugger.onEvent.addListener((_source, method, params) => {
      if (method === 'Network.responseReceived') {
        const url = new URL(params.response.url);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;
        const headers = Object.fromEntries(Object.entries(params.response.headers).map(([key, value]) => [key.toLowerCase(), value]).filter(([key]) => key.startsWith('access-control-') || ['cache-control', 'content-type', 'content-length'].includes(key)));
        window.callbackResponseEvents.push({status: params.response.status, resourceType: params.type, headers});
      }
      if (method !== 'Fetch.requestPaused') return;
      const headers = Object.fromEntries(Object.entries(params.request.headers).map(([key, value]) => [key.toLowerCase(), value]));
      window.callbackTransportEvents.push({method: params.request.method, resourceType: params.resourceType, origin: headers.origin, contentType: headers['content-type'], hasBody: Boolean(params.request.postData || params.request.hasPostData)});
    });
  });
  version = await ui.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(version, '0.3.0');

  {
    const {page, attempt} = await begin();
    await page.goto(`${ssoOrigin}/synthetic`);
    const received = await page.evaluate(async url => {
      const response = await fetch(url);
      return {status: response.status, body: await response.json()};
    }, `http://localhost:${attempt.port}/auth?code=${code}&status=01`);
    assert.equal(received.status, 400);
    assert.deepEqual(received.body, {ok: false, message: 'invalid login callback'});
    assert.equal((await state()).auth.present, false);
    await poll(async () => (await state()).events.some(event => event.event === 'callback_received' && event.origin === 'epsso' && event.field === 'code'), true, 'EP SSO origin classified');
    const authenticated = await page.evaluate(async ({url, token}) => {
      const response = await fetch(url, {headers: {jwt: token}});
      return {status: response.status, body: await response.json()};
    }, {url: `http://localhost:${attempt.port}/auth`, token});
    assert.equal(authenticated.status, 200);
    await poll(async () => (await state()).auth.present, true, 'EP SSO JWT callback authenticated');
    responseEvidence.push({case: 'epsso-origin', codeStatus: 400, jwtStatus: 200});
    check('EP SSO origin receives CORS responses while failed status stays unauthenticated and valid JWT succeeds');
  }

  {
    const {page, attempt} = await begin();
    const response = await submitForm(page, `http://localhost:${attempt.port}/auth`, {jwt: token});
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {ok: true, message: 'AI Pro login completed'});
    assert.equal(response.headers['cache-control'], 'no-store');
    await poll(async () => (await state()).auth.present, true, 'form POST authenticated');
    const current = await state();
    assert(current.events.some(event => event.event === 'credential_received' && event.method === 'POST' && event.field === 'jwt' && event.transport === 'http'));
    responseEvidence.push({case: 'form-post-document', status: response.status, field: 'jwt', fixtureReferrerPolicy: 'origin'});
    check('main-document HTML form POST delivers JWT body and receives router JSON without a localhost server');
  }

  {
    const {page, attempt} = await begin();
    await page.goto(`http://[::1]:${attempt.port}/auth?jwt=${encodeURIComponent(token)}`);
    const response = await documentResponse(page);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {ok: true, message: 'AI Pro login completed'});
    await poll(async () => (await state()).auth.present, true, 'IPv6 callback authenticated');
    responseEvidence.push({case: 'ipv6-navigation', status: response.status});
    check('IPv6 localhost navigation callback is fulfilled and authenticates');
  }

  {
    const {page, attempt} = await begin();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    // Explicitly synthesize the browser PNA preflight header, which is not
    // writable through page fetch(). No production request is changed.
    await cdp.send('Network.setExtraHTTPHeaders', {headers: {'Access-Control-Request-Private-Network': 'true'}});
    const result = await page.evaluate(async url => {
      const response = await fetch(url, {method: 'OPTIONS', credentials: 'include'});
      return {status: response.status, text: await response.text()};
    }, `http://127.0.0.1:${attempt.port}/auth`);
    const response = await ui.evaluate(() => window.callbackResponseEvents.at(-1));
    assert(response, 'Chrome reports the OPTIONS response');
    const {headers} = response;
    assert.equal(result.status, 204);
    assert.equal(result.text, '');
    assert.equal(headers['access-control-allow-origin'], origin);
    assert.equal(headers['access-control-allow-credentials'], 'true');
    assert.equal(headers['access-control-allow-private-network'], 'true');
    assert.equal(headers['access-control-allow-methods'], 'GET, POST, PUT, OPTIONS');
    assert.equal(headers['access-control-max-age'], '600');
    assert.equal((await state()).auth.present, false);
    assert.equal((await session()).attempt.id, attempt.id);
    await cdp.send('Network.setExtraHTTPHeaders', {headers: {}});
    await cdp.detach();
    responseEvidence.push({case: 'options-cors-private-network', status: result.status, privateNetworkHeaderInjectedByTest: true});
    check('explicit OPTIONS receives HTTP 204, credentialed CORS and private-network response while login remains pending');
  }

  {
    const {page, attempt} = await begin();
    await page.goto(`http://localhost:${attempt.port}/auth?code=${code}&status=01`);
    const response = await documentResponse(page);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {ok: false, message: 'invalid login callback'});
    await poll(async () => (await state()).report.stage, 'callback_code_invalid', 'failed-status response recorded');
    assert.equal((await state()).auth.present, false);
    assert.equal((await session()).attempt.id, attempt.id);
    // A document can trigger additional favicon/image requests on the same
    // loopback port. They must not replace the meaningful failed-status diagnostic.
    await page.evaluate(() => {
      const image = new Image();
      window.incidentalCallbackFinished = new Promise(resolve => { image.onload = image.onerror = () => resolve(true); });
      image.src = '/favicon.ico?synthetic=incidental';
      document.body.append(image);
    });
    await page.evaluate(() => window.incidentalCallbackFinished);
    assert.equal((await state()).report.stage, 'callback_code_invalid');
    assert.equal((await session()).attempt.id, attempt.id);
    await page.goto(`http://localhost:${attempt.port}/auth?jwt=${encodeURIComponent(token)}`);
    const success = await documentResponse(page);
    assert.equal(success.status, 200);
    await poll(async () => (await state()).auth.present, true, 'same-attempt JWT authenticated');
    await poll(async () => (await state()).pending, null, 'completed attempt removed');
    responseEvidence.push({case: 'failed-status-then-jwt', statuses: [response.status, success.status]});
    check('failed-status GET receives HTTP 400 and a later JWT completes the same login attempt');
  }

  {
    const {page, attempt} = await begin();
    await page.goto('data:text/html,<!doctype html><body>Synthetic opaque origin</body>');
    const response = await submitForm(page, `http://localhost:${attempt.port}/auth`, {jwt: token});
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, {ok: false, message: 'origin not allowed'});
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal((await state()).auth.present, false);
    assert.equal((await session()).attempt.id, attempt.id);
    responseEvidence.push({case: 'opaque-origin-form', status: response.status});
    check('a form submitted from opaque origin receives HTTP 403 without storing the JWT');
  }

  {
    const {page, attempt} = await begin();
    // Closing the debugged target causes Chrome's real onDetach(target_closed).
    // Calling debugger.detach() ourselves does not emit that event in Chrome.
    await page.close();
    await poll(async () => (await state()).pending, null, 'closed debugger target clears pending login');
    assert.equal((await state()).pending, null);
    assert.equal((await state()).auth.present, false);
    const stored = await session();
    assert.equal(stored.receiverTab, undefined);
    assert.equal(stored.attempt, undefined);
    await poll(() => page.isClosed(), true, 'detached login tab closed');
    const detached = await ui.evaluate(tabId => window.callbackDetachEvents.some(event => event.tabId === tabId && event.reason === 'target_closed'), attempt.tabId);
    assert.equal(detached, true);
    check('Chrome target_closed debugger detach clears the pending login and receiver');
  }

  const stored = await ui.evaluate(async () => ({local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null)}));
  assert(!JSON.stringify(stored).includes(code));
  assert(!JSON.stringify(stored.local).includes(token));
  assert(!JSON.stringify((await state()).events).includes(token));
  assert.deepEqual(pageErrors, []);
  check('synthetic opaque code and JWT are absent from persistent storage and diagnostics');
  await mkdir(resolve('verification'), {recursive: true});
  await writeFile(output, JSON.stringify({synthetic: true, realAiProVerified: false, extensionVersion: version, loopbackServerStarted: false, debuggerDetachVerification: 'real target_closed event; debugger infobar user cancellation not exercised', assertions, responseEvidence, pageErrors}, null, 2) + '\n');
} catch (error) {
  console.error(JSON.stringify({error: error.name, assertions, requestEvidence, transportEvents: await ui.evaluate(() => window.callbackTransportEvents).catch(() => []), state: await state().catch(() => null), pages: await Promise.all((context?.pages() || []).filter(page => page !== ui).map(async page => ({title: await page.title().catch(() => ''), text: (await page.locator('body').innerText().catch(() => '')).replaceAll(token, '[JWT]').replaceAll(code, '[CODE]').slice(0, 1200)})))}, null, 2));
  throw error;
} finally {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
}
