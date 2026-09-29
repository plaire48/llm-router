import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {collectSnapshot, inspectTarget} from '../generated/browser-dom.js';
import {collectPageContent} from '../generated/browser-content-dom.js';

// Real Chromium DOM/actionability regression; no model or external service.
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BINARY});
try {
  const page = await browser.newPage();
  await page.setContent(`<details><summary>지난 기록</summary>${'<p>접힌 기록</p>'.repeat(5100)}</details><label>검색어<input id="search"></label><button id="search-button">검색</button>`);
  const closed = await page.evaluate(collectSnapshot);
  assert(closed.descriptors.some(element => element.id === 'search'), 'A visible input after a large collapsed section must remain observed');
  assert(closed.descriptors.some(element => element.id === 'search-button'));
  assert(!closed.coverage.domTruncated, 'Unrendered collapsed descendants must not spend the rendered-node budget');
  assert(!closed.text.includes('접힌 기록'));
  assert(closed.coverage.nodesInspected < 20);
  console.log('PASS collapsed details preserve following actionable fields without spending the node budget');
  await page.getByText('지난 기록', {exact: true}).click();
  const opened = await page.evaluate(collectSnapshot, {query: '검색'});
  assert(opened.descriptors.some(element => element.id === 'search-button'));
  assert(opened.coverage.nodesInspected > 5100);
  const unfiltered = await page.evaluate(collectSnapshot);
  assert(unfiltered.text.includes('접힌 기록'));
  assert(unfiltered.coverage.domTruncated, 'Opening the section must re-observe its real rendered scope');
  console.log('PASS opening the same details restores its content and actual partial coverage');
  await page.setContent('<table><tbody><tr style="visibility:collapse"><td><button id="collapsed">접힌 동작</button></td></tr></tbody></table><button id="visible">실제 동작</button>');
  const handle = await page.locator('#collapsed').elementHandle();
  const state = await handle.evaluate(inspectTarget);
  assert.equal(state.hidden, true, 'CSS visibility:collapse is not an actionable visible surface');
  const collapsed = await page.evaluate(collectSnapshot);
  assert(!collapsed.descriptors.some(element => element.id === 'collapsed'));
  assert(collapsed.descriptors.some(element => element.id === 'visible'));
  let actions = 0;
  await page.exposeFunction('recordUnexpectedAction', () => {actions++;});
  await page.evaluate(() => document.querySelector('#collapsed').onclick = () => globalThis.recordUnexpectedAction());
  await assert.rejects(page.locator('#collapsed').click({timeout: 150}), /not visible|Timeout/);
  assert.equal(actions, 0);
  console.log('PASS collapsed CSS rows expose no ref and normal Playwright rejects a click without force');
  const links = [
    ['tourism','https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=0363da87-ef3b-4c21-8508-34f70dda31fb'],
    ['news','https://news.kbs.co.kr/news/pc/view/view.do?ncd=1234567'],
    ['video','https://www.youtube.com/watch?v=abcdefghijk'],
    ['unrelated','https://example.com/article'],
  ];
  await page.setContent('<main><h1>출처 링크</h1>'+links.map(([id,url])=>`<p><a id="${id}" href="${url}${url.includes('?')?'&':'?'}token=PRIVATE_VALUE#PRIVATE_FRAGMENT">${id}</a></p>`).join('')+'</main>');
  const sources = await page.evaluate(collectPageContent), destinations = await page.evaluate(collectSnapshot);
  for (const [id,url] of links) {
    assert(sources.text.includes(`[${id}](${url})`), sources.text);
    assert.equal(destinations.descriptors.find(item=>item.id===id)?.destination,url);
  }
  assert(!sources.text.includes('PRIVATE_'));
  assert(!JSON.stringify(destinations.descriptors.map(item=>item.destination)).includes('PRIVATE_'));
  console.log('PASS content and action observers preserve the same public resource IDs while redacting private query and fragment values');
} finally {
  await browser.close();
}
