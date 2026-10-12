import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/chatgpt-usage');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const width of [1280,440,360]){
  await p.setViewportSize({width,height:900});await p.goto('http://127.0.0.1:'+server.address().port+'/?integrated&chatgpt-usage');
  const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const closer=p.getByRole('button',{name:'사이드바 접기',exact:true});if(await closer.count())await closer.click();
  const meter=p.getByRole('button',{name:'컨텍스트 사용량',exact:true});await meter.getByText('23.2K',{exact:true}).waitFor();
  assert.match(await meter.getAttribute('title'),/23,223.*262,144/);
  const layout=await p.locator('.composer-bottom').evaluate(row=>{const boxes=[...row.querySelectorAll('button')].filter(el=>el.getBoundingClientRect().width).map(el=>el.getBoundingClientRect());return {centers:boxes.map(b=>(b.top+b.bottom)/2),right:Math.max(...boxes.map(b=>b.right)),width:innerWidth};});
  assert(Math.max(...layout.centers)-Math.min(...layout.centers)<2,JSON.stringify(layout));assert(layout.right<=layout.width);
  await meter.click();await p.getByRole('dialog',{name:'컨텍스트 사용량',exact:true}).getByText('23,223',{exact:true}).waitFor();await p.keyboard.press('Escape');
  await p.screenshot({path:path.join(dir,`composer-${width}.png`),animations:'disabled'});
  await p.getByRole('button',{name:'토큰 사용량',exact:true}).click();const dialog=p.getByRole('dialog',{name:'사용량',exact:true});
  await dialog.getByText('75% 남음',{exact:true}).waitFor();
  const lag=await p.evaluate(()=>Date.now()-window.quotaFinished);assert(lag<800,`Quota was discarded by polling: ${lag}ms`);
  assert.equal(await p.evaluate(()=>window.quotaCalls),1);await dialog.getByText('23,223',{exact:true}).waitFor();
  await dialog.getByText('ChatGPT',{exact:true}).click();await dialog.getByText('23,175',{exact:true}).waitFor();
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));await p.screenshot({path:path.join(dir,`usage-${width}.png`),animations:'disabled'});
  await p.keyboard.press('Escape');await p.getByRole('button',{name:'토큰 사용량',exact:true}).click();await dialog.getByText('75% 남음',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.quotaCalls),1);
 }
 assert.deepEqual(errors,[]);console.log('PASS: real Workbench at 1280/440/360px shows token count, single-row controls, measured totals and delayed quota without poll collision; reopen uses cached quota. Synthetic responses, not live account verification.');
}finally{await browser?.close();server.close();}
