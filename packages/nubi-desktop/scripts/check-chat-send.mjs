import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/chat-send');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));


let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,440,360]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:width===360?'reduce':'no-preference'}),p=await context.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
  await p.goto('http://127.0.0.1:'+server.address().port+'/?integrated&send-transition');
  const field=p.locator('textarea');await field.fill('메일과 코드의 차이를 확인해 주세요.');
  // Hold admission completely: the screen must change without any host response.
  await field.press('Enter');await p.waitForFunction(()=>window.sendGate.createTask);
  await p.locator('.nubi-outgoing').waitFor();assert.equal(await field.inputValue(),'');assert.equal(await p.locator('.welcome').count(),0);
  assert.equal(await p.locator('.nubi-user-bubble').count(),1);assert(await p.getByText('요청 보내는 중',{exact:true}).isVisible());
  await field.fill('보내는 동안 작성한 다음 초안');await p.locator('.nubi-compose-card').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));const pendingBox=await field.boundingBox();
  await p.screenshot({path:path.join(dir,`pending-${width}.png`),animations:'disabled'});
  await p.evaluate(()=>window.sendGate.createTask.release());await p.waitForFunction(()=>window.sendGate.startAgent);
  await p.getByText('시작하는 중',{exact:true}).waitFor();assert.equal(await field.inputValue(),'보내는 동안 작성한 다음 초안');
  assert.equal(await p.locator('.nubi-user-bubble').count(),1);const admittedBox=await field.boundingBox();
  assert(Math.abs(pendingBox.y-admittedBox.y)<12,JSON.stringify({pendingBox,admittedBox}));
  await p.evaluate(()=>window.sendGate.startAgent.release());await p.getByRole('button',{name:'중지',exact:true}).waitFor();
  await p.waitForFunction(()=>!document.querySelector('.nubi-outgoing'));assert.equal(await field.inputValue(),'보내는 동안 작성한 다음 초안');
  // Queued steering responds instantly too, before its receipt returns.
  await field.press('Enter');await p.waitForFunction(()=>window.sendGate.agentInput);await p.getByText('대기열에 보내는 중',{exact:true}).waitFor();assert.equal(await field.inputValue(),'');
  await field.fill('다음 초안 유지');await p.evaluate(()=>window.sendGate.agentInput.release());
  await p.waitForFunction(()=>!document.querySelector('.nubi-outgoing'));assert.equal(await field.inputValue(),'다음 초안 유지');
  await p.evaluate(()=>{window.finishSend();window.sendGate.startAgent=null;});await p.getByText('확인한 결과입니다.',{exact:true}).waitFor();
  // Existing conversation follow-up must also appear before admission.
  await field.fill('기존 대화 추가 요청');await field.press('Enter');await p.waitForFunction(()=>window.sendGate.startAgent);await p.locator('.nubi-outgoing').waitFor();
  assert.equal(await field.inputValue(),'');assert.equal(await p.locator('.nubi-user-bubble').filter({hasText:'기존 대화 추가 요청'}).count(),1);
  await field.fill('실패해도 남는 새 초안');await p.evaluate(()=>window.sendGate.startAgent.reject());
  await p.getByText('전송 결과 확인 필요',{exact:true}).waitFor({timeout:6000}).catch(async error=>{await p.screenshot({path:path.join(dir,'failed.png')});console.log(await p.locator('body').innerText());throw error;});assert.equal(await field.inputValue(),'실패해도 남는 새 초안');
  assert.equal(await p.evaluate(()=>window.sendCalls.filter(c=>c.method==='startAgent').length),2,'uncertain admission is never resent');
  await p.screenshot({path:path.join(dir,`recovery-${width}.png`),animations:'disabled'});
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Preserve the exact uncertain request across renderer reloads.
  await p.evaluate(()=>window.saveSendFixture());await p.reload();await p.getByText('전송 결과 확인 필요',{exact:true}).waitFor();
  assert.equal(await field.inputValue(),'실패해도 남는 새 초안');assert.equal(await p.locator('.nubi-user-bubble').filter({hasText:'기존 대화 추가 요청'}).count(),1);
  await context.close();console.log(`PASS ${width}px: held create/start/queue, immediate bubble, draft handoff, stable composer, uncertain failure and reload recovery.`);
 }
 const loginPage=await browser.newPage({viewport:{width:1280,height:800}});loginPage.on('pageerror',e=>errors.push(e.message));
 for(const connected of [false,true]){
  await loginPage.goto('http://127.0.0.1:'+server.address().port+'/?integrated&modals&toolbar'+(connected?'&company-connected':''));
  const account=loginPage.locator('.nubi-account-button');await account.waitFor();
  if(connected)await account.locator('img').waitFor();
  else {assert.equal(await account.innerText(),'로그인');assert.equal(await account.locator('.nubi-account-avatar svg').count(),1);}
  await account.click();await loginPage.locator('.nubi-ghes-modal').waitFor();
  await loginPage.screenshot({path:path.join(dir,connected?'account-connected.png':'github-login.png'),animations:'disabled'});
 }
 await loginPage.close();
 assert.deepEqual(errors,[]);console.log('PASS: actual Workbench with controlled host latency; no real provider request.');
}finally{await browser?.close();server.close();}
