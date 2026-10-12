import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdir,writeFile,mkdtemp,rm,cp} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('verification/reasoning-providers');await mkdir(out,{recursive:true});
await build({entryPoints:['tests/reasoning-picker-fixture.jsx'],outfile:path.join(out,'app.js'),bundle:true,format:'esm',platform:'browser',alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(out,'icons'),{recursive:true});
await writeFile(path.join(out,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const storage=await mkdtemp('/tmp/nubi-reasoning-colors-'),require=createRequire(import.meta.url);
const browser=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
const records=[];
try {
 const page=await browser.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>console.error(error.message));await browser.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(640,600));
 for(const [provider,ink,fill] of [['chatgpt','rgb(25, 31, 40)','#191F28'],['claude','rgb(142, 66, 44)','#D97757'],['aipro','rgb(85, 0, 255)','#5500FF']]) {
  await page.goto('file://'+path.join(out,'index.html')+'?provider='+provider);await page.evaluate(()=>document.fonts.ready);
  const trigger=page.getByRole('button',{name:'추론 정도',exact:true});await trigger.click();
  const slider=page.getByRole('slider',{name:'추론 정도',exact:true});await slider.waitFor();
  await slider.press('End');
  const dialog=page.getByRole('dialog',{name:'추론 정도 조절',exact:true});
  const color=await trigger.locator('svg').evaluate(e=>getComputedStyle(e).color);assert.equal(color,ink);
  const titleColor=await dialog.locator('strong').evaluate(e=>getComputedStyle(e).color);assert.equal(titleColor,ink);
  const fillValue=await slider.evaluate(e=>getComputedStyle(e).getPropertyValue('--nubi-reasoning-fill'));assert(fillValue.toLowerCase().includes(fill.toLowerCase()));
  const rect=await dialog.boundingBox();assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=640&&rect.y+rect.height<=600);
  await page.screenshot({path:path.join(out,provider+'.png')});
  await trigger.click();await dialog.waitFor({state:'hidden'});
  records.push({provider,icon:color,title:titleColor,fill:fillValue.trim(),triggerToggle:true,withinViewport:true});
 }
 for(const issue of ['claude_cli_missing','claude_login_required','claude_cli_update']) {
  await page.goto('file://'+path.join(out,'index.html')+'?setup='+issue);
  const dialog=page.getByRole('dialog',{name:'Claude Code 연결',exact:true});await dialog.waitFor();
  const guide=dialog.getByRole('button',{name:'공식 설치 안내',exact:true}),login=dialog.getByRole('button',{name:'로그인',exact:true});
  if(issue==='claude_login_required'){assert.equal(await guide.isVisible(),false);assert.equal(await login.isVisible(),true);}
  else {assert.equal(await guide.isVisible(),true);assert.equal(await login.isVisible(),false);await guide.click();assert.equal(await page.evaluate(()=>window.setupGuideUrl),'https://code.claude.com/docs/en/setup');}
  await page.screenshot({path:path.join(out,issue+'.png')});
  if(issue==='claude_cli_missing'){
    await dialog.getByRole('button',{name:'연결 확인',exact:true}).click();
    await login.waitFor({state:'visible'});assert.equal(await guide.isVisible(),false,'installed but signed-out retry only shows login');
  }
  records.push({setup:issue,stageSpecificGuide:true});
 }
 await page.goto('file://'+path.join(out,'index.html')+'?copy');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(window.failCopy)throw Error('denied');window.copiedText=value;}}}));
 const copy=page.getByRole('button',{name:'내용 복사',exact:true}),native=page.getByRole('button',{name:'경로 복사',exact:true});
 const before=await copy.boundingBox();await copy.focus();await copy.press('Enter');
 const done=page.getByRole('button',{name:'내용 복사 완료',exact:true});await done.waitFor();assert.equal(await page.evaluate(()=>window.copiedText),'첫 원문');
 assert.equal(await done.evaluate(e=>e===document.activeElement),true);assert.deepEqual(await done.boundingBox(),before);
 assert.equal(await done.locator('svg').getAttribute('data-icon'),'check');
 await copy.waitFor();await native.click();await page.getByRole('button',{name:'경로 복사 완료',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.nativeCopies),1);
 await page.getByRole('button',{name:'원문 변경',exact:true}).click();await native.waitFor();
 await page.evaluate(()=>{window.failCopy=true;window.failNative=true;});await copy.click();await page.locator('.copy-control[data-copy-state="error"]').waitFor();assert.equal(await page.locator('.copy-complete').count(),0);
 await native.click();await page.waitForFunction(()=>document.querySelectorAll('.copy-control[data-copy-state="error"]').length===2);assert.equal(await page.locator('.copy-complete').count(),0);
 await page.evaluate(()=>window.failCopy=false);await page.emulateMedia({reducedMotion:'reduce'});await copy.click();await done.waitFor();assert.equal(await page.evaluate(()=>window.copiedText),'바뀐 원문');assert.equal(await done.locator('svg').evaluate(e=>getComputedStyle(e).animationName),'none');
 records.push({copyFeedback:true,nativeAcknowledgement:true,failureNeverChecks:true,sourceReset:true,keyboardFocus:true,stableBounds:true,reducedMotion:true});
 await writeFile(path.join(out,'result.json'),JSON.stringify({scope:'Rendered production components with synthetic capabilities and clipboard/native acknowledgements; no account call',records},null,2));console.log(JSON.stringify(records));
} finally {await browser.close();await rm(storage,{recursive:true,force:true});}
