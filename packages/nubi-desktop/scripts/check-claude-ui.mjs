import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),storage=await mkdtemp(path.join(os.tmpdir(),'nubi-claude-ui-'));
const out=path.resolve('verification/claude-code');await mkdir(out,{recursive:true});
const connectOnly=process.argv.includes('--connect-only');
if(!process.argv.includes('--live')&&!connectOnly)throw Error('Pass --live after signing into Claude Code. This check sends one short prompt.');
const root=path.join(storage,'project');await mkdir(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# 화면 검사 프로젝트\nClaude 연결 UI 검사를 위한 임시 프로젝트입니다.\n');
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});git(['init']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','.']);git(['commit','-m','UI fixture']);await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
let app;const errors=[];
try{
  app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'Claude',exact:true}).waitFor();
  const dismiss=page.getByRole('button',{name:'닫기',exact:true});if(await dismiss.count())await dismiss.first().click();
  const entrances=await page.locator('.provider-options > .provider-button').evaluateAll(items=>items.map(e=>{const s=getComputedStyle(e);return {name:s.animationName,duration:s.animationDuration,easing:s.animationTimingFunction,delay:parseFloat(s.animationDelay)};}));
  assert.equal(entrances.length,4);assert(entrances.every(e=>e.name===entrances[1].name&&e.duration===entrances[1].duration&&e.easing===entrances[1].easing),'login buttons share entrance motion');
  assert(Math.abs((entrances[3].delay-entrances[2].delay)-(entrances[2].delay-entrances[1].delay))<.001,'Claude continues the login stagger');
  await page.getByRole('button',{name:'Claude',exact:true}).click();
  await page.getByRole('button',{name:'모델 변경',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Claude Code 연결',exact:true}).count(),0,'installed authenticated CLI connects without setup dialog');
  if(connectOnly){const connected=await page.evaluate(()=>window.nubi.request('provider'));assert.equal(connected.provider,'claude');assert.equal(connected.connected,true);assert.deepEqual(errors,[]);console.log('Installed CLI connects directly without any setup dialog or model call.');}
  else {
  await page.getByRole('button',{name:'모델 변경',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'모델 선택',exact:true});await modal.waitFor();
  assert.deepEqual(await modal.getByRole('tab').allTextContents(),['AI Pro','ChatGPT','FabriX','Claude']);
  await modal.getByRole('tab',{name:'Claude',exact:true}).click();
  await page.screenshot({path:path.join(out,'claude-models.png')});
  const tabs=await modal.getByRole('tab').evaluateAll(items=>items.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height,scroll:e.scrollWidth,client:e.clientWidth};}));
  assert(tabs.every(t=>Math.abs(t.top-tabs[0].top)<1),'all provider tabs stay on one line');assert(tabs[3].left>tabs[2].left,'Claude follows FabriX');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(620,740));
  await page.waitForFunction(()=>innerWidth<=620);
  assert(await modal.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth;}),'model dialog fits narrow window');
  await page.screenshot({path:path.join(out,'claude-models-narrow.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,960));
  await modal.getByRole('button',{name:'Opus 5.5',exact:true}).click();await modal.waitFor({state:'hidden'});
  const reasoningTrigger=page.getByRole('button',{name:'추론 정도',exact:true});await reasoningTrigger.click();
  const reasoning=page.getByRole('dialog',{name:'추론 정도 조절',exact:true});await reasoning.waitFor();
  const slider=reasoning.getByRole('slider',{name:'추론 정도',exact:true});
  assert.equal(await slider.getAttribute('max'),'4');
  assert.equal(await slider.getAttribute('aria-valuetext'),'Medium');
  assert.equal(await reasoning.locator('code').count(),0,'no separate CLI panel');
  for(const [key,value,label] of [['Home','low','Low'],['ArrowRight','medium','Medium'],['ArrowRight','high','High'],['ArrowRight','xhigh','Xhigh'],['End','max','Max']]) {
    await slider.focus();await slider.press(key);
    await page.waitForFunction(async value=>(await window.nubi.request('provider')).reasoningEffort===value,value);
    await page.waitForFunction(label=>{const input=document.querySelector('.nubi-reasoning-slider');return input?.getAttribute('aria-valuetext')===label&&!input.disabled;},label);
    assert.equal(await slider.getAttribute('aria-valuetext'),label);
  }
  await reasoning.getByRole('button',{name:'추론 정도를 기본값으로 되돌리기',exact:true}).click();
  await page.waitForFunction(async()=>(await window.nubi.request('provider')).reasoningEffort==='medium');
  await page.waitForFunction(()=>{const input=document.querySelector('.nubi-reasoning-slider');return input?.getAttribute('aria-valuetext')==='Medium'&&!input.disabled;});
  await slider.focus();await slider.press('ArrowRight');
  await page.waitForFunction(async()=>(await window.nubi.request('provider')).reasoningEffort==='high');
  await page.waitForFunction(()=>{const input=document.querySelector('.nubi-reasoning-slider');return input?.getAttribute('aria-valuetext')==='High'&&!input.disabled;});
  assert.equal(await reasoning.locator('.nubi-reasoning-heading strong').textContent(),'High');
  assert.equal(await reasoningTrigger.getAttribute('title'),'Claude 추론 요청: --effort high');
  await page.screenshot({path:path.join(out,'claude-effort.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(620,740));await page.waitForFunction(()=>innerWidth<=620);
  assert(await reasoning.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth;}),'effort dialog fits narrow window');
  assert(await reasoning.locator('.nubi-reasoning-heading').evaluate(e=>{const parts=[...e.children].map(x=>x.getBoundingClientRect());return parts.every(r=>Math.abs((r.top+r.height/2)-(parts[0].top+parts[0].height/2))<2)&&e.scrollWidth<=e.clientWidth;}),'effort heading and icons align on one row');
  await page.screenshot({path:path.join(out,'claude-effort-narrow.png')});
  await reasoningTrigger.click();await reasoning.waitFor({state:'hidden'});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,960));
  await page.evaluate(async()=>{const value=await window.nubi.request('provider',{action:'verify'});if(value.__nubiError)throw Error(value.__nubiError);});
  await page.getByRole('button',{name:'토큰 사용량',exact:true}).click();const usage=page.getByRole('dialog',{name:'사용량',exact:true});await usage.waitFor();
  const a=await usage.getByRole('heading',{name:'ChatGPT 잔여 한도',exact:true}).boundingBox(),b=await usage.getByRole('heading',{name:'Claude 잔여 한도',exact:true}).boundingBox();assert(b.y>a.y);
  await page.screenshot({path:path.join(out,'claude-usage.png')});
  assert(await usage.getByRole('meter').count()>0,'live Claude CLI reports account windows');
  assert.deepEqual(errors,[]);
  const measured=await page.evaluate(()=>window.nubi.request('usage'));
  await writeFile(path.join(out,'live-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),cli:'unmodified local Claude Code',quota:measured.claudeAccountUsage,tokens:measured.usage?.total?.claude,scope:'Actual short Claude response and Electron account UI; temporary project; no Windows installation claim'},null,2));
  await app.close();app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
  const reopened=await app.firstWindow();await reopened.getByRole('button',{name:'모델 변경',exact:true}).waitFor();
  const restored=await reopened.evaluate(()=>window.nubi.request('provider'));assert.equal(restored.provider,'claude');assert.equal(restored.connected,true);assert.equal(restored.model,'claude-opus-5-5');assert.equal(restored.reasoningEffort,'high');
  console.log(JSON.stringify({checks:['shared login entrance and stagger','four ordered provider tabs','single row','installed CLI connects without setup','live CLI verification','Claude quota below ChatGPT','actual quota windows','narrow model picker','shared slider with five literal effort values','reset to medium and selected high','narrow effort icon alignment','same trigger closes picker','restart preserves Opus 5.5 and high'],captures:out}));
  }
}catch(error){const page=app?.windows()[0];if(page){console.log((await page.locator('body').innerText()).slice(0,4000));await page.screenshot({path:path.join(out,'failure.png')});}throw error;}finally{await app?.close();await rm(storage,{recursive:true,force:true});}
