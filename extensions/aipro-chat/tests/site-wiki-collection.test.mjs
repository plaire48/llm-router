import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {knowledgeOrigin, routeStep, extendRoute, redactWikiBody, parseWikiDraft, siteWikiOrigins, learnPage, knowledgePacket, wikiCreationMessages, KNOWLEDGE_TTL} from '../browser-knowledge.js';
import {openWikiTools} from '../openwiki-contract.js';
import {SYSTEM_PROMPT} from '../chat-contract.js';

const now = Date.parse('2026-09-01T00:00:00Z');
const page = (url, extra = {}) => ({url, title: '결재 목록', provider: 'chatgpt', verifiedAt: now - 1000, markdown: '# 결재 목록\n메뉴: 결재 > 목록', document: {headings: ['결재 목록'], controls: [], fields: []}, ...extra});

test('the route keeps safe pages in order and drops a detour when the run returns', () => {
  assert.deepEqual(routeStep('https://erp.example.test/app/list?menu=approval', ' 결재  목록 '), {url: 'https://erp.example.test/app/list?menu=approval', title: '결재 목록'});
  for (const [url, title] of [['https://erp.example.test/login', '로그인'], ['https://erp.example.test/app/view?id=123456', '상세'], ['https://erp.example.test/app', ''],
    ['https://erp.example.test/app', 'user@example.test 님'], ['javascript:alert(1)', '목록'], [null, '목록']]) assert.equal(routeStep(url, title), null, String(url));
  const step = (path, title) => routeStep(`https://erp.example.test${path}`, title);
  let route = extendRoute(undefined, step('/home', '홈'));
  route = extendRoute(route, step('/app/menu', '메뉴'));
  route = extendRoute(route, step('/app/wrong', '다른 화면'));
  route = extendRoute(route, step('/app/menu', '메뉴'));
  route = extendRoute(route, step('/app/list', '결재 목록'));
  assert.deepEqual(route.map(item => item.title), ['홈', '메뉴', '결재 목록']);
  assert.equal(extendRoute(route, null).length, 3);
  let long = [];
  for (let index = 0; index < 12; index++) long = extendRoute(long, step(`/p/${index}`, `화면 ${index}`));
  assert.equal(long.length, 8); assert.equal(long.at(-1).title, '화면 11');
  // Stored values are checked again: a forged entry never reaches a draft.
  assert.deepEqual(extendRoute([{url: 'https://erp.example.test/login', title: '로그인'}, {url: 'https://erp.example.test/a', title: 'A'}]), [{url: 'https://erp.example.test/a', title: 'A'}]);
});

test('a page with its own parameters still belongs to its site', () => {
  assert.equal(knowledgeOrigin('https://search.example.test/search?query=PRIVATE#x'), 'https://search.example.test');
  for (const value of ['https://user:secret@example.test/', 'chrome://settings', 'file:///private', 'nope', '']) assert.equal(knowledgeOrigin(value), null, value);
});

test('values that identify a person or a record are replaced in a drafted document', () => {
  const body = redactWikiBody('담당자 hong.gildong@corp.example.co.kr, 연락처 010-1234-5678, 주민번호 900101-1234567, 계정 12345678901234, 키 123e4567-e89b-12d3-a456-426614174000');
  assert.equal(body, '담당자 {이메일}, 연락처 {전화번호}, 주민번호 {주민등록번호}, 계정 {번호}, 키 {식별자}');
  // Amounts, dates, versions and short codes describe the screen and stay.
  const kept = '금액 1,000,000원 또는 1000000원, 기준일 2026-09-29, 버전 1.2.3, 코드 A-1024, 내선 1234';
  assert.equal(redactWikiBody(kept), kept);
  for (const [text, expected] of [['대표 02-123-4567', '대표 {전화번호}'], ['해외 +82 10-1234-5678', '해외 {전화번호}'], ['카드 1234-5678-9012-3456', '카드 {카드번호}'],
    ['계좌 110-123-456789', '계좌 {번호}'], ['사업자 123-45-67890', '사업자 {번호}'], ['사번 12345678901,12345678902', '사번 {번호},{번호}']]) assert.equal(redactWikiBody(text), expected);
  // Only the model's draft is changed. What the user reviewed and saved is stored as written.
  assert.equal(parseWikiDraft(JSON.stringify({title: '결재 목록', markdown: '문의: help@example.test'}), {redact: true}).markdown, '문의: {이메일}');
  assert.equal(parseWikiDraft(JSON.stringify({title: '결재 목록', markdown: '문의: help@example.test'})).markdown, '문의: help@example.test');
  assert.throws(() => parseWikiDraft(JSON.stringify({title: '결재', markdown: 'Bearer abc.def'})), /wiki_draft_invalid/);
});

test('the wiki tool names the sites that hold documents, and guidance names only offered tools', async () => {
  let state = learnPage({enabled: true, revision: 0, entries: []}, page('https://erp.example.test/app/list'), 0, now);
  state = learnPage(state, page('https://hr.example.test/leave', {title: '휴가 신청', verifiedAt: now - 500}), 0, now);
  state = learnPage(state, page('https://old.example.test/a', {verifiedAt: now - KNOWLEDGE_TTL - 5000}), 0, now);
  state = learnPage(state, page('https://other.example.test/a', {provider: 'fabrix'}), 0, now);
  assert.deepEqual(siteWikiOrigins(state, 'chatgpt', now), ['https://hr.example.test', 'https://erp.example.test']);
  assert.deepEqual(siteWikiOrigins({...state, enabled: false}, 'chatgpt', now), []);
  const tool = openWikiTools({internal: true, sites: [...siteWikiOrigins(state, 'chatgpt', now), 'https://x.test/path PRIVATE', 42]})[0].function;
  assert.match(tool.description, /Internal documents exist for: https:\/\/hr\.example\.test, https:\/\/erp\.example\.test\. On any other site/);
  assert(!tool.description.includes('PRIVATE'));
  assert(!openWikiTools({external: true, sites: ['https://erp.example.test']})[0].function.description.includes('Internal documents exist'));
  assert(!openWikiTools({internal: true})[0].function.description.includes('Internal documents exist'));
  // search_site_wiki and read_site_wiki are never offered to the model.
  for (const text of [SYSTEM_PROMPT, knowledgePacket([]).instruction]) assert(!/search_site_wiki|read_site_wiki/.test(text));
  assert.match(SYSTEM_PROMPT, /browserKnowledge inside read_page and browser_snapshot results/);
  const prompt = wikiCreationMessages({kind: 'wiki'})[0].content;
  assert.match(prompt, /task\.route/); assert.match(prompt, /주의할 점/); assert.match(prompt, /never write a failed path as a procedure/);
  const background = await readFile(new URL('../public/background.js', import.meta.url), 'utf8');
  assert.match(background, /observationDrift\(stored,url,lease\.provider,observation\)\) await chrome\.storage\.local\.set\(\{browserKnowledge:invalidatePage/);
  assert.match(background, /parseWikiDraft\(message\.content,\{redact:true\}\)/); assert.match(background, /parseWikiDraft\(JSON\.stringify\(message\.document\)\)/);
  assert.match(background, /knowledgeURL\(page\.origin \+ page\.pathname\)/);
  assert(!/checks\?\.some\(check=>\['text_present','url_is'\]/.test(background));
});
