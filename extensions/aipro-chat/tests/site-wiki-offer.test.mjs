import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hasSiteWiki, learnPage, invalidatePage, searchKnowledge, KNOWLEDGE_TTL} from '../browser-knowledge.js';

const now = Date.now();
const candidate = {url: 'https://portal.example/work?menu=FP', title: 'FP 업무', provider: 'chatgpt', verifiedAt: now,
  document: {headings: ['FP 업무'], fields: [{name: '투입 시간', role: 'spinbutton', required: true}]}, markdown: '# 업무 기록\n투입 시간은 사용자에게 확인합니다.'};

test('an empty, disabled, other-provider, stale or invalidated wiki is not offered', () => {
  assert.equal(hasSiteWiki(null, 'chatgpt', now), false);
  assert.equal(hasSiteWiki({entries: []}, 'chatgpt', now), false);
  const state = learnPage(null, candidate, 0, now);
  assert.equal(searchKnowledge(state, {origin: 'https://portal.example', provider: 'chatgpt', query: '투입 시간'}, now).length > 0, true);
  assert.equal(hasSiteWiki(state, 'chatgpt', now), true);
  assert.equal(hasSiteWiki(state, 'aipro', now), false);
  assert.equal(hasSiteWiki(state, 'unknown', now), false);
  assert.equal(hasSiteWiki({...state, enabled: false}, 'chatgpt', now), false);
  assert.equal(hasSiteWiki(state, 'chatgpt', now + KNOWLEDGE_TTL + 1), false);
  assert.equal(hasSiteWiki({...state, entries: state.entries.map(entry => ({...entry, invalidated: true}))}, 'chatgpt', now), false);
});

test('the chat start offers the internal wiki through this check, not the enabled flag alone', async () => {
  const source = await readFile(new URL('../public/background.js', import.meta.url), 'utf8');
  assert.match(source, /internal: skill\?\.allowAutomation === true && hasSiteWiki\(browserKnowledge, credential\.provider \|\| 'aipro'\)/);
  assert(!/internal: skill\?\.allowAutomation === true && knowledgeState\(browserKnowledge\)\.enabled/.test(source));
});
