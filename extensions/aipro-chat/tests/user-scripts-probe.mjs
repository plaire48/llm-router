// Research probe only. Enable Allow User Scripts in the temporary Chrome profile when prompted.
import {chromium} from 'playwright';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root=await mkdtemp(join(tmpdir(),'aipro-user-scripts-'));
const ext=join(root,'extension'); await mkdir(ext);
await writeFile(join(ext,'manifest.json'),JSON.stringify({manifest_version:3,name:'AI Pro User Scripts Probe',version:'0.0.1',minimum_chrome_version:'135',permissions:['userScripts'],host_permissions:['https://script-probe.example.test/*'],background:{service_worker:'background.js'}}));
await writeFile(join(ext,'background.js'),'chrome.runtime.onInstalled.addListener(() => {});');
await writeFile(join(ext,'index.html'),'<!doctype html><title>User Scripts Probe</title><p>Isolated test profile</p>');
const context=await chromium.launchPersistentContext(join(root,'profile'),{headless:false,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try {
 await context.route('https://script-probe.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><title>Script fixture</title><h1>교육 신청</h1><label>이름<input name="name"></label><button id="review">미리보기</button><output></output><script>window.clicked=0;document.querySelector("button").onclick=()=>{window.clicked++;document.querySelector("output").textContent=document.querySelector("input").value;};</script>'}));
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).hostname;
 const site=await context.newPage(); await site.goto('https://script-probe.example.test/form');
 const ui=await context.newPage(); await ui.goto(`chrome-extension://${id}/index.html`);
 const available=()=>ui.evaluate(async()=>{try {await chrome.userScripts.getScripts();return true;}catch{return false;}});
 const initiallyEnabled=await available();
 const settings=await context.newPage(); await settings.goto(`chrome://extensions/?id=${id}`);
 console.log('WAITING_ALLOW_USER_SCRIPTS',JSON.stringify({id,initiallyEnabled}));
 let enabled=initiallyEnabled;
 for(let attempt=0;attempt<120&&!enabled;attempt++) {await new Promise(r=>setTimeout(r,1000));await ui.reload();enabled=await available();}
 assert(enabled,'Allow User Scripts was not enabled');
 const run=code=>ui.evaluate(async code=>{const [tab]=await chrome.tabs.query({url:'https://script-probe.example.test/*'});return chrome.userScripts.execute({target:{tabId:tab.id},world:'USER_SCRIPT',js:[{code}]});},code);
 const read=await run('({heading:document.querySelector("h1").textContent, storageAvailable:!!globalThis.chrome?.storage})');
 assert.equal(read[0].result.heading,'교육 신청'); assert.equal(read[0].result.storageAvailable,false);
 const write=await run('(() => {const input=document.querySelector("input[name=name]");input.value="홍길동";input.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#review").click();return {value:input.value,output:document.querySelector("output").textContent};})()');
 assert.deepEqual(write[0].result,{value:'홍길동',output:'홍길동'});
 assert.equal(await site.evaluate(()=>window.clicked),1);
 const asyncResult=await run('(async () => {await new Promise(resolve=>setTimeout(resolve,20));return "async complete";})()');
 assert.equal(asyncResult[0].result,'async complete');
 const rawFailure=await run('throw new Error("synthetic-script-error")');
 const failure=await run('(async () => {try {throw new Error("synthetic-script-error");}catch(error){return {ok:false,error:String(error.message)};}})()');
 assert.equal(failure[0].result.error,'synthetic-script-error');
 await site.goto('https://script-probe.example.test/next');
 const newDocument=await run('document.querySelector("h1").textContent');
 assert.equal(newDocument[0].result,'교육 신청');
 assert.notEqual(newDocument[0].documentId,read[0].documentId);
 const result={rawErrorReported:typeof rawFailure[0].error === 'string',structuredWrapperErrorReported:true,chrome:context.browser().version(),api:'chrome.userScripts.execute',initiallyEnabled,enabled:true,debuggerPermission:false,probeOnly:true,productionExtensionChanged:false,fixtureOnly:true,checks:['DOM text read','input value and input event','preview button click','return value collected','async result awaited','script error returned by explicit try/catch wrapper','new document execution after navigation','extension storage inaccessible in USER_SCRIPT world']};
 const output=new URL('../verification/user-scripts-probe-results.json', import.meta.url);
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {await context.close();await rm(root,{recursive:true,force:true});}
