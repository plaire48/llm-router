import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,copyFile,readFile,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createReviewExecution} from '../review-execution.js';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-semantic-receipt-')),extension=resolve(profile,'extension');
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
  const fillArgs={fields:[{field_id:byId(snapshot,'query').ref,value:'museum'}]};
  let result=await run('fill_form',fillArgs);
  assert.equal(result.verified,true,JSON.stringify(result));
  const fill=result.inputExecution.commands[0].inputReceipt;
  assert.equal(fill.targetStatus,'observed',JSON.stringify(result));assert.equal(fill.target.name,'Search');
  assert.equal(fill.readback.matchesExpected,true);assert.equal(await page.locator('#query').inputValue(),'museum');
  const ledger=createReviewExecution({taskStartObserved:true}),fillId=ledger.record('fill_form');ledger.complete(fillId,result);
  assert(await ledger.bindInputArguments(fillId,fillArgs));assert(!JSON.stringify(ledger.snapshot()).includes('museum'));
  assert.equal(ledger.reviewSnapshot().historicalInputValues[0].value,'museum');
  check('semantic fill uses actual DOM readback and binds its original value only in the in-run review view');

  snapshot=await run('browser_snapshot');result=await run('press_key',{ref:byId(snapshot,'query').ref,key:'Enter'});
  const press=result.inputExecution.commands[0].inputReceipt;
  assert.equal(press.targetStatus,'observed',JSON.stringify(result));assert.equal(press.target.controlId,fill.target.controlId);
  assert.equal(press.key,'Enter');assert.equal(press.actionIssued,true);assert.equal(press.readback,undefined);
  assert.equal(await page.locator('#result').innerText(),'Museum results');
  check('Enter dispatch uses the same historical control across refreshed refs; result success is checked separately');

  snapshot=await run('browser_snapshot');const old=byId(snapshot,'query').ref;await run('browser_snapshot');
  result=await run('fill_form',{fields:[{field_id:old,value:'DO_NOT_WRITE'}]});
  assert.equal(result.actionIssued,false);assert.equal(result.reason,'browser_stale');assert.equal(result.inputExecution.commands.length,0);
  assert.equal(await page.locator('#query').inputValue(),'museum');
  check('stale semantic refs fail without input dispatch or a fabricated receipt');

  snapshot=await run('browser_snapshot');const replacement={fields:[{field_id:byId(snapshot,'replace').ref,value:'replacement'}]};
  result=await run('fill_form',replacement);
  assert.equal(result.inputExecution.commands[0].inputReceipt.readback.status,'unknown',JSON.stringify(result));
  const replacementId=ledger.record('fill_form');ledger.complete(replacementId,result);
  assert.equal(await ledger.bindInputArguments(replacementId,replacement),false);
  check('same-label DOM replacement cannot certify historical input or retain its argument in review');

  snapshot=await run('browser_snapshot');result=await run('press_key',{ref:byId(snapshot,'redirect').ref,key:'Enter'});
  assert.equal(result.actionIssued,false);assert.equal(result.reason,'script_focus');
  assert.equal(result.inputExecution.commands[0].inputReceipt.targetStatus,'unknown');
  check('focus redirection preserves a not-issued receipt and never reports a successful Enter');

  snapshot=await run('browser_snapshot');const protectedRef=byId(snapshot,'query').ref;
  await page.locator('#query').evaluate(node=>{node.type='password';});
  result=await run('fill_form',{fields:[{field_id:protectedRef,value:'DO_NOT_STORE_SECRET'}]});
  assert.equal(result.actionIssued,false);assert.equal(result.inputExecution.commands.length,0);
  assert.equal(await page.locator('#query').inputValue(),'museum');
  assert(!JSON.stringify(result).includes('DO_NOT_STORE_SECRET'));
  await page.locator('#query').evaluate(node=>{node.type='search';});
  check('a previously observed input that becomes protected cannot issue a semantic fill or retain private text');

  snapshot=await run('browser_snapshot');const first=byId(snapshot,'query').ref,second=byId(snapshot,'readonly').ref;
  const partialArgs={fields:[{field_id:first,value:'first retained'},{field_id:second,value:'MUST_NOT_WRITE'}]};
  const pending=run('fill_form',partialArgs);
  await page.locator('#query').evaluate(node=>new Promise(resolve=>{if(node.value==='first retained')return resolve();const poll=setInterval(()=>{if(node.value==='first retained'){clearInterval(poll);resolve();}},10);}));
  await new Promise(resolve=>setTimeout(resolve,300));await worker.evaluate(()=>receiptTest.stopBrowserAgent('receipt'));
  result=await pending;assert.equal(result.error,'cancelled');assert.equal(await page.locator('#readonly').inputValue(),'');
  const partialId=ledger.record('fill_form');ledger.complete(partialId,result);assert.equal(await ledger.bindInputArguments(partialId,partialArgs),false);
  assert.equal(ledger.reviewSnapshot().historicalInputValues.length,1);
  assert.equal(await worker.evaluate(()=>receiptTargetCount()),0);
  check('cancelled partial forms retain uncertainty and never promote an earlier successful field to full-form proof');
  assert.deepEqual(errors,[]);
  await mkdir('verification/semantic-input-receipt',{recursive:true});
  await writeFile('verification/semantic-input-receipt/browser.json',JSON.stringify({actualBrowser:true,actualModel:false,syntheticSite:true,
    sourceOverlay:process.env.TEST_SCRIPT_RECEIPT_SOURCE==='1',checks,errors,rawValuesStored:false},null,2));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
