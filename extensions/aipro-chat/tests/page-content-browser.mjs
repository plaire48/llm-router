import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-content-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], network = [];
let context;
const paragraphs = Array.from({length: 30}, (_, i) => `<section><h2>검토 절차 ${i + 1}</h2><p>${'요청한 변경 범위와 실제 화면 결과를 비교하며 기록합니다. '.repeat(15)}</p></section>`).join('');
const html = `<!doctype html><html lang="ko"><title>배포 기준 안내</title><style>.private{display:none}</style><body>
<nav>${Array.from({length: 1200}, (_, i) => `<a href="/menu/${i}">관련없는 메뉴 ${i} 탐색 메뉴</a>`).join('')}</nav>
<main><h1>배포 기준 안내</h1><p>확인한 결과를 바탕으로 초안을 작성합니다.</p>${paragraphs}
<h2>정기배포 승인</h2><p>정기배포 승인 담당자는 품질팀입니다. 승인 전 배포하지 않습니다.</p>
<table><thead><tr><th>환경</th><th>시간</th></tr></thead><tbody><tr><td>검증</td><td>14시</td></tr><tr><td>운영</td><td>18시</td></tr></tbody></table>
<h2>실행 예제</h2><pre><code>const target = "staging";\nconsole.log(target);</code></pre>
<p><a href="/guide?access_token=PRIVATE_URL#SECRET">세부 기준</a></p><ul><li>검증 결과 확인</li><li>사용자 승인</li></ul>
<div class="private">PRIVATE_HIDDEN</div><details><summary>접힌 내용</summary><p>PRIVATE_COLLAPSED</p></details>
<div contenteditable="true">PRIVATE_DRAFT</div><input value="PRIVATE_FIELD"><p aria-hidden="true">PRIVATE_ARIA</p>
<div aria-label="API token">PRIVATE_TOKEN_VALUE</div>
<div id="shadow"></div><iframe title="별도 안내" src="/frame"></iframe></main>
<label>초안<textarea id="draft"></textarea></label><button type="button" id="preview">미리보기</button><output id="result"></output>
<script>window.events=[];shadow.attachShadow({mode:'open'}).innerHTML='<p>SHADOW_REFERENCE</p>';document.querySelector('#preview').onclick=e=>{events.push(e.isTrusted);document.querySelector('#result').textContent='초안 확인: '+document.querySelector('#draft').value;};</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8');res.end(req.url === '/frame' ? '<main><h1>별도 안내</h1><p>프레임 검토자는 운영팀입니다.</p></main>' : html);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const check = label => {checks.push(label);console.log('PASS ' + label);};
try {
  await mkdir('verification/browser-source-quality', {recursive: true});await cp('dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  context.on('request', req => {if (/^https?:/.test(req.url())) network.push(req.url());});
  const page = await context.newPage();page.on('pageerror', e => errors.push(e.message));await page.goto(origin);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready;await chrome.storage.local.set({browserWorkMode:'current'});globalThis.attaches=0;const attach=chrome.debugger.attach.bind(chrome.debugger);chrome.debugger.attach=(...args)=>{attaches++;return attach(...args);};});
  const tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === origin + '/').id, origin);
  const run = async (name, args = {}) => (await worker.evaluate(({tabId,name,args}) => contentTest.runBrowserAgent('content-reader', {tabId}, name, args), {tabId,name,args})).result;
  const original = await page.content();
  // Reproduce the missing late body fact with the unchanged overview reader.
  const overview = await run('browser_snapshot');assert(overview.frames, JSON.stringify(overview));
  assert(!overview.frames[0].text.includes('정기배포 승인 담당자는 품질팀'));assert(overview.frames[0].truncated);
  const first = await run('read_page', {mode:'content'});assert.equal(first.ok,true,JSON.stringify(first));
  assert.equal(first.method,'main_landmark');assert(first.ranges[0].markdown.startsWith('# 배포 기준 안내'));
  const ranges = [...first.ranges];let next=first.next_offset;
  while(next!==null) {assert(ranges.length<20);const part=await run('read_page',{mode:'content',offset:next,content_hash:first.content_hash});assert.equal(part.ok,true,JSON.stringify(part));ranges.push(...part.ranges);next=part.next_offset;}
  const full=ranges.map(r=>r.markdown).join('\n');
  assert.match(full,/정기배포 승인 담당자는 품질팀/);assert.match(full,/\| 환경 \| 시간 \|/);assert.match(full,/const target = "staging";\nconsole.log\(target\);/);
  assert(full.includes(`[세부 기준](${origin}/guide)`));assert(!full.includes('PRIVATE_'));assert(!full.includes('메뉴 100'));
  assert(!full.includes('<table'));assert(first.coverage.partial);assert.equal(first.coverage.embeddedFrames,1);assert.equal(first.coverage.shadowRoots,1);
  const withoutPointer = await page.evaluate(() => {const clone=document.documentElement.cloneNode(true);clone.querySelectorAll(':scope > nubi-action-pointer').forEach(node=>node.remove());return '<!DOCTYPE html>'+clone.outerHTML;});
  assert.equal(withoutPointer,original);
  assert.equal(await page.locator('nubi-action-pointer').count(),1);
  assert.equal(await page.locator('nubi-action-pointer').evaluate(node=>getComputedStyle(node).pointerEvents),'none');assert.equal(await worker.evaluate(()=>attaches),0);
  check('late policy fact missing from overview is recovered as paged Markdown, preserving table/code/link structure without modifying the page or attaching debugger');
  const focused=await run('read_page',{mode:'content',query:'정기배포 승인 담당자'});assert.equal(focused.ok,true);assert.match(focused.ranges[0].markdown,/품질팀/);assert(focused.queryFiltered);assert(focused.ranges[0].markdown.length<=5000);
  const absent=await run('read_page',{mode:'content',query:'없는항목없는항목'});assert.equal(absent.ranges.length,0);assert(absent.coverage.partial);
  const frame=await run('read_page',{mode:'content',frame:1});assert.match(frame.ranges[0].markdown,/운영팀/);assert.equal(frame.frame,1);
  assert.equal((await run('read_page',{mode:'content',offset:100})).error,'tool_arguments_invalid');
  assert.equal((await run('read_page',{mode:'content',offset:-1})).error,'tool_arguments_invalid');
  await page.locator('main h1').evaluate(el=>el.textContent='배포 기준 개정');
  assert.equal((await run('read_page',{mode:'content',offset:first.next_offset,content_hash:first.content_hash})).error,'browser_content_changed');
  check('focused lookup and explicit frame reads report partial coverage, and continuing an old source after mutation is rejected');
  const readCheck=await run('verify_page',{checks:[{kind:'text_present',expected:'정기배포 승인 담당자는 품질팀입니다.'}]});assert.equal(readCheck.verified,true,JSON.stringify(readCheck.checks));
  const hiddenCheck=await run('verify_page',{checks:['PRIVATE_HIDDEN','PRIVATE_FIELD','PRIVATE_DRAFT','PRIVATE_COLLAPSED','PRIVATE_TOKEN_VALUE','존재하지 않는 완료 결과'].map(expected=>({kind:'text_present',expected}))});
  assert.equal(hiddenCheck.verified,false);assert(hiddenCheck.checks.every(check=>check.passed===false),JSON.stringify(hiddenCheck.checks));assert.equal(await worker.evaluate(()=>attaches),0);
  check('fresh text verification reaches late page content without debugger and rejects hidden, collapsed, editor, input and absent text');
  const snap=await run('browser_snapshot',{query:'초안'}), draft=snap.frames[0].elements.find(el=>el.id==='draft');assert(draft?.ref);
  await run('read_page',{mode:'content',query:'정기배포 승인 담당자'});
  const fill=await run('fill_form',{fields:[{field_id:draft.ref,value:'정기배포 승인 담당자는 품질팀입니다.'}]});assert.equal(fill.verified,true,JSON.stringify(fill));
  const preview=fill.observation.frames[0].elements.find(el=>el.id==='preview');assert(preview?.ref);
  const click=await run('click_element',{ref:preview.ref});assert(!click.error,JSON.stringify(click));
  const verify=await run('verify_page',{checks:[{kind:'text_present',expected:'초안 확인: 정기배포 승인 담당자는 품질팀입니다.'}]});assert.equal(verify.verified,true,JSON.stringify(verify.checks));
  assert.deepEqual(await page.evaluate(()=>events),[true]);
  check('content read preserves a previously observed live ref; source-driven draft entry, a single trusted preview click and fresh verification succeed');
  await page.setContent('<article><h1>업무 안내</h1>'+Array.from({length:8},()=>'<p>'+ '문서에 있는 업무 절차와 실제 실행을 비교합니다. '.repeat(15)+'</p>').join('')+'</article>');
  const article=await run('read_page',{mode:'content'});assert.equal(article.method,'readability',JSON.stringify(article));
  // Measured on a library's weekly-hours page without a main landmark: reading
  // mode took a language widget or a note box and dropped every timetable.
  const cells=(a,b,c)=>`<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;
  const menus=Array.from({length:7},(_,i)=>`<div class="gnb_2depth_each"><dl><dt>메뉴 ${i}</dt>${Array.from({length:6},(_,j)=>`<dd><a href="/m/${i}/${j}">하위 메뉴 ${i}-${j} 안내 페이지</a></dd>`).join('')}</dl></div>`).join('');
  const languages=Array.from({length:6},(_,i)=>`<div class="language-contents">${'세계 여러 나라의 언어로 도서관 이용 안내를 제공합니다. '.repeat(4)}${i}</div>`).join('');
  await page.setContent(`<div id="header"><div class="gnb">${menus}</div></div><div id="container"><div id="content"><div class="sub_lnb_wrap"><nav><ul><li><a href="/a">이용안내</a></li></ul></nav></div>
<div id="sub_content"><h2>주간이용</h2><div class="main_building_hours"><ul class="dot_list"><li>이용 대상: 만 16세 이상 누구나 이용할 수 있으며 처음 이용할 때는 이용증을 발급받습니다.</li></ul>
<div class="hours_use_table"><table><caption>본관 자료실 이용시간</caption><tbody>${cells('인문과학자료실','평일 09:00~21:00','주말 09:00~18:00')}${cells('디지털도서관','평일 09:00~21:00','주말 09:00~18:00')}${cells('고문헌실','평일 09:00~18:00','주말 휴실')}</tbody></table></div>
<div class="use_materials_table"><table><tbody>${cells('정기간행물','평일 09:00~18:00','주말 09:00~17:00')}${cells('지도자료','평일 09:00~18:00','주말 휴실')}</tbody></table></div>
<div class="txt"><div>※ 보존용 자료는 평일이용은 자료 당일 신청, 주말이용은 금요일에 주말예약 후 이용할 수 있습니다.</div><div>※ 자료 복사는 해당 자료실 안에 있는 복사실에서 할 수 있습니다.</div><div>※ 소장자료는 도서관 안에서만 이용할 수 있습니다.</div></div>
<div class="ask_table"><table><tbody>${cells('문의','인문과학자료실','02-000-0000')}${cells('문의','디지털도서관','02-000-0001')}</tbody></table></div></div></div></div></div>
<div class="worldword-wrap"><div class="worldword"><ul class="language"><li>한국어</li></ul>${languages}</div></div>`);
  const hours=await run('read_page',{mode:'content'}),hoursText=hours.ranges.map(r=>r.markdown).join('');
  assert.equal(hours.method,'table_region',JSON.stringify({method:hours.method,characters:hours.characters}));
  assert.match(hoursText,/디지털도서관 \| 평일 09:00~21:00 \| 주말 09:00~18:00/);assert.match(hoursText,/지도자료 \| 평일 09:00~18:00 \| 주말 휴실/);
  assert.match(hoursText,/보존용 자료/);assert.doesNotMatch(hoursText,/하위 메뉴/);
  // A short news item beside a statistics table: the item that reading mode
  // chose is kept, and the table is read with it.
  await page.setContent('<div id="top">'+menus+'</div><div class="wrap"><div class="news"><h1>도서관 소식</h1><p>'+'새 자료실이 다음 달 문을 엽니다. 이용 시간은 평일 저녁까지 늘어납니다. '.repeat(5)+'</p></div><div class="side"><table><tr><td>방문자</td><td>1,200명</td></tr><tr><td>대출</td><td>830건</td></tr></table></div></div>');
  const brief=await run('read_page',{mode:'content'}),briefText=brief.ranges.map(r=>r.markdown).join('');
  assert.match(briefText,/새 자료실이 다음 달 문을 엽니다/);
  if(brief.method==='table_region')assert.match(briefText,/방문자 \| 1,200명/);
  // An article that keeps most of the page stays in reading mode even beside a small table.
  await page.setContent('<div><div class="story"><h1>도서관 소식</h1>'+Array.from({length:8},()=>'<p>'+'새 자료실 운영과 이용 방법을 자세히 안내합니다. '.repeat(15)+'</p>').join('')+'</div><div class="box"><table><tr><th>분류</th><th>건수</th></tr><tr><td>도서</td><td>12</td></tr></table></div></div>');
  assert.equal((await run('read_page',{mode:'content'})).method,'readability');
  check('an information page whose timetables reading mode would drop is read from the region that holds them; an article keeps reading mode');
  await page.setContent('<div role="main"><h1>짧은 문서</h1><p>실제 안내</p></div>');
  assert.equal((await run('read_page',{mode:'content'})).method,'main_landmark');
  await page.setContent('<main><table><tbody><tr><th>일반1</th><td rowspan="3">09–21</td></tr><tr><th>일반2</th></tr><tr><th>디지털</th></tr><tr><th>세계</th><td>09–18</td></tr></tbody></table></main>');
  const merged=await run('read_page',{mode:'content'});
  const mergedText=merged.ranges.map(r=>r.markdown).join('');
  assert.match(mergedText,/디지털 \| 09–21/);
  assert.match(mergedText,/세계 \| 09–18/);
  assert.doesNotMatch(mergedText,/디지털 \| 09–18/);
  check('merged opening-hour cells retain their actual row associations in rendered source text');
  await page.setContent('<script type="application/json">'+JSON.stringify({payload:'PRIVATE_SCRIPT'.repeat(170000)})+'</script><style>/*'+'PRIVATE_STYLE'.repeat(170000)+'*/</style><main><h1>검색 결과</h1><p>앞 <a href="/guide?access_token=PRIVATE_URL">확인한 링크</a> 뒤</p><div hidden>'+'PRIVATE_HIDDEN'.repeat(170000)+'</div><p>실제 결과 2개</p></main>');
  const bulky=await run('read_page',{mode:'content'});
  assert.equal(bulky.ok,true,JSON.stringify(bulky));
  const bulkyText=bulky.ranges.map(r=>r.markdown).join('');
  assert.match(bulkyText,/실제 결과 2개/);assert.match(bulkyText,/앞 \[확인한 링크\].* 뒤/);
  assert.doesNotMatch(bulkyText,/PRIVATE/);
  assert.equal(await page.locator('main p').last().innerText(),'실제 결과 2개');
  await page.setContent('<main><p>'+' '.repeat(2000001)+'</p></main>');
  assert.equal((await run('read_page',{mode:'content'})).error,'page_content_limit');
  check('hidden application state does not consume reading budget; visible text remains bounded and source order/privacy are preserved');
  await page.setContent('<input value="PRIVATE_ONLY"><div contenteditable="true">PRIVATE_DRAFT_ONLY</div>');
  assert.equal((await run('read_page',{mode:'content'})).error,'page_content_empty');
  check('Mozilla Readability handles article pages, ARIA main landmarks stay readable and editor-only pages return an explicit fallback instruction');
  await page.setContent('<embed type="application/pdf" style="width:600px;height:500px"><input value="PRIVATE_PDF_FIELD">');
  const embeddedPdf = await run('read_page',{mode:'content'});
  assert.equal(embeddedPdf.error,'page_content_pdf_unavailable');assert.equal(embeddedPdf.retryable,false);
  assert.match(embeddedPdf.instruction,/original request allows/);assert.match(embeddedPdf.instruction,/Do not invent/);
  assert.equal(embeddedPdf.ranges,undefined);assert(!JSON.stringify(embeddedPdf).includes('PRIVATE_'));
  await page.setContent('<embed type="application/pdf" hidden><input value="PRIVATE_ONLY">');
  assert.equal((await run('read_page',{mode:'content'})).error,'page_content_empty');
  await page.setContent('<main><h1>HTML reference</h1><p>Original readable HTML facts.</p><a href="/rules.pdf">PDF source</a></main><embed type="application/pdf">');
  const htmlWithPdf = await run('read_page',{mode:'content'});
  assert.equal(htmlWithPdf.ok,true);assert.match(htmlWithPdf.ranges[0].markdown,/Original readable HTML facts/);
  check('an empty visible PDF viewer returns a non-retryable capability gap without misclassifying HTML references or hidden embeds');
  await page.setContent('<main><h1>Status report</h1><p>Observed 2031-04-09. Current temperature 12.7, low 8, high 17.</p><p>'+ 'Ordinary reference paragraph. '.repeat(700)+'</p></main>');
  const statusWindow=await run('read_page',{mode:'content'});
  assert.match(statusWindow.ranges[0].markdown,/Current temperature 12.7/);
  assert(statusWindow.ranges[0].markdown.length>4000&&statusWindow.ranges[0].markdown.length<=5000);
  const continuedWindow=await run('read_page',{mode:'content',offset:statusWindow.next_offset,content_hash:statusWindow.content_hash});
  assert.equal(continuedWindow.ranges[0].start,statusWindow.ranges[0].end);
  assert.equal(statusWindow.coverage.partial,true);
  check('an initial heading before an oversized section returns a bounded body window and exact continuation instead of heading-only evidence');
  await worker.evaluate(()=>contentTest.stopBrowserAgent('content-reader'));
  assert(network.every(url=>url.startsWith(origin)));assert.deepEqual(errors,[]);
  await writeFile('verification/browser-source-quality/page-content.json',JSON.stringify({checks,actualBrowser:true,actualModel:false,overviewMissesLateFact:true,extractedCharacters:first.characters,sourcePages:ranges.length,errors},null,2));
} finally {await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
