import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/message-footer');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const width of [1280,440,360]){
  await p.setViewportSize({width,height:900});await p.goto('http://127.0.0.1:'+server.address().port+'/?integrated&message-footer');
  const initialOpener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await initialOpener.count())await initialOpener.click();
  await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const closer=p.getByRole('button',{name:'사이드바 접기',exact:true});if(await closer.count())await closer.click();
  await p.getByRole('article',{name:/ 답변$/}).getByText('요청한 내용을 확인했어요.',{exact:true}).waitFor();
  const geometry=await p.locator('.message-actions').evaluateAll(rows=>rows.filter(row=>row.querySelector('time')&&row.querySelector('.copy-control button')).map(row=>{const time=row.querySelector('time').getBoundingClientRect(),copy=row.querySelector('.copy-control button').getBoundingClientRect();return {aligned:Math.abs((time.top+time.bottom)/2-(copy.top+copy.bottom)/2)<1,gap:copy.left-time.right,fits:row.getBoundingClientRect().right<=innerWidth};}));
  assert.equal(geometry.length,3);assert(geometry.every(row=>row.aligned&&row.gap>=0&&row.gap<=8&&row.fits),JSON.stringify(geometry));
  await p.screenshot({path:path.join(dir,`footer-${width}.png`),animations:'disabled'});
  await p.getByRole('button',{name:'다시 응답 받기',exact:true}).click();await p.getByText('새로 확인한 답변이에요.',{exact:true}).waitFor();
  assert.equal(await p.getByText('요청한 내용을 확인했어요.',{exact:true}).count(),0);assert.equal(await p.getByRole('textbox',{name:'추가 요청',exact:true}).inputValue(),'');
  assert.equal(await p.evaluate(()=>window.redoCalls),1);
  const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await p.getByRole('button',{name:'새 대화',exact:true}).click();if(await closer.count())await closer.click();
  await p.getByRole('textbox',{name:'작업 요청',exact:true}).fill('새 대화를 시작해 주세요.');await p.getByRole('button',{name:'전송',exact:true}).click();
  await p.locator('.nubi-launch-progress').getByText(/진행/).waitFor();assert.equal(await p.getByRole('button',{name:'복원',exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'시작',exact:true}).count(),0);
  await p.waitForFunction(()=>window.startCalls===1&&document.querySelector('.nubi-launch-progress')===null);
  if(await opener.count())await opener.click();await p.getByRole('button',{name:'새 대화',exact:true}).click();if(await closer.count())await closer.click();
  await p.getByRole('textbox',{name:'작업 요청',exact:true}).fill('다른 대화가 실행 중이어도 입력');
  assert(await p.getByRole('button',{name:'전송',exact:true}).isEnabled());assert.equal(await p.getByText('다른 대화가 진행 중입니다. 초안은 저장돼요.',{exact:true}).count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: timestamp/copy alignment at 1280/440/360px; redo replaces answer; launch shows elapsed time; other running conversations do not disable Send.');
}catch(error){console.error(errors);throw error;}finally{await browser?.close();server.close();}
