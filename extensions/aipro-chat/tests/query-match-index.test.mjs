import test from 'node:test';
import assert from 'node:assert/strict';
import {contentPacket} from '../browser-content.js';

const section = (title, body) => `## ${title}\n\n${body}\n\n` + 'Procedural filler sentence about organisation. '.repeat(110) + '\n\n';
const text = '# Technical rules\n\n' + section('Contents', 'The target at foil. The target at epee. The target at sabre.') +
  section('Epee target', 'At epee the target includes the whole of the body of the fencer including clothing and equipment.') +
  section('Sabre target', 'At sabre the target comprises any part of the body above the hips, excluding the hands.');
const source = {url: 'https://example.test/rules.pdf', title: 'Rules', frame: 0, documentId: 'doc-1', sourceIdentity: ['doc-1', 'https://example.test/rules.pdf'], text, method: 'test', coverage: {partial: false}};

test('a focused read lists every ranked candidate with exact offsets and verbatim excerpts', async () => {
  const packet = await contentPacket(source, {query: 'target sabre epee'});
  const {matches, total_matches} = packet.retrieval;
  assert.equal(packet.ranges.length, 1);
  assert(total_matches >= 3 && matches.length >= 3 && matches.length <= 8);
  assert.deepEqual(matches.filter(match => match.returned).map(match => match.result_offset), [0]);
  assert.equal(matches[0].start, packet.ranges[0].start);
  for (const match of matches) {
    assert.equal(text.slice(match.start, match.end).includes(match.excerpt.replace(/^…|…$/g, '')), true);
    assert(match.excerpt.length <= 162 && match.terms.length > 0);
  }
  assert(matches.some(match => /excluding the hands/.test(text.slice(match.start, match.end))));
});

test('rewording the query no longer hides the other candidates, and each opens by result_offset or start', async () => {
  const first = await contentPacket(source, {query: 'target'}), reworded = await contentPacket(source, {query: 'the target'});
  assert.equal(first.ranges[0].start, reworded.ranges[0].start);
  const other = first.retrieval.matches.find(match => !match.returned);
  const opened = await contentPacket(source, {query: 'target', offset: other.result_offset, content_hash: first.content_hash});
  assert.equal(opened.ranges[0].start, other.start);
  assert.deepEqual(opened.retrieval.matches.filter(match => match.returned).map(match => match.result_offset), [other.result_offset]);
  const sequential = await contentPacket(source, {offset: other.start, content_hash: first.content_hash});
  assert.equal(sequential.ranges[0].start, other.start);
  assert.equal(sequential.retrieval, undefined);
});

test('no match reports zero candidates and does not invent a range', async () => {
  const packet = await contentPacket(source, {query: '유효면'});
  assert.deepEqual(packet.ranges, []); assert.deepEqual(packet.retrieval.matches, []); assert.equal(packet.retrieval.total_matches, 0);
  assert.match(packet.retrieval.scope, /No word matched/);
});

test('PDF candidates carry only the pages that overlap their range', async () => {
  const half = Math.floor(text.length / 2);
  const packet = await contentPacket({...source, pdf: {page_count: 2}, pageRanges: [{page: 1, start: 0, end: half, textAvailable: true}, {page: 2, start: half, end: text.length, textAvailable: true}]}, {query: 'sabre'});
  for (const match of packet.retrieval.matches) {
    assert(match.pages[0] === (match.start < half ? 1 : 2) && match.pages[1] === (match.end > half ? 2 : 1));
  }
});

test('a short text from a link-heavy document says that links are missing, and ordinary pages do not', async () => {
  const index = {...source, text: '# Rules\n\nStatutes and rules of the federation.', links: {inDocument: 42, inText: 0}};
  const packet = await contentPacket(index);
  assert.deepEqual([packet.link_coverage.in_document, packet.link_coverage.in_returned_text], [42, 0]);
  assert.match(packet.link_coverage.instruction, /browser_snapshot/);
  assert.equal((await contentPacket({...index, links: {inDocument: 6, inText: 4}})).link_coverage, undefined);
  assert.equal((await contentPacket({...source, links: {inDocument: 300, inText: 0}})).link_coverage, undefined);
  assert.equal((await contentPacket({...index, links: undefined})).link_coverage, undefined);
});
