import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {collectSnapshot} from '../generated/browser-dom.js';

const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_BINARY || chromium.executablePath()});
try {
  const page = await browser.newPage();
  await page.setContent(`<section>
    <a href="https://example.test/article?id=one">Publisher</a>
    <h2><a href="https://example.test/article?id=one">Actual article title</a></h2>
    <a href="https://example.test/article?id=two">Different article</a>
    <a hidden href="https://example.test/article?id=one">HIDDEN_LABEL</a>
  </section>`);
  let snapshot = await page.evaluate(collectSnapshot, {});
  const publisher = snapshot.descriptors.find(d=>d.name==='Publisher');
  assert.deepEqual(publisher.sameDestinationLabels, ['Publisher','Actual article title']);
  assert.equal(snapshot.descriptors.find(d=>d.name==='Different article').sameDestinationLabels, undefined);
  assert(!JSON.stringify(snapshot).includes('HIDDEN_LABEL'));
  assert(!JSON.stringify(publisher).includes('id=one'));
  console.log('PASS exact full addresses group observed labels without merging redacted query URLs or hidden labels');
  snapshot = await page.evaluate(collectSnapshot, {query:'Publisher'});
  assert(snapshot.descriptors.find(d=>d.name==='Publisher').sameDestinationLabels.includes('Actual article title'));
  console.log('PASS focused retrieval retains alternative item labels from the same observed document');
  await page.setContent(`<a href="https://example.test/new">Replacement title</a>`);
  snapshot = await page.evaluate(collectSnapshot, {});
  assert(snapshot.descriptors.every(d=>!d.sameDestinationLabels));
  assert(!JSON.stringify(snapshot).includes('Actual article title'));
  console.log('PASS a new observation never inherits old source labels');
  await page.setContent(`<a href="https://user:PRIVATE_SECRET@example.test/article">Credentialed</a><a href="javascript:void(0)">Action</a>`);
  snapshot = await page.evaluate(collectSnapshot, {});
  assert(snapshot.descriptors.every(d=>!d.destination && !d.sameDestinationLabels));
  assert(!JSON.stringify(snapshot).includes('PRIVATE_SECRET'));
  console.log('PASS credentialed and executable URLs do not become source groups');
} finally {await browser.close();}
