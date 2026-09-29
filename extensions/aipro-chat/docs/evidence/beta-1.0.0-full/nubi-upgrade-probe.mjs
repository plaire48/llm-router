import assert from 'node:assert/strict';
import {chromium} from '/Users/ganadi/Documents/llm_router/extensions/aipro-chat/node_modules/playwright/index.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtemp,cp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {resolve} from 'node:path';
const root='/Users/ganadi/Documents/llm_router/extensions/aipro-chat', profile=await mkdtemp(resolve(tmpdir(),'nubi-upgrade-audit-')), extension=resolve(profile,'extension');let context,worker,ui;let id;
async function launch(){context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const nextId=new URL(worker.url()).hostname;if(id)assert.equal(nextId,id);id=nextId;ui=await context.newPage();await ui.goto(`chrome-extension://${id}/index.html`);await ui.getByRole('button',{name:'AI Pro',exact:true}).waitFor();}
async function rpc(type,args={}){const result=await ui.evaluate(message=>chrome.runtime.sendMessage(message),{type,...args});assert.equal(result.ok,true,result.error);return result.data;}
try {
await mkdir(extension);execFileSync('unzip',['-q',`${root}/releases/nubi-beta-1.0.0.zip`,'-d',extension]);await launch();
assert.equal(await ui.evaluate(()=>chrome.runtime.getManifest().version),'1.4.1');
let s=await rpc('GET_STATE');await rpc('DRAFT',{value:'업데이트 전 보관한 초안',conversationId:s.chat.sessionId});await rpc('NEW_CHAT');s=await rpc('GET_STATE');await rpc('DRAFT',{value:'마지막 대화 초안',conversationId:s.chat.sessionId});
const before=await worker.evaluate(()=>chrome.storage.local.get(['chat','chatHistory','activeProvider','providerChats','settings','skills']));
assert(before.chatHistory.length>0);
await context.close();context=null;await rm(extension,{recursive:true});await cp(`${root}/dist`,extension,{recursive:true});await launch();
const after=await worker.evaluate(()=>chrome.storage.local.get(['chat','chatHistory','activeProvider','providerChats','settings','skills']));assert.deepEqual(after,before);assert.equal(await ui.evaluate(()=>chrome.runtime.getManifest().version),'1.4.2');assert.equal(await ui.locator('.nubi-beta').innerText(),'beta');
const report={passed:true,from:'1.4.1',to:'1.4.2',sameExtensionId:true,actualChromeRelaunch:true,localStatePreserved:Object.keys(before),noActualAccount:true};await writeFile(`${root}/verification/upgrade-audit.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally{await context?.close();await rm(profile,{recursive:true,force:true});}
