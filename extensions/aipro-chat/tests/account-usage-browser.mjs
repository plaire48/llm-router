import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chatgptToken} from './fixtures/chatgpt.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-account-usage-')), checks=[],errors=[];
let context,ui,worker,mode='windows',quotaCalls=0,refreshCalls=0,failure;
const token=chatgptToken(), refreshed=token.replace(/signature$/, 'refreshed-signature');
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
const now=()=>Math.floor(Date.now()/1000);
const payload=()=>mode==='credits'?{credits:{has_credits:true,unlimited:false,balance:'4500'},spend_control:{individual_limit:{remaining_percent:80,reset_at:now()+7200}}}:mode==='empty'?{rate_limit:null}:{rate_limit:{primary_window:{used_percent:25,limit_window_seconds:18000,reset_at:now()+7200},secondary_window:{used_percent:60,limit_window_seconds:604800,reset_at:now()+604800}}};
const rpc=(type,args={})=>ui.evaluate(async({type,args})=>chrome.runtime.sendMessage({type,...args}),{type,args});
const state=async()=> (await rpc('GET_STATE')).data;
async function poll(fn,expected){for(let i=0;i<300;i++){if(failure)throw failure;if(await fn()===expected)return;await new Promise(r=>setTimeout(r,50));}assert.equal(await fn(),expected);}
const dialog=()=>ui.getByRole('dialog',{name:'사용량',exact:true});
const open=async()=>{await ui.getByRole('button',{name:'사용량',exact:true}).click();await dialog().waitFor();};
const close=async()=>{await ui.keyboard.press('Escape');await dialog().waitFor({state:'hidden'});};
try {
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/api/models',route=>route.fulfill({json:{modelList:[{name:'GLM-5.2-NVFP4'}]}}));
  await context.route('https://auth.openai.com/oauth/token',route=>{refreshCalls++;return route.fulfill({json:{access_token:refreshed,refresh_token:'synthetic-refresh-new',expires_in:10800}});});
  await context.route('https://chatgpt.com/backend-api/wham/usage',route=>{try{
    quotaCalls++;const request=route.request();assert.equal(request.method(),'GET');assert.equal(request.headers()['chatgpt-account-id'],'synthetic-account');assert.equal(request.headers().cookie,undefined);assert([`Bearer ${token}`,`Bearer ${refreshed}`].includes(request.headers().authorization));
    if(mode==='forbidden')return route.fulfill({status:403,body:'private-response'});
    if(mode==='refresh'&&refreshCalls===0)return route.fulfill({status:401,body:'expired'});
    return route.fulfill({json:payload()});
  }catch(error){failure=error;return route.fulfill({status:500,body:'fixture failed'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async token=>{
    await chrome.storage.local.set({activeProvider:'chatgpt',settings:{loginRoute:'vscode',mode:'browser',modelId:'gpt-5.6-sol'}});
    await chrome.storage.session.set({credential:{provider:'chatgpt',mode:'browser',token,refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,receivedAt:22}});
  },token);
  ui=await context.newPage();ui.on('pageerror',error=>errors.push(error.message));await ui.setViewportSize({width:360,height:800});await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async()=>!!(await state()).catalog?.models?.length,true);await open();await dialog().getByText('75% 남음',{exact:true}).waitFor();
  const placement=await dialog().evaluate(el=>{const body=el.querySelector('.cx-panel-body').getBoundingClientRect(),heading=el.querySelector('.usage-account h3').getBoundingClientRect();return {headingTop:heading.top,bodyTop:body.top,bodyBottom:body.bottom,visible:heading.top>=body.top&&heading.bottom<=body.bottom};});
  if(process.env.EXPECT_LEGACY){await ui.setViewportSize({width:360,height:640});await ui.screenshot({path:'/tmp/nubi-quota-before.png',animations:'disabled'});const rect=await dialog().getByRole('heading',{name:'ChatGPT 잔여 한도'}).boundingBox();assert(rect.y>640);console.log(JSON.stringify({legacy:placement,shortViewport:{height:640,headingTop:rect.y},quotaHttpStatus:200,quotaCalls}));}
  else {
    assert.equal(placement.visible,true,JSON.stringify(placement));await dialog().evaluate(async el=>{for(const a of el.getAnimations()){a.pause();a.currentTime=100;}const style=getComputedStyle(el);if(style.opacity!=='1'||style.backgroundColor==='rgba(0, 0, 0, 0)')throw new Error('Modal must remain opaque while entering');for(const a of el.getAnimations())a.finish();});assert.equal(quotaCalls,1);check('Modal remains opaque during its entrance animation');check('HTTP 200 account windows appear immediately above token totals with ChatGPT selected');
    await mkdir('verification',{recursive:true});
    for(const [width,height] of [[360,640],[360,800],[1100,850]]){await ui.setViewportSize({width,height});await ui.evaluate(()=>document.fonts.ready);assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await dialog().evaluate(el=>{const body=el.querySelector('.cx-panel-body').getBoundingClientRect(),account=el.querySelector('.usage-account').getBoundingClientRect();return account.top>=body.top&&account.bottom<=body.bottom;}));await ui.screenshot({path:`verification/account-usage-${width}x${height}.png`,animations:'disabled'});}
    await close();await open();assert.equal(quotaCalls,1);check('fresh quota caches for five minutes and remains visible in side-panel and full-screen layouts');
    mode='credits';await dialog().getByRole('button',{name:'계정 한도 새로고침',exact:true}).click();await dialog().getByText('4,500',{exact:true}).waitFor();await dialog().getByText('80% 남음',{exact:true}).waitFor();assert.equal((await state()).accountUsage.data.windows.length,0);check('credits and individual limit render from HTTP 200 without rate_limit windows');
    mode='forbidden';await dialog().getByRole('button',{name:'계정 한도 새로고침',exact:true}).click();await poll(async()=>(await state()).accountUsage.error,'quota_unauthorized');assert.equal((await state()).auth.rejected,false);await dialog().getByText('4,500',{exact:true}).waitFor();
    await dialog().getByText('조회 실패. 이전 결과입니다.',{exact:true}).waitFor();
    const previous=quotaCalls;mode='windows';await close();await open();await poll(()=>quotaCalls,previous+1);await dialog().getByText('75% 남음',{exact:true}).waitFor();check('failed quota preserves prior data and reopening retries immediately without rejecting chat login');
    mode='refresh';const before=quotaCalls;await dialog().getByRole('button',{name:'계정 한도 새로고침',exact:true}).click();await poll(()=>refreshCalls,1);await poll(()=>quotaCalls,before+2);await dialog().getByText('75% 남음',{exact:true}).waitFor();check('unexpected 401 refreshes once and retries GET with the refreshed token');
    await close();
    await worker.evaluate(async token=>{
      const session=await chrome.storage.session.get(null);
      await chrome.storage.session.set({providerSessions:{chatgpt:{credential:session.credential,accountUsage:session.accountUsage,catalog:session.catalog}},credential:{provider:'aipro',mode:'browser',token,receivedAt:33},catalog:null,accountUsage:null});
      await chrome.storage.local.set({activeProvider:'aipro',settings:{loginRoute:'vscode',mode:'browser',modelId:'GLM-5.2-NVFP4'}});
    },token);
    await poll(async()=>(await state()).activeProvider,'aipro');mode='credits';await open();await dialog().getByText('75% 남음',{exact:true}).waitFor();await dialog().getByRole('button',{name:'계정 한도 새로고침',exact:true}).click();await dialog().getByText('4,500',{exact:true}).waitFor();assert.equal((await state()).auth.provider,'aipro');check('connected ChatGPT quota remains readable and refreshable while AI Pro is selected');
    mode='empty';await dialog().getByRole('button',{name:'계정 한도 새로고침',exact:true}).click();await dialog().getByText('제공된 한도 정보가 없습니다.',{exact:true}).waitFor();assert.equal(await dialog().getByRole('heading',{name:'ChatGPT 잔여 한도'}).count(),1);check('empty successful payload retains the quota heading and an explicit empty state');
    await close();await ui.reload();await open();await dialog().getByText('제공된 한도 정보가 없습니다.',{exact:true}).waitFor();assert.equal((await state()).activeProvider,'aipro');
    assert.deepEqual(errors,[]);assert(!JSON.stringify(await state()).includes(token));await writeFile('verification/account-usage-browser.json',JSON.stringify({checks,errors,syntheticAccount:true,liveAccountVerified:false},null,2));
  }
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
