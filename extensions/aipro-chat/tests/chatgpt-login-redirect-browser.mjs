// Real Chrome DNR/callback/worker lifecycle, synthetic OAuth upstream only.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, writeFile, mkdir, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chatgptToken} from './fixtures/chatgpt.mjs';
import {forbidLoginDebugger, assertNoLoginDebugger} from './helpers/no-login-debugger.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-chatgpt-redirect-')), extension = resolve(profile, 'extension');
await cp('dist', extension, {recursive: true}); await forbidLoginDebugger(extension);
const code = 'synthetic-private+/_=', token = chatgptToken(), checks = [];
let context, ui, listener, authRoute, mode = '302', exchanges = 0, localHits = 0, authURL;
const check = label => {checks.push(label); console.log('PASS ' + label);};
const rpc = (type, fields = {}) => ui.evaluate(({type, fields}) => chrome.runtime.sendMessage({type, ...fields}), {type, fields});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected) {let value; for (let i=0;i<240;i++) {value=await fn();if(value===expected)return;await new Promise(r=>setTimeout(r,50));} assert.equal(value,expected);}
async function callback(route) {
  authURL = new URL(route.request().url());
  const url = new URL(authURL.searchParams.get('redirect_uri'));
  assert.equal(url.href, 'http://localhost:1455/auth/callback');
  url.search = new URLSearchParams({code, state: authURL.searchParams.get('state')});
  if (mode === '302' || mode === 'restart') return route.fulfill({status:302,headers:{location:url.href},body:''});
  if (mode === 'form') return route.fulfill({contentType:'text/html',body:`<!doctype html><form action="http://localhost:1455/auth/callback"><input name="code" value="${code}"><input name="state" value="${authURL.searchParams.get('state')}"></form><script>document.forms[0].submit()</script>`});
  // Auth may finish on chatgpt.com rather than auth.openai.com.
  if (mode === 'chatgpt') return route.fulfill({contentType:'text/html',body:`<!doctype html><script>location.href=${JSON.stringify('https://chatgpt.com/synthetic-return?' + url.searchParams)}</script>`});
  return route.fulfill({contentType:'text/html',body:`<!doctype html><script>location.replace(${JSON.stringify(url.href)})</script>`});
}
try {
  listener = createServer((_, res) => {localHits++; res.end('Unexpected local callback');});
  await new Promise((resolve, reject) => {listener.once('error',reject);listener.listen(1455,'127.0.0.1',resolve);});
  context = await chromium.launchPersistentContext(profile, {headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://auth.openai.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/oauth/authorize') {
      if (mode === 'restart' || mode === 'hold') {authRoute = route; return;}
      return callback(route);
    }
    assert.equal(url.pathname, '/oauth/token'); assert(request.serviceWorker()); assert.equal(request.method(), 'POST');
    const body = new URLSearchParams(request.postData());
    assert.equal(body.get('code'), code);
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), authURL.searchParams.get('code_challenge'));
    exchanges++;
    return route.fulfill({contentType:'application/json',body:JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',expires_in:3600})});
  });
  await context.route('https://chatgpt.com/**', route => route.fulfill({status:302,headers:{location:`http://localhost:1455/auth/callback${new URL(route.request().url()).search}`},body:''}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button',{name:'ChatGPT',exact:true}).waitFor();
  const clean = async () => {
    await assertNoLoginDebugger(ui); assert.equal(localHits,0);
    assert.deepEqual(await ui.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
    const data = await ui.evaluate(async () => ({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}));
    assert.equal(data.session.loginFlow, undefined); assert.equal(data.session.attempt, undefined);
    assert(!JSON.stringify(data).includes(code)); assert(!JSON.stringify(data).includes(authURL.searchParams.get('state')));
    assert(!JSON.stringify(data.local).includes(token));
  };
  for (const variant of ['302','javascript','form','chatgpt']) {
    mode = variant; const before = exchanges;
    assert.equal((await rpc('START_LOGIN',{provider:'chatgpt'})).ok,true);
    await poll(async () => (await state()).auth.present,true);
    assert.equal((await state()).auth.provider,'chatgpt');
    assert.equal(exchanges,before+1); await clean(); await rpc('LOGOUT');
    check(`${variant}: registered callback, one PKCE exchange, no debugger and no local socket request`);
  }
  mode='restart'; authRoute=null;
  await rpc('START_LOGIN',{provider:'chatgpt'}); await poll(() => !!authRoute,true);
  const pending = await ui.evaluate(() => chrome.storage.session.get(['testWorkerGeneration','loginFlow']));
  const safe = JSON.stringify(await state()); assert(!safe.includes(pending.loginFlow.verifier)); assert(!safe.includes(pending.loginFlow.state));
  const cdp = await context.newCDPSession(ui); await cdp.send('ServiceWorker.enable');
  const {targetInfos} = await cdp.send('Target.getTargets');
  const target = targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url()); assert(target);
  await cdp.send('Target.closeTarget',{targetId:target.targetId});
  await callback(authRoute); authRoute=null;
  await poll(async () => (await state()).auth.present,true);
    assert.equal((await state()).auth.provider,'chatgpt');
  assert.notEqual((await ui.evaluate(() => chrome.storage.session.get('testWorkerGeneration'))).testWorkerGeneration,pending.testWorkerGeneration);
  await clean(); await rpc('LOGOUT'); await cdp.detach();
  check('actual MV3 worker restart resumes waiting PKCE and clears it after exchange');
  mode='hold'; await rpc('START_LOGIN',{provider:'chatgpt'}); await poll(() => !!authRoute,true);
  await rpc('CANCEL_LOGIN'); await clean(); await authRoute.abort().catch(() => {}); authRoute=null;
  check('cancellation closes the login tab and removes the rule and PKCE');
  await mkdir('verification',{recursive:true});
  await writeFile('verification/chatgpt-login-redirect-browser.json',JSON.stringify({checks,exchanges,localHits,debuggerCalls:0,syntheticUpstreams:true,actualAccountVerified:false},null,2)+'\n');
} finally {
  await authRoute?.abort().catch(() => {}); await context?.close();
  if (listener) {listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve));}
  await rm(profile,{recursive:true,force:true});
}
