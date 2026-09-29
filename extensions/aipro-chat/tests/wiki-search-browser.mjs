import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, appendFile, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

// Exercise the actual packaged parser in MV3, where document is unavailable.
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-wiki-search-'));
const extension = resolve(profile, 'extension');
const now = Date.now(), scope = {origin: 'https://portal.example', provider: 'aipro'};
const markdown = '출장 &amp; 관리\n=========\n\n## 국내 출장\n\n### 정산 기준\n\n```md\n# 가짜 제목\n```\n\n휴가 신청의 검토기준을 확인합니다.\n\n| 항목 | 지급 한도 |\n| --- | --- |\n' +
  Array.from({length: 90}, (_, i) => `| 비용 ${i} | 사전 검토 |\n`).join('') + '| 심야교통비 | 사전 확인 |';
const entry = {url: scope.origin + '/guide', title: '업무 안내', provider: scope.provider, verifiedAt: now, documentVersion: 3, markdown, document: {headings: ['업무 안내']}};
let context;
const checks = [];
try {
  await cp(resolve('dist'), extension, {recursive: true});
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.testWikiSearch={executeSiteWiki,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY || chromium.executablePath(),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => testWikiSearch.ready);
  assert.equal(await worker.evaluate(() => typeof document), 'undefined');
  await worker.evaluate(async entry => chrome.storage.local.set({browserKnowledge: {entries: [entry]}}), entry);
  const run = (name, args, activeScope = scope) => worker.evaluate(async ({name, args, activeScope, now}) =>
    testWikiSearch.executeSiteWiki((await chrome.storage.local.get('browserKnowledge')).browserKnowledge, activeScope, name, args, now), {name, args, activeScope, now});
  const found = await run('search_site_wiki', {query: '휴가신청'});
  assert.equal(found.entries.length, 1); assert.equal(found.entries[0].documentVersion, 3);
  assert.equal(found.entries[0].excerpts[0].match.coverage, 1);
  checks.push('packaged MV3 parser and Korean spacing retrieval');
  const result = await run('read_site_wiki', {url: entry.url, version: 3, query: '심야교통비'});
  const excerpt = result.excerpts.find(item => item.text.includes('심야교통비'));
  assert.equal(excerpt.section, '### 정산 기준');
  assert(excerpt.context.some(item => item.kind === 'table_header' && item.text.includes('지급 한도')));
  assert(excerpt.context.some(item => item.kind === 'heading' && item.text.startsWith('출장 &amp; 관리')));
  for (const item of [excerpt, ...excerpt.context]) assert.equal(item.text, markdown.slice(item.range.start, item.range.end));
  checks.push('GFM table header, setext ancestor and exact UTF-16 source ranges');
  assert.equal((await run('read_site_wiki', {url: entry.url, version: 2})).error, 'wiki_changed');
  assert.equal((await run('search_site_wiki', {query: '휴가신청'}, {...scope, provider: 'fabrix'})).entries.length, 0);
  assert.equal((await run('search_site_wiki', {query: '휴가신청'}, {...scope, origin: 'https://other.example'})).entries.length, 0);
  assert.equal((await run('search_site_wiki', {query: '신청휴가'})).entries.length, 0);
  checks.push('version, provider, origin and reordered-query isolation');
  // The index is derived from persisted documents; a second extension page
  // loads it afresh and must get the same answer without relying on worker state.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
  const reread = await page.evaluate(async ({scope, now}) => {
    const {searchKnowledge} = await import('./browser-knowledge.js');
    return searchKnowledge((await chrome.storage.local.get('browserKnowledge')).browserKnowledge, {...scope, query: '심야교통비'}, now);
  }, {scope, now});
  assert.deepEqual(reread[0].excerpts, result.excerpts);
  checks.push('persisted source retrieval from a fresh extension page');
  const nested = '# 정산 안내\n\n휴가 **신청** 절차입니다.\n\n[이동](https://portal.example/hiddenKeyword)\n\n> | 항목 | 지급 한도 |\n> | --- | --- |\n' +
    Array.from({length: 90}, (_, i) => `> | 비용 ${i} | 확인 필요 |\n`).join('') + '> | 심야교통비 | 사전 검토 |';
  await worker.evaluate(async ({entry, nested}) => chrome.storage.local.set({browserKnowledge: {entries: [{...entry, documentVersion: 4, markdown: nested}, {...entry, url: entry.url + '-other', markdown: '# 별도\n타부서규정'}]}}), {entry, nested});
  assert.equal((await run('search_site_wiki', {query: '휴가신청'})).entries[0].excerpts[0].match.coverage, 1);
  assert.equal((await run('search_site_wiki', {query: 'hiddenKeyword'})).entries.length, 0);
  const nestedRead = await run('read_site_wiki', {url: entry.url, version: 4, query: '심야교통비'});
  assert(nestedRead.excerpts.some(item => item.context.some(part => part.kind === 'table_header' && part.text.includes('지급 한도'))));
  for (const item of nestedRead.excerpts.flatMap(excerpt => [excerpt, ...excerpt.context])) assert.equal(item.text, nested.slice(item.range.start, item.range.end));
  assert.equal((await run('read_site_wiki', {url: entry.url, version: 4, query: '타부서규정'})).excerpts.length, 0);
  assert.equal((await run('search_site_wiki', {query: '타부서규정'})).entries[0].url, entry.url + '-other');
  checks.push('formatted Markdown search, nested table context and focused-read isolation');
  await run('search_site_wiki', {query: '휴가신청'});
  await worker.evaluate(async entry => chrome.storage.local.set({browserKnowledge: {entries: [{...entry, documentVersion: 4, markdown: '# 변경된 지출 기준'}]}}), entry);
  assert.equal((await run('search_site_wiki', {query: '휴가신청'})).entries.length, 0);
  assert.equal((await run('read_site_wiki', {url: entry.url, version: 3})).error, 'wiki_changed');
  await worker.evaluate(async () => chrome.storage.local.set({browserKnowledge: {entries: []}}));
  assert.equal((await run('search_site_wiki', {query: '변경된 지출'})).entries.length, 0);
  checks.push('parsed snapshot invalidated after stored document edit and deletion');
  await mkdir('verification', {recursive: true});
  await writeFile('verification/wiki-search-browser.json', JSON.stringify({status: 'passed', browser: context.browser().version(), realModel: false, checks}, null, 2));
  console.log(JSON.stringify({status: 'passed', checks}));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
