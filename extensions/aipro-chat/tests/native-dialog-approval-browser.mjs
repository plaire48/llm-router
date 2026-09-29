import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const root=await mkdtemp(resolve(tmpdir(),'nubi-native-approval-')),extension=resolve(root,'extension');
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<title>선택 검사</title><button id="confirm" onclick="clicks++;if(confirm(\'검토한 내용을 반영할까요?\'))accepted++;if(window.flood)for(let i=0;i<12;i++)alert(i)">다음 단계</button><button id="prompt" onclick="clicks++;answer=prompt(\'메모를 입력하세요\',\'PRIVATE_DEFAULT\')">메모 단계</button><script>window.clicks=0;window.accepted=0;window.answer=null;</script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let context,worker,ui,page;const dialogs=[],checks=[];
try{
 await cp('dist',extension,{recursive:true});const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push(`${origin}/*`);await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 await appendFile(resolve(extension,'background.js'),`\nglobalThis.nativeApprovalProbe={ready:()=>serial(()=>{}),stop:stopBrowserAgent,run:(requestId,name,args={})=>serialTool('RUN_TOOL',()=>handle({type:'RUN_TOOL',requestId,name,args,clientId:'fixture'},{id:chrome.runtime.id,url:chrome.runtime.getURL('index.html')}))};\n`);
 context=await chromium.launchPersistentContext(root,{headless:true,executablePath:process.env.CHROME_BINARY||chromium.executablePath(),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('dialog',dialog=>dialogs.push(dialog));
 await context.route('https://aipro.sdsdev.co.kr/**',r=>r.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K'}]}}));
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>nativeApprovalProbe.ready());
 page=await context.newPage();await page.goto(origin);
 const tabId=await worker.evaluate(async origin=>(await chrome.tabs.query({})).find(t=>t.url===origin+'/').id,origin);
 const seed=async id=>worker.evaluate(async({id,tabId})=>{
  await chrome.storage.local.set({chat:{provider:'aipro',sessionId:'native-conversation',draft:'',messages:[{id,requestId:id,role:'assistant',state:'pending',content:''}],task:{requestId:id,status:'running',goal:'페이지 선택',steps:[]}}});
  await chrome.storage.session.set({page:{tabId,url:'http://localhost',title:'선택 검사'},credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:1},chatLease:{id,conversationId:'native-conversation',clientId:'fixture',provider:'aipro',credentialReceivedAt:1,automation:true,toolNames:['browser_snapshot','click_element'],lastSeenAt:Date.now(),until:Date.now()+60000}});
 },{id,tabId});
 let requestId='confirm-run';await seed(requestId);
 ui=await context.newPage();await ui.goto(worker.url().replace(/background\.js$/,'index.html'));
 const run=(name,args={})=>worker.evaluate(({requestId,name,args})=>nativeApprovalProbe.run(requestId,name,args),{requestId,name,args});
 const target=(result,id)=>(result.observation||result).frames.flatMap(f=>f.elements||[]).find(e=>e.id===id).ref;
 let snapshot=await run('browser_snapshot');let pending=run('click_element',{ref:target(snapshot,'confirm')});
 let card=ui.getByRole('region',{name:'질문'}); // InteractionSurface is a labelled section.
 card=ui.locator('.question-card').filter({hasText:'검토한 내용을 반영할까요?'});
 await card.waitFor();console.log('STAGE confirm visible');assert.equal(await card.getByRole('textbox').count(),0);
 await ui.setViewportSize({width:360,height:800});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mkdir('verification/native-dialog-approval',{recursive:true});await ui.screenshot({path:'verification/native-dialog-approval/confirm.png'});
 // UI refresh must keep the same live decision; it must not start another run.
 const first=await ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data.nativeDialog);
 await ui.reload();await card.waitFor();const second=await ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data.nativeDialog);assert.equal(first.id,second.id);
 await new Promise(resolve=>setTimeout(resolve,8000));
 await card.getByRole('button',{name:/확인/}).click();let result=await pending;console.log('STAGE confirm returned');assert.equal(result.error,'script_timeout',JSON.stringify(result));assert.equal(result.actionIssued,true);assert.equal(result.observation.nativeDialogs[0].disposition,'accepted');assert.deepEqual(await page.evaluate(()=>({clicks,accepted})),{clicks:1,accepted:1});assert(!JSON.stringify(result).includes('반영할까요'));
 checks.push('live confirm survives UI reload and a long user wait; timed-out click remains uncertain and is never replayed');
 const duplicate=await ui.evaluate(async d=>chrome.runtime.sendMessage({type:'ANSWER_NATIVE_DIALOG',questionId:d.id,requestId:d.requestId,conversationId:d.conversationId,choice:{optionId:'accept'}}),first);assert.equal(duplicate.ok,false);
 await worker.evaluate(id=>nativeApprovalProbe.stop(id),requestId);requestId='prompt-run';await seed(requestId);snapshot=await run('browser_snapshot');pending=run('click_element',{ref:target(snapshot,'prompt')});
 card=ui.locator('.question-card').filter({hasText:'메모를 입력하세요'});await card.waitFor();
 console.log('STAGE prompt visible');const promptQuestion=await ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data.nativeDialog);
 for(const choice of [{optionId:'cancel',text:'MIXED_PRIVATE'},{optionId:'accept',text:'x'.repeat(4001)},{optionId:'accept',text:42}]) {
  const malformed=await ui.evaluate(async({q,choice})=>chrome.runtime.sendMessage({type:'ANSWER_NATIVE_DIALOG',questionId:q.id,requestId:q.requestId,conversationId:q.conversationId,choice}),{q:promptQuestion,choice});
  console.log('STAGE malformed rejected');assert.equal(malformed.ok,false,JSON.stringify(malformed));
  assert.equal(await ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data.nativeDialog?.id),promptQuestion.id);
 }
 checks.push('mixed cancel/text and invalid prompt values are rejected without consuming the live question');
 await card.getByRole('textbox',{name:'직접 답변'}).fill('사용자가 작성한 메모');await ui.screenshot({path:'verification/native-dialog-approval/prompt.png'});await card.getByRole('button',{name:'답변 보내기',exact:true}).click();result=await pending;
 console.log('STAGE prompt returned');assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.evaluate(()=>answer),'사용자가 작성한 메모');assert.equal(await page.evaluate(()=>clicks),2);
 const persisted=await worker.evaluate(async()=>JSON.stringify([await chrome.storage.local.get(null),await chrome.storage.session.get(null)]));assert(!persisted.includes('사용자가 작성한 메모'));assert(!persisted.includes('PRIVATE_DEFAULT'));assert(!persisted.includes('메모를 입력하세요'));
 console.log('STAGE prompt storage checked');checks.push('prompt input reaches the pending native dialog without entering storage or model receipts');
 await worker.evaluate(id=>nativeApprovalProbe.stop(id),requestId);requestId='cancel-run';await seed(requestId);await page.evaluate(()=>{window.flood=true;});console.log('STAGE flood armed');snapshot=await run('browser_snapshot');pending=run('click_element',{ref:target(snapshot,'confirm')});card=ui.locator('.question-card').filter({hasText:'검토한 내용을 반영할까요?'});await card.waitFor();await card.getByRole('button',{name:/취소/}).click();result=await pending;console.log('STAGE cancel returned');assert.equal(result.error,'browser_dialog');assert.deepEqual(await page.evaluate(()=>({clicks,accepted})),{clicks:3,accepted:1});
 assert.equal(result.nativeDialogs.length,8);assert(result.nativeDialogs.every(d=>d.type==='alert'));
 snapshot=await run('browser_snapshot');const blocked=await run('click_element',{ref:target(snapshot,'confirm')});
 assert.equal(blocked.error,'action_outcome_unknown');assert.equal(blocked.actionIssued,false);assert.equal(await page.evaluate(()=>clicks),3);
 checks.push('cancel keeps an unresolved write checkpoint after twelve real alerts; fresh observation cannot replay the click');
 await writeFile('verification/native-dialog-approval-browser.json',JSON.stringify({actualBrowser:true,actualModel:false,checks},null,2));checks.forEach(c=>console.log('PASS '+c));
}catch(error){console.error('FAIL',error);throw error;}finally{console.log('STAGE cleanup');for(const d of dialogs)await d.dismiss().catch(()=>{});await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
