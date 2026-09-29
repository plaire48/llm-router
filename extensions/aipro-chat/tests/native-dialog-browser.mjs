import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-native-dialog-')),extension=resolve(profile,'extension');
let context,worker,page,ui,requestId='native-1',tabId,stage=0,routeFailure,flow='ordinary';const checks=[];
const inspectorDialogs=[];
const check=text=>{checks.push(text);console.log('PASS '+text);};
const html=`<!doctype html><meta charset="utf-8"><title>확인창 테스트</title>
<button type="button" id="confirm" onclick="clicks++;if(confirm('PRIVATE_DIALOG_PAYLOAD'))accepted++">다음 단계</button>
<button type="button" id="prompt" onclick="clicks++;if(prompt('PRIVATE_DIALOG_PAYLOAD','PRIVATE_DEFAULT')!==null)accepted++">입력 단계</button>
<button type="button" id="alert" onclick="alert('PRIVATE_DIALOG_PAYLOAD');alerts++">알림 보기</button>
<button type="button" id="hover" onmouseenter="if(!this.dataset.seen){this.dataset.seen='yes';confirm('PRIVATE_HOVER')}" onclick="hoverClicks++">호버 단계</button>
<button type="button" id="publish" onclick="clicks++;if(confirm('PRIVATE_FINAL'))accepted++">보내기</button>
<label>추가 본문<input id="append" onfocus="confirm('PRIVATE_FOCUS')"></label><label>본문<input id="body"></label><script>window.clicks=0;window.accepted=0;window.alerts=0;window.hoverClicks=0;</script>`;
const run=async(name,args={})=>(await worker.evaluate(({requestId,tabId,name,args})=>nativeProbe.runBrowserAgent(requestId,{tabId},name,args),{requestId,tabId,name,args})).result;
const elements=result=>(result.observation||result).frames.flatMap(frame=>frame.elements||[]);
const ref=(result,id)=>{const found=elements(result).find(element=>element.id===id);assert(found,JSON.stringify(result));return found.ref;};
const state=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
async function until(read){for(let i=0;i<250;i++){if(routeFailure)throw routeFailure;if(await read())return;await new Promise(r=>setTimeout(r,40));}throw Error('native dialog fixture timeout');}
async function reset(){await worker.evaluate(id=>nativeProbe.stopBrowserAgent(id),requestId);requestId=crypto.randomUUID();await page.goto('https://dialog.example.test/');return run('browser_snapshot');}
try{
 await mkdir('verification/native-dialog-quality',{recursive:true});
 await cp('dist',extension,{recursive:true});const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 await appendFile(resolve(extension,'background.js'),'\nglobalThis.nativeProbe={runBrowserAgent,runApprovedAction,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(10000);
 // This independent inspector must not auto-dismiss the extension's dialog.
 context.on('dialog',dialog=>inspectorDialogs.push(dialog));
 await context.route('https://dialog.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>nativeProbe.ready());
 page=await context.newPage();await page.goto('https://dialog.example.test/');tabId=await worker.evaluate(async()=>(await chrome.tabs.query({})).find(t=>t.url==='https://dialog.example.test/').id);
 let observation=await run('browser_snapshot');
 assert.equal(await worker.evaluate(async tabId=>{try{await chrome.debugger.sendCommand({tabId},'Page.getFrameTree');return true;}catch{return false;}},tabId),false);
 let result=await run('click_element',{ref:ref(observation,'confirm')});assert.equal(result.error,'browser_dialog',JSON.stringify(result));assert.equal(result.actionIssued,true);
 assert.deepEqual(result.nativeDialogs,[{type:'confirm',disposition:'dismissed'}]);assert.deepEqual(await page.evaluate(()=>({clicks,accepted})),{clicks:1,accepted:0});
 observation=await run('browser_snapshot');result=await run('click_element',{ref:ref(observation,'confirm')});assert.equal(result.error,'browser_dialog');assert.equal(result.actionIssued,false);assert.equal(await page.evaluate(()=>clicks),1);
 assert(!JSON.stringify(result).includes('PRIVATE'));check('passive observation stays debugger-free; confirm is not accepted or reported as success and a fresh ref cannot replay the click');
 await reset();
 result=await run('run_playwright',{code:`try {await page.getByRole('button',{name:'입력 단계',exact:true}).click();} catch {} try {await page.getByLabel('본문').fill('SHOULD_NOT_WRITE');} catch {} return 'pretend success';`});
 assert.equal(result.error,'browser_dialog',JSON.stringify(result));assert.equal(result.ok,false);assert.equal(await page.locator('#body').inputValue(),'');assert.equal(await page.evaluate(()=>accepted),0);assert.equal(await page.evaluate(()=>clicks),1);assert(result.execution.commands.some(c=>c.reason==='browser_dialog'));assert(!JSON.stringify(result).includes('PRIVATE'));
 check('a script cannot swallow the interruption, fill another field, fabricate success or read prompt/default text');
 observation=await reset();result=await run('click_element',{ref:ref(observation,'hover')});assert.equal(result.error,'browser_dialog');assert.equal(await page.evaluate(()=>hoverClicks),0);
 check('a confirmation opened by hover prevents the pending pointer click');
 await reset();result=await run('run_playwright',{code:`await page.getByLabel('추가 본문',{exact:true}).appendText('SHOULD_NOT_WRITE',{expectedLength:0});`});assert.equal(result.error,'browser_dialog',JSON.stringify(result));assert.equal(await page.locator('#append').inputValue(),'');
 check('a confirmation opened by focusing an append target prevents the pending text insertion');
 observation=await reset();result=await run('click_element',{ref:ref(observation,'alert')});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await page.evaluate(()=>alerts),1);assert.deepEqual(result.observation.nativeDialogs,[{type:'alert',disposition:'dismissed'}]);
 result=await run('fill_form',{fields:[{field_id:ref(result,'body'),value:'본문 유지'}]});assert.equal(result.verified,true);
 check('an alert without a choice retains normal page progress and verification');
 observation=await reset();result=await run('fill_form',{fields:[{field_id:ref(observation,'body'),value:'unsaved draft'}]});
 await page.evaluate(()=>{window.onbeforeunload=e=>{e.preventDefault();e.returnValue='';};});
 result=await run('navigate_page',{url:'https://dialog.example.test/next'});assert.equal(result.error,'browser_dialog',JSON.stringify(result));assert.equal(page.url(),'https://dialog.example.test/');assert.equal(await page.locator('#body').inputValue(),'unsaved draft');assert.deepEqual(result.nativeDialogs,[{type:'beforeunload',disposition:'dismissed'}]);
 await page.evaluate(()=>{window.onbeforeunload=null;});
 check('leaving an edited page is declined and preserves the draft instead of reporting a generic navigation failure');
 observation=await reset();const finalRef=ref(observation,'publish');
 const approval=await worker.evaluate(async({requestId,tabId,ref})=>{let record;const value=await nativeProbe.runBrowserAgent(requestId,{tabId},'request_approval',{ref},{onApproval:async r=>{record=r;return {requiresUserInput:true};}});globalThis.nativeApproval=record;return value;},{requestId,tabId,ref:finalRef});
 assert.equal(approval.result.requiresUserInput,true,JSON.stringify(approval));assert.equal(await page.evaluate(()=>clicks),0);
 await worker.evaluate(id=>nativeProbe.stopBrowserAgent(id),requestId);requestId=crypto.randomUUID();
 result=(await worker.evaluate(({requestId,tabId})=>nativeProbe.runApprovedAction(requestId,{tabId},nativeApproval),{requestId,tabId})).result;
 assert.equal(result.error,'browser_dialog',JSON.stringify(result));assert.equal(result.actionIssued,true);assert.equal(await page.evaluate(()=>accepted),0);assert.equal(await page.evaluate(()=>clicks),1);
 check('a one-shot approved button does not automatically accept an additional native confirmation');
 await reset();await worker.evaluate(id=>nativeProbe.stopBrowserAgent(id),requestId);
 await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
  if(route.request().method()==='GET')return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}});
  const body=route.request().postDataJSON(),plan=planCompletion(body);if(plan)return route.fulfill({json:plan});
  const last=body.messages.findLast(m=>m.role==='tool');let name,args={};
  if(flow==='approved'){
    if(stage===0)name='browser_snapshot';
    else if(stage===1){name='verify_page';args={checks:[{kind:'text_present',expected:'다음 단계'}]};}
    else if(stage===2){name='request_approval';args={ref:ref(JSON.parse(last.content),'publish')};}
    else throw Error('An interrupted approved action must not invoke the model again');
  }else if(stage===0)name='browser_snapshot';else if(stage===1){name='click_element';args={ref:ref(JSON.parse(last.content),'confirm')};}else throw Error('The harness must ask instead of retrying or returning success');stage++;
  return route.fulfill({json:{choices:[{message:{content:'',tool_calls:[{id:'call-'+stage,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]}});
 }catch(error){routeFailure=error;return route.fulfill({status:500,body:'fixture failure'});}});
 const token=`header.${Buffer.from(JSON.stringify({exp:Date.now()/1000+3600})).toString('base64url')}.signature`;
 await worker.evaluate(async token=>{await chrome.storage.local.set({browserWorkMode:'current'});await chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}});},token);
 ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);await until(async()=>(await state()).catalog?.models?.length);
 const uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);await worker.evaluate(({tabId,uiId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:tabId}}),{tabId,uiId});
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('이 페이지의 다음 단계를 열고 결과를 확인해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();
 await until(async()=>(await state()).nativeDialog);await ui.locator('.question-card').filter({hasText:'PRIVATE_DIALOG_PAYLOAD'}).getByRole('button',{name:/취소/}).click();
 await until(async()=>(await state()).chat.task?.status==='awaiting_user');const question=(await state()).chat.messages.at(-1).question;
 assert.equal(question.kind,'text');assert.equal(question.inputMode,'long_text');assert.match(question.text,/브라우저 기본 확인창/);assert.equal(stage,2);assert.equal(await page.evaluate(()=>clicks),1);
 await ui.locator('.question-card[data-answered=false]').waitFor();await until(async()=>await ui.getByRole('textbox',{name:'직접 답변',exact:true}).isEnabled());await until(async()=>await ui.locator('.question-card[data-answered=false]').evaluate(el=>getComputedStyle(el).opacity==='1' && el.getAnimations().every(a=>a.playState==='finished')));await ui.setViewportSize({width:360,height:800});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await ui.screenshot({path:'verification/native-dialog-quality/question-panel.png'});
 await ui.reload();await ui.locator('.question-card[data-answered=false]').waitFor();assert.equal((await state()).chat.messages.at(-1).question.id,question.id);assert.equal(stage,2);assert.equal(await page.evaluate(()=>clicks),1);
 assert(!(await ui.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)))).includes('PRIVATE'));
 check('Pi/Qwen-format conversation pauses into the existing written-response form, survives reload and never retries or claims completion');
 flow='approved';stage=0;await page.reload();
 await ui.getByRole('button',{name:'누비 새 채팅',exact:true}).click();await until(async()=>!(await state()).chat.messages.length);await until(async()=>await ui.getByRole('button',{name:'누비 새 채팅',exact:true}).isEnabled());
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('이 페이지에서 보내기를 진행해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();
 await until(async()=>(await state()).chat.messages.at(-1)?.question?.kind==='approval');assert.equal(stage,3);assert.equal(await page.evaluate(()=>clicks),0);
 await ui.getByRole('button',{name:'보내기',exact:true}).click();
 await until(async()=>(await state()).nativeDialog);await ui.locator('.question-card').filter({hasText:'PRIVATE_FINAL'}).getByRole('button',{name:/취소/}).click();
 await until(async()=>(await state()).chat.messages.at(-1)?.question?.kind==='text');await until(async()=>!(await state()).busy);
 assert.equal(stage,3);assert.equal((await state()).chat.task.status,'awaiting_user');assert.deepEqual(await page.evaluate(()=>({clicks,accepted})),{clicks:1,accepted:0});
 check('real HITL approval is consumed once and a following native dialog asks the user before any additional inference');
 await mkdir('verification',{recursive:true});await writeFile('verification/native-dialog-browser.json',JSON.stringify({checks,actualBrowser:true,browserVersion:context.browser().version(),platform:process.platform,actualModel:false,nativeAcceptSupported:true},null,2));
}catch(error){if(ui)await writeFile('verification/native-dialog-quality/failed-state.json',JSON.stringify({stage,state:await state()},null,2));throw error; }finally{
 // Nubi handles dialogs through a separate CDP connection. Retire this test
 // inspector's stale dialog objects before closing its persistent context.
 for(const dialog of inspectorDialogs)try{await dialog.dismiss();}catch(error){if(!/No dialog is showing|already handled|Target page, context or browser has been closed/.test(error.message))throw error;}
 await context?.close();await rm(profile,{recursive:true,force:true});
}
