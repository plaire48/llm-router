// Public-site integration probe. Real Chrome/Naver, synthetic lease, no LLM.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-live-inventory-')), extension=resolve(profile,'extension');
let context;const trials=[];
try {
  await cp('dist',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('https://*/*','http://*/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.inventoryProbe={connectWorkPage,runBrowserAgent,stopBrowserAgent,refreshBrowserPolicy};\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const source=await context.newPage();await source.goto('https://www.naver.com/',{waitUntil:'domcontentloaded'});
  const tab=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url==='https://www.naver.com/'));
  assert(tab);
  for(let i=0;i<3;i++) {
    const result=await worker.evaluate(async({tabId,index})=>{
      const lease={id:`inventory-${index}`,conversationId:`inventory-${index}`,provider:'aipro',credentialReceivedAt:1,pageTargetTabId:tabId};
      await inventoryProbe.refreshBrowserPolicy();
      const start=Date.now(),connected=await inventoryProbe.connectWorkPage({},lease,null,{tabOnly:true});
      const result=await inventoryProbe.runBrowserAgent(lease.id,{...connected.page,browserContext:connected.lease.browserContext},'list_tabs',{});
      const workspace=connected.lease.browserContext.workspace;
      const observation=await inventoryProbe.runBrowserAgent(lease.id,{...connected.page,browserContext:connected.lease.browserContext},'browser_snapshot',{});
      await inventoryProbe.stopBrowserAgent(lease.id);
      return {inventory:result,tabs:result.result.tabs,expectedTabId:String(workspace.tabId),elapsedMs:Date.now()-start,sourceActive:(await chrome.tabs.get(tabId)).active,
        observationTitle:observation.result.title,observationFrameCount:observation.result.frames?.length,error:observation.result.error||null};
    },{tabId:tab.id,index:i});
    assert(result.tabs,JSON.stringify(result.inventory));assert.equal(result.tabs.length,1);assert.equal(result.tabs[0].tab_id,result.expectedTabId);assert.equal(result.tabs[0].current,true);
    assert.equal(result.tabs[0].url,'https://www.naver.com/');assert.equal(result.error,null);assert(result.observationFrameCount>0);assert.equal(result.sourceActive,true);
    trials.push(result);console.log(`PASS Naver fresh-workspace inventory/read ${i+1}/3 (${result.elapsedMs}ms)`);
  }
  await writeFile('verification/browser-30/workspace-inventory-live.json',JSON.stringify({status:'passed',actualBrowser:true,publicSite:true,actualModel:false,syntheticLease:true,trials},null,2)+'\n');
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
