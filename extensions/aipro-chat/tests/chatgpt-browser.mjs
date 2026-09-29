import {fixturePlan} from './fixtures/task-plan.mjs';
import {PLAN_PROMPT} from '../task-plan.js';
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {forbidLoginDebugger, assertNoLoginDebugger} from './helpers/no-login-debugger.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,cp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {acceptedReview} from './fixtures/goal-review.mjs';
import {chatgptToken,responsesSSE} from './fixtures/chatgpt.mjs';

// Installed extension + real browser APIs, synthetic upstreams. No local server.
const profile=await mkdtemp(resolve(tmpdir(),'chatgpt-extension-')),extension=resolve(profile,'extension'),output=resolve('verification');
const token=chatgptToken(),refreshToken='synthetic-private-refresh',checks=[],errors=[];
let context,ui,authURL,held,mode='hold',exchanges=0,refreshes=0,requests=[];
const check=label=>{checks.push(label);console.log(`PASS ${label}`);};
const rpc=(type,values={})=>ui.evaluate(async({type,values})=>chrome.runtime.sendMessage({type,...values}),{type,values});
const state=async()=>(await rpc('GET_STATE')).data;
async function poll(fn,expected){for(let i=0;i<2400;i++){if(await fn()===expected)return;await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(await fn(),expected);}
async function send(text){await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(text);await ui.getByRole('button',{name:'전송',exact:true}).click();}
async function safeStorage(){const data=await ui.evaluate(async()=>({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)})); const {credential,...rest}=data.session;
 for(const secret of [token,refreshToken,authURL.searchParams.get('state'),'synthetic-chatgpt-code']){assert(!JSON.stringify(data.local).includes(secret));assert(!JSON.stringify(rest).includes(secret));}return data;}
