import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-policy-wait-')), extension=resolve(profile,'extension');
const checks=[]; let context;
const server=createServer((_,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Policy checked</h1>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
const check=label=>{checks.push(label);console.log(`PASS ${label}`);};
try {
  await cp(resolve(process.env.TEST_EXTENSION||'dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*','https://127.0.0.1/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  const background=resolve(extension,manifest.background.service_worker);
  // Only the Chrome policy provider is synthetic; boot, queue, policy reader,
  // browser tool and UI state use the production extension implementation.
  const setup=`globalThis.policyFixture={calls:0,settled:false,started:Date.now()};
const policyFixturePending=new Promise(resolve=>{policyFixture.release=()=>{policyFixture.settled=true;resolve({});};});
chrome.storage.managed.get=()=>{policyFixture.calls++;return policyFixture.settled?Promise.resolve({}):policyFixturePending;};\n`;
  const probe=`\nimport {browserPolicySnapshot as policySnapshot,refreshBrowserPolicy as policyRefresh} from './browser-policy.js';
import {runBrowserAgent as policyRun} from './browser-agent.js';
globalThis.policyProbe={ready:()=>serial(()=>{}),snapshot:policySnapshot,refresh:policyRefresh,run:policyRun,
  createWorkspace,connectWorkPage,rememberBrowserContext,refreshWorkConnection,stopBrowserAgent};\n`;
  await writeFile(background,setup+await readFile(background,'utf8')+probe);
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const wait=await worker.evaluate(async()=>{await policyProbe.ready();return {elapsed:Date.now()-policyFixture.started,policy:policyProbe.snapshot(),calls:policyFixture.calls};});
  assert(wait.elapsed>=4500&&wait.elapsed<8000,JSON.stringify(wait));
  assert.equal(wait.policy.invalid,true);assert.equal(wait.calls,1);
  check('production boot responds after its five-second policy wait while unresolved automation remains blocked');
  const ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const uiState=await ui.evaluate(async()=>chrome.runtime.sendMessage({type:'GET_STATE'}));
  assert.equal(uiState.ok,true);assert(uiState.data.chat.sessionId);
  const settings=await ui.evaluate(async()=>chrome.runtime.sendMessage({type:'GET_BROWSER_ROUTINES'}));
  assert.equal(settings.ok,true);assert.equal(settings.data.policy.invalid,true);assert.equal(settings.data.policy.AutomationEnabled,false);
  const page=await context.newPage();await page.goto(origin);
  const tabId=await worker.evaluate(async origin=>(await chrome.tabs.query({})).find(tab=>tab.url===origin+'/').id,origin);
  const denied=await worker.evaluate(async tabId=>(await policyProbe.run('policy-pending',{tabId},'browser_snapshot')).result,tabId);
  assert.equal(denied.error,'browser_policy_invalid');
  const repeated=await worker.evaluate(async()=>{await Promise.all(Array.from({length:20},()=>policyProbe.refresh()));return policyFixture.calls;});
  assert.equal(repeated,1);
  check('UI state remains readable and actual browser tools fail closed without accumulating managed API calls');
  const recovered=await worker.evaluate(async()=>{policyFixture.release();for(let i=0;i<10;i++)await Promise.resolve();return {policy:policyProbe.snapshot(),calls:policyFixture.calls};});
  assert.deepEqual(recovered.policy,{});assert.equal(recovered.calls,1);
  const observed=await worker.evaluate(async tabId=>(await policyProbe.run('policy-recovered',{tabId},'browser_snapshot')).result,tabId);
  assert(!observed.error,JSON.stringify(observed));
  assert(JSON.stringify(observed).includes('Policy checked'));
  check('a late valid response restores current policy and the next tool succeeds only after a fresh confirmed read');
  // An owned error document cannot be scripted, but that must not prevent
  // discovering and switching back to an already-owned, healthy document.
  const fixture=await worker.evaluate(async tabId=>{
    await policyProbe.stopBrowserAgent();
    const source=await chrome.tabs.get(tabId),owner=(await chrome.runtime.getContexts({contextTypes:['TAB']})).find(c=>c.documentUrl===chrome.runtime.getURL('index.html'));
    const binding={conversationId:'policy-tab-recovery',provider:'chatgpt',credentialReceivedAt:1};
    const workspace=await policyProbe.createWorkspace(source,binding);
    const lease={id:'policy-tab-recovery-run',...binding,browserWorkMode:'window',automation:true,autoConnect:true,
      documentId:owner.documentId,clientId:'policy-tab-owner',tabId:owner.tabId,until:Date.now()+660000,lastSeenAt:Date.now(),
      toolNames:['list_tabs','switch_tab','navigate_page','browser_snapshot'],pageTargetTabId:workspace.tabId,browserContext:{tabId:workspace.tabId,workspace}};
    await chrome.storage.session.set({chatLease:lease,credential:{provider:'chatgpt',receivedAt:1},browserWorkspaces:{[binding.conversationId]:workspace}});
    const connected=await policyProbe.connectWorkPage({},lease,null);
    // A run's first navigate_page is held until the connected page has been
    // observed (browser-agent.js). Observe it first, as the model must.
    const observedFirst=await policyProbe.run(lease.id,{...connected.page,browserContext:connected.lease.browserContext},'browser_snapshot');
    if(observedFirst.result?.error)throw new Error(JSON.stringify(observedFirst.result));
    const navigation=await policyProbe.run(lease.id,{...connected.page,browserContext:connected.lease.browserContext},'navigate_page',{url:'https://127.0.0.1:9/news',new_tab:'yes'});
    if(navigation.result?.yielded || navigation.tabId===connected.page.tabId)throw new Error(`error tab was not opened: ${JSON.stringify(navigation.result)}`);
    await policyProbe.rememberBrowserContext(connected.lease);
    await policyProbe.refreshWorkConnection(connected.page,navigation.tabId);
    const stored=await chrome.storage.session.get(['page','browserWorkspaces']);
    // Match the resumed request's owned context, as the next host tool does.
    await chrome.storage.session.set({chatLease:{...connected.lease,browserContext:{tabId:navigation.tabId,workspace:stored.browserWorkspaces[binding.conversationId]}}});
    let documentError;try {await policyProbe.connectWorkPage({},(await chrome.storage.session.get('chatLease')).chatLease,stored.page);}catch(error){documentError=error.message;}
    return {sourceTabId:tabId,workTabId:connected.page.tabId,errorTabId:navigation.tabId,priorPage:stored.page,documentError};
  },tabId);
  assert.equal(fixture.documentError,'page_permission');
  const tool=(name,args={})=>ui.evaluate(({name,args})=>chrome.runtime.sendMessage({type:'RUN_TOOL',requestId:'policy-tab-recovery-run',clientId:'policy-tab-owner',name,args}),{name,args});
  const inventory=await tool('list_tabs');assert.equal(inventory.ok,true,JSON.stringify(inventory));
  assert.deepEqual(inventory.data.tabs.map(tab=>Number(tab.tab_id)).sort(),[fixture.workTabId,fixture.errorTabId].sort());
  const inventoryPage=await worker.evaluate(async()=> (await chrome.storage.session.get('page')).page);
  assert.deepEqual(inventoryPage,fixture.priorPage);
  assert(!inventoryPage.metadataOnly);
  const unrelated=await tool('switch_tab',{tab_id:String(fixture.sourceTabId)});
  assert.equal(unrelated.data.error,'browser_stale');
  const stillBlocked=await tool('browser_snapshot');assert.equal(stillBlocked.ok,false);assert.equal(stillBlocked.error,'page_permission');
  check('owned error-page inventory is readable without replacing its last observed document or admitting unrelated tabs');
  await worker.evaluate(async()=>chrome.storage.local.set({chat:{sessionId:'policy-tab-recovery',provider:'chatgpt',messages:[],task:{requestId:'policy-tab-recovery-run',pendingReconciliation:{version:2,unverifiable:true}}}}));
  const uncertain=await tool('switch_tab',{tab_id:String(fixture.workTabId)});
  assert.equal(uncertain.data.error,'action_outcome_unknown');assert.equal(uncertain.data.actionIssued,false);
  await worker.evaluate(async()=>{const {chat}=await chrome.storage.local.get('chat');delete chat.task.pendingReconciliation;await chrome.storage.local.set({chat});});
  const switched=await tool('switch_tab',{tab_id:String(fixture.workTabId)});assert.equal(switched.ok,true);assert.equal(switched.data.ok,true,JSON.stringify(switched));
  const fresh=await tool('browser_snapshot');assert.equal(fresh.ok,true);assert(JSON.stringify(fresh.data).includes('Policy checked'));
  const refreshedPage=await worker.evaluate(async()=> (await chrome.storage.session.get('page')).page);
  assert.equal(refreshedPage.tabId,fixture.workTabId);assert(refreshedPage.documentId);assert(!refreshedPage.metadataOnly);
  check('uncertain writes still block switching and an allowed owned-tab switch reconnects its actual healthy document');
  // Recover an owned error document in place, without opening another tab.
  const erroredAgain=await tool('switch_tab',{tab_id:String(fixture.errorTabId)});
  const countBefore=await worker.evaluate(async()=> (await chrome.tabs.query({})).length);
  const navigated=await tool('navigate_page',{url:origin+'/recovered'});
  assert.equal(navigated.ok,true,JSON.stringify(navigated));assert.equal(navigated.data.ok,true,JSON.stringify(navigated));
  const recoveredDocument=await tool('browser_snapshot');assert(JSON.stringify(recoveredDocument).includes('Policy checked'));
  assert.equal(await worker.evaluate(async()=> (await chrome.tabs.query({})).length),countBefore);
  const connectedAgain=await worker.evaluate(async()=> (await chrome.storage.session.get('page')).page);
  assert.equal(connectedAgain.tabId,fixture.errorTabId);assert(connectedAgain.documentId);assert(!connectedAgain.metadataOnly);
  check('owned error document navigates to an allowed source in the same tab and rebinds fresh DOM without cloning tabs');
  await worker.evaluate(()=>{chrome.storage.managed.get=async()=>({AutomationEnabled:false});});
  const policyBlocked=await tool('list_tabs');assert.equal(policyBlocked.ok,false);assert.equal(policyBlocked.error,'browser_policy_blocked');
  check('metadata recovery preserves the managed automation ceiling');
  await mkdir('verification/browser-policy',{recursive:true});
  await writeFile('verification/browser-policy/browser.json',JSON.stringify({checks,actualBrowser:true,syntheticPolicy:true,actualModel:false,bootWaitMs:wait.elapsed},null,2));
} finally {await context?.close();server.closeAllConnections();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true});}
