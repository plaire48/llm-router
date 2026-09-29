import {chromium} from '/Users/ganadi/Documents/llm_router/extensions/aipro-chat/node_modules/playwright/index.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const root='/Users/ganadi/Documents/llm_router/extensions/aipro-chat';const profile=await mkdtemp(resolve(tmpdir(),'nubi-beta-visual-'));let context;const checks=[];
try {
context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${root}/dist`,`--load-extension=${root}/dist`]});
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const page=await context.newPage();
await context.route('https://aipro.sdsdev.co.kr/api/models',r=>r.fulfill({json:{modelList:[{name:'GLM-5.2-NVFP4',display_name:'GLM-5.2-512K'}]}}));
await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
for (const loggedIn of [false,true]) {
if(loggedIn)await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic-visual-token',receivedAt:101,expiresAt:Date.now()+3600000}}));
await page.getByRole('button',{name:loggedIn?'로그아웃':'AI Pro',exact:true}).waitFor();
for(const [width,height] of [[320,640],[360,800],[1100,850]]){
await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);
const metrics=await page.evaluate(()=>{const logo=document.querySelector('.nubi-wordmark').getBoundingClientRect(),beta=document.querySelector('.nubi-beta'),r=beta.getBoundingClientRect(),bar=document.querySelector('.cx-kit-topbar'),actions=bar.querySelector('.cx-kit-actions').getBoundingClientRect();return {text:beta.textContent,fontSize:getComputedStyle(beta).fontSize,color:getComputedStyle(beta).color,rightOfLogo:r.left>=logo.right,withinHeader:r.right<actions.left,overflow:document.documentElement.scrollWidth>innerWidth,clipped:[...bar.querySelectorAll('button')].some(b=>b.getBoundingClientRect().right>innerWidth)};});
if(metrics.text!=='beta'||metrics.fontSize!=='12px'||!metrics.rightOfLogo||!metrics.withinHeader||metrics.overflow||metrics.clipped)throw new Error(JSON.stringify({width,loggedIn,...metrics}));
await page.screenshot({path:`${root}/verification/beta-header-${loggedIn?'chat':'login'}-${width}.png`,animations:'disabled'});checks.push({width,height,loggedIn,...metrics});
}}
await writeFile(`${root}/verification/beta-header-visual.json`,JSON.stringify({checks},null,2));console.log(JSON.stringify(checks));
} finally{await context?.close();await rm(profile,{recursive:true,force:true});}
