import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const baseline = process.env.NUBI_INFORMATION_BASELINE === '1';
const {collectSnapshot} = await import(baseline ? '../verification/before-page-information-20260923/generated/browser-dom.js' : '../generated/browser-dom.js');
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-information-')), extension = resolve(profile, 'extension');
const checks = [], failures = [], errors = [];
let context;
const documentHTML = `<!doctype html><html lang="ko"><title>배송 신청</title><style>body{font:16px sans-serif}td,th{padding:8px}canvas{border:1px solid}#scrollable{height:55px;overflow:auto}</style>
<main><h1>배송 신청</h1>
<form aria-label="배송 정보"><label>코드<input id="destination-code" aria-describedby="code-hint" aria-errormessage="code-error" aria-invalid="true" required minlength="6" maxlength="6" pattern="[A-Z]{6}"></label>
<p id="code-hint" hidden>배송 승인번호는 영문 대문자 6글자입니다.</p><p id="code-error">6글자를 입력하세요.</p>
<label>코드<input id="reference-code" aria-describedby="ref-hint"></label><p id="ref-hint">조회용 참조 번호</p>
<label>일반 메모<input id="memo" aria-describedby="unsafe-hint"></label><div id="unsafe-hint" hidden><input value="PRIVATE_HELP_VALUE"></div>
<label>희망 수량<input type="number" min="1" max="20" step="1"></label>
<button type="button" id="preview">미리보기</button><p role="status" id="status"></p></form>
<table><caption>배송 현황</caption><thead><tr><th>품목</th><th>수량</th><th>상태</th></tr></thead><tbody>
${Array.from({length:25},(_,i)=>`<tr><th scope="row">상품 ${i+1}</th><td>${i+11}</td><td>${i===24?'서울 배송 37건':'대기'}</td></tr>`).join('')}
<tr><td colspan="2">합산 안내</td><td><input value="PRIVATE_TABLE_VALUE"></td></tr></tbody></table>
<div role="grid" aria-label="주문 목록" aria-rowcount="1000" aria-colcount="2"><div role="row" aria-rowindex="91"><span role="rowheader" aria-colindex="1">주문91</span><span role="gridcell" aria-colindex="2">보류</span></div></div>
<div id="scrollable" role="region" aria-label="이력"><p>첫 기록</p><p>둘째 기록</p><p>셋째 기록</p></div>
<canvas aria-label="주문 차트" width="120" height="80"></canvas><img alt="배송 아이콘" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3C/svg%3E">
<div id="shadow"></div><iframe title="도움말" src="/frame"></iframe>
<div id="masked" aria-label="API token" hidden>PRIVATE_TOKEN_VALUE</div><div hidden>PRIVATE_HIDDEN_VALUE</div><script>window.log=[];document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>우편 번호<input id="postal" aria-describedby="postal-help"></label><p id="postal-help" hidden>배송 우편번호 5자리</p>';
document.querySelector('#preview').onclick=e=>{log.push({trusted:e.isTrusted});document.querySelector('#status').textContent='초안 미리보기 완료';};</script></main></html>`;
const server = createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/frame'?'<html lang="ko"><title>도움말</title><p>배송 도움말</p></html>':documentHTML);});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const origin=`http://127.0.0.1:${server.address().port}`;
async function check(name, fn) {
  try {await fn();checks.push(name);console.log(`PASS ${name}`);} catch(error) {if(!baseline) throw error;failures.push({name,error:error.message});console.log(`REPRODUCED ${name}: ${error.message.slice(0,150)}`);}
}
try {
  await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push(`${origin}/*`);await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
  let result=await page.evaluate(collectSnapshot,{query:'배송 승인번호'});
  await check('description retrieves the correct duplicate-label field and carries actual constraints',async()=>{
    const field=result.descriptors.find(d=>d.id==='destination-code');assert(field);assert.equal(result.descriptors[0].id,field.id);
    assert.equal(field.description,'배송 승인번호는 영문 대문자 6글자입니다.');assert.equal(field.validationMessage,'6글자를 입력하세요.');
    assert.deepEqual(field.constraints,{minLength:6,maxLength:6,pattern:'[A-Z]{6}'});
  });
  result=await page.evaluate(collectSnapshot,{query:'서울 배송 37건'});
  await check('table query keeps late matching row, headers and column relationships',async()=>{
    const table=result.tables.find(t=>t.name==='배송 현황');assert(table);const row=table.rows.find(r=>r.cells.some(c=>c.text==='서울 배송 37건'));assert(row);
    assert.deepEqual(row.cells.map(c=>c.text),['상품 25','35','서울 배송 37건']);assert.equal(row.index,26);assert.equal(row.cells[2].column,3);
    assert(table.rows.some(r=>r.cells.some(c=>c.text==='품목')));assert(table.omittedRows>0);assert(table.partial);
  });
  result=await page.evaluate(collectSnapshot,'');
  await check('virtual grid and visual surfaces state what was actually observed',async()=>{
    const grid=result.tables.find(t=>t.name==='주문 목록');assert.equal(grid.declaredRows,1000);assert.equal(grid.rows[0].index,91);assert(grid.partial);
    assert.equal(result.pageState.language,'ko');assert.equal(result.pageState.readyState,'complete');assert(result.pageState.viewport.height>0);
    assert.equal(result.surfaces.canvas,1);assert.equal(result.surfaces.images,1);assert.equal(result.surfaces.embeddedFrames,1);
    assert(result.surfaces.scrollContainers.some(s=>s.name==='이력'));assert(result.coverage.nodesInspected>0);
  });
  await check('sensitive fields and their help are absent from added metadata',async()=>{
    assert(!JSON.stringify(result).includes('PRIVATE_'));assert(!result.descriptors.find(d=>d.id==='memo').description);
    const postal=result.descriptors.find(d=>d.id==='postal');assert.equal(postal.description,'배송 우편번호 5자리');
  });
  if(!baseline) {
    const span=await page.evaluate(collectSnapshot,{query:'합산 안내'});
    const row=span.tables.flatMap(t=>t.rows).find(r=>r.cells.some(c=>c.text==='합산 안내'));
    assert.equal(row.cells[0].colSpan,2);assert.equal(row.cells[1].valueOmitted,true);assert.equal(row.cells[1].text,'');
    checks.push('merged table cells retain explicit spans and editable cells never expose values');
  }
  await page.evaluate(()=>{const wrapper=document.createElement('div');wrapper.hidden=true;wrapper.innerHTML='<span>숨은 이력</span>'.repeat(5500);document.body.prepend(wrapper);});
  result=await page.evaluate(collectSnapshot,{query:'미리보기'});
  await check('hidden subtrees do not consume the meaningful DOM budget',async()=>{assert(result.descriptors.some(d=>d.id==='preview'));assert(result.coverage.skippedSubtrees>0);assert.equal(result.coverage.domTruncated,false);});
  if(!baseline) {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const tabId=await worker.evaluate(async origin=>(await chrome.tabs.query({})).find(t=>t.url===origin+'/').id,origin);
    await worker.evaluate(async()=>{await testBrowserAgent.ready;globalThis.attachCount=0;const original=chrome.debugger.attach.bind(chrome.debugger);chrome.debugger.attach=(...args)=>{attachCount++;return original(...args);};});
    const run=async(name,args={})=>(await worker.evaluate(({tabId,name,args})=>testBrowserAgent.runBrowserAgent('information',{tabId},name,args),{tabId,name,args})).result;
    const initial=await run('browser_snapshot',{query:'配送'});
    assert(initial.frameCoverage,JSON.stringify({error:initial.error,reason:initial.reason}));
    assert.equal(initial.frameCoverage.inspected,2);assert.equal(initial.frameCoverage.omitted,0);assert.equal(await worker.evaluate(()=>attachCount),0);
    const snap=await run('browser_snapshot',{query:'배송 승인번호'});
    const target=snap.frames[0].elements.find(d=>d.id==='destination-code');assert(target?.ref);
    const filled=await run('fill_form',{fields:[{field_id:target.ref,value:'ABCDEF'}]});assert.equal(filled.verified,true,JSON.stringify(filled));
    const active=filled.observation.frames[0];assert(active.pageState);assert(active.tables);assert(active.coverage);assert.equal(active.elements.find(d=>d.id==='destination-code').description,target.description);
    const verification=await run('verify_page',{checks:[{kind:'field_value',ref:active.elements.find(d=>d.id==='destination-code').ref,expected:'ABCDEF'}]});assert.equal(verification.ok,true,JSON.stringify(verification));
    assert.equal(await page.locator('#reference-code').inputValue(),'');assert.deepEqual(await page.evaluate(()=>log),[]);
    checks.push('isolated content read attaches no debugger; exact ref fills only the matching field and verifies it with equivalent Playwright metadata');
    await worker.evaluate(()=>testBrowserAgent.stopBrowserAgent('information'));
    await page.evaluate(()=>{
      document.body.innerHTML='<main>'+Array.from({length:190},(_,i)=>`<label>항목 ${i}<input aria-description="${'일반 입력 도움말 '.repeat(20)}"></label>`).join('')+'</main>';
    });
    const bounded=await page.evaluate(collectSnapshot,'');assert(bounded.coverage.omittedControlDetails>0);assert.equal(bounded.descriptors.length,180);
    assert(bounded.descriptors.reduce((sum,d)=>sum+JSON.stringify({description:d.description,validationMessage:d.validationMessage,constraints:d.constraints}).length,0)<6500);
    await page.evaluate(()=>{document.body.innerHTML='<div>'+ '<span>긴 본문</span>'.repeat(5100)+'</div><button>뒤쪽 버튼</button>';});
    const limited=await page.evaluate(collectSnapshot,'');assert(limited.coverage.domTruncated);assert(limited.truncated);assert(!limited.descriptors.some(d=>d.name==='뒤쪽 버튼'));
    const focused=await page.evaluate(collectSnapshot,{query:'뒤쪽 버튼'});assert(focused.descriptors.some(d=>d.name==='뒤쪽 버튼'));assert.equal(focused.coverage.domTruncated,false);assert(focused.descriptors.length<=180);
    checks.push('control details stay bounded and a real DOM scan limit explicitly reports incomplete evidence');
    checks.push('focused retrieval reaches beyond the overview scan without increasing result limits');
    await page.evaluate(()=>{document.body.innerHTML='<table><caption>정책</caption><tr><td>'+ '일반 설명 '.repeat(200)+'추가 배송은 승인 후 진행</td></tr></table>';});
    const longCell=await page.evaluate(collectSnapshot,{query:'추가 배송 승인'});assert(longCell.tables[0].rows[0].cells[0].text.includes('추가 배송은 승인 후 진행'));assert(longCell.tables[0].rows[0].cells[0].textTruncated);assert(longCell.tables[0].partial);
    checks.push('long table-cell queries return the relevant passage with explicit truncation');
    await page.evaluate(()=>{document.body.innerHTML='<table><tr><th rowspan="0">배송</th><td>첫 행</td></tr><tr><td>둘째 행</td></tr></table><div role="grid" aria-rowcount="1e309"><div role="row"><div role="gridcell" aria-colindex="99999999999999999999999999999999999999">유한한 위치</div></div></div>';});
    const spans=await page.evaluate(collectSnapshot,'');assert.equal(spans.tables[0].rows[0].cells[0].rowSpan,0);assert.equal(spans.tables[1].rows[0].cells[0].column,1);assert.equal(spans.tables[1].declaredRows,undefined);
    checks.push('remaining-row spans stay explicit and invalid oversized ARIA indexes never become coordinates');
    await page.evaluate(async origin=>{
      document.body.replaceChildren();
      await Promise.all(Array.from({length:18},()=>new Promise(resolveLoad=>{const frame=document.createElement('iframe');frame.onload=resolveLoad;frame.src=origin+'/frame';document.body.append(frame);})));
    },origin);
    const attaches=await worker.evaluate(()=>attachCount);
    const overflow=(await worker.evaluate(tabId=>testBrowserAgent.runBrowserAgent('information-frames',{tabId},'browser_snapshot',{}),tabId)).result;
    assert.equal(overflow.frameCoverage.discovered,19);assert.equal(overflow.frameCoverage.inspected,16);assert.equal(overflow.frameCoverage.omitted,3);assert.equal(await worker.evaluate(()=>attachCount),attaches);
    await worker.evaluate(()=>testBrowserAgent.stopBrowserAgent('information-frames'));
    checks.push('accessible frame overflow is explicit and inspection remains debugger-free');
  }
  assert.deepEqual(errors,[]);await mkdir('verification',{recursive:true});
  await writeFile(`verification/page-information-${baseline?'before':'after'}.json`,JSON.stringify({checks,failures,errors,actualBrowser:true,syntheticSite:true,actualModel:false},null,2));
} finally {await context?.close();await new Promise(resolveClose=>server.close(resolveClose));await rm(profile,{recursive:true,force:true});}
