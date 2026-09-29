import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-restart-write-')),extension=resolve(profile,'extension');
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<title>입력 복구 검사</title><label>본문<input id="body"></label><label>메모<input id="note"></label><script>window.writes=0;addEventListener("input",()=>writes++);</script>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
let context,worker,page;
const checks=[];
const field=(result,id)=>{const observation=result.observation||result;assert(Array.isArray(observation.frames),JSON.stringify(result));const match=observation.frames.flatMap(frame=>frame.elements||[]).find(el=>el.id===id);assert(match,JSON.stringify(result));return match.ref;};
try {
  await cp('dist',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push(`${origin}/*`);await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  const bgPath=resolve(extension,'background.js');let bg=await readFile(bgPath,'utf8');
  const marker="        if(message.name==='verify_page'&&result.ok===true";assert(bg.includes(marker));
  bg=bg.replace(marker,"        if(globalThis.holdInput&&message.name==='fill_form'){globalThis.inputReturned=true;await new Promise(()=>{});}\n"+marker);
  await writeFile(bgPath,bg);
  await appendFile(bgPath,`\nglobalThis.restartProbe={ready:()=>serial(()=>{}),run:(requestId,name,args={})=>handle({type:'RUN_TOOL',requestId,name,args,clientId:'fixture'},{id:chrome.runtime.id,url:chrome.runtime.getURL('index.html')})};\n`);
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY||chromium.executablePath(),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route('https://aipro.sdsdev.co.kr/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({modelList:[{name:'QWEN3.8-27B-FP8-256K'}]})}));
  page=await context.newPage();await page.goto(origin);
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>restartProbe.ready());
  const tabId=await worker.evaluate(async origin=>(await chrome.tabs.query({})).find(tab=>tab.url===origin+'/').id,origin);
  const seed=async id=>worker.evaluate(async({id,tabId,origin})=>{
    const {chat:prior}=await chrome.storage.local.get('chat');
    await chrome.storage.local.set({chat:{provider:'aipro',sessionId:'restart-conversation',messages:[{id,requestId:id,role:'assistant',state:'pending',content:''}],draft:'',task:{...(prior?.task||{steps:[],goal:'본문 입력'}),requestId:id,status:'running'}}});
    await chrome.storage.session.set({page:{id:'fixture-page',tabId,url:origin,title:'입력 복구 검사'},credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:1},chatLease:{id,pageId:'fixture-page',conversationId:'restart-conversation',clientId:'fixture',credentialReceivedAt:1,provider:'aipro',automation:true,toolNames:['browser_snapshot','fill_form','verify_page'],lastSeenAt:Date.now(),until:Date.now()+60000}});
  },{id,tabId,origin});
  let requestId='before-crash';await seed(requestId);
  const run=(name,args={})=>worker.evaluate(({requestId,name,args})=>restartProbe.run(requestId,name,args),{requestId,name,args});
  let observation=await run('browser_snapshot');const bodyRef=field(observation,'body');
  await worker.evaluate(()=>{globalThis.holdInput=true;});
  const lost=run('fill_form',{fields:[{field_id:bodyRef,value:'작성한 초안'}]}).catch(()=>null);
  await page.waitForFunction(()=>window.writes===1);
  await worker.evaluate(async()=>{
    const deadline=Date.now()+5000;while(!globalThis.inputReturned){if(Date.now()>deadline)throw Error('input receipt not reached');await new Promise(r=>setTimeout(r,25));}
    const {chatLease}=await chrome.storage.session.get('chatLease');await chrome.storage.session.set({chatLease:{...chatLease,owner:'worker'}});
  });
  const saved=await worker.evaluate(async()=>(await chrome.storage.local.get('chat')).chat.task);
  assert.equal(saved.pendingReconciliation.version,1);assert(!JSON.stringify(saved.pendingReconciliation).includes('작성한'));
  const cdp=await context.browser().newBrowserCDPSession();const {targetInfos}=await cdp.send('Target.getTargets');
  const target=targetInfos.find(target=>target.type==='service_worker'&&target.url===worker.url());assert(target);
  assert.equal((await cdp.send('Target.closeTarget',{targetId:target.targetId})).success,true);await lost;
  const ui=await context.newPage();await ui.goto(worker.url().replace(/background\.js$/,'index.html'));
  const state=await ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
  assert.equal(state.chat.task.status,'paused');assert(state.chat.task.pendingReconciliation);assert.equal(await page.evaluate(()=>writes),1);
  checks.push('actual worker death after one page input preserves a pending fingerprint without replay');
  worker=context.serviceWorkers().find(item=>item.url()===target.url)||await context.waitForEvent('serviceworker');await worker.evaluate(()=>restartProbe.ready());
  requestId='resumed';await seed(requestId);observation=await run('browser_snapshot');
  let result=await run('fill_form',{fields:[{field_id:field(observation,'body'),value:'작성한 초안'}]});assert.equal(result.error,'action_outcome_unknown');
  result=await run('verify_page',{checks:[{kind:'field_value',ref:field(observation,'note'),expected:''}]});assert.equal(result.unresolvedAction,true);
  observation=await run('browser_snapshot');result=await run('fill_form',{fields:[{field_id:field(observation,'note'),value:'다음 단계'}]});assert.equal(result.error,'action_outcome_unknown');
  assert.equal(await page.evaluate(()=>writes),1);checks.push('replayed and unrelated writes stay blocked after a passing check of another field');
  result=await run('verify_page',{checks:[{kind:'field_value',ref:field(observation,'body'),expected:'작성한 초안'}]});assert.equal(result.reconciledAction,true);
  observation=await run('browser_snapshot');result=await run('fill_form',{fields:[{field_id:field(observation,'note'),value:'다음 단계'}]});assert.equal(result.verified,true);
  assert.equal(await page.evaluate(()=>writes),2);assert.equal(await page.locator('#body').inputValue(),'작성한 초안');checks.push('matching original target/value readback permits the next input without repeating the first');
  // A complete browser shutdown clears trusted session auth, but not the
  // pre-dispatch local receipt. A new Chrome process must not resume it.
  await worker.evaluate(()=>{globalThis.holdInput=true;globalThis.inputReturned=false;});
  observation=await run('browser_snapshot');
  const lostAtShutdown=run('fill_form',{fields:[{field_id:field(observation,'body'),value:'종료 직전 입력'}]}).catch(()=>null);
  await page.waitForFunction(()=>window.writes===3);
  await worker.evaluate(async()=>{const deadline=Date.now()+5000;while(!globalThis.inputReturned){if(Date.now()>deadline)throw Error('shutdown receipt not reached');await new Promise(r=>setTimeout(r,25));}const {chatLease}=await chrome.storage.session.get('chatLease');await chrome.storage.session.set({chatLease:{...chatLease,owner:'worker'}});});
  const priorWorkerURL=worker.url();await context.close();context=null;await lostAtShutdown;
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY||chromium.executablePath(),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let modelRequests=0;context.on('request',request=>{if(request.url().includes('/chat/completions'))modelRequests++;});
  const reopened=await context.newPage();await reopened.goto(priorWorkerURL.replace(/background\.js$/,'index.html'));
  const afterShutdown=await reopened.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
  assert.equal(afterShutdown.auth.present,false);assert.equal(afterShutdown.chat.task.status,'paused');assert(afterShutdown.chat.task.pendingReconciliation);assert.equal(afterShutdown.busy,false);assert.equal(modelRequests,0);
  checks.push('a new Chrome process retains the uncertain local receipt, clears session auth and pauses without model or write replay');
  await writeFile('verification/restart-write-browser.json',JSON.stringify({actualBrowser:true,actualModel:false,checks},null,2));
  checks.forEach(check=>console.log(`PASS ${check}`));
} finally {await context?.close();server.closeAllConnections();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true});}
