import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {reviewEvidence, goalReviewMessages} from '../goal-review.js';

// Compile source in memory only: do not replace generated/dist or the running
// evaluation extension. This isolated Chromium regression uses no real site.
const bundle = await build({entryPoints: ['browser-dom.js'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'NubiDOM', target: 'chrome125'});
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BINARY});
try {
  const page = await browser.newPage();
  const observe = async query => {
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    return page.evaluate(query => NubiDOM.collectSnapshot(query), query);
  };
  await page.setContent(`<main><h1>서울 날씨 검색</h1>
    <section><h2>현재 날씨 카드</h2><p>중구 을지로1가</p><p>현재 기온 26.7℃</p><p>오늘 9.27. 최저 17℃ 최고 28℃</p><p>카드 끝</p></section>
    <article><h2><a href="https://example.test/weather?token=PRIVATE_TOKEN">외부 예보</a></h2><p>어제 9.26. 13시 현재 28.0℃</p><p>최저 18℃ 최고 28℃</p></article>
    <section aria-label="추가 카드"><h2>다른 지역</h2><p>부산 현재 26.7℃</p></section>
    <p>고유숫자 28℃</p><p>독립 날짜 9.27.</p>
  </main>`);
  const result = await observe('현재 28');
  assert(result.retrieval.textRegions.length >= 3);
  const grouped = result.retrieval.textRegions.map(region => ({...region,
    text: result.retrieval.textBlocks.filter(block => block.regionIndex === region.index).map(block => result.text.slice(block.start, block.end)).join('\n')}));
  const card = grouped.find(region => region.heading === '현재 날씨 카드');
  const external = grouped.find(region => region.heading === '외부 예보');
  assert(card?.text.includes('26.7℃')); assert(external?.text.includes('28.0℃'));
  assert(!card.text.includes('18℃')); assert(!external.text.includes('17℃'));
  assert.notEqual(card.index, external.index);
  assert.deepEqual(external.links, ['https://example.test/weather']);
  assert(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
  assert(result.retrieval.textBlocks.every(block => block.end > block.start && block.end <= result.text.length));
  assert(result.retrieval.textBlocks.every((block, index, blocks) => !index || block.start > blocks[index - 1].end));
  assert(!result.descriptors.some(control => control.ref === String(card.index)));
  console.log('PASS identical values remain in separate card/snippet regions with ordered text offsets and redacted observed links');

  const unfiltered = await observe('');
  assert.equal(unfiltered.retrieval.method, 'dom_order');
  assert.equal(unfiltered.textFiltered, false);
  assert.equal(unfiltered.coverage.queryFiltered, false);
  assert.equal(unfiltered.coverage.nodeLimit, 5000);
  assert.equal(unfiltered.retrieval.matchedControls, undefined);
  assert.equal(unfiltered.text, '서울 날씨 검색\n현재 날씨 카드\n중구 을지로1가\n현재 기온 26.7℃\n오늘 9.27. 최저 17℃ 최고 28℃\n카드 끝\n외부 예보\n어제 9.26. 13시 현재 28.0℃\n최저 18℃ 최고 28℃\n다른 지역\n부산 현재 26.7℃\n고유숫자 28℃\n독립 날짜 9.27.');
  const evidence = reviewEvidence(7, 'read_page', {}, {frames: [{...unfiltered, frame: 0, url: 'https://example.test/search'}]});
  const reviewed = evidence.result.frames[0];
  assert.equal(reviewed.text, undefined);
  assert.equal(reviewed.textSegments.map(segment => segment.text).join(''), unfiltered.text);
  const byHeading = heading => reviewed.textSegments.filter(segment => segment.heading === heading).map(segment => segment.text).join('\n');
  assert(byHeading('현재 날씨 카드').includes('17℃'));
  assert(!byHeading('현재 날씨 카드').includes('18℃'));
  assert(byHeading('외부 예보').includes('18℃'));
  assert(byHeading('외부 예보').includes('어제 9.26.'));
  assert(!byHeading('현재 날씨 카드').includes('9.26.'));
  assert(!byHeading('외부 예보').includes('17℃'));
  assert(byHeading('다른 지역').includes('부산'));
  assert(!byHeading('현재 날씨 카드').includes('부산'));
  const review = goalReviewMessages({goal: '현재 카드의 지역과 날짜에 맞는 값 확인', history: [], evidence: [evidence], answer: '현재 26.7℃', inputBudget: 20000});
  const reviewFrame = JSON.parse(review.messages[1].content).evidence[0].result.frames[0];
  assert.deepEqual(reviewFrame.textSegments, reviewed.textSegments);
  assert.deepEqual(reviewFrame.coverage, unfiltered.coverage);
  assert(!JSON.stringify(reviewFrame).includes('PRIVATE_TOKEN'));
  console.log('PASS default snapshot reaches actual review as lossless separate card, snippet and region segments');

  const boundary = await observe('카드 끝');
  assert(boundary.text.includes('카드 끝'));
  assert(!boundary.text.includes('외부 예보'), 'Neighbor context must not cross the next article boundary');
  const standalone = await observe('고유숫자');
  assert(standalone.text.includes('고유숫자'));
  assert(!standalone.text.includes('독립 날짜'), 'Main alone is not an attribution region');
  assert(standalone.retrieval.textRegions.every(region => region.role === 'text_block'));
  console.log('PASS neighboring excerpts cannot cross semantic regions or share a whole-main fallback');

  await page.setContent(`<section><h2>공개 제목 <span hidden>PRIVATE_HIDDEN</span><span style="display:none">PRIVATE_CSS</span></h2>
    <input value="PRIVATE_FIELD"><div contenteditable="true">PRIVATE_EDITOR</div><p data-token="PRIVATE_ATTRIBUTE">공개 숫자 28℃</p>
    <section><h3>내부 카드</h3><p>내부 숫자 28℃</p></section><p>외부 숫자 28℃</p></section>`);
  const privateResult = await observe('숫자 28');
  assert(!JSON.stringify(privateResult).includes('PRIVATE_'));
  const inner = privateResult.retrieval.textRegions.find(region => region.heading === '내부 카드');
  const outer = privateResult.retrieval.textRegions.find(region => region.heading === '공개 제목');
  assert(inner && outer && inner.index !== outer.index);
  const privateDefault = await observe('');
  assert(!JSON.stringify({text: privateDefault.text, retrieval: privateDefault.retrieval}).includes('PRIVATE_'), 'Body attribution must not acquire input/editor text or hidden context');
  assert(privateDefault.retrieval.textRegions.some(region => region.heading === '내부 카드'));
  console.log('PASS heading context shares text privacy rules and nested regions remain distinct');

  await page.setContent('<main><p>앞 문단</p>앞<span role="region" style="display:inline">안쪽<b>강조</b></span>뒤 <section style="display:inline">다른 카드</section> 끝<p>다음 문단</p></main>');
  const mixed = await observe('');
  assert.equal(mixed.text, '앞 문단\n앞안쪽강조뒤 다른 카드 끝\n다음 문단');
  assert(mixed.retrieval.contextOmitted);
  assert.equal(mixed.retrieval.textBlocks.length, 2);
  const mixedReviewed = reviewEvidence(8, 'read_page', {}, {frames: [mixed]}).result.frames[0];
  assert.equal(mixedReviewed.textSegments.map(segment => segment.text).join(''), mixed.text);
  assert(mixedReviewed.textSegments.some(segment => segment.regionIndex === null && segment.text.includes('앞안쪽강조뒤 다른 카드 끝')));
  assert(!mixedReviewed.textSegments.some(segment => segment.regionIndex !== null && segment.text.includes('안쪽')));
  console.log('PASS inline regions sharing a rendered block stay explicitly unassociated without changing whitespace');

  await page.setContent(Array.from({length: 12}, (_, index) => `<article><h2>${'아주 긴 제목 '.repeat(30)}${index}</h2><p><a href="https://example.test/${'x'.repeat(450)}${index}">기온 28℃</a></p></article>`).join(''));
  const bounded = await observe('기온');
  assert(bounded.text.length <= 16000);
  assert(JSON.stringify({textBlocks: bounded.retrieval.textBlocks, textRegions: bounded.retrieval.textRegions}).length <= 4000);
  assert(bounded.retrieval.contextOmitted);
  assert(bounded.retrieval.textBlocks.every(block => bounded.retrieval.textRegions.some(region => region.index === block.regionIndex)));
  const boundedDefault = await observe('');
  assert(boundedDefault.retrieval.contextOmitted);
  assert(JSON.stringify({textBlocks: boundedDefault.retrieval.textBlocks, textRegions: boundedDefault.retrieval.textRegions}).length <= 4000);
  assert(boundedDefault.retrieval.textBlocks.every(block => block.end <= boundedDefault.text.length && boundedDefault.retrieval.textRegions.some(region => region.index === block.regionIndex)));
  console.log('PASS context metadata is bounded without duplicating text or fabricating absent region associations');

  // Preserve the core retrieval-browser contracts against current source,
  // without running that extension test against the ongoing evaluator's dist.
  await page.setContent(`<main><h1>설정</h1>${'<button>관계없는 메뉴</button>'.repeat(210)}
    <section><h2>결제 설정</h2><button role="switch" id="billing" aria-checked="false">알림</button></section>
    <section><h2>배송 설정</h2><button role="switch" id="shipping" aria-checked="false">알림</button><button>저장</button></section>
    <article><h2>배송 기준</h2><p>${'다른 설명 '.repeat(4000)}배송 기준 37건은 승인 후 반영합니다.</p></article>
    <div id="shadow"></div><input type="password" value="PRIVATE_PASSWORD"><div hidden><button>숨긴 대상</button></div></main>`);
  await page.evaluate(() => document.querySelector('#shadow').attachShadow({mode: 'open'}).innerHTML = '<section><h3>계정 설정</h3><button role="switch" aria-checked="false">알림</button></section>');
  const controls = await observe('배송 설정의 알림 스위치');
  assert.equal(controls.descriptors[0].id, 'shipping');
  assert.equal(controls.descriptors[0].match.coverage, 1);
  assert(controls.descriptors.some(control => control.id === 'billing'));
  assert(!JSON.stringify(controls).includes('PRIVATE_PASSWORD'));
  const shadow = await observe('계정 설정 알림');
  assert(shadow.descriptors.some(control => control.context?.some(context => context.name === '계정 설정')));
  const late = await observe('배송 기준 37건');
  assert(late.text.includes('배송 기준 37건')); assert(late.truncated); assert(late.text.length <= 16000);
  const absent = await observe('존재하지않는항목');
  assert.equal(absent.descriptors.length, 0); assert.equal(absent.retrieval.textBlocks.length, 0);
  assert.equal(absent.retrieval.matchedControls, 0);
  await page.setContent('<main>앞 <b>강조</b> 뒤<p>다음 문단</p></main>');
  const plain = await observe('');
  assert.equal(plain.text, '앞 강조 뒤\n다음 문단');
  assert.equal(plain.retrieval.method, 'dom_order');
  console.log('PASS original control ranking, shadow context, late long-paragraph matches, absent targets and unfiltered text order remain intact');

  await page.setContent(`<section><h2>긴 본문</h2><p>${'가'.repeat(17000)}</p></section>${'<div>x</div>'.repeat(6000)}`);
  const limited = await observe('');
  assert.equal(limited.text, `긴 본문\n${'가'.repeat(15995)}`);
  assert.equal(limited.text.length, 16000);
  assert.equal(limited.coverage.nodeLimit, 5000);
  assert(limited.coverage.nodesInspected <= 5000);
  assert(limited.coverage.domTruncated);
  assert(limited.coverage.textTruncated);
  assert(limited.retrieval.textBlocks.every(block => block.end <= 16000));
  console.log('PASS default node and text limits remain unchanged and metadata stops at the returned text boundary');
} finally {await browser.close();}
