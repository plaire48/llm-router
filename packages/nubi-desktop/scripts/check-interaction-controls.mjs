import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/interaction-controls');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));



let browser,p;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 const origin='http://127.0.0.1:'+server.address().port;
 for(const width of (process.env.PIN_ONLY?[]:[1280,440,360])){
  await p.setViewportSize({width,height:900});await p.goto(origin+'/?integrated&modals&catalog&toolbar&builtin-commands');
  const settings=p.getByRole('button',{name:'설정',exact:true}),anchor=await settings.boundingBox();await settings.click();
  const dialog=p.getByRole('dialog',{name:'설정',exact:true});await dialog.waitFor();
  const field=dialog.locator('#nubi-default-shell');await field.click();const menu=p.getByRole('listbox',{name:'기본 터미널',exact:true});await menu.waitFor();
  await p.waitForFunction(()=>{const field=document.querySelector('#nubi-default-shell'),menu=document.getElementById(field.getAttribute('aria-controls'));return menu&&Math.abs(field.getBoundingClientRect().width-menu.getBoundingClientRect().width)<1;});
  await p.screenshot({path:path.join(dir,`settings-${width}.png`),animations:'disabled'});await field.press('Escape');
  await p.mouse.click(anchor.x+anchor.width/2,anchor.y+anchor.height/2);await dialog.waitFor({state:'hidden'});assert(await settings.evaluate(node=>document.activeElement===node));
  // Same opener toggles both full-window and anchored modal surfaces.
  for(const selector of ['.nubi-account-button','.context-trigger','.nubi-reasoning-trigger','.nubi-approval-mode-button']){
   const button=p.locator(selector);await button.click();await p.locator('[aria-modal="true"]').last().waitFor();const box=await button.boundingBox();
   await p.mouse.click(box.x+box.width/2,box.y+box.height/2);await p.waitForFunction(()=>![...document.querySelectorAll('[aria-modal="true"]')].some(el=>el.getClientRects().length));
  }
  const input=p.locator('textarea');await input.fill('/');const commands=p.getByRole('listbox',{name:'명령과 스킬',exact:true});await commands.waitFor();
  const mail=commands.getByRole('option').filter({hasText:'/mail'}),code=commands.getByRole('option').filter({hasText:'/code'});await code.waitFor();assert(await mail.isVisible());assert.equal(await commands.getByText('보고서 작성',{exact:true}).count(),0);
  const lines=await commands.locator('.nubi-command-copy').evaluateAll(rows=>rows.map(row=>{const name=row.querySelector('strong').getBoundingClientRect(),detail=row.querySelector('small').getBoundingClientRect();return {align:Math.abs((name.top+name.bottom)/2-(detail.top+detail.bottom)/2),fits:row.scrollWidth<=row.clientWidth};}));
  assert(lines.every(row=>row.align<2&&row.fits),JSON.stringify(lines));await p.screenshot({path:path.join(dir,`commands-${width}.png`),animations:'disabled'});
  await input.fill('/code');await input.press('Enter');assert.equal(await input.inputValue(),'/code ');
  console.log(`PASS ${width}px: dropdown field edges, opener toggles settings/account/context/reasoning/approval, one-line slash menu and keyboard selection.`);
 }
 await p.setViewportSize({width:1280,height:900});await p.goto(origin+'/?integrated&sessions&toolbar');
 const row=p.locator('.nubi-session-row').first();await row.hover();await row.locator('summary[aria-label="실행 중인 분석 관리"]').click();await p.getByRole('button',{name:'실행 중인 분석 고정',exact:true}).click();await p.keyboard.press('Escape');await p.waitForFunction(()=>document.querySelector('.nubi-session-row[data-pinned="true"]'));assert.equal(await row.getAttribute('data-pinned'),'true');await p.screenshot({path:path.join(dir,'pinned-conversation.png'),animations:'disabled'});
 assert.deepEqual(errors,[]);
} catch(error){if(p)await p.screenshot({path:path.join(dir,'failure.png')});throw error;} finally{await browser?.close();server.close();}