try{
 await mkdir(output,{recursive:true});
 await cp(resolve('dist'),extension,{recursive:true});
 await forbidLoginDebugger(extension);
 const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
 // Pregrant only the isolated fixture copy; production prompts are not tested here.
 manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',channel:'chromium',executablePath:process.env.CHROME_BINARY||undefined,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.setDefaultTimeout(15000);
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.name)));
 await context.route('https://auth.openai.com/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/oauth/authorize'){
   authURL=url;assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:1455/auth/callback');
   const callback=new URL(url.searchParams.get('redirect_uri'));
   callback.search=new URLSearchParams({state:mode==='wrong-state'?'wrong-state':url.searchParams.get('state'),code:'synthetic-chatgpt-code'}).toString();
   return route.fulfill({status:302,headers:{location:callback.href},body:''});
  }
  assert.equal(url.pathname,'/oauth/token');assert(request.serviceWorker());assert.equal(request.method(),'POST');assert.equal(request.headers().cookie,undefined);
  const body=new URLSearchParams(request.postData());
  if(body.get('grant_type')==='refresh_token'){refreshes++;assert.equal(body.get('refresh_token'),refreshToken);}
  else{exchanges++;assert.equal(body.get('code'),'synthetic-chatgpt-code');assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),authURL.searchParams.get('code_challenge'));}
  if(mode==='hold'){held=route;return;}
  return route.fulfill({contentType:'application/json',body:JSON.stringify({access_token:token,refresh_token:refreshToken,expires_in:3600})});
 });
 await context.route('https://chatgpt.com/**',async route=>{
  const request=route.request();assert.equal(request.url(),'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(request.headers().authorization,`Bearer ${token}`);assert.equal(request.headers()['chatgpt-account-id'],'synthetic-account');assert.equal(request.headers().cookie,undefined);
  const body=request.postDataJSON();requests.push(body);
  if(body.instructions.startsWith(PLAN_PROMPT)) return route.fulfill({contentType:'text/event-stream',body:responsesSSE({tool:{name:'update_plan',arguments:{steps:fixturePlan}}})});
  if(body.instructions.startsWith(COMPLETION_REVIEW_PROMPT)) {
   assert.equal(mode,'chat'); assert(!body.tools?.length);
   return route.fulfill({contentType:'text/event-stream',body:responsesSSE({text:JSON.stringify({decision:'reply',scope:'conversation',next_step:''})})});
  }
  if(body.instructions.startsWith("You are Nubi's independent task-result reviewer.")) {
   const content=body.input.findLast(item=>item.role==='user').content;
   const payload=JSON.parse(typeof content==='string'?content:content.find(part=>part.type==='input_text').text);
   return route.fulfill({contentType:'text/event-stream',body:responsesSSE({text:JSON.stringify(acceptedReview(payload))})});
  }
  assert(body.instructions.includes('누비'));assert.equal(body.store,false);assert.equal(body.stream,true);assert(!JSON.stringify(body).includes('company-private-history'));
  if(mode==='forbidden')return route.fulfill({status:403,body:'synthetic-private-body'});
  const last=body.input.at(-1);
  const response=mode==='tools'&&last?.type!=='function_call_output'?responsesSSE({tool:{name:'read_page',arguments:{}}}):responsesSSE({text:mode==='tools'?'페이지 내용을 확인했습니다.':'ChatGPT로 연결되었습니다.'});
  if(mode==='tools'&&last?.type==='function_call_output'){assert(last.output.includes('Synthetic form'), last.output);assert.equal(last.call_id,'call_synthetic');}
  return route.fulfill({contentType:'text/event-stream',body:response});
 });
 await context.route('https://aipro.sdsdev.co.kr/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic form</title><h1>Synthetic form</h1><label>Name<input></label>'}));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 await ui.setViewportSize({width:360,height:800});
 await ui.getByRole('button',{name:'ChatGPT',exact:true}).waitFor();
 assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await ui.screenshot({path:resolve(output,'chatgpt-login-panel.png'),fullPage:true});
 await ui.setViewportSize({width:1100,height:850});await ui.screenshot({path:resolve(output,'chatgpt-login-desktop.png'),fullPage:true});
 check('CX login choices fit both 360px panel and desktop');
 await worker.evaluate(()=>chrome.storage.local.set({chat:{messages:[{id:'old',role:'user',content:'company-private-history'}],draft:'company draft'}}));
 await ui.getByText('AI Pro 연결 필요', {exact:true}).waitFor();
 await ui.getByRole('button',{name:'설정',exact:true}).click(); await ui.getByRole('button',{name:'로그인',exact:true}).click();
 await ui.getByRole('dialog',{name:'모델 선택',exact:true}).getByRole('tab',{name:'ChatGPT',exact:true}).click();await ui.getByRole('dialog',{name:'모델 선택',exact:true}).getByRole('button',{name:'로그인',exact:true}).click();
 await poll(()=>exchanges,1);await poll(async()=>(await state()).pending?.phase,'exchanging');
 assert.equal((await state()).auth.present,false);
 const callback=context.pages().find(page=>page.url().includes('/auth-return.html'));
 assert(callback);await poll(()=>callback.url().endsWith('/auth-return.html'),true);assert((await callback.locator('body').innerText()).includes('로그인'));await assertNoLoginDebugger(ui);
 await callback.reload();assert.equal(exchanges,1);await safeStorage();
 check('real loopback redirect uses the extension page without debugger or socket; PKCE exchange is single-use');
 mode='chat';await held.fulfill({contentType:'application/json',body:JSON.stringify({access_token:token,refresh_token:refreshToken,expires_in:3600})});held=null;
 await poll(async()=>(await state()).auth.provider,'chatgpt');await poll(async()=>!!(await state()).catalog?.models?.length,true);
 assert.equal((await state()).catalog.diagnostics.status,null);assert.equal((await state()).chat.messages.length,0);
 assert.equal(await ui.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'');
 await send('테스트');await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
 assert.equal((await state()).chat.messages.at(-1).usage.total_tokens,140);
 await ui.getByRole('button',{name:'모델 변경',exact:true}).click();await ui.getByRole('button',{name:'GPT-5.5',exact:true}).click();
 assert.equal((await state()).settings.modelId,'gpt-5.5');
 await ui.reload();assert.equal((await state()).auth.provider,'chatgpt');assert.equal((await state()).chat.messages.at(-1).content,'ChatGPT로 연결되었습니다.');
 await ui.setViewportSize({width:360,height:800});await ui.screenshot({path:resolve(output,'chatgpt-chat-panel.png'),fullPage:true});
 await ui.setViewportSize({width:1100,height:850});await ui.screenshot({path:resolve(output,'chatgpt-chat-desktop.png'),fullPage:true});
 await poll(()=>callback.isClosed(),true);await safeStorage();
 check('ChatGPT stream, usage, model selection and reload work with AI Pro history isolated');
 await worker.evaluate(async()=>{const {credential}=await chrome.storage.session.get('credential');await chrome.storage.session.set({credential:{...credential,expiresAt:Date.now()-1}});});
 await send('갱신 후 테스트');await poll(()=>refreshes,1);await poll(async()=>(await state()).chat.messages.at(-1)?.state,'done');
 check('expired access token refreshes once before the next chat');
 const target=await context.newPage();await target.goto('https://aipro.sdsdev.co.kr/fixture-chatgpt');await target.bringToFront();
 // This provider contract checks the connected current page. A newly created
 // window can navigate before Playwright attaches its synthetic HTTPS route;
 // dedicated-window/popup behavior uses a real local server in completion-review-browser.
 await worker.evaluate(()=>chrome.storage.local.set({browserWorkMode:'current'}));
 assert.equal((await rpc('CONNECT_PAGE')).ok,true);await ui.bringToFront();mode='tools';
 console.log('WAITING_SITE_PERMISSION');await send('페이지 내용을 읽어 주세요');await poll(async()=>(await state()).chat.messages.at(-1)?.content,'페이지 내용을 확인했습니다.');
 assert((await state()).chat.messages.at(-1).trace.some(step=>step.tool==='read_page'&&step.status==='done'));
 check('ChatGPT calls the current-page tool and receives observed DOM through the Pi loop');
 await rpc('DISCONNECT_PAGE');mode='forbidden';await send('권한 오류 테스트');
 await poll(async()=>(await state()).chat.messages.at(-1)?.error,'forbidden');assert(!(await ui.locator('body').innerText()).includes('synthetic-private-body'));
 check('account model restriction is reported safely without replay');
 await ui.getByRole('button', {name: '설정', exact: true}).click();
  await ui.getByRole('button',{name:'로그아웃',exact:true}).click();mode='wrong-state';const count=exchanges;
 await ui.getByRole('dialog',{name:'모델 선택',exact:true}).getByRole('tab',{name:'ChatGPT',exact:true}).click();await ui.getByRole('dialog',{name:'모델 선택',exact:true}).getByRole('button',{name:'로그인',exact:true}).click();await poll(async()=>(await state()).report.error,'chatgpt_callback_invalid');
 assert.equal(exchanges,count);assert.equal((await state()).auth.present,false);check('mismatched OAuth state is rejected before token exchange');
 await assertNoLoginDebugger(ui);
 assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'chatgpt-browser.json'),JSON.stringify({checks,chrome:context.browser()?.version(),actualChatGPTAccountVerified:false,syntheticUpstreams:true},null,2));
 console.log(`Completed ${checks.length} ChatGPT browser checks`);
}finally{await held?.abort().catch(()=>{});await context?.close();await rm(profile,{recursive:true,force:true});}
