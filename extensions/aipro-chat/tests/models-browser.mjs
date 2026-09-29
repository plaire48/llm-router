import {completionIntentResponse} from './fixtures/completion-intent.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {MODEL_CATALOG_VERSION} from '../core.js';

const profile=await mkdtemp(resolve(tmpdir(),'aipro-models-contract-'));
const extension=resolve(profile,'extension'), fixture=JSON.parse(await readFile('tests/fixtures/aipro-models.json','utf8'));
const token=`header.${Buffer.from(JSON.stringify({sub:'synthetic-models-contract',exp:Date.now()/1000+3600})).toString('base64url')}.signature`;
let context,ui,requests=0,catalogPayload=fixture;
const chatRequests=[];
const errors=[],checks=[];
const state=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
async function poll(fn,expected){let actual;for(let i=0;i<160;i++){actual=await fn();if(actual===expected)return;await new Promise(r=>setTimeout(r,50));}assert.equal(actual,expected);}
try{
 await cp(resolve('dist'),extension,{recursive:true});
 const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
 manifest.host_permissions.push('http://*/*','https://*/*');
 await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',executablePath:process.env.CHROME_BINARY||undefined,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.setDefaultTimeout(10000);
 await context.route('https://aipro.sdsdev.co.kr/api/models',async route=>{
  requests++;
  const req=route.request();assert.equal(req.method(),'GET');assert.equal(req.headers().authorization,`Bearer ${token}`);
  assert.equal(req.headers().cookie,undefined);
  assert.equal(req.headers()['x-reasoning'],'true');
  return route.fulfill({contentType:'application/json',body:JSON.stringify(catalogPayload)});
 });
 await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions',async route=>{
  const req=route.request();
  assert.equal(req.method(),'POST');
  assert.equal(req.headers().authorization,`Bearer ${token}`);
  assert.equal(req.headers()['x-reasoning'],undefined);
  const intent = completionIntentResponse(req.postDataJSON()); if (intent) return route.fulfill({json:intent});
  chatRequests.push(req.postDataJSON());
  await route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'합성 응답'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'});
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 ui=await context.newPage();ui.on('pageerror',e=>errors.push(e.message));
 await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 await ui.evaluate(async token=>{
  const receivedAt=Date.now();
  await chrome.storage.session.set({credential:{token,mode:'browser',source:'login',receivedAt,expiresAt:Date.now()+3600000},catalog:{requestVersion:2,credentialReceivedAt:receivedAt,models:[],error:null,fetchedAt:Date.now(),diagnostics:{status:200,summary:{received:5,usable:0}}}});
 },token);
 await poll(async()=>(await state()).catalog?.models?.length,10);
 assert.equal(requests,1);
 assert.equal((await state()).catalog.requestVersion,MODEL_CATALOG_VERSION);
 assert.equal((await state()).catalog.diagnostics.summary.received,10);
 assert.equal((await state()).catalog.diagnostics.summary.excluded.target,0);
 checks.push('version 2 empty catalog with received 5 automatically refetches using Bearer and displays all ten fixture models');
 assert.equal((await state()).settings.modelId,'QWEN3.8-27B-FP8-256K');
 await ui.setViewportSize({width:360,height:800});
 const picker=ui.getByRole('button',{name:'모델 변경',exact:true});
 async function openPicker(){const before=requests;await picker.click();await poll(()=>requests,before+1);await poll(()=>ui.getByRole('button',{name:'모델 목록 새로고침',exact:true}).isEnabled(),true);}
 await poll(()=>picker.innerText(),'QWEN3.8-27B-256K');
 await openPicker();
 const options=ui.locator('.model-options').getByRole('button');
 assert.deepEqual(new Set(await options.allTextContents()),new Set(fixture.modelList.map(model=>model.display_name)));
 assert.equal(await options.count(),10);
 assert.equal(await ui.getByRole('button',{name:'QWEN3.8-27B-256K',exact:true}).getAttribute('aria-pressed'),'true');
 assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mkdir('verification',{recursive:true});
 await ui.screenshot({path:'verification/models-confirmed-panel.png',fullPage:true});
 checks.push('all user-provided catalog display names render at 360px with Qwen 3.8 27B selected by default');
 await ui.keyboard.press('Escape');
 await ui.getByRole('button',{name:'컨텍스트 사용량',exact:true}).click();
 await ui.getByRole('dialog',{name:'컨텍스트',exact:true}).getByText('토큰 상세',{exact:true}).click();
 const details=await ui.getByRole('dialog',{name:'컨텍스트',exact:true}).innerText();
 assert(details.includes('262,144'));assert(details.includes('221,184'));
 await ui.keyboard.press('Escape');
 await openPicker();await ui.getByRole('button',{name:'GLM-5.2-512K',exact:true}).click();
 await ui.reload();await poll(()=>picker.innerText(),'GLM-5.2-512K');
 checks.push('an explicit non-baseline model selection survives reload');
 await openPicker();await ui.getByRole('button',{name:'QWEN3.8-27B-256K',exact:true}).click();
 await poll(async()=>(await state()).settings.modelId,'QWEN3.8-27B-FP8-256K');
 const afterSelection=requests;await ui.reload();await poll(()=>picker.innerText(),'QWEN3.8-27B-256K');assert.equal(requests,afterSelection);
 checks.push('context limits and request model name remain correct after model selection and reload');
 await ui.setViewportSize({width:1100,height:850});await openPicker();
 await ui.screenshot({path:'verification/models-confirmed-desktop.png',fullPage:true});
 await ui.keyboard.press('Escape');
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('선택한 모델에 보낼 메시지');
 assert(await ui.getByRole('button',{name:'전송',exact:true}).isEnabled());
 const stored=await ui.evaluate(async()=>({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}));
 assert(!JSON.stringify(stored.local).includes(token));assert(!JSON.stringify(stored.session.events).includes(token));
 assert(!JSON.stringify(stored.session.catalog).includes('COMPLETION_EXT'));
 checks.push('usable catalog enables chat and does not persist credentials or unrelated env data');
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('');
 await openPicker();await ui.getByRole('button',{name:'GPT-OSS-128K_general',exact:true}).click();
 await ui.getByRole('dialog',{name:'모델 선택',exact:true}).waitFor({state:'hidden'});
 await poll(()=>picker.innerText(),'GPT-OSS-128K_general');
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('일반 분류 모델 테스트');
 await poll(async()=>(await state()).chat.draft,'일반 분류 모델 테스트');
 await ui.getByRole('button',{name:'전송',exact:true}).click();
 await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
 assert.equal(chatRequests.length,1);
 assert.equal(chatRequests[0].model,'GPT-OSS-128K_general');
 checks.push('general classification uses the same completion endpoint and its exact request name');
 catalogPayload={modelList:[
  {name:'general-model',display_name:'General',target:'general',sort_seq:1},
  {name:'rag-model',display_name:'RAG',target:'rag',sort_seq:2},
  {name:'api-model',display_name:'API',target:'open_api',sort_seq:3},
  {name:'agent-model',display_name:'Agent',target:'pull',is_agent:true,sort_seq:4},
  {name:'unclassified-model',display_name:'Unclassified',sort_seq:5},
 ]};
 await openPicker();
 const beforeManualRefresh=requests;
 await ui.getByRole('button',{name:'모델 목록 새로고침',exact:true}).click();
 await poll(()=>requests,beforeManualRefresh+1);
 await poll(()=>ui.getByRole('button',{name:'모델 목록 새로고침',exact:true}).isEnabled(),true);
 await poll(async()=>(await state()).catalog?.models?.length,5);
 assert.deepEqual((await state()).catalog.diagnostics.summary,{received:5,usable:5,excluded:{target:0,agent:0,name:0,duplicate:0}});
 assert.deepEqual(await options.allTextContents(),['General','RAG','API','Agent','Unclassified']);
 await ui.getByRole('button',{name:'Agent',exact:true}).click();
 await ui.getByRole('dialog',{name:'모델 선택',exact:true}).waitFor({state:'hidden'});
 await poll(()=>picker.innerText(),'Agent');
 await poll(async()=>(await state()).busy,false);
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('에이전트 분류 모델 테스트');
 await poll(async()=>(await state()).chat.draft,'에이전트 분류 모델 테스트');
 await ui.getByRole('button',{name:'전송',exact:true}).click();
 await poll(async()=>(await state()).chat.messages.length,4);
 await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
 assert.equal(chatRequests.length,2);
 assert.equal(chatRequests[1].model,'agent-model');
 const beforeReload=requests;
 await ui.reload();await poll(()=>picker.innerText(),'Agent');
 assert.equal((await state()).catalog.models.length,5);assert.equal(requests,beforeReload);
 checks.push('five non-chat or unclassified rows all display, agent selection sends its original name, and selection survives reload');
 assert.deepEqual(errors,[]);
 await writeFile('verification/models-browser-results.json',JSON.stringify({version:await ui.evaluate(()=>chrome.runtime.getManifest().version),userProvidedModelFixture:true,syntheticNetwork:true,fixtureSiteAccessPregranted:true,realAiProVerified:false,checks,pageErrors:errors},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,received:10,displayed:10,nonChatScenarioDisplayed:5,authorization:'Bearer',realAiProVerified:false}));
}catch(error){
 if(ui){const current=await state();console.error(JSON.stringify({checks,busy:current.busy,draft:current.chat.draft,selected:current.settings.modelId,messages:current.chat.messages.length,body:await ui.locator('body').innerText()}));}
 throw error;
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
