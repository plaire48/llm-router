import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {reviewEvidence} from '../goal-review.js';

// Source-only, isolated browser fixture. Does not alter generated/dist, an
// evaluation profile or the active live-model candidate.
const bundle=await build({entryPoints:['browser-dom.js'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'NubiDOM',target:'chrome125'});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY});
const checks=[];
try {
  const page=await browser.newPage();
  const html=`<main><h1>지역 정보 검색</h1>
  <section id="current"><h2>현재 카드</h2><p>서울 중구</p><p>관찰 날짜 9.27.</p><p>현재 수치 <strong>22.4</strong></p><p>오늘 최저 17 최고 28</p><p>기준 제공자 Alpha</p><input value="PRIVATE_INPUT"><textarea>PRIVATE_TEXTAREA</textarea><div contenteditable>PRIVATE_EDITOR</div><div hidden>PRIVATE_HIDDEN</div><a href="https://example.test/info?token=PRIVATE_TOKEN">안내</a></section>
  <article><h2>다른 제공자</h2><p>어제 9.26. 13시 현재 수치 28.0</p><p>최저 18 최고 28</p><p>기준 제공자 Beta</p></article>
  <section id="tomorrow"><h2>내일 카드</h2><p>9.28. 현재 수치 25 최저 18 최고 26</p></section>
  <section id="long"><h2>긴 영역</h2>${'<p>추가 원문 범위 1234567890</p>'.repeat(1200)}</section>
  <section id="parent"><h2>여러 카드를 포함한 영역</h2><div>서울 22.4</div><div>부산 25.0</div></section></main>`;
  await page.setContent(html);await page.addScriptTag({content:bundle.outputFiles[0].text});
  const collect=input=>page.evaluate(input=>{const {elements,...result}=NubiDOM.collectSnapshot(input);return result;},input);
  await mkdir('verification/browser-30',{recursive:true});
  await page.screenshot({path:'verification/browser-30/region-read-mixed-cards.png'});
  const query=await collect('현재');
  const current=query.retrieval.textRegions.find(r=>r.heading==='현재 카드');assert(current?.region_ref);
  assert(JSON.stringify(query.retrieval.textRegions).length<4000);
  const scope=await collect({region_ref:current.region_ref});
  assert.equal(scope.error,undefined);assert.equal(scope.textFiltered,false);assert.equal(scope.region_scope.read_only,true);assert.equal(scope.region_scope.region_index,current.index);
  for(const value of ['서울 중구','9.27.','22.4','최저 17','최고 28','제공자 Alpha'])assert(scope.text.includes(value),value);
  for(const value of ['28.0','최저 18','Beta','9.28.','PRIVATE_'])assert(!JSON.stringify(scope).includes(value),value);
  assert.deepEqual(scope.descriptors,[]);assert.equal(scope.coverage.controlsReturned,0);assert.equal(scope.coverage.queryFiltered,false);
  const reviewed=reviewEvidence(1,'read_page',{mode:'region',region_ref:current.region_ref},{frames:[{...scope,frame:0,documentId:'synthetic-doc'}]});
  assert.equal(reviewed.result.frames[0].textSegments.map(s=>s.text).join(''),scope.text);
  checks.push('Observed region reread keeps its exact labels/date/provider and dynamic values without mixing sibling cards or private input');
  // Reread a different region without losing the first cache or granting action refs.
  const other=query.retrieval.textRegions.find(r=>r.heading==='다른 제공자');assert(other?.region_ref);
  assert((await collect({region_ref:other.region_ref})).text.includes('28.0'));
  assert((await collect({region_ref:current.region_ref})).text.includes('22.4'));
  const actions=await collect({query:'안내',nonce:crypto.randomUUID()});
  const ref=actions.descriptors[0]?.ref;assert(ref);
  const actionRegion=actions.retrieval.textRegions.find(r=>r.heading==='현재 카드');assert(actionRegion?.region_ref);
  const beforeActionRefs=await page.evaluate(()=>[...__nubiBrowserObservationV1.refs.keys()]);
  await collect({region_ref:actionRegion.region_ref});
  assert.deepEqual(await page.evaluate(()=>[...__nubiBrowserObservationV1.refs.keys()]),beforeActionRefs);
  assert.equal((await collect({region_ref:ref})).error,'region_arguments_invalid');
  assert.equal((await collect({region_ref:current.region_ref})).error,'region_stale');
  checks.push('Region refs remain read-only, coexist for one snapshot and expire after another full observation');
  const fresh=await collect('현재'), target=fresh.retrieval.textRegions.find(r=>r.heading==='현재 카드');
  await page.locator('#current').evaluate(el=>el.replaceWith(el.cloneNode(true)));
  assert.equal((await collect({region_ref:target.region_ref})).error,'region_stale');
  const hidden=await collect('현재'), hiddenRef=hidden.retrieval.textRegions.find(r=>r.heading==='현재 카드').region_ref;
  await page.locator('#current').evaluate(el=>el.hidden=true);
  assert.equal((await collect({region_ref:hiddenRef})).error,'region_stale');
  assert.equal((await collect({region_ref:'r-00000000-0000-0000-0000-000000000000-0'})).error,'region_stale');
  checks.push('Replaced, hidden, missing and stale region nodes fail explicitly');
  const largeQuery=await collect('긴 영역'), largeRef=largeQuery.retrieval.textRegions.find(r=>r.heading==='긴 영역').region_ref;
  const large=await collect({region_ref:largeRef});assert(large.text.length<=16000);assert.equal(large.region_scope.partial,true);assert.equal(large.coverage.nodeLimit,5000);
  const broad=await collect('여러 카드를 포함한 영역'), broadRef=broad.retrieval.textRegions.find(r=>r.heading==='여러 카드를 포함한 영역').region_ref;
  const broadRead=await collect({region_ref:broadRef});assert(broadRead.text.includes('서울'));assert(broadRead.text.includes('부산'));assert.match(broadRead.region_scope.instruction,/several cards or dates/);
  checks.push('Existing 16k text and 5000-node budgets remain; truncation and multi-card interpretation limits are explicit');
  const frame=await page.evaluateHandle(()=>{const f=document.createElement('iframe');f.srcdoc='<section><h2>별도 프레임</h2><p>서울 현재 수치 999</p></section>';document.body.append(f);return f;});
  const child=await frame.asElement().contentFrame();await child.waitForLoadState();await child.addScriptTag({content:bundle.outputFiles[0].text});
  const foreign=await child.evaluate(()=>NubiDOM.collectSnapshot('현재').retrieval.textRegions[0].region_ref);
  assert.equal((await collect({region_ref:foreign})).error,'region_stale');
  checks.push('An opaque region from a different real iframe cannot be read in the main document');
  await mkdir('verification/browser-30',{recursive:true});
  await writeFile('verification/browser-30/region-read-browser.json',JSON.stringify({checks,actualBrowser:true,actualModel:false,syntheticDOM:true},null,2));
  checks.forEach(c=>console.log('PASS '+c));
}finally{await browser.close();}
