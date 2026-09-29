import test from 'node:test';
import assert from 'node:assert/strict';
import {rankEvidence, evidenceExcerpt, searchTerms} from '../evidence-search.js';

test('retrieval combines Korean control names, surrounding regions, roles and symbols without inventing targets', () => {
  const docs = [{id: 'billing', name: '알림', context: '결제 설정', text: 'switch 스위치'},
    {id: 'shipping', name: '알림', context: '배송 설정', text: 'switch 스위치'},
    {id: 'draft', name: 'saveDraft', context: 'src/mail/editor.js', text: '초안 저장'}];
  assert.equal(docs.filter(d => `${d.name} ${d.context}`.includes('배송 설정의 알림 스위치')).length, 0, 'old full-phrase matching misses the actual control');
  const result = rankEvidence(docs, '배송 설정의 알림 스위치');
  assert.equal(result[0].id, 'shipping'); assert.equal(result[0].match.coverage, 1);
  assert(result.some(hit => hit.id === 'billing'), 'partial alternatives stay visible');
  assert.equal(rankEvidence(docs, 'editor saveDraft')[0].id, 'draft');
  assert.deepEqual(rankEvidence(docs, '없는항목'), []);
  assert.deepEqual(searchTerms('SaveDraft 배송의 설정을'), ['save', 'draft', '배송', '설정']);
  const tied = rankEvidence([{id: 1, name: '다운로드'}, {id: 2, name: '다운로드'}], '다운로드');
  assert.equal(tied.length, 2); assert.equal(tied[0].score, tied[1].score);
});

test('focused excerpt keeps a match past the former 16000-character boundary', () => {
  const text = `${'설명 '.repeat(7000)}배송 기준 37건은 승인 후 반영합니다.${' 후속 설명'.repeat(400)}`;
  const excerpt = evidenceExcerpt(text, '배송 기준');
  assert(excerpt.includes('배송 기준 37건')); assert(excerpt.length <= 1202); assert(excerpt.startsWith('…'));
});
