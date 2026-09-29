import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from '/Users/ganadi/Documents/llm_router/extensions/aipro-chat/node_modules/playwright/index.mjs';
const root='/Users/ganadi/Documents/llm_router/extensions/aipro-chat';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-native-dialog-audit-'));
const extension=resolve(profile,'extension');let context;
try {
  await cp(resolve(root,'dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('https://dialog.example.test/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.auditAgent={runBrowserAgent,stopBrowserAgent};\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await context.route('https://dialog.example.test/**',r=>r.fulfill({contentType:'text/html',body:`<title>Native dialog test</title><button onclick="window.result=confirm('Continue preview?');document.querySelector('output').textContent=result?'Preview accepted':'Preview cancelled'">Preview</button><output></output>`}));
  const page=await context.newPage();const dialogs=[];
  // The test connection observes but neither accepts nor dismisses dialogs.
  page.on('dialog',dialog=>dialogs.push({type:dialog.type(),message:dialog.message()}));
  await page.goto('https://dialog.example.test/');
  for(let i=0;i<100&&!await worker.evaluate(()=>!!globalThis.auditAgent);i++)await new Promise(r=>setTimeout(r,40));
  const tabId=await worker.evaluate(async()=>(await chrome.tabs.query({})).find(t=>t.url==='https://dialog.example.test/').id);
  const result=await worker.evaluate(async tabId=>(await auditAgent.runBrowserAgent('native-dialog-audit',{tabId},'run_playwright',{code:'await page.getByRole("button",{name:"Preview",exact:true}).click();'})).result,tabId);
  const pageResult=await page.locator('output').textContent();
  const verification=(await worker.evaluate(async tabId=>await auditAgent.runBrowserAgent('native-dialog-audit',{tabId},'verify_page',{checks:[{kind:'text_present',expected:'Preview accepted'}]}),tabId)).result;
  assert.equal(verification.verified,false);
  assert.equal(pageResult,'Preview cancelled'); assert.equal(result.ok,true);
  const report={verification,status:'gap_confirmed',build:manifest.version,syntheticSite:true,actualModel:false,testConnectionHandledDialog:false,dialogs,pageResult,ok:result.ok,reason:result.reason||null,modelResultHasDialogEvent:!!(result.dialog||result.dialogs||result.observation?.dialog),result};
  await writeFile(resolve(root,'verification/native-dialog-audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({dialogs,pageResult,ok:result.ok,reason:result.reason,modelResultHasDialogEvent:report.modelResultHasDialogEvent}));
  await worker.evaluate(()=>auditAgent.stopBrowserAgent('native-dialog-audit'));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
