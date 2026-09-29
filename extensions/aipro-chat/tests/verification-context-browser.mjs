import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createAnalysisCoordinator} from '../analysis-agents.js';

const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<title>Verification cache</title><label>Search<input aria-label="Search"></label><h1>Cache fixture marker</h1><main>${Array.from({length:160}, (_, i) =>
    `<p><a href="/item/${i}">Source ${i}: ${'observed article context '.repeat(4)}</a></p>`).join('')}</main>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-verification-cache-')), extension = resolve(profile, 'extension');
let browser, coordinator;
try {
  await cp(resolve('dist'), extension, {recursive:true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.cacheProbe={runBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  browser = await chromium.launchPersistentContext(profile, {headless:true, executablePath:process.env.CHROME_BINARY,
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const page = await browser.newPage(); await page.goto(origin);
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await cacheProbe.ready; await chrome.storage.local.set({browserWorkMode:'current'});});
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const run = (name, args) => worker.evaluate(async ({tabId,name,args}) =>
    (await cacheProbe.runBrowserAgent('cache-probe', {tabId}, name, args)).result, {tabId,name,args});
  await run('browser_snapshot', {});
  coordinator = createAnalysisCoordinator({signal:new AbortController().signal,
    complete:async () => assert.fail('No model required to reference a retained observation'), execute:async () => assert.fail('No action replay')});
  const args = {checks:[{kind:'text_present', expected:'Cache fixture marker'}]};
  const originals = [], ids = [], wire = [{role:'user', content:'Read only. Do not change the page.'}];
  for (let i=0; i<6; i++) {
    const result = await run('verify_page', args);
    assert.equal(result.ok, true); assert.equal(result.verified, true);
    assert(JSON.stringify(result.observation).length > 2048);
    const id = coordinator.observe('verify_page', args, result); ids.push(id); originals.push(result);
    wire.push({role:'assistant', content:'', tool_calls:[{id:`check-${i}`,type:'function',function:{name:'verify_page',arguments:JSON.stringify(args)}}]},
      {role:'tool',tool_call_id:`check-${i}`,content:JSON.stringify({...result,analysis_evidence_id:id})});
  }
  const untouched = structuredClone(wire), prepared = coordinator.prepareContext(wire);
  const results = prepared.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
  for (let i=0; i<6; i++) {
    const {observation:before, ...receipt} = originals[i];
    const {observation:after, analysis_evidence_id, ...kept} = results[i];
    assert.deepEqual(kept, receipt, 'Every verification receipt field remains unchanged');
    if (i>=4) assert.deepEqual(after, before, 'Two latest observations remain complete');
    else {assert.equal(after.reason, 'cached_verification_observation'); assert.equal(after.source_path, 'result.observation');}
  }
  let offset=0, raw='';
  do {
    const packet = await coordinator.execute('read_analysis_evidence', {evidence_id:ids[0],offset});
    assert(!packet.error); raw += packet.text; offset=packet.next_offset;
  } while (offset !== null && offset !== undefined);
  assert.deepEqual(JSON.parse(raw), {input:args,result:originals[0]}, 'Full original remains retrievable by the original source ID');
  assert.deepEqual(wire, untouched);
  const before=JSON.stringify(wire).length, after=JSON.stringify(prepared).length;
  assert(after<before*.5, 'Only repeated observation payloads should account for the size reduction');
  const failureArgs={checks:[{kind:'text_present',expected:'Missing marker that is not on this page'}]};
  const failure=await run('verify_page',failureArgs);
  assert.equal(failure.error,'verification_failed');
  const snapshot=await run('browser_snapshot',{});
  const input=snapshot.frames.flatMap(frame=>frame.elements||[]).find(element=>element.kind==='field'&&element.name==='Search');assert(input);
  const keyArgs={ref:input.ref,key:'Enter'},keyResult=await run('press_key',keyArgs);
  assert.equal(keyResult.ok,true);assert.equal(keyResult.inputExecution.commands[0].inputReceipt.key,'Enter');
  const mixed=[{role:'user',content:'Inspect only. Never infer business submission from Enter.'}];
  const append=(name,result,args={})=>{
    const id=coordinator.observe(name,args,result),callId=`mixed-${mixed.length}`;
    mixed.push({role:'assistant',tool_calls:[{id:callId,type:'function',function:{name,arguments:JSON.stringify(args)}}]},
      {role:'tool',tool_call_id:callId,content:JSON.stringify({...result,analysis_evidence_id:id})});return id;
  };
  const failureId=append('verify_page',failure,failureArgs),keyId=append('press_key',keyResult,keyArgs);
  append('browser_snapshot',await run('browser_snapshot',{}));append('browser_snapshot',await run('browser_snapshot',{}));
  const mixedPrepared=coordinator.prepareContext(mixed);
  const failedPacket=JSON.parse(mixedPrepared[2].content),keyPacket=JSON.parse(mixedPrepared[4].content);
  assert.equal(failedPacket.error,'verification_failed');assert.equal(failedPacket.verified,false);
  assert.equal(failedPacket.observation.reason,'cached_failed_verification_observation');
  assert.equal(keyPacket.observation.reason,'cached_key_observation');
  for(const [index,original] of [[2,failure],[4,keyResult]]) {
    const{observation:discard,...expected}=original,{observation:locator,analysis_evidence_id,...actual}=JSON.parse(mixedPrepared[index].content);
    assert.deepEqual(actual,expected);
  }
  for(const [id,original,args] of [[failureId,failure,failureArgs],[keyId,keyResult,keyArgs]]) {
    let offset=0,text='';do{const packet=await coordinator.execute('read_analysis_evidence',{evidence_id:id,offset});text+=packet.text;offset=packet.next_offset;}while(offset!==null);
    assert.deepEqual(JSON.parse(text),JSON.parse(JSON.stringify({input:args,result:original})));
  }
  await mkdir('verification/five-task-repair-2026-09-28',{recursive:true});
  await writeFile('verification/five-task-repair-2026-09-28/context-cache-browser-i.json',JSON.stringify({actualBrowser:true,actualModel:false,
    syntheticSite:true,failedCheckStillFailed:true,keyReceiptPreserved:true,originalsReadBack:true,
    beforeCharacters:JSON.stringify(mixed).length,afterCharacters:JSON.stringify(mixedPrepared).length},null,2));
  await mkdir('verification/browser-30', {recursive:true});
  await writeFile('verification/browser-30/verification-context-browser.json', JSON.stringify({actualBrowser:true,actualModel:false,
    syntheticSite:true,verifiedReads:6,olderObservationReferences:4,latestFullObservations:2,receiptFieldsUnchanged:true,
    originalSourceReadback:true,rawCharacters:before,preparedCharacters:after,modelCalls:0},null,2));
  console.log('PASS real Chrome verification receipts survive cached observation references and exact original-source readback');
} finally {coordinator?.dispose(); await browser?.close(); server.close(); await rm(profile,{recursive:true,force:true});}
