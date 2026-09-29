import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {approvalTarget} from '../browser-approval.js';
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY,headless:true});
try {
  const page=await browser.newPage();
  await page.setContent('<form role="search" method="get"><fieldset><input id="query" type="search" name="query" title="검색어를 입력해 주세요."><button id="search" type="submit">검색</button><button id="ai" type="submit">AI 검색</button><button id="register" type="submit">등록</button></fieldset></form>');
  const query=await page.locator('#query').elementHandle();
  assert.equal(await query.evaluate(approvalTarget,{method:'press',key:'Enter'}),null);
  assert.equal(await (await page.locator('#ai').elementHandle()).evaluate(approvalTarget,{method:'click'}),null);
  assert.equal((await (await page.locator('#register').elementHandle()).evaluate(approvalTarget,{method:'click'})).action,'등록');
  assert.equal((await query.evaluate(approvalTarget,{method:'press',key:'ControlOrMeta+Enter'})).action,'제출');
  await page.locator('#ai').evaluate(e=>e.setAttribute('formmethod','post'));
  assert.equal((await (await page.locator('#ai').elementHandle()).evaluate(approvalTarget,{method:'click'})).action,'제출');
  await page.locator('#ai').evaluate(e=>e.removeAttribute('formmethod'));
  await page.locator('form').evaluate(f=>f.method='post');
  assert.equal((await query.evaluate(approvalTarget,{method:'press',key:'Enter'})).action,'제출');
  await page.locator('form').evaluate(f=>{f.method='get';const e=document.createElement('input');e.type='password';f.append(e);});
  assert.equal((await query.evaluate(approvalTarget,{method:'press',key:'Enter'})).action,'제출');
  // Sites often use type=text for the query. One marked query field in a GET form is a search.
  const target=(selector,operation)=>page.locator(selector).elementHandle().then(handle=>handle.evaluate(approvalTarget,operation));
  await page.setContent('<form role="search" method="get" action="/search"><input id="q1" type="text" name="query" class="box_window"><button id="b1" type="submit" aria-label="검색"></button></form>'+
    '<form method="get" action="/find"><input id="q2" type="text" name="q" placeholder="Search rules"><input type="hidden" name="lang" value="en"><button id="b2" type="submit">Search</button></form>'+
    '<form method="get" action="/list"><input id="q3" type="text" name="title"><button id="b3" type="submit">조회하기</button></form>'+
    '<form method="get" action="/s"><input id="q4" type="text" name="q"><input id="other" type="text" name="memo"><button type="submit">검색</button></form>'+
    '<form method="post" action="/s"><input id="q5" type="text" name="q" aria-label="검색"><button id="b5" type="submit">검색</button></form>'+
    '<form method="get" action="/s"><input id="q6" type="text" name="q"><textarea name="note"></textarea><button type="submit">검색</button></form>'+
    '<form method="get" action="/s"><input id="q7" type="text" name="q"><select name="scope"><option>all</option></select><button type="submit">검색</button></form>');
  for(const id of ['#q1','#q2'])assert.equal(await target(id,{method:'press',key:'Enter'}),null,id);
  for(const id of ['#b1','#b2'])assert.equal(await target(id,{method:'click'}),null,id);
  for(const id of ['#q3','#q4','#other','#q5','#q6','#q7'])assert.equal((await target(id,{method:'press',key:'Enter'}))?.action,'제출',id);
  assert.equal((await target('#b5',{method:'click'}))?.action,undefined,'a POST form with a search caption keeps its existing rule');
  assert.equal((await target('#q1',{method:'press',key:'ControlOrMeta+Enter'})).action,'제출');
  console.log('PASS observed GET search navigation needs no approval; POST, credentials, registration and submit shortcuts remain guarded');
  // A museum's detailed search: several query fields, a select, and an image
  // button named only by its alt text. The search click is not a submission.
  await page.setContent('<form method="get" action="/collection"><input type="text" name="query" title="소장품명 검색"><input type="text" name="query"><select name="sc"><option>전체</option></select>'+
    '<input id="img1" type="image" alt="검색" src="data:," onclick="return false;"><button id="img2" type="submit"><img alt="검색" src="data:,"></button><input id="img3" type="image" alt="등록" src="data:,"><input id="img4" type="image" src="data:,"></form>');
  for(const id of ['#img1','#img2'])assert.equal(await target(id,{method:'click'}),null,id);
  assert.equal((await target('#img3',{method:'click'}))?.action,'등록','an image button named 등록 still needs approval');
  assert.equal((await target('#img4',{method:'click'}))?.action,'제출','an unnamed image submit is still a form submission');
  console.log('PASS an image search button is named by its alt text; other image submits keep their rule');
} finally {await browser.close();}
