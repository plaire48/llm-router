// Exercise the shipped background and callback page, with synthetic upstream responses.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-login-redirect-'));
const extension = resolve(profile, 'extension');
await cp('dist', extension, {recursive: true});
// Fail any debugger call in this isolated copy. The actual product permissions,
// rule, callback page, exchange and UI are unchanged.
const backgroundFile = resolve(extension, 'background.js');
await writeFile(backgroundFile, `chrome.storage.session.set({testWorkerGeneration: crypto.randomUUID()});
for (const method of ['attach', 'detach', 'sendCommand']) chrome.debugger[method] = async () => { await chrome.storage.session.set({testDebuggerInvoked: true}); console.error('UNEXPECTED_LOGIN_DEBUGGER'); throw new Error('Debugger forbidden by test'); };\n${await readFile(backgroundFile, 'utf8')}`);
const origin = 'https://aipro.sdsdev.co.kr', code = 'synthetic-private+/_=';
const token = `header.${Buffer.from(JSON.stringify({exp: Date.now()/1000+3600, sub: 'synthetic'})).toString('base64url')}.signature`;
const check = label => {checks.push(label);console.log('PASS '+label);};
const checks = [], errors = [], debuggerCalls = [], callbacks = [];
let context, ui, listener, authRoute, exchangeRoute, mode = '302', host = 'localhost', exchangeMode = 'ok', exchangeCount = 0, modelCount = 0, localHits = 0;
const rpc = (type, fields = {}) => ui.evaluate(({type, fields}) => chrome.runtime.sendMessage({type, ...fields}), {type, fields});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected, label = '') {let value; for (let i=0;i<200;i++) {value=await fn();if(value===expected)return;await new Promise(r=>setTimeout(r,50));} assert.equal(value,expected,label);}
async function closeListener() {if (listener) {listener.closeAllConnections(); await new Promise(r=>listener.close(r)); listener = null;}}
async function serveCallback(route) {
  const port = Number(new URL(route.request().url()).searchParams.get('port'));
  await closeListener();
  listener = createServer((_, res) => {localHits++;res.end('Unexpected local request');});
  await new Promise((resolve, reject) => {listener.once('error',reject);listener.listen(port, host === '[::1]' ? '::1' : '127.0.0.1', resolve);});
  const callback = `http://${host}:${port}/auth?${new URLSearchParams({code, status: mode === 'invalid' ? '01' : '00'})}`;
  if (mode === '302' || mode === 'restart') return route.fulfill({status:302,headers:{location:callback},body:''});
  if (mode === 'sso') return route.fulfill({contentType:'text/html',body:`<!doctype html><script>location.href='https://epsso.samsung.net/synthetic?port=${port}'</script>`});
  if (mode === 'form') return route.fulfill({contentType:'text/html',body:`<!doctype html><form action="http://${host}:${port}/auth"><input name="code" value="${code}"><input name="status" value="00"></form><script>document.forms[0].submit()</script>`});
  return route.fulfill({contentType:'text/html',body:`<!doctype html><script>location.replace(${JSON.stringify(callback)})</script>`});
}
try {
  context = await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  const watchdog=setTimeout(()=>context.close(),60000); watchdog.unref();
  const observeWorker = worker => worker.on('console', msg => {if(msg.text().includes('UNEXPECTED_LOGIN_DEBUGGER'))debuggerCalls.push(msg.text());});
  context.on('serviceworker', observeWorker); context.serviceWorkers().forEach(observeWorker);
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('framenavigated', frame => {if(frame===page.mainFrame() && frame.url().includes('/auth-return.html')) callbacks.push(page);});
  });
  await context.route(`${origin}/**`,async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/auth/cli/login') {
      if (mode === 'hold' || mode === 'restart') {authRoute=route;return;}
      return serveCallback(route);
    }
    if(url.pathname==='/auth/exchange') {
      exchangeCount++; assert.equal(req.method(),'POST');
      assert.equal(req.postData(),new URLSearchParams({code}).toString());
      assert.equal(req.headers()['content-type'],'application/x-www-form-urlencoded');
      if(exchangeMode==='hold') {exchangeRoute=route;return;}
      if(exchangeMode==='reject') return route.fulfill({status:400,body:'private-rejection'});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({token})});
    }
    if(url.pathname==='/api/models') {
      modelCount++;assert.equal(req.headers().authorization,`Bearer ${token}`);
      return route.fulfill({contentType:'application/json',body:await readFile('tests/fixtures/aipro-models.json','utf8')});
    }
    return route.abort();
  });
  await context.route('https://epsso.samsung.net/**', async route => {
    const port=new URL(route.request().url()).searchParams.get('port');
    return route.fulfill({status:302,headers:{location:`http://localhost:${port}/auth?${new URLSearchParams({code,status:'00'})}`},body:''});
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  ui=await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button',{name:'AI Pro',exact:true}).waitFor();
  const manifest=await ui.evaluate(()=>chrome.runtime.getManifest());
  assert.deepEqual(manifest.web_accessible_resources[0].resources,['auth-return.html']);
  const ensureClean = async () => {
    await poll(async()=> (await ui.evaluate(()=>chrome.declarativeNetRequest.getSessionRules())).length,0);
    assert.equal((await ui.evaluate(()=>chrome.storage.session.get('testDebuggerInvoked'))).testDebuggerInvoked,undefined);
    assert.equal((await state()).pending,null); assert.equal(localHits,0); assert.deepEqual(debuggerCalls,[]);
    const stored=await ui.evaluate(async()=>JSON.stringify({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}));
    assert(!stored.includes(code)); assert(!stored.includes('private-rejection'));
    assert(!JSON.stringify((await state()).events).includes(token));
    assert(!(await ui.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)))).includes(token));
  };
  for (const [variant, target] of [['302','localhost'],['javascript','127.0.0.1'],['form','localhost'],['sso','localhost'],['302','[::1]']]) {
    mode=variant;host=target; const before=exchangeCount;
    assert.equal((await rpc('START_LOGIN')).ok,true);
    await poll(async()=>(await state()).auth.present,true,variant);
    await poll(async()=>(await state()).catalog?.models?.length,10);
    assert.equal(exchangeCount,before+1); await ensureClean();
    await rpc('LOGOUT');
    check(`${variant} via ${target}: one exchange, ten models, zero debugger calls and zero localhost requests`);
  }
  // Waiting for SSO must survive MV3 worker suspension without storing its code.
  mode='restart';host='localhost';authRoute=null;
  await rpc('START_LOGIN');await poll(()=>Promise.resolve(!!authRoute),true);
  const generation = (await ui.evaluate(()=>chrome.storage.session.get('testWorkerGeneration'))).testWorkerGeneration;
  const cdp=await context.newCDPSession(ui);
  await cdp.send('ServiceWorker.enable');
  const {targetInfos} = await cdp.send('Target.getTargets');
  const target = targetInfos.find(target=>target.type==='service_worker' && target.url===worker.url());
  assert(target);
  await cdp.send('Target.closeTarget', {targetId:target.targetId});
  await serveCallback(authRoute);authRoute=null;
  await poll(async()=>(await state()).auth.present,true,'callback after worker restart');
  assert.notEqual((await ui.evaluate(()=>chrome.storage.session.get('testWorkerGeneration'))).testWorkerGeneration,generation,'worker really restarted');
  await ensureClean();await rpc('LOGOUT');await cdp.detach();
  check('pending SSO survives worker restart and finishes without code persistence');

  // Hold an exchange long enough to inspect the real callback document and reject a replay.
  mode='javascript';exchangeMode='hold';exchangeRoute=null;
  await rpc('START_LOGIN');await poll(()=>Promise.resolve(!!exchangeRoute),true);
  const attempt=await ui.evaluate(async()=>(await chrome.storage.session.get('attempt')).attempt);
  const callbackPage=callbacks.findLast(page=>!page.isClosed());assert(callbackPage);
  await poll(()=>Promise.resolve(callbackPage.url().endsWith('/auth-return.html')),true,'callback URL is scrubbed');
  await mkdir('verification',{recursive:true});
  for (const width of [360,1100]) {
    await callbackPage.setViewportSize({width,height:800});
    await callbackPage.evaluate(()=>document.fonts.ready);
    assert(await callbackPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const appearance=await callbackPage.locator('[role="status"]').evaluate(el=>({font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,color:getComputedStyle(el).color}));
    assert(appearance.font.includes('Noto Sans KR'));assert.equal(appearance.size,'14px');
    await callbackPage.screenshot({path:`verification/login-return-${width}.png`});
  }
  await callbackPage.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await callbackPage.locator('img').evaluate(el=>getComputedStyle(el).animationName),'none');
  const beforeReplay=exchangeCount;
  const replay=await callbackPage.evaluate(({nonce,query})=>chrome.runtime.sendMessage({type:'AIPRO_LOGIN_CALLBACK',nonce,query}),{nonce:attempt.id,query:new URLSearchParams({code,status:'00'}).toString()});
  assert.equal(replay.data.accepted,false);assert.equal(exchangeCount,beforeReplay);
  // A second extension document is not the login tab, even if it knows the nonce.
  const foreign=await context.newPage();await foreign.goto(`chrome-extension://${new URL(worker.url()).hostname}/auth-return.html`);
  const rejected=await foreign.evaluate(({nonce,query})=>chrome.runtime.sendMessage({type:'AIPRO_LOGIN_CALLBACK',nonce,query}),{nonce:attempt.id,query:new URLSearchParams({code,status:'00'}).toString()});
  assert.equal(rejected.error,'invalid_sender');await foreign.close();
  await rpc('CANCEL_LOGIN');await ensureClean();
  await exchangeRoute.fulfill({contentType:'application/json',body:JSON.stringify({token})});
  await new Promise(resolve=>setTimeout(resolve,100)); assert.equal((await state()).auth.present,false);
  check('callback URL is scrubbed; replay and other tabs are rejected; cancellation discards a late token');
  exchangeMode='reject';await rpc('START_LOGIN');
  await poll(async()=>(await state()).report.stage,'exchange_rejected');await ensureClean();
  exchangeMode='ok';mode='invalid';const exchanges=exchangeCount;
  await rpc('START_LOGIN');await poll(async()=>(await state()).report.stage,'callback_code_invalid');
  assert.equal(exchangeCount,exchanges);await ensureClean();
  mode='302';await rpc('START_LOGIN');await poll(async()=>(await state()).auth.present,true);await ensureClean();
  check('exchange failure and invalid SSO status clean up fully; retry succeeds');
  assert.equal(errors.length,0,errors.join('\n'));
  await mkdir('verification',{recursive:true});
  await writeFile('verification/login-redirect-browser.json',JSON.stringify({version:manifest.version,realAiProVerified:false,shippedProduct:true,localHits,debuggerCalls:debuggerCalls.length,modelCount,checks},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,localHits,debuggerCalls:debuggerCalls.length,realAiProVerified:false},null,2));
} catch (error) {console.log(JSON.stringify({mode,localHits,exchangeCount,state: ui ? await state().then(({pending,report,events})=>({pending,report,events})).catch(()=>null) : null,pages:context?.pages().map(page=>page.url().split(/[?#]/)[0])},null,2));throw error;} finally {await context?.close();await closeListener();await rm(profile,{recursive:true,force:true});}
