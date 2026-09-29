import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,appendFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

// Run only after the coordinator builds the candidate. Copies dist into a
// disposable profile; never touches a real evaluation profile or credentials.
const profile=await mkdtemp(resolve(tmpdir(),'nubi-region-extension-')),extension=resolve(profile,'extension');
const checks=[];let context;
try {
  await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('https://region.example.test/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.regionProbe={runBrowserAgent,ready:()=>serial(()=>{})};\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route('https://region.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:route.request().url().endsWith('/child')?
    '<section><h2>Frame card</h2><p>Frame date Today current 99 low 88 high 100</p><input value="PRIVATE_CHILD"></section>':
    '<main><section><h2>Current card</h2><p>Seoul Today current 22.4 low 17 high 28 Provider Alpha</p><input value="PRIVATE_INPUT"><textarea>PRIVATE_TEXTAREA</textarea><div contenteditable>PRIVATE_EDITOR</div><div hidden>PRIVATE_HIDDEN</div><button>Unused action</button></section><article><h2>Other card</h2><p>Yesterday current 28.0 low 18 Provider Beta</p></article><iframe title="Region frame" src="/child"></iframe></main><script>window.actions=0;document.addEventListener("click",()=>actions++);document.addEventListener("input",()=>actions++);</script>'}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await regionProbe.ready();await chrome.storage.local.set({browserWorkMode:'current'});globalThis.attachCount=0;const attach=chrome.debugger.attach.bind(chrome.debugger);chrome.debugger.attach=(...args)=>{attachCount++;return attach(...args);};});
  const page=await context.newPage();await page.goto('https://region.example.test/');await page.frameLocator('iframe').getByText('Frame date').waitFor();
  const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url==='https://region.example.test/').id);
  const run=(name,args={})=>worker.evaluate(async({tabId,name,args})=>(await regionProbe.runBrowserAgent('region-probe',{tabId},name,args)).result,{tabId,name,args});
  const refFor=(snapshot,heading)=>{for(const frame of snapshot.frames||[])for(const region of frame.retrieval?.textRegions||[])if(region.heading===heading)return {ref:region.region_ref,index:region.index,documentId:frame.documentId};throw Error('Missing observed region '+heading);};
  const checkRead=async(snapshot,heading,include,exclude)=>{
    const selected=refFor(snapshot,heading),result=await run('read_page',{mode:'region',region_ref:selected.ref});
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.frames.length,1);assert.equal(result.frames[0].documentId,selected.documentId);
    assert.equal(result.region_scope.region_index,selected.index);assert.equal(result.region_scope.read_only,true);
    for(const text of include)assert(result.frames[0].text.includes(text),text);
    for(const text of [...exclude,'PRIVATE_'])assert(!JSON.stringify(result).includes(text),text);
    assert.deepEqual(result.frames[0].elements,[]);assert.equal(result.frames[0].coverage.controlsReturned,0);
    return selected.ref;
  };
  let snapshot=await run('read_page',{});
  await checkRead(snapshot,'Current card',['Today','22.4','low 17','Alpha'],['28.0','Beta','Frame date']);
  await checkRead(snapshot,'Frame card',['Frame date','99','low 88'],['22.4','Beta']);
  assert.equal(await worker.evaluate(()=>attachCount),0);
  checks.push('Actual extension scripting region reads preserve top/iframe document scope with no debugger or actions');
  const attached=await run('run_playwright',{code:'return await browser.snapshot();'});
  assert.equal(attached.ok,true,JSON.stringify(attached));snapshot=attached.observation;
  assert(await worker.evaluate(()=>attachCount)>0);
  const oldRef=await checkRead(snapshot,'Current card',['Today','22.4','low 17','Alpha'],['28.0','Beta']);
  await checkRead(snapshot,'Frame card',['Frame date','99'],['22.4','Beta']);
  assert.equal(await page.evaluate(()=>actions),0);
  checks.push('Attached Playwright path rereads observed regions without granting action refs or exposing field values');
  await page.goto('https://region.example.test/next');
  const stale=await run('read_page',{mode:'region',region_ref:oldRef});
  assert.notEqual(stale.ok,true);assert.match(String(stale.error),/region_stale|browser_stale/);
  assert.equal(await page.evaluate(()=>actions),0);
  checks.push('Navigation invalidates a previously observed region instead of silently reading another document');
  await mkdir('verification/browser-30',{recursive:true});
  await writeFile('verification/browser-30/region-extension-browser.json',JSON.stringify({checks,actualBrowser:true,actualModel:false,syntheticSite:true,actions:0},null,2));
  checks.forEach(check=>console.log('PASS '+check));
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
