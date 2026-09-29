import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

// All auth endpoints, redirect codes, cookies and tokens below are synthetic.
// These fixtures do not describe or verify the actual AI Pro exchange API.
const origin = 'https://aipro.sdsdev.co.kr';
const secret = 'PRIVATE_BROWSER_SENTINEL_9c8de9';
const extension = resolve('dist');
const profile = await mkdtemp(resolve(tmpdir(), 'aipro-auth-trace-'));
const checks = [];
let context;
async function poll(fn, label) {
  for (let i = 0; i < 150; i++) {if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50));}
  assert.fail(label);
}
try {
  context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chromium', executablePath: process.env.CHROME_BINARY || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  await context.route(`${origin}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/vscode/login') return route.fulfill({status: 302, headers: {location: `${origin}/auth/vscode/callback?port=${url.searchParams.get('port')}&code=${secret}`}, body: ''});
    if (url.pathname === '/auth/vscode/callback') return route.fulfill({contentType: 'text/html', body: `<!doctype html><title>Synthetic auth trace</title><script>
      (async () => {
        await (await fetch('/api/auth/token?code=${secret}', {method:'POST',headers:{'content-type':'application/json','authorization':'${secret}'},body:JSON.stringify({code:'${secret}',grant_type:'authorization_code'})})).json();
        await (await fetch('/auth/${secret}?${secret}=ignored')).text();
        await (await fetch('/api/private?code=${secret}')).text();
        location.href='http://localhost:${url.searchParams.get('port')}/auth?code=${secret}&status=01';
      })();</script>`});
    if (url.pathname === '/api/auth/token') return route.fulfill({contentType: 'application/json', headers: {'Set-Cookie': `synthetic=${secret}; Secure; SameSite=None`}, body: JSON.stringify({data: {access_token: secret, expires_in: 300}, [secret]: secret})});
    return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Synthetic</title>'});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const rpc = async type => {
    const result = await ui.evaluate(type => chrome.runtime.sendMessage({type}), type);
    assert.equal(result.ok, true, result.error);
    return result.data;
  };
  await rpc('START_LOGIN');
  await poll(async () => (await rpc('GET_STATE')).report.stage === 'callback_code_invalid', 'code callback must still reach extension');
  await poll(async () => (await rpc('GET_STATE')).authTrace.requests.some(row => row.path === '/api/auth/token' && row.body === 'fields_only'), 'completed JSON schema inspected');
  let state = await rpc('GET_STATE');
  assert.equal(state.auth.present, false, 'observed response tokens must never authenticate the extension');
  assert(state.events.some(event => event.event === 'callback_received' && event.status === 400));
  assert(state.authTrace.requests.some(row => row.path === '/auth/vscode/login' && row.status === 302));
  assert(state.authTrace.requests.some(row => row.path === '/auth/vscode/callback' && row.status === 200 && row.content === 'html'));
  const tokenRequest = state.authTrace.requests.find(row => row.path === '/api/auth/token');
  assert.deepEqual(tokenRequest.requestFields, ['code', 'grant_type']);
  assert.deepEqual(tokenRequest.responseFields, ['data.access_token', 'data.expires_in']);
  assert(state.authTrace.requests.some(row => row.path === '/auth/[redacted]'));
  assert(!state.authTrace.requests.some(row => row.path.includes('private')));
  assert(!JSON.stringify(state).includes(secret));
  checks.push('login redirects and JSON auth field names captured without changing callback authentication');

  const count = state.authTrace.requests.length;
  const unrelated = await context.newPage();
  await unrelated.goto(`${origin}/auth/session?code=${secret}`);
  await unrelated.close();
  assert.equal((await rpc('GET_STATE')).authTrace.requests.length, count);
  checks.push('unrelated tabs and non-auth requests excluded');

  await ui.evaluate(() => {window.copiedDiagnostic = ''; navigator.clipboard.writeText = async value => {window.copiedDiagnostic = value;};});
  await ui.getByRole('button', {name: '설정', exact: true}).click();
  await ui.getByText('연결 진단', {exact: true}).click();
  await ui.getByRole('button', {name: '진단 복사', exact: true}).click();
  await poll(() => ui.evaluate(() => Boolean(window.copiedDiagnostic)), 'diagnostic copy');
  const copied = await ui.evaluate(() => window.copiedDiagnostic);
  assert.equal(JSON.parse(copied).authTrace.scope, 'login_tab_browser_only');
  assert(!copied.includes(secret));
  assert(!copied.includes('localhost:'));
  assert(!/https?:\/\//.test(copied));
  const stored = await ui.evaluate(() => chrome.storage.local.get(null));
  assert(!JSON.stringify(stored).includes(secret));
  checks.push('existing diagnostic copy includes sanitized trace and no secret values');

  await rpc('CANCEL_LOGIN');
  assert.equal((await rpc('GET_STATE')).authTrace.state, 'stopped');
  await context.close(); context = null;
  await mkdir('verification', {recursive: true});
  await writeFile('verification/auth-trace-browser-results.json', JSON.stringify({version: '0.3.0', passed: checks.length, realAiProVerified: false, checks}, null, 2));
  console.log(`PASS ${checks.length} synthetic auth trace browser checks`);
} finally {
  await context?.close();
  await rm(profile, {recursive: true, force: true});
}
