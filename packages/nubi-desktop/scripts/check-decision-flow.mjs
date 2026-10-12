import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/decision-flow');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));



let browser,p;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',error=>errors.push(error.message));await p.addInitScript(()=>localStorage.removeItem('nubi-session-tabs-v1:fixture'));
 const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [1280,440,360]){
  await p.setViewportSize({width,height:800});
  for(const kind of ['question','command']){
   await p.goto(origin+'/?integrated&modals&toolbar&decision='+kind);
   const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
   await p.locator('.nubi-session-select').filter({hasText:'요청한 결과를 확인해 주세요.'}).click();
   const dialog=p.getByRole('dialog',{name:kind==='question'?'확인이 필요해요':'이 명령을 실행할까요?',exact:true});await dialog.waitFor();
   assert.equal(await p.locator('[aria-modal="true"]').count(),1);
   assert(await dialog.evaluate(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight;}));
   assert.equal(await p.getByText('실행 후 확인 방법',{exact:true}).count(),0);
   assert.equal(await p.evaluate(()=>window.decisionCalls.length),0);
   if(kind==='question')await dialog.getByRole('textbox',{name:'직접 답변',exact:true}).fill('중요한 항목부터 정리');
   await p.screenshot({path:path.join(dir,kind+'-'+width+'.png'),animations:'disabled'});
   await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
   await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await p.locator('[aria-modal="true"]').count(),0,'dismissed decisions do not reopen');
   const trigger=p.getByRole('button',{name:kind==='question'?'답변하기':'확인하고 실행',exact:true});assert(await trigger.evaluate(node=>document.activeElement===node));await trigger.click();await dialog.waitFor();
   if(kind==='question'){
    assert.equal(await dialog.getByRole('textbox',{name:'직접 답변',exact:true}).inputValue(),'중요한 항목부터 정리');
    await dialog.getByRole('button',{name:/표로 정리/}).click();
    await dialog.waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.decisionCalls[0].method),'answerAgent');
   }else{
    await dialog.getByRole('button',{name:'실행',exact:true}).click();await dialog.waitFor({state:'hidden'});
    assert.equal(await p.evaluate(()=>window.decisionCalls[0].decision),'approve');
   }
   assert.equal(await p.evaluate(()=>window.decisionCalls.length),1,'exactly one explicit decision');
  }
  console.log('PASS '+width+'px: one decision modal, bounds, defer/reopen, draft preserved, explicit answer/approval only.');
 }
 assert.deepEqual(errors,[]);
} catch(error){if(p)await p.screenshot({path:path.join(dir,'failure.png')});throw error;} finally{await browser?.close();server.close();}
