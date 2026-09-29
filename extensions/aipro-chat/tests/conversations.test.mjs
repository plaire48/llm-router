import test from 'node:test';
import assert from 'node:assert/strict';
import {newConversation, migrateConversations, activateConversation, allConversations, conversationSummaries, removeConversation, renameConversation, conversationCaptureIds} from '../conversations.js';

const message = text => ({id: crypto.randomUUID(), role: 'user', content: text});
const state = () => ({activeProvider: 'aipro', settings: {modelId: 'glm', endpoint: 'unchanged'}, activeSkillId: 'source', ...migrateConversations({chat: {messages: [message('첫 질문')], draft: '초안'}, providerChats: {chatgpt: {messages: [message('별도 대화')], draft: 'GPT 초안'}}, settings: {modelId: 'glm'}})});
const apply = (state, patch) => ({...state, ...patch});

test('legacy provider conversations migrate once without losing messages or drafts', () => {
  const s = state();
  assert(s.chat.sessionId); assert.notEqual(s.chat.sessionId, s.providerChats.chatgpt.sessionId);
  assert.deepEqual(migrateConversations(s), {chat: s.chat, providerChats: s.providerChats, chatHistory: []});
  assert.equal(s.providerChats.chatgpt.draft, 'GPT 초안');
});
test('new and selected sessions preserve draft, model, summary, task and capture references', () => {
  let s = state();
  s.chat.memory = {summary: 'keep', throughId: s.chat.messages[0].id};
  s.chat.task = {status: 'paused', steps: [{tool: 'read_page'}]};
  s.chat.messages.push({id: 'reply', role: 'assistant', captures: [{id: 'image'}]});
  const original = structuredClone(s.chat);
  s = apply(s, activateConversation(s, newConversation('aipro', 'glm')));
  assert.equal(s.chat.messages.length, 0);
  assert.equal(s.chatHistory[0].draft, '초안');
  assert.deepEqual(conversationCaptureIds(s), ['image']);
  s = apply(s, activateConversation(s, s.chatHistory[0]));
  assert.deepEqual(s.chat, {...original, modelId: 'glm', skillId: 'source'});
  assert.equal(s.chatHistory.length, 0);
  assert.equal(s.settings.endpoint, 'unchanged');
});
test('cross-provider selection retains both provider slots and older conversations without duplicates', () => {
  let s = state(); const first = s.chat.sessionId;
  s = apply(s, activateConversation(s, newConversation('aipro', 'qwen')));
  s.chat.messages.push(message('두 번째')); s.settings.modelId = 'qwen';
  const second = s.chat.sessionId;
  s = apply(s, activateConversation(s, s.providerChats.chatgpt));
  s = apply(s, activateConversation(s, s.chatHistory.find(c => c.sessionId === first)));
  assert.equal(s.activeProvider, 'aipro'); assert.equal(s.settings.modelId, 'glm');
  assert.equal(s.chatHistory[0].sessionId, second);
  assert.equal(s.providerChats.chatgpt.draft, 'GPT 초안');
  const ids = allConversations(s).map(c => c.sessionId);
  assert.equal(new Set(ids).size, ids.length);
});
test('rename and delete affect only the requested session and retain other image references', () => {
  let s = state(); const first = s.chat.sessionId;
  s.chat.messages[0].captures = [{id: 'shared'}, {id: 'first'}];
  s.providerChats.chatgpt.messages[0].captures = [{id: 'shared'}, {id: 'other'}];
  s = apply(s, renameConversation(s, first, '  교육 준비  '));
  assert.equal(conversationSummaries(s).find(c => c.id === first).title, '교육 준비');
  assert.throws(() => renameConversation(s, first, ' '), /conversation_title/);
  s = apply(s, removeConversation(s, first));
  assert.deepEqual(new Set(conversationCaptureIds(s)), new Set(['shared', 'other']));
  assert.equal(s.chat.messages.length, 0); assert.notEqual(s.chat.sessionId, first);
  assert.throws(() => removeConversation(s, first), /conversation_missing/);
});
