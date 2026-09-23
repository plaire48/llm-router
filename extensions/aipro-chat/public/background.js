import {browserCollaboration,A2A_ERRORS} from './a2a-connection.js';
import {documentBindings, documentToolDefinitions, DOCUMENT_TOOL_NAMES, executeDocumentTool} from './document-tools.js';
import {createBackgroundRunner} from './background-runner.js';
import {compareImages} from './background-images.js';
import {visionModelFor} from './model-routing.js';
import {completionDiagnostic} from './completion-errors.js';
import {ATTACHMENT_LIMITS, attachmentIds} from './attachments.js';
import {saveAttachments, readAttachment, deleteAttachments, pruneAttachments} from './attachment-store.js';
import {clearApproval, readApprovalDraft, approvalPresentation} from './browser-approval.js';
import {PROJECT_TOOL_NAMES, projectSummary, projectContext, readProjectTool} from './project-tools.js';
import {projectCandidate, connectProject, revokeProject} from './project-connection.js';
import {loadWikiFolder, commitWikiFolder, clearWikiFolder, wikiFolderSummary, executeWikiFolderTool} from './wiki-folder.js';
import {questionArgs, makeQuestion, questionAnswer, questionContext, QUESTION_TEXT_LIMIT} from './user-question.js';
import {CONVERSATION_KEYS, newConversation, migrateConversations, allConversations, conversationSummaries, activateConversation, removeConversation, renameConversation, conversationCaptureIds} from './conversations.js';
import {normalizeTrace} from './agent-trace.js';
import {ORIGIN, MODEL_CATALOG_VERSION, DEFAULT_SETTINGS, ERROR_TEXT, cleanSettings, cleanCredential, inspectModelList, fail} from './core.js';
import {handleCallback} from './callback.js';
import {normalizeUsage} from './usage.js';
import {recordUsage, finishUsage, usageSummary} from './usage-ledger.js';
import {ACCOUNT_USAGE_VERSION, normalizeAccountUsage} from './account-usage.js';
import {CHAT_TIMEOUT_MS} from './chat-contract.js';
import {allSkills, normalizeSkill, browserTools, automaticSkillTools, taskSkillId} from './skills.js';
import {skillLibrary, skillCatalog, bindSkillLibrary, skillLibraryTools, executeSkillTool, SKILL_TOOL_NAMES} from './skill-library.js';
import {runPageOperation} from './page-tools.js';
import {runBrowserAgent, runApprovedAction, stopBrowserAgent, browserAgentRequestForTab, browserAgentContext, resolveBrowserTab, browserURL} from './browser-agent.js';
import {createWorkspace, workspaceMatches, workspaceTab, readyWorkspaceTab, releaseWorkspace, showWorkspace} from './browser-workspace.js';
import {normalizeSummary, normalizePlan, taskReceipt, pauseTask, resumedVerification} from './context-state.js';
import {taskProgress} from './task-plan.js';
import {LOGIN_REDIRECT_RULE_ID, loginRedirectRule, validRedirectSender} from './login-redirect.js';
import {exchangeCode} from './exchange.js';
import {CHATGPT_AUTH_ORIGIN, CHATGPT_REDIRECT, createChatGPTLogin, validChatGPTFlow, chatGPTCallback, exchangeChatGPTCode, refreshChatGPTToken} from './chatgpt-auth.js';
import {cleanFabrixCredentials, fabrixSettings, fabrixModels, fabrixDiagnostic} from './fabrix.js';
import {saveCapture, savePageImage, deleteCaptures, pruneCaptures} from './capture-store.js';
import {PROVIDERS, providerSession, updateProviderSession, connectionStatuses, activateProviderSession, removeProviderSession} from './provider-sessions.js';

const boot = Promise.all([
  chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}),
  chrome.storage.local.get('settings').then(({settings}) => chrome.storage.local.set({settings: cleanSettings(settings)})),
  migrateLogin(),
  migrateChatHistory().then(pruneCaptureHistory),
]);
let queue = Promise.resolve();
let activeExchange = null;
let activeRefresh = null;
let activeFabrix = null;
let toolBusy = false;
const endedWorkspaceRequests = new Set();
function endWorkspaceRequest(id) {
  endedWorkspaceRequests.add(id);
  if (endedWorkspaceRequests.size > 100) endedWorkspaceRequests.delete(endedWorkspaceRequests.values().next().value);
}
const serial = (task) => { const run = queue.then(() => boot).then(task); queue = run.catch(() => {}); return run; };
const getSession = async () => chrome.storage.session.get(null);
// An in-memory capability, never a document ID or a message-supplied flag.
const collaboration=browserCollaboration({session:getSession,saveSession:value=>chrome.storage.session.set(value),conversation:readConversationState,saveChat});
const RUNNER = Object.freeze({});
const RUNNER_TYPES = new Set(['SAVE_CONTEXT', 'RUN_TOOL', 'APPLY_FILL', 'RECORD_USAGE', 'MODEL_DIAGNOSTIC', 'FINISH_CHAT']);
const runner = createBackgroundRunner({
  call: (type, value) => type === 'PREPARE_CREDENTIAL' ? prepareCredential({type, ...value}, RUNNER) : serial(async () => {
    const longOperation = ['RUN_TOOL', 'APPLY_FILL'].includes(type);
    if (longOperation) toolBusy = true;
    try {return await handle({type, ...value}, RUNNER);} finally {if (longOperation) toolBusy = false;}
  }),
  compareImages,
  publish: snapshot => serial(async () => {
    const {chatLease, credential} = await getSession();
    if (!chatLease || chatLease.id !== snapshot.requestId || chatLease.owner !== 'worker' || chatLease.cancelled || credential?.receivedAt !== chatLease.credentialReceivedAt) return;
    await chrome.storage.session.set({agentRun: snapshot});
  }),
});

async function readConversationState() {
  const local = await chrome.storage.local.get(CONVERSATION_KEYS);
  if (!local.chat?.sessionId || !Array.isArray(local.chatHistory) || Object.values(local.providerChats || {}).some(chat => !chat.sessionId)) {
    const patch = migrateConversations(local);
    await chrome.storage.local.set(patch);
    return {...local, ...patch};
  }
  return local;
}
async function migrateChatHistory() {await readConversationState();}
async function saveChat(chat) {
  const progress = taskProgress(chat.task);
  if (progress) chat.messages = chat.messages.map(message => message.id === chat.task.requestId ? {...message, progress} : message);
  await chrome.storage.local.set({chat: {...chat, updatedAt: Date.now()}});
}
async function pruneCaptureHistory() {
  if (typeof indexedDB === 'undefined') return;
  const local = await chrome.storage.local.get(CONVERSATION_KEYS);
  await pruneCaptures(conversationCaptureIds(local)).catch(() => {});
  await pruneAttachments(attachmentIds(local)).catch(() => {});
}
async function commitConversationChange(local, patch) {
  // A failed quota write must retain the entire old selection and history.
  await chrome.storage.local.set(patch);
  const remaining = new Set(conversationCaptureIds({...local, ...patch}));
  await deleteCaptures(conversationCaptureIds(local).filter(id => !remaining.has(id))).catch(() => {});
  const retainedFiles = new Set(attachmentIds({...local, ...patch}));
  await deleteAttachments(attachmentIds(local).filter(id => !retainedFiles.has(id))).catch(() => {});
}
async function attachCapture(lease, screenshot, image, save = saveCapture, traceId) {
  const current = (await getSession()).chatLease;
  if (!current || current.id !== lease.id || current.cancelled) throw new Error('cancelled');
  let attachment;
  try {attachment = await save({screenshot, image, requestId: lease.id, provider: lease.provider, traceId});}
  catch (error) {
    const {chat} = await chrome.storage.local.get('chat');
    const reply = chat?.messages.find(message => message.id === lease.id);
    if (reply) {reply.captureError = error.message === 'capture_storage_full' ? error.message : 'capture_save_failed'; await saveChat(chat);}
    return {error: error.message === 'capture_storage_full' ? error.message : 'capture_save_failed'};
  }
  try {
    const {chat} = await chrome.storage.local.get('chat');
    const latest = (await getSession()).chatLease;
    const reply = chat?.messages.find(message => message.id === lease.id);
    if (!reply || latest?.id !== lease.id || latest.cancelled) throw new Error('cancelled');
    reply.captures = [...(reply.captures || []), attachment];
    await saveChat(chat);
    return {id: attachment.id, availableInChat: true};
  } catch (error) {await deleteCaptures([attachment.id]).catch(() => {}); throw error;}
}
async function saveUserQuestion(lease, args, attachments = []) {
  const current = (await getSession()).chatLease;
  if (current?.id !== lease.id || current.cancelled) fail('interrupted');
  const {chat} = await chrome.storage.local.get('chat');
  const reply = chat?.messages.find(message => message.id === lease.id);
  if (!reply || chat.sessionId !== lease.conversationId) fail('interrupted');
  reply.question = makeQuestion(args.question, attachments, reply.captures || [], args);
  await saveChat(chat);
  await chrome.storage.session.set({chatLease: {...current, awaitingUser: true}});
  return {requiresUserInput: true, questionId: reply.question.id};
}
async function revokeActionApproval(conversationId) {
  const {actionApprovals = {}} = await getSession();
  const record = actionApprovals[conversationId];
  delete actionApprovals[conversationId];
  await chrome.storage.session.set({actionApprovals});
  await clearApproval(record);
}
async function rememberBrowserContext(lease) {
  const context = browserAgentContext(lease.id);
  const {chatLease, browserContexts = {}, browserWorkspaces = {}} = await getSession();
  if (!context || chatLease?.id !== lease.id || chatLease.cancelled) return;
  delete browserContexts[lease.conversationId];
  browserContexts[lease.conversationId] = {context, provider: lease.provider, credentialReceivedAt: lease.credentialReceivedAt};
  if (context.workspace) browserWorkspaces[lease.conversationId] = context.workspace;
  await chrome.storage.session.set({chatLease: {...chatLease, browserContext: context}, browserContexts: Object.fromEntries(Object.entries(browserContexts).slice(-40)), browserWorkspaces});
}
async function saveActionApproval(lease, record, verifiedBeforeTool) {
  if (!verifiedBeforeTool || record.afterActions) return {error: 'approval_verification_required'};
  const {chatLease, actionApprovals = {}} = await getSession();
  const {chat} = await chrome.storage.local.get('chat');
  const reply = chat?.messages.find(message => message.id === lease.id);
  if (chatLease?.id !== lease.id || chatLease.cancelled || !reply || chat.sessionId !== lease.conversationId) fail('interrupted');
  const presentation = approvalPresentation(record);
  const question = {id: crypto.randomUUID(), kind: 'approval', action: record.action, targetLabel: record.label, ...presentation,
    pageTitle: record.pageTitle, preview: record.preview, hasEditableDraft: record.hasEditableDraft, summary: record.summary,
    options: [{id: 'approve', label: presentation.buttonLabel}, {id: 'reject', label: '취소'}]};
  const {preview, summary, afterActions, ...binding} = record;
  const previous = actionApprovals[chat.sessionId];
  actionApprovals[chat.sessionId] = {...binding, browserContext: browserAgentContext(lease.id), questionId: question.id, conversationId: chat.sessionId,
    provider: lease.provider, credentialReceivedAt: lease.credentialReceivedAt};
  await chrome.storage.session.set({actionApprovals});
  try {
    reply.question = question;
    await saveChat(chat);
    await chrome.storage.session.set({chatLease: {...chatLease, awaitingUser: true}});
  } catch (error) {await revokeActionApproval(chat.sessionId); throw error;}
  await clearApproval(previous);
  return {requiresUserInput: true, questionId: question.id, instruction: 'Draft is ready. Stop here and wait for the approval buttons in chat. Do not click, publish, or run more tools.'};
}
async function event(name, details = {}) {
  const {events = []} = await getSession();
  await chrome.storage.session.set({events: [...events.slice(-39), {time: new Date().toISOString(), event: name, ...details}]});
}
async function removeLoginRedirect() {
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [LOGIN_REDIRECT_RULE_ID]});
}
async function migrateLogin() {
  const {attempt, guardTab, receiverTab, receiverTransport, loginFlow} = await chrome.storage.session.get(['attempt', 'guardTab', 'receiverTab', 'receiverTransport', 'loginFlow']);
  if (['aipro', 'chatgpt'].includes(attempt?.provider) && attempt.receiverVersion === 4 && attempt.phase === 'waiting' && attempt.expiresAt > Date.now() &&
      (attempt.provider === 'aipro' || validChatGPTFlow(loginFlow, attempt.id))) {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const tab = await chrome.tabs.get(attempt.tabId).catch(() => null);
    // Session rules survive worker suspension. Never persist or replay an exchange code.
    if (tab && receiverTab === attempt.tabId && receiverTransport === 'redirect' &&
        rules.some(rule => rule.id === LOGIN_REDIRECT_RULE_ID && rule.condition.tabIds?.[0] === attempt.tabId &&
          rule.condition.regexFilter === loginRedirectRule(attempt, chrome.runtime.getURL('auth-return.html')).condition.regexFilter &&
          rule.action.redirect?.regexSubstitution === loginRedirectRule(attempt, chrome.runtime.getURL('auth-return.html')).action.redirect.regexSubstitution)) return;
  }
  await chrome.storage.session.remove(['attempt', 'guardTab', 'receiverTab', 'receiverTransport', 'authTrace', 'loginFlow']);
  await chrome.alarms.clear('login-timeout');
  await chrome.alarms.clear('callback-settle');
  await chrome.alarms.clear('callback-close');
  const tabId = receiverTab ?? guardTab ?? attempt?.tabId;
  if (Number.isInteger(tabId)) {
    await chrome.tabs.remove(tabId).catch(() => {});
    if (receiverTransport !== 'redirect') await chrome.debugger.detach({tabId}).catch(() => {});
  }
  await removeLoginRedirect();
  if (attempt) {
    const error = attempt.phase === 'exchanging' ? 'exchange_interrupted' : 'login_closed';
    await chrome.storage.session.set({authReport: {stage: error, error, provider: attempt.provider || 'aipro'}});
  }
}
async function clearLogin(code, closeTab = false) {
  if (activeFabrix) {activeFabrix.controller.abort(); activeFabrix = null;}
  await chrome.storage.session.remove('fabrixTest');
  if (activeRefresh) {activeRefresh.controller.abort(); activeRefresh = null;}
  if (activeExchange) {activeExchange.controller.abort(); activeExchange = null;}
  const {attempt, receiverTab, guardTab, receiverTransport} = await getSession();
  await chrome.storage.session.remove(['attempt', 'receiverTab', 'guardTab', 'receiverTransport', 'loginFlow']);
  await chrome.alarms.clear('login-timeout');
  await chrome.alarms.clear('callback-settle');
  await chrome.alarms.clear('callback-close');
  const tabId = receiverTab ?? guardTab ?? attempt?.tabId;
  // Close before removing the rule or detaching so a cancelled callback cannot reach localhost.
  if (closeTab && Number.isInteger(tabId)) await chrome.tabs.remove(tabId).catch(() => {});
  await removeLoginRedirect();
  if (Number.isInteger(tabId) && receiverTransport !== 'redirect' && attempt?.receiverVersion !== 4) await chrome.debugger.detach({tabId}).catch(() => {});
  if (code && attempt) await chrome.storage.session.set({authReport: {stage: code, error: code, provider: attempt.provider || 'aipro'}});
}
async function attachReceiver(attempt) {
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [LOGIN_REDIRECT_RULE_ID],
    addRules: [loginRedirectRule(attempt, chrome.runtime.getURL('auth-return.html'))]});
  await chrome.storage.session.set({receiverTab: attempt.tabId, receiverTransport: 'redirect'});
}

