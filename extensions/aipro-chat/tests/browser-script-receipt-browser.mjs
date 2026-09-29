import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,copyFile,readFile,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createReviewExecution} from '../review-execution.js';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-script-receipt-')),extension=resolve(profile,'extension');
const checks=[],errors=[];let context;
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
const fixture=`<title>Search interaction evidence</title><style>input,button{display:block;margin:15px;padding:8px}</style>
<form role="search"><label>Search<input type="search" id="query"></label><button type="submit">Search</button></form><h1 id="result">Not searched</h1>
<label>Replacement<input id="replace"></label><label>Readonly<input id="readonly" readonly></label>
<label>Redirect<input id="redirect"></label><label>Other<input id="other"></label><label>Password<input id="secret" type="password"></label>
<script>document.querySelector('form').onsubmit=e=>{e.preventDefault();result.textContent='Museum results';};
replace.oninput=()=>replace.replaceWith(replace.cloneNode(true));redirect.onfocus=()=>other.focus();</script>`;
try {
  await cp(resolve(process.env.TEST_EXTENSION||'dist'),extension,{recursive:true});
  if(process.env.TEST_SCRIPT_RECEIPT_SOURCE==='1') {
    for(const file of ['browser-agent.js','browser-keyboard.js','browser-script-receipt.js','browser-region.js'])await copyFile(file,resolve(extension,file));
    const {build}=await import('esbuild');
    await build({entryPoints:['verification-text-feedback.js'],outfile:resolve(extension,'verification-text-feedback.js'),bundle:true,platform:'browser',format:'esm',target:'chrome125'});
  }
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('https://*/*','http://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.receiptTest={runBrowserAgent,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  await appendFile(resolve(extension,'browser-agent.js'),'\nglobalThis.receiptTargetCount=()=>active?.scriptReceiptTargets?.size||0;\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('https://receipt.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>receiptTest.ready());
  const page=await context.newPage();await page.goto('https://receipt.example.test/');
  const tabId=await worker.evaluate(async()=>(await chrome.tabs.query({})).find(tab=>tab.url==='https://receipt.example.test/').id);
  let request='receipt';
  const run=async(name,args={})=>(await worker.evaluate(({request,tabId,name,args})=>receiptTest.runBrowserAgent(request,{tabId},name,args),{request,tabId,name,args})).result;
  const byId=(result,id)=>(result.observation||result).frames.flatMap(frame=>frame.elements||[]).find(element=>element.id===id);
  const script=(ref,operation)=>run('run_playwright',{code:`await browser.ref(${JSON.stringify(ref)}).${operation};`});
  const command=result=>result.execution.commands.find(command=>['fill','press'].includes(command.method));
  let snapshot=await run('browser_snapshot');
  let result=await run('run_playwright',{code:'await page.getByLabel("Search",{exact:true}).fill("museum"); return {inputReceipt:{actionIssued:true,targetStatus:"observed",allowed:true,value:"FAKE_RETURN"}};'});
  assert.equal(result.ok,true,JSON.stringify(result));const fill=command(result).inputReceipt;
  assert.equal(fill.targetStatus,'observed',JSON.stringify(result));assert.equal(fill.target.name,'Search');
  assert.equal(fill.readback.matchesExpected,true);assert.equal(fill.target.type,'search');assert(fill.target.documentId);
  assert.equal(await page.locator('#query').inputValue(),'museum');
  const ledger=createReviewExecution({taskStartObserved:true});ledger.complete(ledger.record('run_playwright'),result);
  assert(!JSON.stringify(ledger.snapshot()).includes('museum'));assert(!JSON.stringify(ledger.snapshot()).includes('FAKE_RETURN'));
  check('resolved locator fill binds the observed node and retains only digest/match, not script claims or raw value');

  snapshot=await run('browser_snapshot');result=await script(byId(snapshot,'query').ref,'press("Enter")');
  const press=command(result).inputReceipt;assert.equal(press.targetStatus,'observed',JSON.stringify(result));
  assert.equal(press.key,'Enter');assert.equal(press.actionIssued,true);assert.equal(press.target.controlId,fill.target.controlId);
  assert.equal(await page.locator('#result').innerText(),'Museum results');
  check('exact Enter issuance is attributed to the same physical input across refreshed refs; result is checked separately');

  snapshot=await run('browser_snapshot');const old=byId(snapshot,'query').ref;await run('browser_snapshot');
  result=await script(old,'fill("DO_NOT_WRITE")');assert.equal(result.actionIssued,false);assert.equal(result.reason,'browser_stale');
  assert.equal(await page.locator('#query').inputValue(),'museum');
  check('a stale ref cannot mint input proof or replay the fill');

  snapshot=await run('browser_snapshot');result=await script(byId(snapshot,'replace').ref,'fill("replacement")');
  assert.equal(command(result).inputReceipt.readback.status,'unknown',JSON.stringify(result));
  const replacedId=command(result).inputReceipt.target.controlId;
  snapshot=await run('browser_snapshot');result=await script(byId(snapshot,'replace').ref,'fill("replacement 2")');
  assert.equal(command(result).inputReceipt.readback.status,'observed');
  assert.notEqual(command(result).inputReceipt.target.controlId,replacedId);
  check('an equal-label replacement after input cannot count as same-node retained readback');

  result=await run('run_playwright',{code:'await page.getByLabel("Password",{exact:true}).fill("PRIVATE_SECRET");'});
  assert.equal(result.actionIssued,false);assert.equal(result.reason,'script_secret_field');
  assert.equal(command(result).inputReceipt,undefined);assert.equal(await page.locator('#secret').inputValue(),'');
  check('protected secret inputs are rejected before issuance without target/value certificates');

  snapshot=await run('browser_snapshot');result=await script(byId(snapshot,'redirect').ref,'press("Enter")');
  assert.equal(result.actionIssued,false);assert.equal(result.reason,'script_focus');
  assert.equal(command(result).inputReceipt.actionIssued,false);assert.equal(command(result).inputReceipt.targetStatus,'unknown');
  assert.equal(await page.locator('#other').inputValue(),'');
  check('focus redirection cannot attribute an unissued Enter to another control');

  assert((await worker.evaluate(()=>receiptTargetCount()))>0);
  const pending=run('run_playwright',{code:'await page.getByLabel("Readonly",{exact:true}).fill("MUST_NOT_WRITE");'});
  await new Promise(resolve=>setTimeout(resolve,400));await worker.evaluate(()=>receiptTest.stopBrowserAgent('receipt'));
  result=await pending;assert.equal(result.error,'cancelled');assert.equal(await page.locator('#readonly').inputValue(),'');
  assert.equal(await worker.evaluate(()=>receiptTargetCount()),0);
  check('cancellation suppresses pending fill and releases the bounded retained target registry');
  assert.deepEqual(errors,[]);
  await mkdir('verification/browser-script-receipt',{recursive:true});
  await writeFile('verification/browser-script-receipt/browser.json',JSON.stringify({actualBrowser:true,actualModel:false,syntheticSite:true,
    sourceOverlay:process.env.TEST_SCRIPT_RECEIPT_SOURCE==='1',checks,errors,rawValuesStored:false},null,2));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
