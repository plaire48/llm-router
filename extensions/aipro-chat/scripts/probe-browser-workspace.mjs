// Local synthetic reproduction. Never opens a personal browser profile.
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-focus-probe-'));let context;
try {
  const extension=resolve(profile,'extension');await cp('dist',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('https://*.example.test/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.workspaceProbe={runBrowserAgent,stopBrowserAgent,serial};\n');
  context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
  await context.route('https://*.example.test/**',r=>r.fulfill({contentType:'text/html',body:'<title>Probe</title><button onclick="window.clicks=(window.clicks||0)+1">Choose</button><input aria-label="User work">'}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const target=await context.newPage();await target.goto('https://agent.example.test/');
  const user=await context.newPage();await user.goto('https://user.example.test/');
  const tabId=await worker.evaluate(async()=>(await chrome.tabs.query({})).find(t=>t.url==='https://agent.example.test/').id);
  const snapshot=await worker.evaluate(tabId=>workspaceProbe.runBrowserAgent('probe',{tabId},'browser_snapshot'),tabId);
  const ref=snapshot.result.frames.flatMap(f=>f.elements||[]).find(e=>e.name==='Choose').ref;
  await user.bringToFront();
  const before=await worker.evaluate(async()=>(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.url);
  const receipt=await worker.evaluate(({tabId,ref})=>workspaceProbe.runBrowserAgent('probe',{tabId},'click_element',{ref}),{tabId,ref});
  const after=await worker.evaluate(async()=>(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.url);
  await worker.evaluate(()=>workspaceProbe.stopBrowserAgent('probe'));
  const report={actualBrowser:true,actualModel:false,before,after,receipt:receipt.result,actualClicks:await target.evaluate(()=>window.clicks||0)};
  console.log(JSON.stringify(report,null,2));await writeFile('verification/workspace-focus-before.json',JSON.stringify(report,null,2));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
