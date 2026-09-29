// Isolated feasibility probe. This temporary extension is not the shipped product.
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, copyFile, mkdir, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {spawnSync} from 'node:child_process';

const dir = await mkdtemp(resolve(tmpdir(), 'aipro-no-debugger-'));
const extension = resolve(dir, 'extension'), profile = resolve(dir, 'profile');
await mkdir(extension);
const origin = 'https://aipro.sdsdev.co.kr', code = 'synthetic-no-debugger+/_=';
const token = `header.${Buffer.from(JSON.stringify({sub:'synthetic-no-debugger',exp:Date.now()/1000+3600})).toString('base64url')}.signature`;
let localHits = 0, exchangeCount = 0, modelsCount = 0, context, mode = '302';
const listener = createServer((req,res) => {localHits++;res.end('unexpected localhost request');});
await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve));
const port = listener.address().port;
const checks = [];
async function poll(fn, expected) {
  let actual;
  for(let i=0;i<200;i++) {actual=await fn();if(actual===expected)return;await new Promise(r=>setTimeout(r,50));}
  assert.equal(actual,expected);
}
try {
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'AI Pro no-debugger feasibility probe',version:'0.0.1',permissions:['storage','declarativeNetRequestWithHostAccess'],host_permissions:[`${origin}/*`,'http://localhost/*','http://127.0.0.1/*'],background:{service_worker:'background.js',type:'module'},web_accessible_resources:[{resources:['callback.html'],matches:['http://localhost/*','http://127.0.0.1/*',`${origin}/*`,'https://epsso.samsung.net/*']}]}));
  await copyFile('exchange.js',resolve(extension,'exchange.js'));
  await copyFile('core.js',resolve(extension,'core.js'));
  await writeFile(resolve(extension,'control.html'),'<!doctype html><title>Probe control</title>');
  await writeFile(resolve(extension,'callback.html'),'<!doctype html><meta charset="utf-8"><title>AI Pro 로그인</title><p>인증 확인 중</p><script src="callback.js"></script>');
  await writeFile(resolve(extension,'callback.js'),`const query=location.hash.slice(1),nonce=new URL(location.href).searchParams.get('attempt');history.replaceState(null,'',location.pathname);chrome.runtime.sendMessage({type:'callback',nonce,query});`);
  await writeFile(resolve(extension,'background.js'),String.raw`
import {exchangeCode} from './exchange.js';
import {inspectModelList} from './core.js';
let attempt=null;
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 (async()=>{
  if(msg.type==='start'){
   if(attempt)await chrome.tabs.remove(attempt.tabId).catch(()=>{});
   const tab=await chrome.tabs.create({url:'about:blank'});
   attempt={tabId:tab.id,nonce:crypto.randomUUID(),phase:'waiting'};
   await chrome.storage.session.set({phase:'waiting',models:[],codeStored:false});
   await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[1],addRules:[{id:1,priority:1,action:{type:'redirect',redirect:{regexSubstitution:chrome.runtime.getURL('callback.html')+'?attempt='+attempt.nonce+'#\\1'}},condition:{tabIds:[tab.id],resourceTypes:['main_frame'],requestMethods:['get'],regexFilter:'^http://127\\.0\\.0\\.1:'+msg.port+'/auth\\?(.*)$'}}]});
   await chrome.tabs.update(tab.id,{url:'https://aipro.sdsdev.co.kr/auth/vscode/login?port='+msg.port});
   return {tabId:tab.id};
  }
  if(msg.type==='callback'){
   if(!attempt || attempt.phase!=='waiting' || sender.tab?.id!==attempt.tabId || sender.url?.split(/[?#]/)[0]!==chrome.runtime.getURL('callback.html') || msg.nonce!==attempt.nonce)return {ignored:true};
   const params=new URLSearchParams(msg.query);
   if(params.getAll('code').length!==1 || params.getAll('status').length!==1 || params.get('status')!=='00')throw new Error('callback_code_invalid');
   const current=attempt;current.phase='exchanging';
   const {credential}=await exchangeCode(params.get('code'));
   if(attempt!==current)return {ignored:true};
   const response=await fetch('https://aipro.sdsdev.co.kr/api/models',{credentials:'omit',headers:{Authorization:'Bearer '+credential.token}});
   if(!response.ok)throw new Error('models_failed');
   const {models}=inspectModelList(await response.json());
   await chrome.storage.session.set({phase:'complete',models,tokenReceived:true});
   await chrome.tabs.remove(current.tabId);
   await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[1]});
   attempt=null;return {ok:true};
  }
 })().then(result=>reply(result),()=>{chrome.storage.session.set({phase:'failed'});reply({ok:false});});
 return true;
});
`);
  const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:await readFile(resolve(extension,'background.js')),encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  context = await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',executablePath:process.env.CHROME_BINARY||undefined,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route(`${origin}/**`,async route=>{
   const req=route.request(), url=new URL(req.url());
   if(url.pathname==='/auth/vscode/login'){
    const callback=`http://127.0.0.1:${port}/auth?${new URLSearchParams({code,status:'00'})}`;
    if(mode==='302')return route.fulfill({status:302,headers:{location:callback},body:''});
    return route.fulfill({contentType:'text/html',body:`<!doctype html><script>location.href=${JSON.stringify(callback)}</script>`});
   }
   if(url.pathname==='/auth/exchange'){
    exchangeCount++;assert.equal(req.method(),'POST');assert.equal(req.postData(),new URLSearchParams({code}).toString());
    return route.fulfill({contentType:'application/json',body:JSON.stringify({token})});
   }
   if(url.pathname==='/api/models'){
    modelsCount++;assert.equal(req.headers().authorization,`Bearer ${token}`);
    return route.fulfill({contentType:'application/json',body:await readFile('tests/fixtures/aipro-models.json','utf8')});
   }
   if(!['http:','https:'].includes(url.protocol))return route.continue();
   return route.abort();
  });
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
  const ui=await context.newPage();context.setDefaultTimeout(15000);await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/control.html`);
  assert(!(await ui.evaluate(()=>chrome.runtime.getManifest().permissions)).includes('debugger'));
  for(const variant of ['302','javascript']){
   mode=variant;const before=exchangeCount;
   const startPromise=ui.evaluate(port=>chrome.runtime.sendMessage({type:'start',port}),port);
   const started=await Promise.race([startPromise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('start timeout')),15000))]);
   assert(started?.tabId);
   await poll(()=>ui.evaluate(async()=>(await chrome.storage.session.get('phase')).phase),'complete');
   const stored=await ui.evaluate(()=>chrome.storage.session.get(null));
   assert.equal(stored.models.length,10);assert.equal(exchangeCount,before+1);assert.equal(localHits,0);
   assert(!JSON.stringify(stored).includes(code));assert(!JSON.stringify(stored).includes(token));
   await poll(()=>ui.evaluate(async()=>(await chrome.declarativeNetRequest.getSessionRules()).length),0);
   checks.push(`${variant} redirect delivered code and loaded ten models without debugger or reaching localhost`);
  }
  assert.equal(modelsCount,2);
  await mkdir('verification',{recursive:true});
  await writeFile('verification/no-debugger-probe.json',JSON.stringify({experimental:true,shipped:false,realAiProVerified:false,localServerPurpose:'detect unexpected callback traffic',localHits,checks},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,localHits,debuggerPermission:false,shipped:false}));
} catch(error) {console.log('probe failure',error.message,'local hits',localHits);throw error;} finally {await context?.close();listener.closeAllConnections();await new Promise(resolve=>listener.close(resolve));await rm(dir,{recursive:true,force:true});}
