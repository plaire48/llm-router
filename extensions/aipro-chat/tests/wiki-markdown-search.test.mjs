import test from 'node:test';
import assert from 'node:assert/strict';
import {searchKnowledge, executeSiteWiki} from '../browser-knowledge.js';

const now = Date.now(), scope = {origin: 'https://portal.example', provider: 'aipro'};
const entry = (path, markdown) => ({url: scope.origin + path, provider: scope.provider, title: '업무 안내', verifiedAt: now, markdown, document: {headings: ['업무 안내']}});
const lookup = (markdown, query) => searchKnowledge({entries: [entry('/guide', markdown)]}, {...scope, query}, now);
const original = (markdown, excerpts) => {
  for (const excerpt of excerpts) {
    if (excerpt.range) assert.equal(excerpt.text, markdown.slice(excerpt.range.start, excerpt.range.end));
    for (const item of excerpt.context || []) assert.equal(item.text, markdown.slice(item.range.start, item.range.end));
  }
};

test('Korean compounds survive emphasis, inline code and reference link labels', () => {
  for (const text of ['휴가 **신청**', '휴가 `신청`', '**휴가** _신청_', '[휴가][leave] **신청**']) {
    const markdown = '# 업무\n\n' + text + ' 절차입니다.\n\n[leave]: https://portal.example/form';
    const result = lookup(markdown, '휴가신청');
    assert.equal(result.length, 1, text);
    assert.equal(result[0].excerpts[0].match.coverage, 1);
    original(markdown, result[0].excerpts);
  }
});

test('Markdown syntax targets and HTML attributes do not become visible text evidence', () => {
  const markdown = '# 안내\n\n[확인 화면](https://example.org/hiddenKeyword)\n\n<img data-value="secretKeyword">\n';
  assert.equal(lookup(markdown, 'hiddenKeyword').length, 0);
  assert.equal(lookup(markdown, 'secretKeyword').length, 0);
  assert.equal(lookup(markdown, '확인 화면').length, 1);
});

test('quoted and list-nested tables retain their own header at a distant row', () => {
  for (const prefix of ['> ', '  ']) {
    const markdown = '# 정산 안내\n\n' + (prefix === '  ' ? '- 업무 기준\n\n' : '') +
      prefix + '| 항목 | 지급 한도 |\n' + prefix + '| --- | --- |\n' +
      Array.from({length: 90}, (_, i) => prefix + `| 비용 ${i} | 사전 확인 |\n`).join('') + prefix + '| 심야교통비 | 검토 필요 |\n';
    const result = lookup(markdown, '심야교통비')[0];
    assert(result);
    assert(result.excerpts.some(excerpt => excerpt.context.some(item => item.kind === 'table_header' && item.text.includes('지급 한도'))), prefix);
    original(markdown, result.excerpts);
  }
});

test('plain-text indexing does not glue separate paragraphs, table cells or lines', () => {
  for (const markdown of ['# 안내\n\n휴가\n\n신청', '# 안내\n\n| 휴가 | 신청 |\n| --- | --- |\n| 해당 | 없음 |', '# 안내\n휴가\n신청']) {
    assert.equal(lookup(markdown, '휴가신청').length, 0, markdown);
  }
});

test('focused reads preserve their document scope and version amid broader search', () => {
  const a = entry('/a', '# 휴가\n**휴가** 신청 절차입니다.'), b = entry('/b', '# 비용\n국외정산 절차입니다.');
  const value = {entries: [a, b]};
  assert.equal(searchKnowledge(value, {...scope, query: '국외정산'}, now)[0].url, b.url);
  assert.equal(executeSiteWiki(value, scope, 'read_site_wiki', {url: a.url, version: 1, query: '국외정산'}, now).excerpts.length, 0);
  const result = executeSiteWiki(value, scope, 'read_site_wiki', {url: a.url, version: 1, query: '휴가신청'}, now);
  assert(result.excerpts.length > 0);
  assert(result.excerpts.every(excerpt => excerpt.url === a.url));
  original(a.markdown, result.excerpts);
  assert.equal(executeSiteWiki(value, scope, 'read_site_wiki', {url: a.url, version: 2, query: '휴가신청'}, now).error, 'wiki_changed');
});

test('text outside an excerpt never supplies its match and code fences stay literal', () => {
  const markdown = '# 처리 기준\n\n' + '일반 설명입니다. '.repeat(280) + '**최종검수**를 확인합니다.\n\n```md\n# 가짜 제목\n수동절차 예시\n```';
  const result = lookup(markdown, '최종검수')[0];
  assert(result.excerpts.every(excerpt => excerpt.text.includes('최종검수')));
  original(markdown, result.excerpts);
  assert.equal(lookup(markdown, '수동절차')[0].excerpts[0].section, '# 처리 기준');
});
