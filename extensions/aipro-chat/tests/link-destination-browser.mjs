import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

let navigations = 0;
const server = createServer((request, response) => {
  if (request.url !== '/') navigations++;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<title>Search link verification</title><main><h1>Observed results</h1>
    <a id="first" href="https://example.test/article-one">First ordinary result</a>
    <a id="second" href="https://other.test/article-two">Second ordinary result</a>
    <a id="query" href="https://example.test/article?token=PRIVATE_QUERY">Query result</a>
    <button id="button">Not a link</button></main>
    <script>window.linkClicks=0; document.addEventListener('click',()=>window.linkClicks++);</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-link-verification-')), extension = resolve(profile, 'extension');
let browser;
try {
  await cp(resolve('dist'), extension, {recursive:true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.linkProbe={runBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  browser = await chromium.launchPersistentContext(profile, {headless:true, executablePath:process.env.CHROME_BINARY,
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const page = await browser.newPage(); await page.goto(origin);
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await linkProbe.ready; await chrome.storage.local.set({browserWorkMode:'current'});});
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const run = (name, args) => worker.evaluate(async ({tabId,name,args}) =>
    (await linkProbe.runBrowserAgent('link-probe', {tabId}, name, args)).result, {tabId,name,args});
  const observe = async () => {
    const snapshot = await run('browser_snapshot', {});
    return snapshot.frames.flatMap(frame => frame.elements || []);
  };
  const find = (rows, name) => {const element=rows.find(row=>row.name===name); assert(element, `Missing observed ${name}`); return element.ref;};
  let rows = await observe();
  const exact = await run('verify_page', {checks:[
    {kind:'link_destination',ref:find(rows,'First ordinary result'),expected:'https://example.test/article-one'},
    {kind:'link_destination',ref:find(rows,'Second ordinary result'),expected:'https://other.test/article-two'}]});
  assert.equal(exact.verified,true); assert(exact.checks.every(check=>check.passed));
  assert.equal(page.url(),origin+'/');
  const pageCheck = await run('verify_page',{checks:[{kind:'url_is',expected:'https://example.test/article-one'}]});
  assert.equal(pageCheck.verified,false); assert.equal(pageCheck.checks[0].reason,'url_origin_mismatch');
  rows = await observe();
  // The shown destination of a link with a hidden query is a display reference: it passes and says
  // that the query was not compared. An expected value with its own query is compared exactly.
  const shown = await run('verify_page',{checks:[{kind:'link_destination',ref:find(rows,'Query result'),expected:'https://example.test/article'}]});
  assert.equal(shown.verified,true); assert.equal(shown.checks[0].queryCompared,false);
  assert(!JSON.stringify(shown).includes('PRIVATE_QUERY'));
  rows = await observe();
  const query = await run('verify_page',{checks:[{kind:'link_destination',ref:find(rows,'Query result'),expected:'https://example.test/article?q=other'}]});
  assert.equal(query.verified,false); assert.equal(query.checks[0].reason,'url_query_mismatch');
  assert(!JSON.stringify(query).includes('PRIVATE_QUERY'));
  rows = await observe();
  const changedRef = find(rows,'First ordinary result');
  await page.locator('#first').evaluate(el=>el.href='https://example.test/changed');
  const changed = await run('verify_page',{checks:[{kind:'link_destination',ref:changedRef,expected:'https://example.test/article-one'}]});
  assert.equal(changed.verified,false);
  rows = await observe();
  const removedRef = find(rows,'Second ordinary result');
  await page.locator('#second').evaluate(el=>el.remove());
  const removed = await run('verify_page',{checks:[{kind:'link_destination',ref:removedRef,expected:'https://other.test/article-two'}]});
  assert(!removed.verified); assert(removed.error);
  rows = await observe();
  const wrongKind = await run('verify_page',{checks:[{kind:'link_destination',ref:find(rows,'Not a link'),expected:'https://example.test/article-one'}]});
  assert(!wrongKind.verified); assert(wrongKind.error);
  assert.equal(await page.evaluate(()=>window.linkClicks),0);
  assert.equal(page.url(),origin+'/');
  await mkdir('verification/browser-30',{recursive:true});
  await writeFile('verification/browser-30/link-destination-browser.json',JSON.stringify({actualBrowser:true,actualModel:false,syntheticSite:true,
    distinctDestinationsVerified:2,currentPageRemainsDistinct:true,queryMismatchPreserved:true,querySecretNotExposed:true,
    changedLinkRejected:true,removedLinkRejected:true,nonLinkRejected:true,clicks:0,pageUnchanged:true},null,2));
  console.log('PASS observed link destinations verified independently of current page URL without clicks or query disclosure');
} finally {await browser?.close(); server.close(); await rm(profile,{recursive:true,force:true});}
