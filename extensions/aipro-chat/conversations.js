// The active conversation remains in `chat` for the existing agent pipeline.
// Inactive provider slots and history contain other conversations, never a copy
// of the active one. Transitions are committed with one storage.local.set.
export const CONVERSATION_KEYS = ['chat', 'chatHistory', 'providerChats', 'activeProvider', 'providerModels', 'settings', 'activeSkillId'];
const providers = ['aipro', 'chatgpt', 'fabrix'];
export function newConversation(provider, modelId = '', now = Date.now()) {
  return {sessionId: crypto.randomUUID(), provider, modelId, createdAt: now, updatedAt: now, messages: [], draft: ''};
}
export function normalizeConversation(chat, provider, modelId = '', now = Date.now()) {
  const value = chat && Array.isArray(chat.messages) ? chat : {messages: [], draft: ''};
  return {...value, sessionId: value.sessionId || crypto.randomUUID(), provider,
    modelId: value.modelId || modelId, createdAt: value.createdAt || now, updatedAt: value.updatedAt || now};
}
export const hasConversation = chat => !!(chat?.messages?.length || chat?.draft?.trim() || chat?.draftAttachments?.length || chat?.title);
export function conversationTitle(chat) {
  return chat.title || chat.messages.find(m => m.role === 'user' && !m.contextOnly)?.content?.replace(/\s+/g, ' ').trim().slice(0, 64) || chat.draft?.replace(/\s+/g, ' ').trim().slice(0, 64) || chat.draftAttachments?.[0]?.name || '새 대화';
}
export function allConversations(state) {
  return [state.chat, ...Object.values(state.providerChats || {}), ...(state.chatHistory || [])].filter(Boolean);
}
export function conversationSummaries(state) {
  return allConversations(state).filter(hasConversation).map(chat => ({id: chat.sessionId, title: conversationTitle(chat),
    provider: chat.provider, updatedAt: chat.updatedAt, messages: chat.messages.filter(m => !m.contextOnly).length,
    current: chat.sessionId === state.chat.sessionId, paused: chat.task?.status === 'paused'})).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function migrateConversations(state, now = Date.now()) {
  const provider = providers.includes(state.activeProvider) ? state.activeProvider : 'aipro';
  const chat = normalizeConversation(state.chat, provider, state.settings?.modelId, now);
  const providerChats = Object.fromEntries(Object.entries(state.providerChats || {}).filter(([key]) => providers.includes(key) && key !== provider)
    .map(([key, value]) => [key, normalizeConversation(value, key, state.providerModels?.[key], now)]));
  const known = new Set([chat.sessionId, ...Object.values(providerChats).map(item => item.sessionId)]);
  const chatHistory = (state.chatHistory || []).filter(item => item?.sessionId && providers.includes(item.provider) && !known.has(item.sessionId) && known.add(item.sessionId));
  return {chat, providerChats, chatHistory};
}
export function snapshotConversation(state) {
  return {...state.chat, modelId: state.settings?.modelId || state.chat.modelId, skillId: state.activeSkillId || ''};
}
export function activateConversation(state, target) {
  if (target.sessionId === state.chat.sessionId) return {};
  const current = snapshotConversation(state), providerChats = {...state.providerChats};
  const chatHistory = (state.chatHistory || []).filter(item => item.sessionId !== target.sessionId);
  if (current.provider === target.provider) {
    if (hasConversation(current)) chatHistory.push(current);
  } else {
    providerChats[current.provider] = current;
    const previous = providerChats[target.provider];
    if (previous && previous.sessionId !== target.sessionId && hasConversation(previous)) chatHistory.push(previous);
  }
  delete providerChats[target.provider];
  return {chat: target, chatHistory, providerChats, activeProvider: target.provider, activeSkillId: target.skillId || '',
    providerModels: {...state.providerModels, [current.provider]: state.settings?.modelId},
    settings: {...state.settings, modelId: target.modelId || state.providerModels?.[target.provider] || (target.provider === 'chatgpt' ? 'gpt-5.6-sol' : 'GLM-5.2-NVFP4')}};
}
export function removeConversation(state, id) {
  const target = allConversations(state).find(item => item.sessionId === id);
  if (!target) throw new Error('conversation_missing');
  const patch = {chatHistory: (state.chatHistory || []).filter(item => item.sessionId !== id),
    providerChats: Object.fromEntries(Object.entries(state.providerChats || {}).filter(([, chat]) => chat.sessionId !== id))};
  if (state.chat.sessionId === id) {patch.chat = newConversation(state.activeProvider || 'aipro', state.settings?.modelId); patch.activeSkillId = '';}
  return patch;
}
export function renameConversation(state, id, title) {
  title = String(title || '').trim().slice(0, 80);
  if (!title) throw new Error('conversation_title');
  if (!allConversations(state).some(chat => chat.sessionId === id)) throw new Error('conversation_missing');
  const rename = chat => chat.sessionId === id ? {...chat, title} : chat;
  return {chat: rename(state.chat), providerChats: Object.fromEntries(Object.entries(state.providerChats || {}).map(([key, chat]) => [key, rename(chat)])),
    chatHistory: (state.chatHistory || []).map(rename)};
}
export function conversationCaptureIds(state) {
  return [...new Set(allConversations(state).flatMap(chat => chat.messages.flatMap(message => message.captures?.map(capture => capture.id) || [])))];
}