function ownsChat(lease, sender, clientId) {
  if (!lease) return false;
  if (lease.owner === 'worker') return sender === RUNNER && runner.has(lease.id);
  if (lease.documentId && sender?.documentId) return lease.documentId === sender.documentId;
  return !!lease.clientId && lease.clientId === clientId;
}
function recoverReply(message) {
  return message.question ? {...message, content: '', state: 'done', error: null} : {...message, state: 'error', error: 'interrupted'};
}
async function touchChatLease(lease) {
  const now = Date.now();
  if (!lease.cancelled && lease.until > now && (!lease.lastSeenAt || now - lease.lastSeenAt >= 5000)) {
    await chrome.storage.session.set({chatLease: {...lease, lastSeenAt: now, until: now + CHAT_TIMEOUT_MS + 60000}});
  }
}
async function recoverChat(sender, clientId) {
  const {chatLease, agentRun} = await getSession();
  if (!chatLease) {
    await stopBrowserAgent();
    if (!activeFabrix) await settleUsage();
    const {chat} = await chrome.storage.local.get('chat');
    if (chat?.messages.some(m => m.state === 'pending')) {
      chat.messages = chat.messages.map(m => m.state === 'pending' ? recoverReply(m) : m);
      if (chat.task?.status === 'running') chat.task = chat.messages.find(m => m.id === chat.task.requestId)?.question ? {...chat.task, status: 'awaiting_user'} : pauseTask(chat.task);
      await saveChat(chat);
    }
    return;
  }
  if (chatLease.owner === 'worker' && runner.has(chatLease.id)) return;
  // A worker generation ended. Never reissue an uncertain action on startup.
  if (chatLease.owner !== 'worker' && chatLease.until > Date.now()) {
    if (ownsChat(chatLease, sender, clientId)) {
      // A message from the owner proves it is alive even when a side panel has no documentId.
      await touchChatLease(chatLease);
      return;
    }
    const contexts = await chrome.runtime.getContexts({}).catch(() => []);
    if (chatLease.documentId && contexts.some(c => c.documentId === chatLease.documentId)) return;
    const replacedTab = Number.isInteger(chatLease.tabId) && sender?.tab?.id === chatLease.tabId &&
      sender.documentId && chatLease.documentId && sender.documentId !== chatLease.documentId;
    if (!replacedTab && Date.now() - (chatLease.lastSeenAt || 0) < 30000) return;
  }
  await stopBrowserAgent(chatLease.id);
  const {chat = {messages: [], draft: ''}} = await chrome.storage.local.get('chat');
  chat.messages = chat.messages.map(m => m.requestId === chatLease.id ? recoverReply({...m, ...(agentRun?.requestId === m.id ? {content: agentRun.partial || m.content, trace: agentRun.trace || m.trace} : {})}) : m);
  if (chat.task?.requestId === chatLease.id) chat.task = chat.messages.find(m => m.id === chatLease.id)?.question ? {...chat.task, status: 'awaiting_user'} : pauseTask(chat.task);
  await saveChat(chat);
  await chrome.storage.session.remove(['chatLease', 'agentRun']);
  await settleUsage(chatLease.id);
}
async function settleUsage(requestId) {
  try {
    const {usageLedger} = await chrome.storage.local.get('usageLedger');
    const updated = finishUsage(usageLedger, requestId || usageLedger?.active?.requestId);
    if (updated !== usageLedger) await chrome.storage.local.set({usageLedger: updated});
  } catch { /* Logging must not break chat recovery. */ }
}
async function projectBinding(session) {
  try {
    const folder = await loadWikiFolder();
    const summary = folder ? await wikiFolderSummary(folder) : null;
    return {connection: folder || session.projectConnection, project: folder ? summary : projectSummary(session.projectConnection), wikiFolder: summary};
  } catch {
    // A failed local database must not break unrelated chat or silently switch
    // a configured folder to another project's data source.
    return {connection: null, project: null, wikiFolder: null, wikiFolderError: 'project_storage'};
  }
}
async function state(sender, clientId, readOnly = false) {
  if (!readOnly) {await readConversationState(); await recoverChat(sender, clientId);}
  const session = await getSession();
  const {browserWorkMode = 'window'} = await chrome.storage.local.get('browserWorkMode');
  const {settings = DEFAULT_SETTINGS, chat = {messages: [], draft: ''}, skills = [], activeSkillId = '', activeProvider = 'aipro', fabrixConnection = null} = await chrome.storage.local.get(['settings', 'chat', 'skills', 'activeSkillId', 'activeProvider', 'fabrixConnection']);
  const c = (session.credential?.provider || 'aipro') === activeProvider ? session.credential : null;
  const {usageLedger} = await chrome.storage.local.get('usageLedger').catch(() => ({}));
  const catalog = c && session.catalog?.credentialReceivedAt === c.receivedAt ? session.catalog : null;
  const chatgpt = providerSession(session, 'chatgpt');
  const binding = await projectBinding(session);
  const workspace = session.browserWorkspaces?.[chat.sessionId];
  return {settings, browserWorkMode, workspace: workspace && workspaceMatches(workspace, {conversationId:chat.sessionId,provider:activeProvider,credentialReceivedAt:c?.receivedAt}) ? {id:workspace.id, closed:!!workspace.closed} : null, chat, conversations: conversationSummaries(readOnly ? await chrome.storage.local.get(CONVERSATION_KEYS) : await readConversationState()), catalog, activeProvider, usage: usageSummary(usageLedger), accountUsage: chatgpt.credential && chatgpt.accountUsage?.credentialReceivedAt === chatgpt.credential.receivedAt ? chatgpt.accountUsage : null, auth: {present: !!c, provider: c?.provider || activeProvider, expired: !!c?.expiresAt && c.expiresAt <= Date.now() && !(c.provider === 'chatgpt' && c.refreshToken), rejected: !!c?.rejected, mode: c?.mode, expiresAt: c?.expiresAt, source: c?.source, verifiedAt: c?.verifiedAt, receivedAt: c?.receivedAt},
    connections: connectionStatuses(session), project: binding.project, wikiFolder: binding.wikiFolder, wikiFolderError: binding.wikiFolderError,
    serverProject: projectSummary(session.projectConnection),
    pending: session.attempt ? {provider: session.attempt.provider || 'aipro', expiresAt: session.attempt.expiresAt, port: session.attempt.port, phase: session.attempt.phase} : null,
    agentRun: session.chatLease && session.agentRun?.requestId === session.chatLease.id ? session.agentRun : null,
    report: session.authReport || {stage: 'not_started'}, events: session.events || [], authTrace: session.authTrace || null, busy: !!session.chatLease,
    skills: allSkills(skills), activeSkillId, fabrixConnection, page: session.page ? {id: session.page.id, title: session.page.title, url: session.page.url} : null};
}
function trustedUI(sender) {
  return sender.id === chrome.runtime.id && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('index.html');
}
async function pageTarget(sender, rememberTab = false) {
  const [active] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  if (active?.id && /^https?:\/\//.test(active.url || '')) return active;
  // Chrome hides a site's URL until access is granted. Remember only its tab
  // identity when opening chat, then validate the URL before any DOM access.
  if (rememberTab && active?.id && active.id !== sender?.tab?.id && !active.url?.startsWith('chrome-extension://')) return active;
  const {chatSourceTabs = {}, page} = await getSession();
  const tabId = chatSourceTabs[sender?.tab?.id] ?? page?.tabId;
  return Number.isInteger(tabId) ? chrome.tabs.get(tabId).catch(() => null) : null;
}
async function connectPage(sender, targetTabId) {
  const tab = Number.isInteger(targetTabId) ? await chrome.tabs.get(targetTabId).catch(() => null) : await pageTarget(sender);
  if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) fail('page_target_missing');
  const url = new URL(tab.url);
  if (url.origin === CHATGPT_AUTH_ORIGIN || (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/auth')) || url.origin === 'https://epsso.samsung.net' || (url.origin === ORIGIN && url.pathname.startsWith('/auth/'))) fail('page_restricted');
  const result = await runPageOperation({tabId: tab.id}, 'connect');
  const page = {id: crypto.randomUUID(), tabId: tab.id, ...result};
  await chrome.storage.session.set({page});
  return page;
}
async function disconnectWorkspace() {
  const {chat} = await chrome.storage.local.get('chat');
  const {browserWorkspaces = {}, browserContexts = {}} = await getSession();
  await releaseWorkspace(browserWorkspaces[chat?.sessionId]);
  delete browserWorkspaces[chat?.sessionId];
  if (browserContexts[chat?.sessionId]?.context?.workspace) delete browserContexts[chat.sessionId];
  await chrome.storage.session.set({browserWorkspaces, browserContexts});
}
async function connectWorkPage(sender, lease, page) {
  const {browserWorkspaces = {}} = await getSession();
  // A reviewed approval/revision carries its exact workspace even if the
  // composer was meanwhile connected to another page. Never clone that draft.
  let workspace = workspaceMatches(lease.browserContext?.workspace, lease) ? lease.browserContext.workspace : browserWorkspaces[lease.conversationId];
  if (workspaceMatches(workspace, lease)) browserWorkspaces[lease.conversationId] = workspace;
  if (!workspaceMatches(workspace, lease)) {
    const source = await chrome.tabs.get(lease.pageTargetTabId ?? page?.tabId).catch(() => null);
    if (!source) fail('page_target_missing');
    browserURL(source.url);
    workspace = await createWorkspace(source, {conversationId:lease.conversationId,provider:lease.provider,credentialReceivedAt:lease.credentialReceivedAt});
    browserWorkspaces[lease.conversationId] = workspace;
    await chrome.storage.session.set({browserWorkspaces});
  }
  if (!await chrome.tabs.get(workspace.tabId).catch(() => null)) {
    // A closed child can return only to a recorded parent in the same workspace.
    // An approved transaction remains pinned to its exact original document.
    if (lease.approvalQuestionId) fail('approval_changed');
    const parent = await resolveBrowserTab({...lease.browserContext, workspace}, workspace.tabId);
    if (!Number.isInteger(parent)) fail('workspace_changed');
    workspace.tabId = parent;
    await chrome.storage.session.set({browserWorkspaces});
  }
  await workspaceTab(workspace, workspace.tabId);
  if (page?.workspaceId === workspace.id && page.tabId === workspace.tabId && page.id === lease.pageId) return {page, lease};
  try {
    await readyWorkspaceTab(workspace, workspace.tabId, () => endedWorkspaceRequests.has(lease.id));
    // New documents must be observed before refs or approvals can be reused.
    page = {...await connectPage(sender, workspace.tabId), workspaceId:workspace.id};
    const current = (await getSession()).chatLease;
    if (current?.id !== lease.id || current.cancelled) fail('interrupted');
    lease = {...current, pageId:page.id, pageTargetTabId:workspace.tabId, browserContext:{...(current.browserContext || {}),tabId:workspace.tabId,workspace}};
    await chrome.storage.session.set({page, chatLease:lease});
    return {page, lease};
  } catch(error) {await releaseWorkspace(workspace); throw error;}
}
async function refreshWorkConnection(page, tabId) {
  try {
    const {chatLease} = await getSession();
    if (chatLease?.browserContext?.workspace) await workspaceTab(chatLease.browserContext.workspace, tabId);
    const connection = await runPageOperation({tabId}, 'connect');
    await chrome.storage.session.set({page: {...page, tabId, ...connection}});
  } catch { /* Keep the tool receipt; never inspect another tab as a fallback. */ }
}
async function handle(message, sender, owner) {
  if (!message || typeof message.type !== 'string') fail('invalid_sender');
  if (message.type === 'LOGIN_CALLBACK' || message.type === 'AIPRO_LOGIN_CALLBACK') return receiveRedirect(message, sender);
  if (sender === RUNNER ? !RUNNER_TYPES.has(message.type) : !trustedUI(sender)) fail('invalid_sender');
  switch (message.type) {
    case 'GET_STATE': return state(sender, message.clientId);
    case 'SET_BROWSER_WORK_MODE': {
      if ((await getSession()).chatLease) fail('busy');
      if (!['window','current'].includes(message.mode)) fail('tool_arguments_invalid');
      await chrome.storage.local.set({browserWorkMode:message.mode});
      await disconnectWorkspace();
      await chrome.storage.session.remove('page');
      return state();
    }
    case 'SHOW_BROWSER_WORKSPACE': {
      const {chat} = await chrome.storage.local.get('chat');
      const {browserWorkspaces = {},credential} = await getSession();
      const {activeProvider = 'aipro'} = await chrome.storage.local.get('activeProvider');
      const workspace = browserWorkspaces[chat.sessionId];
      if (!workspaceMatches(workspace,{conversationId:chat.sessionId,provider:activeProvider,credentialReceivedAt:credential?.receivedAt})) fail('workspace_changed');
      await showWorkspace(workspace); return null;
    }
    case 'WIKI_FOLDER_STATUS': {
      const binding = await projectBinding(await getSession());
      return {folder: binding.wikiFolder, error: binding.wikiFolderError};
    }
    case 'WIKI_FOLDER_COMMIT': {
      const {chatLease, attempt, projectConnection} = await getSession();
      if (chatLease || attempt || activeFabrix) fail('busy');
      // Remove the previous authority before committing the durable folder.
      // A failed session write must never leave a hidden server fallback.
      await chrome.storage.session.remove('projectConnection');
      try {await commitWikiFolder(message.stageId, {clientId: message.clientId});}
      catch (error) {
        if (projectConnection) await chrome.storage.session.set({projectConnection});
        throw error;
      }
      await revokeProject(projectConnection);
      await event('wiki_folder_selected').catch(() => {});
      return state(sender, message.clientId);
    }
    case 'WIKI_FOLDER_CLEAR': {
      const {chatLease, attempt} = await getSession();
      if (chatLease || attempt || activeFabrix) fail('busy');
      if (await loadWikiFolder()) await chrome.storage.session.remove('projectConnection');
      await clearWikiFolder();
      await event('wiki_folder_removed').catch(() => {});
      return state(sender, message.clientId);
    }
    case 'PROJECT_CANDIDATE': return {candidate: await projectCandidate(await pageTarget(sender))};
    case 'A2A': return collaboration.dispatch(message);
    case 'PROJECT_CONNECT': {
      const {chatLease, attempt, projectConnection} = await getSession();
      if (chatLease || attempt || activeFabrix) fail('busy');
      const connection = await connectProject({origin: message.origin, tabId: message.tabId});
      try {
        await chrome.storage.session.set({projectConnection: connection});
        await clearWikiFolder();
      }
      catch (error) {
        if (projectConnection) await chrome.storage.session.set({projectConnection});
        else await chrome.storage.session.remove('projectConnection');
        await revokeProject(connection); throw error;
      }
      await revokeProject(projectConnection);
      await event('project_connected');
      return state(sender, message.clientId);
    }
    case 'PROJECT_DISCONNECT': {
      const {chatLease, attempt, projectConnection} = await getSession();
      if (chatLease || attempt || activeFabrix) fail('busy');
      // Remove local authority even when the local server has already stopped.
      await chrome.storage.session.remove('projectConnection');
      await revokeProject(projectConnection);
      await event('project_disconnected');
      return state(sender, message.clientId);
    }
    case 'CANCEL_FABRIX_TEST': {
      if (activeFabrix?.id === message.testId && ownsChat(activeFabrix, sender, message.clientId)) {activeFabrix.controller.abort(); activeFabrix = null;}
      const {fabrixTest} = await getSession();
      if (fabrixTest?.id === message.testId && ownsChat(fabrixTest, sender, message.clientId)) await chrome.storage.session.remove('fabrixTest');
      return null;
    }
    case 'CONNECT_FABRIX': {
      const {fabrixTest, chatLease, attempt} = await getSession();
      if (chatLease || attempt || activeFabrix) fail('busy');
      if (!fabrixTest || fabrixTest.id !== message.testId || !ownsChat(fabrixTest, sender, message.clientId) || fabrixTest.expiresAt <= Date.now()) fail('fabrix_test_expired');
      const connection = cleanFabrixCredentials(fabrixTest.connection), receivedAt = Date.now();
      const {models, summary} = inspectModelList(fabrixTest.payload);
      if (!models.length) fail('models_empty');
      if (!await chrome.permissions.contains({origins: [`${new URL(connection.endpoint).origin}/*`]})) fail('page_permission');
      await clearLogin(null, true);
      await switchProvider('fabrix');
      const {settings = DEFAULT_SETTINGS} = await chrome.storage.local.get('settings');
      const modelId = models.some(model => model.name === settings.modelId) ? settings.modelId : models[0].name;
      await chrome.storage.local.set({settings: {...settings, modelId}, fabrixConnection: fabrixSettings(connection)});
      await chrome.storage.session.set({credential: {...connection, provider: 'fabrix', mode: 'apiKey', source: 'connection', receivedAt, verifiedAt: receivedAt, expiresAt: null},
        catalog: {requestVersion: MODEL_CATALOG_VERSION, credentialReceivedAt: receivedAt, models, error: null, diagnostics: {status: 200, summary}, fetchedAt: receivedAt},
        authReport: {stage: 'fabrix_connected'}});
      await event('fabrix_connected', {status: 200});
      return state(sender, message.clientId);
    }
    case 'SAVE_CONTEXT': {
      const {chatLease, credential} = await getSession();
      if (!chatLease || chatLease.cancelled || chatLease.id !== message.requestId || !ownsChat(chatLease, sender, message.clientId) || credential?.receivedAt !== chatLease.credentialReceivedAt) fail('interrupted');
      // Actual owner activity renews the job even if its display query is
      // paused. Neither observers nor cancelled/expired owners can revive it.
      await touchChatLease(chatLease);
      if (message.kind === 'heartbeat') return null;
      const {chat} = await chrome.storage.local.get('chat');
      if (message.kind === 'model') {
        if (!chatLease.modelIds?.includes(message.modelId)) fail('invalid_model');
        const {catalog} = await getSession();
        const model = catalog?.credentialReceivedAt === credential.receivedAt && catalog.models?.find(item => item.name === message.modelId);
        if (!model) fail('invalid_model');
        chat.messages = chat.messages.map(reply => reply.id === chatLease.id && reply.state === 'pending' ? {...reply, modelId: model.name, modelName: model.displayName || model.name} : reply);
        await saveChat(chat); return null;
      }
      if (message.kind === 'trace') {
        chat.messages = chat.messages.map(reply => reply.id === chatLease.id && reply.state === 'pending' ? {...reply, trace: normalizeTrace(message.trace)} : reply);
        await saveChat(chat); return null;
      }
      if (message.kind === 'review') {
        if (chat.task?.requestId !== chatLease.id || !['running', 'complete', 'revise', 'blocked', 'failed'].includes(message.status) || !Number.isInteger(message.checks) || message.checks < 0 || message.checks > 8) fail('goal_review_failed');
        chat.task = {...chat.task, goalReview: {status: message.status, checks: message.checks, at: Date.now()}};
        await saveChat(chat); return null;
      }
      const summary = normalizeSummary(message.kind === 'history' ? message.memory?.summary : message.summary);
      if (!summary) fail('context_compaction_failed');
      const count = (chat.contextStats?.count || 0) + 1, at = Date.now();
      const source = message.kind === 'history' ? message.memory : message;
      const tokens = key => Number.isSafeInteger(source[key]) && source[key] >= 0 ? source[key] : null;
      if (message.kind === 'history') {
        const boundary = chat.messages.findIndex(m => m.id === message.memory.throughId && !m.contextOnly && (m.role === 'user' || m.state === 'done'));
        const previous = chat.messages.findIndex(m => m.id === chat.memory?.throughId);
        if (boundary < 0 || boundary <= previous) fail('context_compaction_failed');
        chat.memory = {version: 1, throughId: message.memory.throughId, summary, count: (chat.memory?.count || 0) + 1, at, beforeTokens: tokens('beforeTokens'), afterTokens: tokens('afterTokens')};
      } else if (message.kind === 'task') {
        if (chat.task?.requestId === chatLease.id) chat.task = {...chat.task, summary};
      } else fail('context_compaction_failed');
      chat.contextStats = {count, at, beforeTokens: tokens('beforeTokens'), afterTokens: tokens('afterTokens')};
      await saveChat(chat); return null;
    }
    case 'MODEL_DIAGNOSTIC':
    case 'FABRIX_DIAGNOSTIC': {
      const {chatLease} = await getSession();
      if (chatLease?.id !== message.requestId || !ownsChat(chatLease, sender, message.clientId)) return null;
      const diagnostic = chatLease.provider === 'fabrix' ? fabrixDiagnostic(message) : chatLease.provider === 'aipro' && message.type === 'MODEL_DIAGNOSTIC' ? completionDiagnostic(message) : null;
      if (!diagnostic) return null;
      await event(`${chatLease.provider === 'fabrix' ? 'fabrix_format' : 'model_request'}_${diagnostic.phase}`, diagnostic);
      return null;
    }
    case 'RECORD_USAGE': {
      const {chatLease} = await getSession();
      if (chatLease?.id !== message.requestId || !ownsChat(chatLease, sender, message.clientId)) return null;
      try {
        const {usageLedger} = await chrome.storage.local.get('usageLedger');
        const next = recordUsage(usageLedger, {requestId: chatLease.id, provider: chatLease.provider || 'aipro', round: message.round, phase: message.phase, usage: message.usage});
        if (next && next !== usageLedger) await chrome.storage.local.set({usageLedger: next});
      } catch { /* Telemetry failure cannot interrupt inference. */ }
      return null;
    }
    case 'SAVE_ACCOUNT_USAGE': {
      const session = await getSession();
      const {credential, accountUsage} = providerSession(session, 'chatgpt');
      if (credential?.provider !== 'chatgpt' || credential.receivedAt !== message.credentialReceivedAt) return null;
      const previous = accountUsage?.credentialReceivedAt === credential.receivedAt ? accountUsage : null;
      let data, error = Object.hasOwn(ERROR_TEXT, message.error) && message.error.startsWith('quota_') ? message.error : null;
      if (!error) {try {data = normalizeAccountUsage(message.payload);} catch {error = 'quota_invalid';}}
      await chrome.storage.session.set(updateProviderSession(session, 'chatgpt', {accountUsage: {version: data ? ACCOUNT_USAGE_VERSION : previous?.version, credentialReceivedAt: credential.receivedAt, data: data || previous?.data || null,
        fetchedAt: data ? Date.now() : previous?.fetchedAt || null, checkedAt: Date.now(), status: Number.isInteger(message.status) ? message.status : 0, error}}));
      return null;
    }
    case 'SAVE_SKILL': {
      if ((await getSession()).chatLease) fail('busy');
      const {skills = []} = await chrome.storage.local.get('skills');
      const skill = normalizeSkill(message.skill);
      const next = skills.filter(item => item.id !== skill.id);
      if (next.length >= 20) fail('skill_invalid');
      await chrome.storage.local.set({skills: [...next, skill], activeSkillId: skill.id});
      return state();
    }
    case 'DELETE_SKILL': {
      if ((await getSession()).chatLease) fail('busy');
      const {skills = [], activeSkillId = ''} = await chrome.storage.local.get(['skills', 'activeSkillId']);
      await chrome.storage.local.set({skills: skills.filter(skill => skill.id !== message.id), activeSkillId: activeSkillId === message.id ? '' : activeSkillId});
      return state();
    }
    case 'SELECT_SKILL': {
      if ((await getSession()).chatLease) fail('busy');
      const {skills = []} = await chrome.storage.local.get('skills');
      if (message.id && !allSkills(skills).some(skill => skill.id === message.id)) fail('skill_invalid');
      await chrome.storage.local.set({activeSkillId: message.id || ''}); return state();
    }
    case 'CONNECT_PAGE': {
      if ((await getSession()).chatLease) fail('busy');
      await connectPage(sender);
      await disconnectWorkspace();
      return state();
    }
    case 'DISCONNECT_PAGE': {
      if ((await getSession()).chatLease) fail('busy');
      const {page} = await getSession();
      await chrome.storage.session.remove('page');
      await disconnectWorkspace();
      if (page) await runPageOperation(page, 'clear').catch(() => {});
      return state();
    }
    case 'RUN_TOOL':
    case 'APPLY_FILL': {
      let {chatLease, page, credential} = await getSession();
      if (!chatLease || chatLease.cancelled || chatLease.id !== message.requestId || !ownsChat(chatLease, sender, message.clientId) || chatLease.until <= Date.now() || credential?.receivedAt !== chatLease.credentialReceivedAt) fail('interrupted');
      await touchChatLease(chatLease);
      if (chatLease.awaitingUser) fail('question_changed');
      if (message.type === 'RUN_TOOL' && !chatLease.toolNames?.includes(message.name) && !(message.name === 'apply_approved_action' && chatLease.approvalQuestionId)) fail('tools_unavailable');
      const question = message.type === 'RUN_TOOL' && message.name === 'ask_user' ? questionArgs(message.args) : null;
      if (message.type === 'RUN_TOOL' && chatLease.autoConnect) {
        const {chat} = await chrome.storage.local.get('chat');
        if (chat.task?.requestId !== chatLease.id) {
          chat.task = {requestId: chatLease.id, skillId: chatLease.librarySkillId || 'browser-agent', autoConnect: true, goal: chat.messages.findLast(m => m.role === 'user')?.content || '', status: 'running', steps: [], plan: [], summary: null, page: null, updatedAt: Date.now()};
          await saveChat(chat);
        }
      }
      if (question && !question.refs.length) return saveUserQuestion(chatLease, question);
      if (message.type === 'RUN_TOOL' && message.name === 'update_plan') {
        const {chat} = await chrome.storage.local.get('chat');
        if (chat.task?.requestId !== chatLease.id) fail('interrupted');
        const plan = normalizePlan(message.args?.steps, chat.task.plan); if (!plan) fail('tool_arguments_invalid');
        chat.task = {...chat.task, plan, updatedAt: Date.now()};
        await saveChat(chat); return {ok: true, plan};
      }
      if (message.type === 'RUN_TOOL' && DOCUMENT_TOOL_NAMES.has(message.name)) {
        await checkpointTool(chatLease.id, message.name, 'start');
        let result;
        try {result = await executeDocumentTool({bindings: chatLease.documentBindings || [], owner: {provider: chatLease.provider, conversationId: chatLease.conversationId}}, message.name, message.args);}
        catch (error) {result = {error: ['attachment_missing', 'attachment_storage'].includes(error.message) ? error.message : 'response_invalid', instruction: 'Document read failed. Do not invent its contents. Revise the document ID/range or ask for the missing source.'};}
        await checkpointTool(chatLease.id, message.name, 'end', result);
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        return result;
      }
      if (message.type === 'RUN_TOOL' && SKILL_TOOL_NAMES.has(message.name)) {
        const {skills = []} = await chrome.storage.local.get('skills');
        const {project} = await projectBinding(await getSession());
        const library = skillLibrary(skills, {selectedSkillId: chatLease.librarySkillId, project});
        await checkpointTool(chatLease.id, message.name, 'start');
        const result = await executeSkillTool(library, chatLease.skillBindings || [], message.name, message.args);
        await checkpointTool(chatLease.id, message.name, 'end', result);
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        return result;
      }
      if (message.type === 'RUN_TOOL' && PROJECT_TOOL_NAMES.has(message.name)) {
        const {connection: projectConnection} = await projectBinding(await getSession());
        if (!projectConnection || projectConnection.connectionId !== chatLease.projectConnectionId) return {error: 'project_changed'};
        await checkpointTool(chatLease.id, message.name, 'start');
        let result;
        try {result = projectConnection.kind === 'folder'
          ? await executeWikiFolderTool(projectConnection, message.name, message.args)
          : await readProjectTool(projectConnection, message.name, message.args);}
        catch (error) {
          const code = Object.hasOwn(ERROR_TEXT, error.message) ? error.message : 'project_unavailable';
          if (code === 'project_expired' && projectConnection.kind !== 'folder') await chrome.storage.session.set({projectConnection: {...projectConnection, rejected: true}});
          result = {error: code, instruction: projectConnection.kind === 'folder'
            ? 'OpenWiki folder read failed. For permission errors ask the user to allow the saved folder in Settings > OpenWiki folder. Do not request a server or page link. Do not invent documents. For missing files or arguments revise the query/path from observed evidence.'
            : 'Project read failed. Do not claim source access or substitute rendered HTML for repository code. Reconnect the project when its session expired, or use a valid relative path/range for argument errors.'};
        }
        await checkpointTool(chatLease.id, message.name, 'end', result);
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        return result;
      }
      if (chatLease.browserWorkMode === 'window') {
        const connected = await connectWorkPage(sender, chatLease, page);
        page = connected.page; chatLease = connected.lease;
      }
      const restoreClosedPage = message.type === 'RUN_TOOL' && chatLease.automation && !page && chatLease.pageId && chatLease.browserContext;
      if ((message.type === 'RUN_TOOL' && chatLease.autoConnect && !chatLease.pageId) || restoreClosedPage) {
        const targetTabId = chatLease.browserContext && message.name !== 'apply_approved_action'
          ? await resolveBrowserTab(chatLease.browserContext, restoreClosedPage ? chatLease.browserContext.tabId : chatLease.pageTargetTabId)
          : chatLease.pageTargetTabId;
        if (!Number.isInteger(targetTabId)) fail('page_target_missing');
        page = await connectPage(sender, targetTabId);
        const current = (await getSession()).chatLease;
        if (!current || current.id !== chatLease.id || current.cancelled) fail('interrupted');
        chatLease = {...current, pageId: page.id};
        await chrome.storage.session.set({chatLease});
        const {chat} = await chrome.storage.local.get('chat');
        if (chat.task?.requestId === chatLease.id) {
          chat.task = {...chat.task, page: {title: page.title, url: page.url}};
          await saveChat(chat);
        }
      }
      if (!page || page.id !== chatLease.pageId) fail('page_changed');
      if (message.type === 'APPLY_FILL') {
        if (!message.planId || chatLease.pendingFill !== message.planId) fail('fill_invalid');
        await chrome.storage.session.set({chatLease: {...chatLease, pendingFill: null}});
        return runPageOperation(page, 'apply', {planId: message.planId});
      }
      if (question) {
        const {result} = await runBrowserAgent(chatLease.id, page, 'attach_images', {refs: question.refs}, {
          onImage: (image, payload) => attachCapture(chatLease, image, payload, savePageImage)});
        if (result.error || result.attachments?.length !== question.refs.length) fail(result.error || 'image_unavailable');
        return saveUserQuestion(chatLease, question, result.attachments);
      }
      if (message.name === 'apply_approved_action') {
        const {actionApprovals = {}} = await getSession();
        const record = actionApprovals[chatLease.conversationId];
        if (!record || record.questionId !== chatLease.approvalQuestionId || record.provider !== chatLease.provider || record.credentialReceivedAt !== credential.receivedAt) fail('approval_changed');
        // Consume durably before the external action. A timeout/reload never replays it.
        delete actionApprovals[chatLease.conversationId];
        await chrome.storage.session.set({actionApprovals});
        await checkpointTool(chatLease.id, message.name, 'start');
        const {result, tabId} = await runApprovedAction(chatLease.id, {...page, browserContext: chatLease.browserContext}, record);
        await rememberBrowserContext(chatLease);
        await checkpointTool(chatLease.id, message.name, 'end', result, result.observation || result);
        const {chat} = await chrome.storage.local.get('chat');
        const question = chat?.messages.find(item => item.question?.id === record.questionId)?.question;
        if (question?.answer) {
          question.answer.state = result.ok ? 'issued' : result.actionIssued ? 'unknown' : 'changed';
          await saveChat(chat);
        }
        await refreshWorkConnection(page, tabId);
        return result;
      }
      if (chatLease.automation && !['list_page_storage', 'read_page_storage'].includes(message.name)) {
        const {chat: beforeTool} = await chrome.storage.local.get('chat');
        const verifiedBeforeTool = beforeTool?.task?.requestId === chatLease.id && beforeTool.task.verification?.status === 'passed';
        await checkpointTool(chatLease.id, message.name, 'start');
        const {result, tabId} = await runBrowserAgent(chatLease.id, {...page, browserContext: chatLease.browserContext}, message.name, message.args, {vision: chatLease.vision,
          onApproval: record => saveActionApproval(chatLease, record, verifiedBeforeTool),
          onCapture: (screenshot, image) => attachCapture(chatLease, screenshot, image, saveCapture, message.traceId),
          onImage: (image, payload) => attachCapture(chatLease, image, payload, savePageImage)});
        await rememberBrowserContext(chatLease);
        await checkpointTool(chatLease.id, message.name, 'end', result, result.observation || result);
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        // Follow only the tab selected by the authorized action. Old manual fill
        // plans stay document-bound and cannot cross this connection update.
        await refreshWorkConnection(page, tabId);
        return result;
      }
      const operation = message.name === 'fill_form' ? 'prepare' : message.name;
      const result = await runPageOperation(page, operation, message.args);
      if (result.planId) await chrome.storage.session.set({chatLease: {...chatLease, pendingFill: result.planId}});
      return result;
    }
    case 'SAVE_MODELS': {
      const {credential, catalog} = await getSession();
      if (!credential || credential.rejected || credential.receivedAt !== message.credentialReceivedAt) return null;
      const status = Number.isInteger(message.status) && message.status >= 100 && message.status <= 599 ? message.status : null;
      let result, error = message.error;
      if (!error) {
        try { result = inspectModelList(message.payload); }
        catch { error = 'models_invalid'; }
      }
      if (error) {
        const previous = catalog?.credentialReceivedAt === credential.receivedAt ? catalog.models : null;
        const safeError = Object.hasOwn(ERROR_TEXT, error) ? error : 'models_invalid';
        if (safeError === 'unauthorized') await chrome.storage.session.set({credential: {...credential, rejected: true, verifiedAt: null}});
        await chrome.storage.session.set({catalog: {requestVersion: MODEL_CATALOG_VERSION, credentialReceivedAt: credential.receivedAt, models: previous, error: safeError, diagnostics: {status, summary: null}, fetchedAt: Date.now()}});
        await event('models_failed', {status, error: safeError});
        return state();
      }
      const {models, summary} = result;
      await chrome.storage.session.set({catalog: {requestVersion: MODEL_CATALOG_VERSION, credentialReceivedAt: credential.receivedAt, models, error: null, diagnostics: {status, summary}, fetchedAt: Date.now()}});
      await event(credential.provider === 'chatgpt' ? 'models_sdk_catalog' : 'models_received', {status, received: summary.received, usable: summary.usable, excluded: summary.excluded});
      const {settings = DEFAULT_SETTINGS} = await chrome.storage.local.get('settings');
      if (models.length && !models.some(m => m.name === settings.modelId)) {
        const modelId = models.find(m => m.name === DEFAULT_SETTINGS.modelId)?.name || models[0].name;
        await chrome.storage.local.set({settings: {...settings, modelId}});
      }
      return state();
    }
    case 'SELECT_MODEL': {
      const {credential, catalog, chatLease} = await getSession();
      if (chatLease) fail('busy');
      if (!credential || credential.rejected || catalog?.credentialReceivedAt !== credential.receivedAt) fail('no_credential');
      if (!catalog.models?.some(m => m.name === message.name)) fail('model_required');
      const {settings = DEFAULT_SETTINGS} = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({settings: {...settings, modelId: message.name}});
      return state();
    }
    case 'SELECT_PROVIDER': {
      await recoverChat(sender, message.clientId);
      const session = await getSession();
      if (session.chatLease || session.attempt || activeFabrix) fail('busy');
      if (!PROVIDERS.includes(message.provider)) fail('invalid_sender');
      const local = await readConversationState();
      if (message.conversationId && message.conversationId !== local.chat.sessionId) fail('conversation_changed');
      const connection = connectionStatuses(session)[message.provider];
      if (!connection.present || connection.rejected) fail('no_credential');
      if (connection.expired) fail('expired_token');
      await clearLogin(null, true);
      await switchProvider(message.provider);
      return state(sender, message.clientId);
    }
    case 'SAVE_SETTINGS': {
      const {settings: previous = DEFAULT_SETTINGS} = await chrome.storage.local.get('settings');
      const settings = cleanSettings({...previous, ...message.settings, modelId: previous.modelId});
      await chrome.storage.local.set({settings});
      return settings;
    }
    case 'START_LOGIN': {
      if ((await getSession()).chatLease || activeFabrix) fail('busy');
      const provider = message.provider === 'chatgpt' ? 'chatgpt' : 'aipro';
      const existing = (await getSession()).attempt;
      if (existing && existing.expiresAt > Date.now()) { await chrome.tabs.update(existing.tabId, {active: true}); return state(); }
      await clearLogin(null, true);
      await chrome.storage.session.remove('authTrace');
      const {settings = DEFAULT_SETTINGS} = await chrome.storage.local.get('settings');
      const port = provider === 'chatgpt' ? 1455 : 49152 + crypto.getRandomValues(new Uint16Array(1))[0] % 16384;
      const flow = provider === 'chatgpt' ? await createChatGPTLogin() : null;
      const [activeTab] = await chrome.tabs.query({active: true, currentWindow: true});
      const tab = await chrome.tabs.create({url: 'about:blank', active: true});
      const attempt = {id: crypto.randomUUID(), provider, tabId: tab.id, returnTabId: sender.tab?.id ?? activeTab?.id, port, loginRoute: settings.loginRoute, mode: 'browser', receiverVersion: 4, phase: 'waiting', expiresAt: Date.now() + 300000};
      try {
        await chrome.storage.session.set({attempt, ...(flow ? {loginFlow: {attemptId: attempt.id, verifier: flow.verifier, state: flow.state}} : {}), authReport: {stage: 'login_opened', provider}, events: []});
        await attachReceiver(attempt);
        await chrome.alarms.create('login-timeout', {when: attempt.expiresAt});
        await event('login_opened', {provider, route: provider === 'chatgpt' ? 'oauth' : settings.loginRoute, port});
        await event('callback_receiver_ready');
        await chrome.tabs.update(tab.id, {url: provider === 'chatgpt' ? flow.url : `${ORIGIN}/auth/${settings.loginRoute}/login?port=${port}`});
      } catch {
        await clearLogin('callback_receiver_unavailable', true);
        await chrome.tabs.remove(tab.id).catch(() => {});
        await event('callback_receiver_unavailable');
        fail('callback_receiver_unavailable');
      }
      return state();
    }
    case 'CANCEL_LOGIN': await clearLogin('login_closed', true); return state();
    case 'SAVE_CREDENTIAL': {
      if ((await getSession()).chatLease) fail('busy');
      const {settings = DEFAULT_SETTINGS} = await chrome.storage.local.get('settings');
      const credential = cleanCredential(message.token, settings.mode);
      await clearLogin(null, true);
      await switchProvider('aipro');
      await chrome.storage.session.set({credential: {...credential, source: 'manual'}, authReport: {stage: 'manual_credential'}});
      await event('manual_credential');
      return state();
    }
    case 'LOGOUT': {
      await recoverChat(sender, message.clientId);
      if ((await getSession()).chatLease) fail('busy');
      const {activeProvider = 'aipro'} = await chrome.storage.local.get('activeProvider');
      const provider = message.provider || (await getSession()).credential?.provider || activeProvider;
      if (!PROVIDERS.includes(provider)) fail('invalid_sender');
      await clearLogin(null, true);
      await chrome.storage.session.set({...removeProviderSession(await getSession(), provider), authReport: {stage: 'signed_out'}});
      return state(sender, message.clientId);
    }
    case 'ATTACH_FILES':
    case 'REMOVE_ATTACHMENT': {
      await recoverChat(sender, message.clientId);
      const session = await getSession();
      if (session.chatLease || session.attempt || activeFabrix) fail('busy');
      const local = await readConversationState(), chat = local.chat;
      if (message.conversationId !== chat.sessionId || message.provider !== chat.provider) fail('conversation_changed');
      const previous = chat.draftAttachments || [];
      if (message.type === 'REMOVE_ATTACHMENT') {
        if (!previous.some(file => file.id === message.id)) fail('attachment_missing');
        chat.draftAttachments = previous.filter(file => file.id !== message.id);
        await saveChat(chat);
        await deleteAttachments([message.id]).catch(() => {});
      } else {
        if (!Array.isArray(message.files) || previous.length + message.files.length > ATTACHMENT_LIMITS.count) fail('attachment_count');
        const files = await saveAttachments(message.files, {provider: chat.provider, conversationId: chat.sessionId});
        try {
          chat.draftAttachments = [...previous, ...files];
          if (chat.draftAttachments.reduce((sum, file) => sum + file.bytes, 0) > ATTACHMENT_LIMITS.batchBytes) fail('attachment_size');
          await saveChat(chat);
        } catch (error) {await deleteAttachments(files.map(file => file.id)).catch(() => {}); throw error;}
      }
      return state(sender, message.clientId);
    }
    case 'DRAFT': {
      const {activeProvider = 'aipro'} = await chrome.storage.local.get('activeProvider');
      if (message.provider && message.provider !== activeProvider) return null;
      const {chat} = await readConversationState();
      if (message.conversationId && message.conversationId !== chat.sessionId) fail('conversation_changed');
      chat.draft = String(message.value || '').slice(0, 16000);
      await saveChat(chat); return null;
    }
    case 'QUESTION_DRAFT': {
      const {chat} = await readConversationState();
      if (message.conversationId !== chat.sessionId || message.provider !== chat.provider) fail('conversation_changed');
      const reply = chat.messages.at(-1), question = reply?.question;
      if (reply?.state !== 'done' || !question || question.id !== message.questionId || question.kind === 'approval' || question.answer) fail('question_changed');
      if (typeof message.value !== 'string' || message.value.length > QUESTION_TEXT_LIMIT) fail('tool_arguments_invalid');
      question.draft = message.value;
      await saveChat(chat); return null;
    }
    case 'READ_APPROVAL_DRAFT': {
      if ((await getSession()).chatLease) fail('busy');
      const {chat} = await readConversationState();
      const {credential, actionApprovals = {}} = await getSession();
      const question = chat.messages.at(-1)?.question, record = actionApprovals[chat.sessionId];
      if (message.conversationId !== chat.sessionId || question?.id !== message.questionId || question?.kind !== 'approval' || question.answer) fail('question_changed');
      if (!record || record.questionId !== question.id || record.credentialReceivedAt !== credential?.receivedAt || record.provider !== credential?.provider) fail('approval_changed');
      return readApprovalDraft(record);
    }
    case 'REJECT_APPROVAL': {
      await recoverChat(sender, message.clientId);
      if ((await getSession()).chatLease) fail('busy');
      const {chat} = await readConversationState();
      if (message.conversationId !== chat.sessionId) fail('conversation_changed');
      const question = chat.messages.at(-1)?.question;
      if (question?.kind !== 'approval') fail('question_changed');
      questionAnswer(question, {questionId: message.questionId, optionId: 'reject'});
      await revokeActionApproval(chat.sessionId);
      question.answer = {optionId: 'reject', text: question.hasEditableDraft === false ? '최종 반영을 취소했습니다.' : '최종 반영을 취소했습니다. 초안은 유지합니다.', state: 'rejected'};
      if (chat.task) chat.task = pauseTask(chat.task);
      await saveChat(chat);
      return state();
    }
    case 'START_AGENT': {
      const request = await handle({...message, type: 'START_CHAT'}, sender, RUNNER);
      await chrome.action.setBadgeText({text: ''}).catch(() => {});
      runner.start(request);
      return {requestId: request.requestId, conversationId: request.conversationId};
    }
    case 'RESOLVE_FILL': {
      const {chatLease} = await getSession();
      if (chatLease?.owner !== 'worker' || chatLease.id !== message.requestId || chatLease.conversationId !== message.conversationId || chatLease.cancelled) fail('fill_invalid');
      runner.resolveFill(chatLease.id, message.planId, message.approved);
      return null;
    }
    case 'START_CHAT': {
      if (activeFabrix) fail('busy');
      await readConversationState();
      await recoverChat(sender, message.clientId);
      const {credential, chatLease, attempt, catalog, page: connectedPage, browserWorkspaces = {}} = await getSession();
      const {browserWorkMode = 'window'} = await chrome.storage.local.get('browserWorkMode');
      if (chatLease || attempt) fail('busy');
      if (!credential || credential.rejected) fail('no_credential');
      if (credential.expiresAt && credential.expiresAt <= Date.now() && !(credential.provider === 'chatgpt' && credential.refreshToken)) fail('expired_token');
      if (catalog?.credentialReceivedAt === credential.receivedAt && catalog.models?.length === 0 && !catalog.error) fail('models_empty');
      const {settings = DEFAULT_SETTINGS, chat = {messages: [], draft: ''}, skills = [], activeSkillId = ''} = await chrome.storage.local.get(['settings', 'chat', 'skills', 'activeSkillId']);
      if (message.conversationId && message.conversationId !== chat.sessionId) fail('conversation_changed');
      if ((credential.provider || 'aipro') !== chat.provider) fail('no_credential');
      const model = catalog?.credentialReceivedAt === credential.receivedAt && catalog.models?.find(model => model.name === settings.modelId);
      const visionModel = visionModelFor(chat.provider, model || {name: settings.modelId}, catalog?.credentialReceivedAt === credential.receivedAt ? catalog.models : []);
      const useDraftFiles = !message.retry && !message.compact && !message.resume && !message.choice && !message.draftEdit;
      const files = useDraftFiles ? chat.draftAttachments || [] : message.retry ? chat.messages.findLast(item => item.role === 'user')?.attachments || [] : [];
      if (files.some(file => file.kind === 'image') && !visionModel) fail('attachment_vision');
      for (const file of files) await readAttachment(file.id, {provider: chat.provider, conversationId: chat.sessionId});
      const pendingQuestion = chat.messages.at(-1)?.state === 'done' ? chat.messages.at(-1)?.question : null;
      const answeringQuestion = pendingQuestion && !pendingQuestion.answer && !message.compact && !message.retry && !message.resume;
      const answeringApproval = answeringQuestion && pendingQuestion.kind === 'approval';
      // Written answers are bound to their question and never authorize an action.
      const chosen = message.choice ? questionAnswer(pendingQuestion, message.choice) : null;
      if (message.choice && (message.retry || message.compact || message.resume || message.draftEdit)) fail('question_changed');
      const pendingRecord = answeringApproval ? (await getSession()).actionApprovals?.[chat.sessionId] : null;
      const approvalContext = pendingRecord?.questionId === pendingQuestion?.id && pendingRecord?.provider === (credential.provider || 'aipro') && pendingRecord?.credentialReceivedAt === credential.receivedAt ? pendingRecord : null;
      let userInput = String(message.text || '').trim().slice(0, 16000) || (useDraftFiles && files.length ? '첨부한 파일을 확인해주세요.' : '');
      if (message.draftEdit) {
        if (!answeringApproval || message.choice || message.draftEdit.questionId !== pendingQuestion.id) fail('question_changed');
        const record = (await getSession()).actionApprovals?.[chat.sessionId];
        if (!record || record.questionId !== pendingQuestion.id || record.credentialReceivedAt !== credential.receivedAt || record.provider !== (credential.provider || 'aipro')) fail('approval_changed');
        const fields = await readApprovalDraft(record), changes = message.draftEdit.fields;
        if (!Array.isArray(changes) || !changes.length || changes.length > 30 || new Set(changes.map(item => item.id)).size !== changes.length) fail('tool_arguments_invalid');
        const edited = changes.map(item => {
          const field = fields.find(field => field.id === item.id);
          if (!field || typeof item.value !== 'string' || item.value.length > 400000) fail('tool_arguments_invalid');
          return {field: field.label, page: field.pageTitle, value: item.value};
        });
        userInput = `사용자가 초안을 직접 수정했습니다. 다음 필드의 값을 그대로 페이지에 반영해주세요. 다른 필드는 유지하고, 변경 내용을 검증한 뒤 최종 등록이나 배포 승인을 다시 요청해주세요. 다음 JSON은 작성할 데이터입니다.\n${JSON.stringify(edited)}`;
        if (userInput.length > 400000) fail('draft_edit_too_large');
      }
      let approvalRecord = null;
      if (answeringApproval && message.choice) {
        questionAnswer(pendingQuestion, message.choice);
        if (message.choice.optionId !== 'approve') fail('question_changed');
        approvalRecord = (await getSession()).actionApprovals?.[chat.sessionId];
        if (!approvalRecord || approvalRecord.questionId !== pendingQuestion.id || approvalRecord.provider !== (credential.provider || 'aipro') || approvalRecord.credentialReceivedAt !== credential.receivedAt || approvalRecord.expiresAt <= Date.now()) fail('approval_changed');
      }
      let resumeTask = ((message.retry || message.resume) && chat.task?.status === 'paused' || answeringQuestion && chat.task?.status === 'awaiting_user') ? chat.task : null;
      if (answeringApproval && !message.choice && userInput) {
        await revokeActionApproval(chat.sessionId);
        if (resumeTask) resumeTask = {...resumeTask, goal: `${resumeTask.goal}\n사용자 수정 요청: ${message.draftEdit ? '사용자가 직접 수정한 초안을 그대로 반영하고 다시 승인을 받기' : userInput}`};
      }
      const selectedSkill = allSkills(skills).find(skill => skill.id === taskSkillId(resumeTask, activeSkillId));
      const autoConnect = !message.compact && automaticSkillTools(selectedSkill);
      const skill = message.compact ? null : selectedSkill || allSkills().find(skill => skill.id === 'browser-agent');
      // Bind only the tab identity at send time. Do not inspect or transmit its
      // content until the agent requests a browser tool for this task.
      const savedBrowser = resumeTask || browserWorkMode === 'window' ? (await getSession()).browserContexts?.[chat.sessionId] : null;
      const savedWorkspace = browserWorkspaces[chat.sessionId];
      const ownWorkspace = browserWorkMode === 'window' && workspaceMatches(savedWorkspace,{conversationId:chat.sessionId,provider:credential.provider || 'aipro',credentialReceivedAt:credential.receivedAt}) ? savedWorkspace : null;
      const previousContext = savedBrowser?.provider === (credential.provider || 'aipro') && savedBrowser?.credentialReceivedAt === credential.receivedAt ? savedBrowser.context : null;
      const browserContext = approvalContext?.browserContext || (ownWorkspace ? {...previousContext,tabId:ownWorkspace.tabId,workspace:ownWorkspace} : browserWorkMode === 'current' ? previousContext : null);
      const continuationTabId = approvalContext?.tabId ?? browserContext?.tabId;
      // An approval binds to its exact document. Revisions/resumes may return to
      // a known parent after a child closes, but never to an unrelated active tab.
      const pageTargetTabId = approvalRecord?.tabId ?? (Number.isInteger(continuationTabId) ? await resolveBrowserTab(browserContext, continuationTabId) ?? continuationTabId : connectedPage?.tabId ?? (await pageTarget(sender, true))?.id ?? null);
      const needsPage = !message.compact && !autoConnect && (skill?.needsPage || skill?.allowFill || connectedPage);
      const page = needsPage && browserWorkMode === 'current' ? await connectPage(sender, pageTargetTabId) : null;
      const binding = await projectBinding(await getSession());
      const projectConnection = binding.connection;
      const project = message.compact ? null : binding.project;
      const tools = browserTools(page || (needsPage && browserWorkMode === 'window' ? {tabId:pageTargetTabId} : null), skill, settings.modelId, {autoConnect, vision: !!visionModel, visionModel, project});
      const library = message.compact ? [] : skillLibrary(skills, {selectedSkillId: selectedSkill?.id, project});
      tools.push(...skillLibraryTools(library));
      const skillBindings = await bindSkillLibrary(library);
      if (!settings.modelId) fail('model_required');
      const requestId = crypto.randomUUID();
      if (message.retry && chat.messages.at(-1)?.state !== 'done' && chat.messages.at(-1)?.role === 'assistant') {
        await deleteCaptures(chat.messages.at(-1).captures?.map(capture => capture.id));
        chat.messages.pop();
      }
      else {
        const content = chosen || (message.compact ? '/compact' : message.resume && resumeTask ? '중단한 작업을 이어서 진행해 주세요.' : userInput);
        if (!content) fail('invalid_model');
        if (!message.compact && !message.resume && pendingQuestion && !pendingQuestion.answer) {
          pendingQuestion.answer = {text: message.draftEdit ? '초안을 직접 수정했습니다.' : content, ...(message.choice?.optionId ? {optionId: message.choice.optionId} : {})};
          delete pendingQuestion.draft;
        }
        chat.messages.push({id: crypto.randomUUID(), role: 'user', content, ...(useDraftFiles && files.length ? {attachments: files} : {}), ...(message.draftEdit ? {displayContent: '초안을 수정했습니다.'} : {}), ...(message.compact ? {contextOnly: true} : {})});
        if (useDraftFiles) {chat.draft = ''; chat.draftAttachments = [];}
      }
      const messages = chat.messages.filter(m => !m.contextOnly && (m.role === 'user' || m.state === 'done')).map(m => ({id: m.id, role: m.role, content: questionContext(m), ...(m.attachments?.length ? {attachments: m.attachments} : {})}));
      const documents = documentBindings(messages);
      if (documents.length && !message.compact) tools.push(...documentToolDefinitions());
      if (!message.compact) chat.task = skill?.allowAutomation && (!autoConnect || resumeTask) ? {requestId, skillId: skill.id, autoConnect, goal: resumeTask?.goal || messages.findLast(m => m.role === 'user')?.content || '', status: 'running', steps: resumeTask?.steps || [], plan: resumeTask?.plan || [], summary: resumeTask?.summary || null, ...(resumedVerification(resumeTask) ? {verification: {status: 'pending'}} : {}), ...(resumeTask?.goalReview ? {goalReview: {status: 'running', checks: 0}} : {}), page: page ? {title: page.title, url: page.url} : null, updatedAt: Date.now()} : null;
      chat.messages.push({id: requestId, requestId, role: 'assistant', content: '', state: 'pending', modelId: settings.modelId, modelName: model?.displayName || settings.modelId, skillId: skill?.id || '', pageId: page?.id || '', ...(message.compact ? {contextOnly: true} : {})});
      await collaboration.bindRun({text:userInput,runId:requestId,conversationId:chat.sessionId,provider:chat.provider,continuation:!!(answeringQuestion||message.retry||message.resume)});
      await saveChat(chat);
      await chrome.storage.session.set({chatLease: {id: requestId, ...(owner === RUNNER ? {owner: 'worker'} : {}), conversationId: chat.sessionId, ...(approvalRecord ? {approvalQuestionId: approvalRecord.questionId} : {}), browserContext, browserWorkMode, documentBindings: documents, compacting: !!message.compact, skillBindings, librarySkillId: selectedSkill?.id || '', modelIds: [settings.modelId, visionModel?.name].filter(Boolean), projectConnectionId: project?.status === 'connected' ? projectConnection?.connectionId : null, provider: credential.provider || 'aipro', automation: skill?.allowAutomation === true, autoConnect, pageTargetTabId, vision: !!visionModel, documentId: sender.documentId, clientId: typeof message.clientId === 'string' ? message.clientId.slice(0, 100) : null, tabId: sender.tab?.id, lastSeenAt: Date.now(), credentialReceivedAt: credential.receivedAt, pageId: page?.id, toolNames: tools.map(tool => tool.function.name), until: Date.now() + CHAT_TIMEOUT_MS + 60000}});
      return {requestId, conversationId: chat.sessionId, documents, provider: credential.provider || 'aipro', modelId: settings.modelId, model: model || {name: settings.modelId}, visionModel, memory: chat.memory || null, compact: !!message.compact, approvedAction: !!approvalRecord, resumeTask, mode: credential.mode, credentialReceivedAt: credential.receivedAt, messages, skill, skillCatalog: skillCatalog(library), autoConnect, browserWorkMode, project: projectContext(project), page: page ? {title: page.title, url: page.url} : null, tools};
    }
    case 'FINISH_CHAT': {
      const {chatLease, credential} = await getSession();
      if (chatLease?.id !== message.requestId || !ownsChat(chatLease, sender, message.clientId)) return null;
      if (credential?.receivedAt !== chatLease.credentialReceivedAt || (credential?.provider || 'aipro') !== chatLease.provider) message = {...message, content: '', error: 'interrupted'};
      else if (chatLease.cancelled) message = {...message, error: 'cancelled'};
      // Browser ownership ends even if saving the completed reply fails.
      await stopBrowserAgent(chatLease.id);
      const {chat} = await chrome.storage.local.get('chat');
      if (chatLease.conversationId && chatLease.conversationId !== chat.sessionId) return null;
      const awaitingUser = chatLease.awaitingUser && !!chat.messages.find(m => m.id === message.requestId)?.question && !message.error;
      const unchecked = !awaitingUser && chat.task?.requestId === message.requestId && ['pending', 'failed'].includes(chat.task.verification?.status);
      const unreviewed = !awaitingUser && chat.task?.requestId === message.requestId && chat.task.goalReview && chat.task.goalReview.status !== 'complete';
      const error = Object.hasOwn(ERROR_TEXT, message.error) ? message.error : message.error ? 'upstream' : unchecked ? 'verification_required' : unreviewed ? 'goal_review_failed' : null;
      chat.messages = chat.messages.map(m => m.id === message.requestId ? {...m, content: awaitingUser || (unchecked || unreviewed) && !message.error ? '' : String(message.content || '').slice(0, 400000), state: error ? 'error' : 'done', error, finishReason: error ? null : message.finishReason === 'length' ? 'length' : 'stop', usage: error ? null : normalizeUsage(message.usage), trace: normalizeTrace(message.trace)} : m);
      if (chat.task?.requestId === message.requestId) chat.task = error ? pauseTask(chat.task) : {...chat.task, status: awaitingUser ? 'awaiting_user' : 'done', updatedAt: Date.now()};
      await saveChat(chat);
      await chrome.storage.session.remove(['chatLease', 'agentRun']);
      await chrome.action.setBadgeText({text: awaitingUser ? '?' : ''}).catch(() => {});
      await settleUsage(chatLease.id);
      if (credential?.receivedAt === chatLease.credentialReceivedAt) {
        if (!error && !chatLease.compacting) await chrome.storage.session.set({credential: {...credential, verifiedAt: Date.now()}});
        else if (error === 'unauthorized') await chrome.storage.session.set({credential: {...credential, verifiedAt: null, rejected: true}});
      }
      await event(error || (chatLease.compacting ? 'context_compacted' : 'api_success'), {status: Number.isInteger(message.status) ? message.status : 0});
      return state();
    }
    case 'NEW_CHAT':
    case 'SELECT_CONVERSATION':
    case 'DELETE_CONVERSATION':
    case 'RENAME_CONVERSATION':
    case 'CLEAR_CHAT': {
      await recoverChat(sender, message.clientId);
      const session = await getSession();
      if (session.chatLease || session.attempt || activeFabrix) fail('busy');
      const local = await readConversationState();
      if (message.conversationId && message.conversationId !== local.chat.sessionId) fail('conversation_changed');
      let patch;
      if (message.type === 'NEW_CHAT') {
        patch = activateConversation(local, newConversation(local.activeProvider || 'aipro', local.settings?.modelId));
      } else if (message.type === 'SELECT_CONVERSATION') {
        const target = allConversations(local).find(chat => chat.sessionId === message.id);
        if (!target) fail('conversation_missing');
        patch = activateConversation(local, target);
      } else if (message.type === 'RENAME_CONVERSATION') patch = renameConversation(local, message.id, message.title);
      else patch = removeConversation(local, message.type === 'CLEAR_CHAT' ? local.chat.sessionId : message.id);
      await commitConversationChange(local, patch);
      if (patch.chat && patch.chat.sessionId !== local.chat.sessionId) {
        await chrome.storage.session.remove('page');
        if (patch.activeProvider && patch.activeProvider !== (local.activeProvider || 'aipro')) {
          await clearLogin(null, true);
          try {await chrome.storage.session.set(activateProviderSession(await getSession(), patch.activeProvider));}
          catch (error) {await chrome.storage.local.set(local); throw error;}
        }
      }
      return state();
    }
    case 'OPEN_TAB': {
      const source = await pageTarget(sender, true);
      const tab = await chrome.tabs.create({url: chrome.runtime.getURL(`index.html${message.hash === '#settings-wiki' ? '#settings-wiki' : ''}`)});
      if (source) {
        const {chatSourceTabs = {}} = await getSession();
        await chrome.storage.session.set({chatSourceTabs: {...Object.fromEntries(Object.entries(chatSourceTabs).slice(-19)), [tab.id]: source.id}});
      }
      return null;
    }
    default: fail('invalid_sender');
  }
}
async function checkpointTool(requestId, tool, phase, result, page) {
  const {chat} = await chrome.storage.local.get('chat');
  if (chat?.task?.requestId !== requestId) return;
  chat.task = taskReceipt(chat.task, tool, phase, result, page);
  await saveChat(chat);
}
async function cancelBrowser(message, sender) {
  await boot;
  if (!trustedUI(sender)) fail('invalid_sender');
  const {chatLease} = await getSession();
  if (!chatLease || chatLease.id !== message.requestId || (chatLease.owner === 'worker' ? message.conversationId !== chatLease.conversationId : !ownsChat(chatLease, sender, message.clientId))) fail('invalid_sender');
  runner.cancel(chatLease.id);
  endWorkspaceRequest(chatLease.id);
  try {await chrome.storage.session.set({chatLease: {...chatLease, cancelled: true}});}
  finally {await stopBrowserAgent(chatLease.id);}
  return null;
}
async function cancelDetachedBrowser(requestId) {
  // Stop outside the serialized tool queue: a pending locator must not wait
  // for another model response or silently reconnect after the user cancels.
  runner.cancel(requestId);
  endWorkspaceRequest(requestId);
  const stopped = stopBrowserAgent(requestId);
  try {
    const {chatLease} = await getSession();
    if (chatLease?.id === requestId) await chrome.storage.session.set({chatLease: {...chatLease, cancelled: true}});
  } finally {await stopped;}
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target === 'image-renderer') return;
  // A locator or slow page must not block read-only progress or the explicit
  // work-window shortcut. State reads here never recover/replay a running job.
  const task = message?.type === 'GET_STATE' && toolBusy && trustedUI(sender) ? boot.then(() => state(sender, message.clientId, true))
    : message?.type === 'SHOW_BROWSER_WORKSPACE' && trustedUI(sender) ? boot.then(() => handle(message, sender))
    : message?.type === 'CANCEL_BROWSER' ? cancelBrowser(message, sender) : message?.type === 'PREPARE_CREDENTIAL' ? prepareCredential(message, sender) : message?.type === 'TEST_FABRIX' ? runFabrixTest(message, sender) : serial(async () => {
      const longOperation = ['RUN_TOOL','APPLY_FILL'].includes(message?.type);
      if (longOperation) toolBusy = true;
      try {return await handle(message, sender);} finally {if (longOperation) toolBusy = false;}
    });
  task.then(data => reply({ok: true, data}), error => reply({ok: false, error: Object.hasOwn(ERROR_TEXT, error.message)||Object.hasOwn(A2A_ERRORS,error.message) ? error.message : 'storage_failed'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (!['login-timeout', 'callback-close'].includes(alarm.name)) return;
  serial(async () => {
    const {attempt, receiverTab} = await getSession();
    if (alarm.name === 'callback-close') {
      if (!attempt && Number.isInteger(receiverTab)) await clearLogin(null, true);
      return;
    }
    if (!attempt || attempt.expiresAt > Date.now()) return;
    const error = attempt.lastError || 'login_timeout';
    await clearLogin(error, true); await event(error);
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const {attempt, receiverTab, page} = await getSession();
  if (page?.tabId === tabId) await chrome.storage.session.remove('page');
  if (attempt?.tabId === tabId || receiverTab === tabId) await clearLogin(attempt ? 'login_closed' : null);
}).catch(() => {}));
chrome.windows?.onRemoved?.addListener(windowId => serial(async () => {
  const {browserWorkspaces = {}} = await getSession();
  for (const workspace of Object.values(browserWorkspaces)) if (workspace.windowId === windowId) workspace.closed = true;
  await chrome.storage.session.set({browserWorkspaces});
}).catch(() => {}));
function onDebuggerDetached(source, reason) {
  const requestId = reason === 'canceled_by_user' && browserAgentRequestForTab(source.tabId);
  if (requestId) cancelDetachedBrowser(requestId).catch(() => {});
}
chrome.debugger.onDetach.addListener(onDebuggerDetached);

async function receiveRedirect(message, sender) {
  const {attempt, loginFlow} = await getSession();
  if (!validRedirectSender(message, sender, attempt, chrome.runtime.id, chrome.runtime.getURL('auth-return.html'))) fail('invalid_sender');
  if (attempt.phase !== 'waiting') return {accepted: false};
  let result;
  if (attempt.provider === 'chatgpt') {
    try {
      if (!validChatGPTFlow(loginFlow, attempt.id)) fail('chatgpt_callback_invalid');
      result = {exchangeCode: chatGPTCallback(`${CHATGPT_REDIRECT}?${message.query}`, loginFlow), field: 'code'};
    } catch (error) {result = {error: error.message};}
  } else result = handleCallback({url: `http://localhost:${attempt.port}/auth?${message.query}`, method: 'GET'});
  await event('callback_received', {transport: 'redirect', method: 'GET', field: result.field || 'none'});
  if (result.exchangeCode) {
    const operation = {attemptId: attempt.id, controller: new AbortController()};
    activeExchange = operation;
    await chrome.storage.session.set({attempt: {...attempt, phase: 'exchanging'}, authReport: {stage: 'code_exchange_started'}});
    await event('code_exchange_started', {method: 'POST'});
    // A consumed code and its PKCE verifier must never survive an exchange restart.
    await chrome.storage.session.remove('loginFlow');
    runCodeExchange(operation, result.exchangeCode, attempt, attempt.provider === 'chatgpt' ? loginFlow : null).catch(() => {});
  } else if (result.credential) {
    await finishLogin(attempt, result.credential, {transport: 'redirect', field: result.field});
  } else {
    const error = Object.hasOwn(ERROR_TEXT, result.error) ? result.error : 'callback_missing';
    await clearLogin(error, true);
    if (Number.isInteger(attempt.returnTabId)) await chrome.tabs.update(attempt.returnTabId, {active: true}).catch(() => {});
    fail(error);
  }
  return {accepted: true};
}
async function finishLogin(attempt, credential, details) {
  await switchProvider(credential.provider || 'aipro');
  await chrome.storage.session.set({credential: {...credential, source: 'login'}, catalog: null, accountUsage: null, authReport: {stage: 'credential_received'}});
  await chrome.storage.session.remove(['attempt', 'loginFlow']);
  await chrome.alarms.clear('login-timeout');
  await event('credential_received', details);
  if (Number.isInteger(attempt.returnTabId)) await chrome.tabs.update(attempt.returnTabId, {active: true}).catch(() => {});
  await clearLogin(null, true);
}
async function runCodeExchange(operation, code, started, flow) {
  try {
    const result = flow ? await exchangeChatGPTCode(code, flow, {signal: operation.controller.signal}) : await exchangeCode(code, {signal: operation.controller.signal});
    await serial(async () => {
      const {attempt} = await getSession();
      if (activeExchange !== operation || attempt?.id !== operation.attemptId || attempt.expiresAt <= Date.now()) return;
      const details = {transport: 'exchange', method: 'POST', status: result.status, field: result.field};
      await event('code_exchange_succeeded', details);
      await finishLogin(attempt, result.credential, details);
      activeExchange = null;
    });
  } catch (error) {
    await serial(async () => {
      const {attempt} = await getSession();
      if (activeExchange !== operation || attempt?.id !== operation.attemptId) return;
      const code = Object.hasOwn(ERROR_TEXT, error.message) ? error.message : 'exchange_invalid_response';
      await event('code_exchange_failed', {status: Number.isInteger(error.status) ? error.status : 0, error: code});
      await clearLogin(code, true);
      if (Number.isInteger(started.returnTabId)) await chrome.tabs.update(started.returnTabId, {active: true}).catch(() => {});
    });
  }
}

async function runFabrixTest(message, sender) {
  const operation = await serial(async () => {
    if (!trustedUI(sender) || typeof message.testId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(message.testId) || typeof message.clientId !== 'string' || !message.clientId || message.clientId.length > 100) fail('invalid_sender');
    const {chatLease, attempt} = await getSession();
    if (chatLease || attempt) fail('busy');
    const connection = cleanFabrixCredentials(message.connection);
    if (!await chrome.permissions.contains({origins: [`${new URL(connection.endpoint).origin}/*`]})) fail('page_permission');
    if (activeFabrix) activeFabrix.controller.abort();
    await chrome.storage.session.remove('fabrixTest');
    const operation = {id: message.testId, clientId: message.clientId, documentId: sender.documentId, controller: new AbortController(), connection};
    activeFabrix = operation;
    await event('fabrix_test_started');
    return operation;
  });
  const timeout = setTimeout(() => operation.controller.abort('timeout'), 15000);
  try {
    const result = await fabrixModels(operation.connection, {signal: operation.controller.signal});
    const {models} = inspectModelList(result.payload);
    if (!models.length) fail('models_empty');
    return await serial(async () => {
      if (activeFabrix !== operation || operation.controller.signal.aborted) fail('cancelled');
      await chrome.storage.session.set({fabrixTest: {id: operation.id, clientId: operation.clientId, documentId: operation.documentId, connection: operation.connection, payload: result.payload, expiresAt: Date.now() + 300000}});
      await event('fabrix_test_passed', {status: 200});
      return {testId: operation.id, modelCount: models.length};
    });
  } catch (cause) {
    const code = operation.controller.signal.reason === 'timeout' ? 'fabrix_test_timeout' : operation.controller.signal.aborted ? 'cancelled' : Object.hasOwn(ERROR_TEXT, cause.message) ? cause.message : 'fabrix_network';
    await serial(async () => {if (activeFabrix === operation) await event('fabrix_test_failed', {error: code, status: Number.isInteger(cause.status) ? cause.status : 0});});
    fail(code);
  } finally {
    clearTimeout(timeout);
    await serial(async () => {if (activeFabrix === operation) activeFabrix = null;});
  }
}

async function switchProvider(provider) {
  const local = await readConversationState();
  if ((local.activeProvider || 'aipro') === provider) return;
  const target = local.providerChats?.[provider] || newConversation(provider, local.providerModels?.[provider]);
  await chrome.storage.local.set(activateConversation(local, target));
  try {await chrome.storage.session.set(activateProviderSession(await getSession(), provider));}
  catch (error) {await chrome.storage.local.set(local); throw error;}
}

// Keep the network wait outside the message queue so logout can cancel refresh.
async function prepareCredential(message, sender) {
  const operation = await serial(async () => {
    if (sender === RUNNER) {
      const {chatLease} = await getSession();
      if (chatLease?.id !== message.requestId || !ownsChat(chatLease, sender) || chatLease.cancelled) fail('interrupted');
    } else if (!trustedUI(sender)) fail('invalid_sender');
    if (message.provider && message.provider !== 'chatgpt') fail('invalid_sender');
    const session = await getSession();
    const {credential} = message.provider ? providerSession(session, message.provider) : session;
    if (!credential || credential.rejected || credential.receivedAt !== message.credentialReceivedAt) fail('no_credential');
    if (credential.provider !== 'chatgpt' || (!message.force && credential.expiresAt > Date.now() + 60000)) return null;
    if (!credential.refreshToken) fail('expired_token');
    if (activeRefresh) return activeRefresh;
    const operation = {controller: new AbortController(), credential};
    activeRefresh = operation;
    operation.promise = runRefresh(operation);
    return operation;
  });
  if (operation) await operation.promise;
  return null;
}
async function runRefresh(operation) {
  try {
    const result = await refreshChatGPTToken(operation.credential, {signal: operation.controller.signal});
    await serial(async () => {
      const session = await getSession();
      const {credential} = providerSession(session, 'chatgpt');
      if (activeRefresh !== operation || credential?.receivedAt !== operation.credential.receivedAt || credential?.token !== operation.credential.token) fail('exchange_interrupted');
      await chrome.storage.session.set(updateProviderSession(session, 'chatgpt', {credential: {...credential, ...result.credential}}));
      await event('credential_refreshed', {provider: 'chatgpt', status: result.status});
    });
  } catch (error) {
    await serial(async () => {
      const session = await getSession();
      const {credential} = providerSession(session, 'chatgpt');
      if (activeRefresh === operation && credential?.receivedAt === operation.credential.receivedAt && ([400, 401, 403].includes(error.status) || error.message === 'chatgpt_token_invalid')) {
        await chrome.storage.session.set(updateProviderSession(session, 'chatgpt', {credential: {...credential, rejected: true}}));
      }
    });
    throw error;
  } finally {if (activeRefresh === operation) activeRefresh = null;}
}

void serial(() => recoverChat()).catch(() => {});
