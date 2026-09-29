import test from 'node:test';
import assert from 'node:assert/strict';
import {searchKnowledge, executeSiteWiki} from '../browser-knowledge.js';
import {wikiChunks} from '../site-wiki-retrieval.js';

const now = Date.now(), scope = {origin: 'https://portal.example', provider: 'aipro'};
const entry = markdown => ({url: scope.origin + '/guide', title: '업무 안내', provider: scope.provider, verifiedAt: now, markdown, document: {headings: ['업무 안내']}});
const search = (markdown, query) => searchKnowledge({entries: [entry(markdown)]}, {...scope, query}, now);
const exactRanges = (markdown, excerpts) => {
  for (const excerpt of excerpts) {
    if (excerpt.range) assert.equal(excerpt.text, markdown.slice(excerpt.range.start, excerpt.range.end));
    for (const context of excerpt.context || []) assert.equal(context.text, markdown.slice(context.range.start, context.range.end));
    assert(excerpt.text.length <= 900);
    assert((excerpt.context || []).reduce((n, item) => n + item.text.length, 0) <= 600);
    assert.equal(excerpt.match.confidence, false);
  }
};

test('Korean spacing variants retrieve complete terms in both directions', () => {
  for (const [body, query] of [['휴가 신청 절차를 확인합니다.', '휴가신청'], ['휴가신청 절차를 확인합니다.', '휴가 신청']]) {
    const result = search('# 안내\n' + body, query);
    assert.equal(result.length, 1, query);
    assert.equal(result[0].excerpts[0].match.coverage, 1, query);
    assert.equal(result[0].excerpts[0].match.kind, 'lexical');
  }
});

test('fenced pseudo-headings cannot replace the enclosing real heading', () => {
  const markdown = '# 실제 업무\n\n```markdown\n# 가짜 제목\n예시코드\n```\n\n사후검수 절차를 확인합니다.';
  const result = search(markdown, '사후검수')[0];
  assert.equal(result.excerpts[0].section, '# 실제 업무');
  exactRanges(markdown, result.excerpts);
});

test('setext headings and nested ancestors retain separate original ranges', () => {
  const markdown = '출장 관리\n=========\n\n## 국내 출장\n\n### 정산 기준\n\n증빙확인 절차를 따릅니다.';
  const result = search(markdown, '증빙확인')[0];
  const context = result.excerpts[0].context;
  assert.deepEqual(context?.filter(item => item.kind === 'heading').map(item => item.text), ['출장 관리\n=========', '## 국내 출장', '### 정산 기준']);
  exactRanges(markdown, result.excerpts);
});

test('late table rows retrieve their column headers without changing source ranges', () => {
  const markdown = '# 비용 기준\n\n| 항목 | 지급 한도 |\n| --- | --- |\n' +
    Array.from({length: 90}, (_, i) => `| 기준 ${i} | 확인 필요 |\n`).join('') + '| 심야교통비 | 사전 확인 |';
  const result = search(markdown, '심야교통비')[0];
  const excerpt = result.excerpts.find(item => item.text.includes('심야교통비'));
  assert(excerpt.context?.some(item => item.kind === 'table_header' && item.text.includes('지급 한도')));
  assert(!excerpt.text.startsWith('| 항목'), 'the original late row slice must not get a synthetic prefix');
  exactRanges(markdown, result.excerpts);
});

test('spacing fallback does not match reordered syllables, line breaks or absent terms', () => {
  const markdown = '# 안내\n휴가 신청\n\n비용\n\n정산';
  for (const query of ['신청휴가', '비용정산', '보안검토']) assert.deepEqual(search(markdown, query), [], query);
});

test('focused read preserves source context and rejects an obsolete document version', () => {
  const markdown = '# 업무\n\n## 휴가 신청\n\n검토기준을 먼저 확인합니다.';
  const value = {entries: [entry(markdown)]};
  const result = executeSiteWiki(value, scope, 'read_site_wiki', {url: scope.origin + '/guide', version: 1, query: '휴가신청'}, now);
  assert(result.excerpts.some(item => item.text.includes('검토기준')));
  exactRanges(markdown, result.excerpts);
  assert.equal(executeSiteWiki(value, scope, 'read_site_wiki', {url: scope.origin + '/guide', version: 2, query: '휴가신청'}, now).error, 'wiki_changed');
});

test('GFM escaped pipes, CRLF and Unicode preserve exact original offsets', () => {
  const markdown = '# 📋 정산 &amp; 안내\r\n\r\n| 업무\\|유형 | 확인 |\r\n| --- | --- |\r\n| 교통비 | 사전검토 |\r\n';
  const result = search(markdown, '사전검토')[0];
  assert(result.excerpts.some(item => item.context.some(part => part.kind === 'table_header' && part.text.includes('업무\\|유형'))));
  exactRanges(markdown, result.excerpts);
});

test('oversized source context is explicitly truncated and stays within budget', () => {
  const markdown = '# ' + '긴제목'.repeat(230) + '\n\n| ' + '긴머리글'.repeat(180) + ' | 설명 |\n| --- | --- |\n' +
    Array.from({length: 80}, (_, i) => `| 기준 ${i} | 검토 |\n`).join('') + '| 마지막비용 | 확인 |';
  const result = search(markdown, '마지막비용')[0];
  assert(result.excerpts[0].contextTruncated);
  assert(result.excerpts[0].context.some(item => item.truncated));
  exactRanges(markdown, result.excerpts);
});

test('bounded chunks cover all source characters, including dense heading tails', () => {
  for (const markdown of ['# 항목\n' + '일반설명 '.repeat(2600), Array.from({length: 700}, (_, i) => `## 항목 ${i}\n내용\n`).join('')]) {
    const chunks = wikiChunks(markdown);
    assert(chunks.length <= 64);
    let covered = 0;
    for (const chunk of chunks) {
      assert(chunk.start <= covered);
      assert.equal(chunk.text, markdown.slice(chunk.start, chunk.end));
      covered = Math.max(covered, chunk.end);
    }
    assert.equal(covered, markdown.length);
  }
});

test('parsed snapshot observes edits, expiry, deletion, revocation and provider changes', () => {
  const original = entry('# 업무\n\n휴가 신청 절차입니다.');
  const lookup = (entries, extra = {}, at = now) => searchKnowledge({entries, ...extra}, {...scope, query: '휴가신청'}, at);
  assert.equal(lookup([original]).length, 1);
  assert.equal(lookup([{...original, markdown: '# 업무\n\n지출 절차입니다.'}]).length, 0, 'even an edit without a version bump changes the source');
  assert.equal(lookup([original]).length, 1);
  assert.equal(lookup([{...original, markdownNeedsReview: true}]).length, 0);
  assert.equal(lookup([original]).length, 1);
  assert.equal(lookup([original], {}, now + 31 * 86400000).length, 0);
  assert.equal(lookup([original]).length, 1);
  assert.equal(lookup([]).length, 0);
  assert.equal(lookup([original]).length, 1);
  assert.equal(lookup([original], {enabled: false}).length, 0);
  assert.equal(lookup([{...original, provider: 'fabrix'}]).length, 0);
});

test('returned context cannot mutate a later lookup of the cached source', () => {
  const markdown = '# 휴가 신청\n\n검토기준을 확인합니다.';
  const first = search(markdown, '검토기준')[0];
  first.excerpts[0].context[0].text = 'poisoned';
  first.excerpts[0].context[0].range.start = 9000;
  const next = search(markdown, '검토기준')[0];
  assert.equal(next.excerpts[0].context[0].text, '# 휴가 신청');
  exactRanges(markdown, next.excerpts);
});
