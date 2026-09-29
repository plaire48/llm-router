import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {collectSnapshot} from '../generated/browser-dom.js';

// A snapshot-local cache may save repeated DOM work, but never survive a new
// observation or alter the document, secret filtering, frame scope or refs.
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="ko"><body>
    <main><section aria-label="경기 결과"><h2>경기 결과</h2>
      <button id="visible">자세히</button><p>대한민국 결승 결과</p>
      <div id="hidden" hidden><button id="hidden-button">비공개 버튼</button><p>PRIVATE_HIDDEN_VALUE</p></div>
      <label>토큰<input type="password" value="PRIVATE_INPUT_VALUE"></label>
      <div id="shadow"></div>
    </section></main>
    <iframe title="별도 문서" srcdoc="<button id='frame-button'>프레임 보기</button>"></iframe>
    <script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button id="shadow-button">그림자 보기</button>';</script>
  </body></html>`);
  const first = await page.evaluate(collectSnapshot, {nonce: 'observation-a'});
  const ids = first.descriptors.map(item => item.id);
  assert(ids.includes('visible'));
  assert(ids.includes('shadow-button'));
  assert(!ids.includes('hidden-button'));
  assert(!ids.includes('frame-button'));
  assert(!JSON.stringify(first).includes('PRIVATE_HIDDEN_VALUE'));
  assert(!JSON.stringify(first).includes('PRIVATE_INPUT_VALUE'));
  assert(first.descriptors.find(item => item.id === 'visible')?.ref.startsWith('c-observation-a-'));
  const frame = page.frames().find(item => item !== page.mainFrame());
  const frameSnapshot = await frame.evaluate(collectSnapshot, {nonce: 'frame-observation'});
  assert(frameSnapshot.descriptors.some(item => item.id === 'frame-button' && item.ref.startsWith('c-frame-observation-')));
  await page.locator('#visible').evaluate(node => {node.hidden = true; document.querySelector('#hidden').hidden = false;});
  const second = await page.evaluate(collectSnapshot, {nonce: 'observation-b'});
  assert(!second.descriptors.some(item => item.id === 'visible'));
  assert(second.descriptors.some(item => item.id === 'hidden-button' && item.ref.startsWith('c-observation-b-')));
  assert(second.text.includes('PRIVATE_HIDDEN_VALUE'));
  assert(!JSON.stringify(second).includes('PRIVATE_INPUT_VALUE'));
  console.log('PASS snapshot cache keeps hidden, secret, frame and fresh-ref boundaries');
} finally {await browser.close();}
