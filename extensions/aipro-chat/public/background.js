import {browserCollaboration,A2A_ERRORS} from './a2a-connection.js';
import {browserTasks,taskPrompt,TASK_ERRORS,DELEGATION_TOOLS,DELEGATION_TOOL_NAMES,runDelegationTool,REPORT_FACTS_TOOL,delegationResult} from './a2a-tasks.js';
import {planningKnowledge, procedureCards, createSiteProcedure, procedureTool, prepareFormProcedure, linkProcedureTool, prepareLinkProcedure} from './site-procedures.js';
import {storeResearchHandoff,cancelResearchHandoffs} from './research-handoff.js';
import {routinesView,restoreRoutines,restoreRecording,expireRecording,saveRoutine,changeRoutine,fireRoutine,finishRoutine,setRoutineNotifications,notifyRoutineResult,beginRecording,recordStep,recordingNavigation,stopRecording,saveWorkflow,deleteWorkflow,workflowPrompt} from './browser-routines.js';
import {refreshBrowserPolicy,assertBrowserPolicy,browserPolicySnapshot} from './browser-policy.js';
import {uploadMetadata,uploadFiles,startDownload,downloadStatus,playwrightFiles} from './browser-transfers.js';
import {createNativeDialogRequests} from './native-dialog-request.js';
import {reconciliationProof,unresolvedReconciliations,reconcilesProofs} from './restart-reconciliation.js';
import {sameVerifiedDocuments} from './uncertain-action.js';
import {MUTATING_TOOLS} from './agent-harness.js';
import {recordStep as recordReplayStep, replayRecord} from './browser-replay.js';
import {isPlanCommand, planningRequest, planTools, planToolAllowed} from './plan-mode.js';
import {documentObservedPage, knowledgeState, knowledgeURL, knowledgeOrigin, siteWikiOrigins, routeStep, extendRoute, learnPage, autoRefreshPage, restoreKnowledge, invalidatePage, searchKnowledge, knowledgePacket, wikiOffer, wikiSource, parseWikiDraft, observationHash, observationDrift, SITE_WIKI_TOOLS, hasSiteWiki, executeSiteWiki, siteWikiSnapshot} from './browser-knowledge.js';
import {resolveSkillCommand} from './skill-command.js';
import {skillCreationSource, creationSessionContext, continueSkillCreation, parseSkillDraft, saveSkillDraft} from './skill-creator.js';
import {enqueueInput, nextInput, reorderInput} from './agent-inbox.js';
import {workspaceRecord, workspaceSummary, commitWorkspace, clearWorkspace, storeVoc, readVoc, searchVoc, vocRecord, saveVocFile, exportVoc} from './voc-workspace.js';
import {vocTools, VOC_TOOLS} from './voc-tools.js';
import {collectVocPage, fetchVocAttachment} from './voc-page.js';
import {MCP_TOOL_NAMES, mcpTools, mcpSummary, connectMcp, mcpCallBinding, callMcp, cancelMcp} from './mcp-client.js';
import {documentBindings, documentToolDefinitions, DOCUMENT_TOOL_NAMES, executeDocumentTool} from './document-tools.js';
import {createReferenceReads} from './read-deadline.js';
import {createBackgroundRunner} from './background-runner.js';
import {compareImages} from './background-images.js';
import {visionModelFor} from './model-routing.js';
import {completionDiagnostic, agentDiagnostic} from './completion-errors.js';
import {ATTACHMENT_LIMITS, attachmentIds} from './attachments.js';
import {saveAttachments, readAttachment, deleteAttachments, pruneAttachments} from './attachment-store.js';
import {clearApproval, readApprovalDraft, approvalPresentation} from './browser-approval.js';
import {PROJECT_TOOL_NAMES, projectSummary, projectContext, readProjectTool, projectWikiSnapshot} from './project-tools.js';
import {projectCandidate, connectProject, revokeProject} from './project-connection.js';
import {loadWikiFolder, commitWikiFolder, clearWikiFolder, wikiFolderSummary, executeWikiFolderTool, wikiFolderSnapshot} from './wiki-folder.js';
import {openWikiTools} from './openwiki-contract.js';
import {questionArgs, makeQuestion, questionAnswer, questionContext, repeatedQuestionAnswer, QUESTION_TEXT_LIMIT} from './user-question.js';
import {CONVERSATION_KEYS, newConversation, migrateConversations, allConversations, conversationSummaries, activateConversation, removeConversation, renameConversation, conversationCaptureIds} from './conversations.js';
import {normalizeTrace} from './agent-trace.js';
import {traceJournal} from './trace-journal.js';
import {agentDiagnosticJournal} from './agent-diagnostic-journal.js';
import {ORIGIN, MODEL_CATALOG_VERSION, DEFAULT_SETTINGS, ERROR_TEXT, cleanSettings, cleanCredential, inspectModelList, fail} from './core.js';
import {handleCallback} from './callback.js';
import {normalizeUsage} from './usage.js';
import {recordUsage, finishUsage, usageSummary} from './usage-ledger.js';
import {ACCOUNT_USAGE_VERSION, normalizeAccountUsage} from './account-usage.js';
import {CHAT_TIMEOUT_MS} from './chat-contract.js';
import {allSkills, normalizeSkill, browserTools, clarificationTool, automaticSkillTools, taskSkillId} from './skills.js';
import {skillLibrary, skillCatalog, bindSkillLibrary, prepareSkillScript, skillLibraryTools, executeSkillTool, SKILL_TOOL_NAMES} from './skill-library.js';
import {skillStats, recordSkillUse, forgetSkill} from './skill-stats.js';
import {runPageOperation} from './page-tools.js';
import {runBrowserAgent, browserAgentObservation, runApprovedAction, stopBrowserAgent, browserAgentRequestForTab, browserAgentContext, resolveBrowserTab, browserURL} from './browser-agent.js';
import {nativeResearchBrowser} from './research-browser-native.js';
import {createWorkspace, workspaceMatches, workspaceTab, readyWorkspaceTab, releaseWorkspace, showWorkspace, reconnectWorkspace, openChatTab} from './browser-workspace.js';
import {normalizeSummary, taskReceipt, pauseTask, resumedVerification, assertResumeTarget} from './context-state.js';
import {analysisCheckpoint} from './analysis-checkpoint.js';
import {storeAnalysisHandoff, cancelAnalysisHandoffs} from './analysis-handoff.js';
import {taskProgress, updateTaskPlan} from './task-plan.js';
import {LOGIN_REDIRECT_RULE_ID, loginRedirectRule, validRedirectSender} from './login-redirect.js';
import {exchangeCode} from './exchange.js';
import {CHATGPT_AUTH_ORIGIN, CHATGPT_REDIRECT, createChatGPTLogin, validChatGPTFlow, chatGPTCallback, exchangeChatGPTCode, refreshChatGPTToken} from './chatgpt-auth.js';
import {cleanFabrixCredentials, fabrixSettings, fabrixModels, fabrixDiagnostic} from './fabrix.js';
import {saveCapture, savePageImage, attachedScreenshotRecords, deleteCaptures, pruneCaptures} from './capture-store.js';
import {PROVIDERS, providerSession, updateProviderSession, connectionStatuses, activateProviderSession, removeProviderSession} from './provider-sessions.js';

const researchBrowser = nativeResearchBrowser({checkOwner:async id=>{
  const {chatLease:lease,credential}=await getSession();
  if(!lease || lease.id!==id || lease.cancelled || lease.awaitingUser || lease.planningOnly || !lease.automation ||
    lease.until<=Date.now() || credential?.receivedAt!==lease.credentialReceivedAt || credential?.rejected ||
    (credential?.provider || 'aipro')!==lease.provider)fail('interrupted');
}});
const boot = Promise.all([
  researchBrowser.recover(),
  chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}),
  chrome.storage.local.get('settings').then(({settings}) => chrome.storage.local.set({settings: cleanSettings(settings)})),
  migrateLogin(),
  restoreRoutines(),
  restoreRecording().catch(()=>{}),
  refreshBrowserPolicy(),
  migrateChatHistory().then(pruneCaptureHistory),
]);
let queue = Promise.resolve();
let activeExchange = null;
let activeRefresh = null;
let activeFabrix = null;
let pendingToolOperations = 0;
const endedWorkspaceRequests = new Set();
function endWorkspaceRequest(id) {
  endedWorkspaceRequests.add(id);
  if (endedWorkspaceRequests.size > 100) endedWorkspaceRequests.delete(endedWorkspaceRequests.values().next().value);
}
const serial = (task) => { const run = queue.then(() => boot).then(task); queue = run.catch(() => {}); return run; };
const serialTool = (type, task) => {
  if (!['RUN_TOOL', 'APPLY_FILL'].includes(type)) return serial(task);
  // Reserve before enqueueing: observers arriving before this task starts must
  // not queue behind a tool that can wait for their native-dialog response.
  pendingToolOperations++;
  return serial(task).finally(() => {pendingToolOperations--;});
};
const getSession = async () => chrome.storage.session.get(null);
// An in-memory capability, never a document ID or a message-supplied flag.
const RUNNER = Object.freeze({});
const RUNNER_TYPES = new Set(['SAVE_CONTEXT', 'RUN_TOOL', 'APPLY_FILL', 'RECORD_USAGE', 'MODEL_DIAGNOSTIC', 'FINISH_CHAT', 'TAKE_AGENT_INPUT', 'START_CHAT', 'RESEARCH_OPERATION']);
const referenceReads = createReferenceReads();
const runner = createBackgroundRunner({
  call: (type, value) => type === 'PREPARE_CREDENTIAL' ? prepareCredential({type, ...value}, RUNNER)
    : type === 'RESEARCH_OPERATION' ? boot.then(()=>handle({type,...value},RUNNER)) : serialTool(type, () => handle({type, ...value}, RUNNER)),
  compareImages,
  publish: snapshot => serial(async () => {
    const {chatLease, credential} = await getSession();
    if (!chatLease || chatLease.id !== snapshot.requestId || chatLease.owner !== 'worker' || chatLease.cancelled || credential?.receivedAt !== chatLease.credentialReceivedAt) return;
    await chrome.storage.session.set({agentRun: snapshot});
  }),
});

async function currentTransferViews(){
  const {chat,browserTransfers=[]}=await chrome.storage.local.get(['chat','browserTransfers']);
  const owned=browserTransfers.filter(r=>r.provider===chat?.provider&&r.conversationId===chat?.sessionId);
  for(const receipt of owned.slice(-20))if(['in_progress','unknown'].includes(receipt.status)&&Number.isInteger(receipt.downloadId))await downloadStatus(receipt,receipt.id).catch(()=>{});
  const fresh=(await chrome.storage.local.get('browserTransfers')).browserTransfers||[];
  return fresh.filter(r=>r.provider===chat?.provider&&r.conversationId===chat?.sessionId).map(({id,status,filename,bytesReceived,totalBytes})=>({id,status,filename,bytesReceived,totalBytes}));
}
async function routineOwner() {
  const {chat,settings,activeSkillId=''}=await chrome.storage.local.get(['chat','settings','activeSkillId']);
  const {credential,chatLease,attempt}=await getSession();
  return {conversationId:chat?.sessionId,provider:chat?.provider,modelId:settings?.modelId,skillId:activeSkillId,
    credentialReceivedAt:credential?.receivedAt,busy:!!chatLease||!!attempt,pendingQuestion:!!chat?.messages?.at(-1)?.question&&!chat.messages.at(-1).question.answer};
}
async function startScheduledRoutine(job) {
  browserURL(job.url);
  const tab=await chrome.tabs.create({url:job.url,active:false});
  const request=await handle({type:'START_CHAT',text:job.prompt,conversationId:job.conversationId,scheduledTabId:tab.id},RUNNER,RUNNER);
  runner.start(request);return request;
}
async function readConversationState() {
  const local = await chrome.storage.local.get(CONVERSATION_KEYS);
  if (!local.chat?.sessionId || !Array.isArray(local.chatHistory) || Object.values(local.providerChats || {}).some(chat => !chat.sessionId)) {
    const patch = migrateConversations(local);
    await chrome.storage.local.set(patch);
    return {...local, ...patch};
  }
  return local;
}
// Loaded only by an explicit connection action or a bound imported run.
let a2aReceiver;
async function browserA2A() {
  if(!a2aReceiver)a2aReceiver=browserCollaboration({session:getSession,saveSession:value=>chrome.storage.session.set(value),conversation:readConversationState,saveChat});
  return a2aReceiver;
}
// nubi-task-v1 uses the pairing made above (session a2a). A received task runs
// only after the user accepts it, in a new conversation, and its result is sent
// when that run ends. The token never reaches UI state or the model.
const A2A_POLL = 'nubi-a2a-tasks';
const a2aTasks = browserTasks({
  load: async () => (await getSession()).a2aTasks,
  save: value => chrome.storage.session.set({a2aTasks: value}),
  connection: async () => (await getSession()).a2a?.connection || null,
  saveConnection: async moved => {const {a2a} = await getSession(); if (a2a?.connection?.token === moved.token) await chrome.storage.session.set({a2a: {...a2a, connection: moved}});},
});
function taskError(error) {
  const code = String(error?.message || ''), known = Object.hasOwn(TASK_ERRORS, code) || Object.hasOwn(ERROR_TEXT, code);
  return {error: known ? code : 'a2a_unavailable', message: TASK_ERRORS[code] || ERROR_TEXT[code] || TASK_ERRORS.a2a_unavailable};
}
async function taskBadge(tasks) {
  const waiting = tasks.filter(task => task.recipient === 'browser' && task.state === 'submitted').length;
  const current = await chrome.action.getBadgeText({}).catch(() => '');
  // The '?' of a question waiting for the user stays.
  if (current === '' || /^\d+$/.test(current)) await chrome.action.setBadgeText({text: waiting ? String(Math.min(waiting, 99)) : ''}).catch(() => {});
}
async function a2aTasksRpc(message, sender) {
  try {
    if (!(await getSession()).a2a?.connection) return {connected: false, tasks: []};
    if (!await chrome.alarms.get(A2A_POLL)) await chrome.alarms.create(A2A_POLL, {periodInMinutes: 1});
    const id = typeof message.id === 'string' ? message.id.slice(0, 100) : '';
    if (message.action === 'accept') await acceptTask(id, message, sender);
    else if (message.action === 'reject') await a2aTasks.reject(id, '브라우저 사용자가 거절했습니다.');
    else if (message.action === 'cancel') await a2aTasks.cancel(id);
    else if (message.action === 'fail') {
      const run = await a2aTasks.run();
      if (run?.taskId !== id || !run.stopped) fail('a2a_scope');
      await a2aTasks.fail(id, '브라우저 실행이 끝나지 않아 실패로 알렸습니다.'); await a2aTasks.clearRun(id);
    } else if (message.action !== 'list') fail('a2a_scope');
    const {tasks} = await a2aTasks.list(), session = await getSession(), run = session.a2aTasks?.run;
    await taskBadge(tasks);
    return {connected: true, tasks, busy: !!(session.chatLease || session.attempt || run), run: run ? {taskId: run.taskId, stopped: run.stopped === true} : null};
  } catch (error) {return taskError(error);}
}
async function acceptTask(id, message, sender) {
  const session = await getSession();
  if (session.chatLease || session.attempt || session.a2aTasks?.run) fail('a2a_busy');
  const task = await a2aTasks.get(id);
  if (task.recipient !== 'browser' || task.state !== 'submitted') fail('a2a_state');
  await a2aTasks.accept(id);
  let request;
  try {
    // Like a scheduled routine, a task with an address starts in its own background
    // tab, so the page the user is looking at is left alone.
    const start = task.urls?.length ? await chrome.tabs.create({url: browserURL(task.urls[0]).href, active: false}) : null;
    request = await serial(async () => {
      await handle({type: 'NEW_CHAT', clientId: message.clientId}, sender);
      const {chat} = await readConversationState();
      await a2aTasks.bindRun({taskId: id, conversationId: chat.sessionId, provider: chat.provider, facts: [], acceptedAt: Date.now()});
      const text = taskPrompt(task);
      return start ? handle({type: 'START_CHAT', text, conversationId: chat.sessionId, scheduledTabId: start.id}, RUNNER, RUNNER)
        : handle({type: 'START_CHAT', text, conversationId: chat.sessionId, clientId: message.clientId}, sender, RUNNER);
    });
  } catch (error) {
    await a2aTasks.clearRun(id);
    await a2aTasks.fail(id, '브라우저에서 작업을 시작하지 못했습니다.').catch(() => {});
    throw error;
  }
  await chrome.action.setBadgeText({text: ''}).catch(() => {});
  runner.start(request);
}
async function deliverTaskResult(run) {
  try {await a2aTasks.complete(run.taskId, run.result); await a2aTasks.clearRun(run.taskId);}
  // A lost reply keeps the result and its message ID for the next poll.
  catch (error) {if (!['a2a_uncertain', 'a2a_unavailable'].includes(error.message)) await a2aTasks.clearRun(run.taskId);}
}
// A run of the conversation bound to an accepted task ended. A question or an
// approval pause is progress; a stop keeps the task open for the user.
async function finishDelegatedRun(lease, {error, awaitingUser, content, reviewed}) {
  const run = await a2aTasks.run();
  if (!run || run.conversationId !== lease.conversationId || run.provider !== lease.provider || lease.compacting || run.result) return;
  if (awaitingUser) {await a2aTasks.progress(run.taskId, '브라우저 사용자의 답을 기다립니다.').catch(() => {}); return;}
  if (error) {await a2aTasks.updateRun({stopped: true}); await a2aTasks.progress(run.taskId, '브라우저 실행이 멈췄습니다. 브라우저에서 이어 가거나 실패로 알립니다.').catch(() => {}); return;}
  const updated = await a2aTasks.updateRun({result: delegationResult({content, facts: run.facts || [], verified: reviewed, runId: lease.id})});
  if (updated) await deliverTaskResult(updated);
}
async function pollTasks() {
  const {a2a, a2aTasks: stored} = await getSession();
  if (!a2a?.connection) {await chrome.alarms.clear(A2A_POLL); return;}
  if (stored?.run?.result) await deliverTaskResult(stored.run);
  const {tasks} = await a2aTasks.list(), run = (await getSession()).a2aTasks?.run;
  // A task its requester cancelled no longer takes this run's result.
  if (run && !run.result && tasks.find(task => task.id === run.taskId)?.state === 'canceled') await a2aTasks.clearRun(run.taskId);
  await taskBadge(tasks);
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
  await traceJournal.prune(journalOwners(local)).catch(() => {});
  await agentDiagnosticJournal.prune(journalOwners(local)).catch(() => {});
}
function journalOwners(local) {
  return allConversations(local).flatMap(chat => (chat.messages || []).filter(message => message.role === 'assistant').map(message => ({provider: chat.provider, conversationId: chat.sessionId, requestId: message.id})));
}
async function commitConversationChange(local, patch) {
  // A failed quota write must retain the entire old selection and history.
  await chrome.storage.local.set(patch);
  const remaining = new Set(conversationCaptureIds({...local, ...patch}));
  await deleteCaptures(conversationCaptureIds(local).filter(id => !remaining.has(id))).catch(() => {});
  const retainedFiles = new Set(attachmentIds({...local, ...patch}));
  await deleteAttachments(attachmentIds(local).filter(id => !retainedFiles.has(id))).catch(() => {});
  await traceJournal.prune(journalOwners({...local, ...patch})).catch(() => {});
  await agentDiagnosticJournal.prune(journalOwners({...local, ...patch})).catch(() => {});
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
async function alreadyAttachedScreenshots(lease, refs) {
  if (!Array.isArray(refs) || !refs.length || refs.length > 4 || new Set(refs).size !== refs.length ||
    refs.some(ref => typeof ref !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(ref))) return null;
  const matchesReply = chat => chat?.sessionId === lease.conversationId && chat.provider === lease.provider &&
    chat.messages?.some(reply => reply.id === lease.id && reply.role === 'assistant' &&
      refs.every(id => reply.captures?.some(capture => capture.id === id && capture.source === 'browser-tab')));
  const assertLease = ({chatLease: current, credential}) => {
    if (!current || !credential || current.id !== lease.id || current.conversationId !== lease.conversationId ||
      current.provider !== lease.provider || current.cancelled || current.awaitingUser || !Number.isFinite(current.until) || current.until <= Date.now() ||
      current.credentialReceivedAt !== lease.credentialReceivedAt || credential?.receivedAt !== current.credentialReceivedAt ||
      credential.rejected || (credential.provider || 'aipro') !== current.provider) fail('interrupted');
  };
  const {chat} = await chrome.storage.local.get('chat');
  assertLease(await getSession());
  if (!matchesReply(chat)) return null;
  const attachments = await attachedScreenshotRecords(refs, {requestId: lease.id, provider: lease.provider});
  // Storage reads yield. Recheck both ownership and the exact reply after the
  // IndexedDB read so cancellation or conversation changes cannot return success.
  const {chat: currentChat} = await chrome.storage.local.get('chat');
  assertLease(await getSession());
  if (!matchesReply(currentChat)) fail('interrupted');
  if (!attachments) return {error: 'capture_save_failed', alreadyAttached: false};
  return {attachments, alreadyAttached: true, scope: 'stored_chat_attachments',
    instruction: 'These screenshots are already attached to this reply and available for preview/download in chat. No new image was captured or saved. This receipt does not verify the current page or a device download.'};
}
async function saveUserQuestion(lease, args, attachments = []) {
  const current = (await getSession()).chatLease;
  if (current?.id !== lease.id || current.cancelled) fail('interrupted');
  const repeated = repeatedQuestionAnswer(current.answeredQuestion, args);
  if (repeated) return repeated;
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
async function saveActionApproval(lease, record, replay = null) {
  // The approval card itself shows the draft for the user to decide on. Requiring
  // a separate check first held presses the user wanted made ("초안 검증 필요").
  const {chatLease, actionApprovals = {}} = await getSession();
  const {chat} = await chrome.storage.local.get('chat');
  const reply = chat?.messages.find(message => message.id === lease.id);
  if (chatLease?.id !== lease.id || chatLease.cancelled || !reply || chat.sessionId !== lease.conversationId) fail('interrupted');
  const presentation = record.kind === 'mcp' ? {text:'이 도구를 실행할까요?',buttonLabel:'실행'} : approvalPresentation(record);
  const question = {id: crypto.randomUUID(), kind: 'approval', action: record.action, targetLabel: record.label, ...presentation,
    ...(record.operation?.method === 'download' ? {requiredPermission: 'downloads'} : {}),
    pageTitle: record.pageTitle, preview: record.preview, hasEditableDraft: record.hasEditableDraft, summary: record.summary,
    options: [{id: 'approve', label: presentation.buttonLabel}, {id: 'reject', label: '취소'}]};
  const {preview, summary, afterActions, ...binding} = record;
  const previous = actionApprovals[chat.sessionId];
  actionApprovals[chat.sessionId] = {...binding, browserContext: browserAgentContext(lease.id), questionId: question.id, conversationId: chat.sessionId,
    provider: lease.provider, credentialReceivedAt: lease.credentialReceivedAt, ...(replay ? {replay} : {})};
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
async function patchChatLease(lease,patch) {
  const current=(await getSession()).chatLease;
  if (!current || current.id!==lease.id || current.cancelled) fail('interrupted');
  await chrome.storage.session.set({chatLease:{...current,...patch}});
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
  cancelMcp(chatLease.id);
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
async function projectReadFailure(connection, error) {
  const code = Object.hasOwn(ERROR_TEXT, error.message) ? error.message : 'project_unavailable';
  if (code === 'project_expired' && connection.kind !== 'folder') {
    const current = (await getSession()).projectConnection;
    if (current?.connectionId === connection.connectionId && current.token === connection.token)
      await chrome.storage.session.set({projectConnection: {...current, rejected: true}});
  }
  return {error: code, instruction: connection.kind === 'folder'
    ? 'OpenWiki folder read failed. For permission errors ask the user to allow the saved folder in Settings > OpenWiki folder. Do not request a server or page link. Do not invent documents. For missing files or arguments revise the query/path from observed evidence.'
    : 'Project read failed. Do not claim source access or substitute rendered HTML for repository code. Reconnect the project when its session expired, or use a valid relative path/range for argument errors.'};
}
const nativeDialogRequests = createNativeDialogRequests({changed: () => chrome.storage.session.set({nativeDialogRevision:crypto.randomUUID()})});
async function answerNativeDialog(message, sender) {
  if(!trustedUI(sender))fail('invalid_sender');
  const {chatLease,credential}=await getSession();
  const {chat}=await chrome.storage.local.get('chat');
  if(message.conversationId!==chat?.sessionId)fail('question_changed');
  return nativeDialogRequests.answer(message,chatLease,credential,chat.sessionId);
}
async function state(sender, clientId, readOnly = false) {
  if (!readOnly) {await readConversationState(); await recoverChat(sender, clientId);}
  const session = await getSession();
  const {browserWorkMode = 'window', browserKnowledge, debugMode} = await chrome.storage.local.get(['browserWorkMode', 'browserKnowledge', 'debugMode']);
  const {settings = DEFAULT_SETTINGS, chat = {messages: [], draft: ''}, skills = [], activeSkillId = '', activeProvider = 'aipro', fabrixConnection = null} = await chrome.storage.local.get(['settings', 'chat', 'skills', 'activeSkillId', 'activeProvider', 'fabrixConnection']);
  const c = (session.credential?.provider || 'aipro') === activeProvider ? session.credential : null;
  const {usageLedger} = await chrome.storage.local.get('usageLedger').catch(() => ({}));
  const catalog = c && session.catalog?.credentialReceivedAt === c.receivedAt ? session.catalog : null;
  const chatgpt = providerSession(session, 'chatgpt');
  const binding = await projectBinding(session);
  const workspace = session.browserWorkspaces?.[chat.sessionId];
  return {nativeDialog:nativeDialogRequests.view(session.chatLease,c,chat.sessionId), recording: session.browserRecording && !session.browserRecording.stopped ? {origin:session.browserRecording.origin,actions:session.browserRecording.steps.filter(step=>step.kind!=='navigate').length,expiresAt:session.browserRecording.expiresAt} : null, settings, browserWorkMode, debugMode: debugMode === true, workspace: workspace && workspaceMatches(workspace, {conversationId:chat.sessionId,provider:activeProvider,credentialReceivedAt:c?.receivedAt}) ? {id:workspace.id, closed:!!workspace.closed} : null, chat, conversations: conversationSummaries(readOnly ? await chrome.storage.local.get(CONVERSATION_KEYS) : await readConversationState()), catalog, activeProvider, usage: usageSummary(usageLedger), accountUsage: chatgpt.credential && chatgpt.accountUsage?.credentialReceivedAt === chatgpt.credential.receivedAt ? chatgpt.accountUsage : null, auth: {present: !!c, provider: c?.provider || activeProvider, expired: !!c?.expiresAt && c.expiresAt <= Date.now() && !(c.provider === 'chatgpt' && c.refreshToken), rejected: !!c?.rejected, mode: c?.mode, expiresAt: c?.expiresAt, source: c?.source, verifiedAt: c?.verifiedAt, receivedAt: c?.receivedAt},
    connections: connectionStatuses(session), project: binding.project, wikiFolder: binding.wikiFolder, wikiFolderError: binding.wikiFolderError,
    serverProject: projectSummary(session.projectConnection),
    pending: session.attempt ? {provider: session.attempt.provider || 'aipro', expiresAt: session.attempt.expiresAt, port: session.attempt.port, phase: session.attempt.phase} : null,
    agentRun: session.chatLease && session.agentRun?.requestId === session.chatLease.id ? session.agentRun : null,
    liveContext: session.chatLease && session.liveContext?.requestId === session.chatLease.id ? session.liveContext.usage : null,
    report: session.authReport || {stage: 'not_started'}, events: session.events || [], modelTimings: session.modelTimings || [], authTrace: session.authTrace || null, busy: !!session.chatLease,
    skills: allSkills(skills), skillStats: skillStats((await chrome.storage.local.get('skillStats').catch(() => ({}))).skillStats), activeSkillId, fabrixConnection, page: session.page ? {id: session.page.id, title: session.page.title, url: session.page.url} : null};
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
  await refreshBrowserPolicy(); assertBrowserPolicy(tab.url);
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
async function connectWorkPage(sender, lease, page, {tabOnly = false} = {}) {
  let createdWorkspace = false;
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
    createdWorkspace = true;
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
  // A newly created HTTP tab may still expose about:blank or no URL. An
  // inventory at that instant silently filters out the authorized target.
  // Wait only on initial creation; recovery of existing error tabs must stay
  // possible without a scriptable DOM, and must not focus a user window.
  if (tabOnly && createdWorkspace) await readyWorkspaceTab(workspace, workspace.tabId, () => endedWorkspaceRequests.has(lease.id));
  const tab = await workspaceTab(workspace, workspace.tabId);
  if (tabOnly) {
    // Tab recovery needs ownership and policy, not a scriptable current DOM.
    // This transient binding is never stored as an observed document or used
    // for refs, approvals or writes. The selected document reconnects normally.
    assertBrowserPolicy(tab.url);
    return {page: {tabId:tab.id, workspaceId:workspace.id, metadataOnly:true},
      lease:{...lease,browserContext:{...(lease.browserContext || {}),tabId:tab.id,workspace}}};
  }
  if (!page?.metadataOnly && page?.workspaceId === workspace.id && page.tabId === workspace.tabId && page.id === lease.pageId) return {page, lease};
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
    case 'A2A': {
      try {
        const receiver=await browserA2A();
        const value=await receiver.dispatch({...message,conversationId:message.conversationId});
        if(value.draft){const {chat}=await readConversationState();chat.draft=value.draft;await saveChat(chat);}
        return value;
      } catch(error) {
        return {error:Object.hasOwn(A2A_ERRORS,error.message)?error.message:'a2a_unavailable'};
      }
    }
    case 'GET_AGENT_DIAGNOSTICS':
    case 'GET_TRACE_JOURNAL': {
      const local = await readConversationState();
      const chat = allConversations(local).find(item => item.sessionId === message.conversationId && item.provider === message.provider);
      const reply = chat?.messages?.find(item => item.id === message.requestId && item.role === 'assistant');
      if (!reply) fail('conversation_changed');
      if (message.type === 'GET_AGENT_DIAGNOSTICS') return agentDiagnosticJournal.page({provider: chat.provider, conversationId: chat.sessionId, requestId: reply.id}, {before: message.before});
      const page = await traceJournal.page({provider: chat.provider, conversationId: chat.sessionId, requestId: reply.id}, {before: message.before});
      return {...page, incomplete: reply.traceJournal?.incomplete === true, priorRecord: reply.traceJournal?.available === true};
    }
    case 'GET_BROWSER_ROUTINES': registerOptionalBrowserEvents();return {...await routinesView(),transfers:await currentTransferViews(),draft:(await chrome.storage.local.get('browserRecordingDraft')).browserRecordingDraft||null};
    case 'SET_BROWSER_NOTIFICATIONS': registerOptionalBrowserEvents();await setRoutineNotifications(message.enabled);return routinesView();
    case 'SAVE_BROWSER_ROUTINE': return saveRoutine(message,await routineOwner());
    case 'CHANGE_BROWSER_ROUTINE': await changeRoutine(message.id,message.action,message,await routineOwner());return routinesView();
    case 'START_BROWSER_RECORDING': {const owner=await routineOwner();if(owner.busy)fail('busy');const tab=await pageTarget(sender);if(!tab)fail('page_target_missing');browserURL(tab.url);await beginRecording(tab,{replaceDraftId:message.replaceDraftId});return routinesView();}
    case 'STOP_BROWSER_RECORDING': return stopRecording();
    case 'SAVE_BROWSER_WORKFLOW': return saveWorkflow(message);
    case 'DELETE_BROWSER_WORKFLOW': await deleteWorkflow(message.id);return routinesView();
    case 'RUN_BROWSER_WORKFLOW': {const text=await workflowPrompt(message.id);return handle({type:'START_AGENT',text},sender);}

    case 'GET_BROWSER_KNOWLEDGE': {
      const stored=await chrome.storage.local.get(['browserKnowledge','browserSiteProcedures']);
      const knowledge=knowledgeState(stored.browserKnowledge);
      return {...knowledge,procedures:procedureCards(stored.browserSiteProcedures).map(card=>({id:card.id,url:card.url,provider:card.provider,title:card.title,
        kind:card.kind || 'form',fields:card.fields.length,wikiVersion:card.wikiVersion,status:knowledge.entries.some(entry=>entry.url===card.url && entry.provider===card.provider && !entry.invalidated && !entry.markdownNeedsReview && entry.documentVersion===card.wikiVersion && entry.sourceHash===card.sourceHash) ? 'reviewed' : 'needs_review'}))};
    }
    case 'UPDATE_BROWSER_KNOWLEDGE': {
      const current = knowledgeState((await chrome.storage.local.get('browserKnowledge')).browserKnowledge);
      if (message.enabled !== undefined && typeof message.enabled !== 'boolean') fail('tool_arguments_invalid');
      if (message.url !== undefined && typeof message.url !== 'string') fail('tool_arguments_invalid');
      if (message.autoUpdate !== undefined && typeof message.autoUpdate !== 'boolean') fail('tool_arguments_invalid');
      if (message.restore === true) {
        const restored=restoreKnowledge(current,message);
        await chrome.storage.local.set({browserKnowledge:restored}); return restored;
      }
      const updated = {...current, revision:current.revision+1,
        ...(message.enabled !== undefined ? {enabled:message.enabled} : {}),
        ...(message.autoUpdate !== undefined ? {autoUpdate:message.autoUpdate} : {}),
        entries:message.clear === true ? [] : current.entries.filter(item => !(item.url === message.url && item.provider === message.provider))};
      const storedCards=procedureCards((await chrome.storage.local.get('browserSiteProcedures')).browserSiteProcedures);
      await chrome.storage.local.set({browserKnowledge:updated,...(message.clear===true || message.url && !message.restore ? {browserSiteProcedures:message.clear===true ? [] : storedCards.filter(card=>card.url!==message.url || card.provider!==message.provider)} : {})});
      return {...updated,procedures:storedCards.filter(card=>updated.entries.some(entry=>entry.url===card.url && entry.provider===card.provider)).map(card=>({id:card.id,url:card.url,provider:card.provider,title:card.title,kind:card.kind || 'form',fields:card.fields.length,wikiVersion:card.wikiVersion,status:updated.entries.some(entry=>entry.url===card.url && entry.provider===card.provider && entry.documentVersion===card.wikiVersion && entry.sourceHash===card.sourceHash && !entry.invalidated && !entry.markdownNeedsReview) ? 'reviewed' : 'needs_review'}))};
    }
    case 'SAVE_BROWSER_WIKI':
    case 'DISMISS_BROWSER_WIKI': {
      if ((await getSession()).chatLease) fail('busy');
      const {chat} = await chrome.storage.local.get('chat');
      if (!chat || message.conversationId !== chat.sessionId) fail('conversation_changed');
      const reply = chat.messages.find(item=>item.id===message.messageId);
      if (!reply || reply.state!=='done') fail('skill_draft_invalid');
      if (message.type==='DISMISS_BROWSER_WIKI') {
        if (!reply.wikiOffer) fail('skill_draft_invalid');
        reply.wikiOffer.status='dismissed'; await saveChat(chat); return state();
      }
      if (!reply.wikiDraft || reply.creationSource?.kind!=='wiki') fail('skill_draft_invalid');
      const current=knowledgeState((await chrome.storage.local.get('browserKnowledge')).browserKnowledge);
      if (!current.enabled || current.revision!==reply.creationSource.revision) fail('wiki_source_missing');
      const existing=current.entries.find(item=>item.url===reply.creationSource.candidate.url && item.provider===chat.provider);
      if ((existing?.documentVersion || 0)!==(reply.creationSource.targetVersion || 0)) fail('wiki_changed');
      const document=parseWikiDraft(JSON.stringify(message.document));
      const candidate={...reply.creationSource.candidate,title:document.title,markdown:document.markdown,reviewedAt:Date.now(),markdownNeedsReview:false};
      if (candidate.provider!==chat.provider) fail('conversation_changed');
      const updated=learnPage(current,candidate,current.revision);
      if (!updated.entries.some(item=>item.url===candidate.url && item.provider===candidate.provider && item.markdown===document.markdown)) fail('skill_draft_invalid');
      reply.wikiDraft={...document,saved:true};
      reply.creationSource={...reply.creationSource,targetVersion:updated.entries.find(item=>item.url===candidate.url && item.provider===candidate.provider).documentVersion};
      const source=chat.messages.find(item=>item.id===reply.creationSource.sourceId);
      if (source?.wikiOffer) source.wikiOffer.status='saved';
      const previousCards=(await chrome.storage.local.get('browserSiteProcedures')).browserSiteProcedures;
      const card=message.linkProcedure === true && source?.replay ? createSiteProcedure(source.replay,
        updated.entries.find(item=>item.url===candidate.url && item.provider===candidate.provider),{id:crypto.randomUUID()}) : null;
      if (message.linkProcedure === true && !card) fail('skill_draft_invalid');
      reply.wikiDraft={...reply.wikiDraft,...(card ? {procedureLinked:true,procedureKind:card.kind || 'form'} : {})};
      // One storage transaction: document and its conversation receipt agree.
      await chrome.storage.local.set({browserKnowledge:updated,chat:{...chat,updatedAt:Date.now()},...(card ? {browserSiteProcedures:[...procedureCards(previousCards).filter(item=>item.url!==card.url || item.provider!==card.provider),card].slice(-50)} : {})});
      return state();
    }
    case 'SET_DEBUG_MODE': {
      if (typeof message.enabled !== 'boolean') fail('tool_arguments_invalid');
      await chrome.storage.local.set({debugMode: message.enabled});
      return state(sender, message.clientId, true);
    }
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
    case 'WORKSPACE_STATUS': return workspaceSummary();
    case 'WORKSPACE_COMMIT':
    case 'WORKSPACE_CLEAR': {
      const session = await getSession(); if (session.chatLease || session.attempt || activeFabrix) fail('busy');
      if (message.type === 'WORKSPACE_COMMIT') await commitWorkspace(message.stageId,message.clientId); else await clearWorkspace();
      return workspaceSummary();
    }
    case 'MCP_STATUS': return {servers:((await getSession()).mcpServers || []).map(mcpSummary)};
    case 'MCP_CONNECT': {
      const session = await getSession();
      if (session.chatLease || session.attempt || activeFabrix) fail('busy');
      const previous = session.mcpServers || [];
      if (previous.length >= 8 && !previous.some(item => item.id === message.replaceId)) fail('mcp_limit');
      const record = await connectMcp(message.connection);
      await chrome.storage.session.set({mcpServers:[...previous.filter(item => item.id !== message.replaceId),record]});
      return {servers:[...previous.filter(item => item.id !== message.replaceId),record].map(mcpSummary)};
    }
    case 'MCP_REMOVE': {
      const session = await getSession();
      if (session.chatLease || session.attempt || activeFabrix) fail('busy');
      const servers = (session.mcpServers || []).filter(item => item.id !== message.id);
      await chrome.storage.session.set({mcpServers:servers}); return {servers:servers.map(mcpSummary)};
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
      if (message.kind === 'delegation_facts') {
        // The runner checked these against its own page reads; keep them for the result.
        const run = await a2aTasks.run();
        if (sender !== RUNNER || !Array.isArray(message.facts) || message.facts.length > 50 || run?.conversationId !== chatLease.conversationId || run.provider !== chatLease.provider) fail('interrupted');
        await a2aTasks.updateRun({facts: message.facts.map(({name, value, source_url, quote, checked, title}) => ({name, value, source_url, quote, checked: checked === true, ...(typeof title === 'string' && title ? {title} : {})}))});
        return null;
      }
      const {chat} = await chrome.storage.local.get('chat');
      if (['analysis_handoff','research_handoff'].includes(message.kind)) {
        if (sender!==RUNNER || chat.sessionId!==chatLease.conversationId || chat.provider!==chatLease.provider || !chatLease.automation ||
            !chat.messages.some(m=>m.id===chatLease.id&&m.role==='assistant'&&m.state==='pending')) fail('interrupted');
        if (chat.task?.requestId!==chatLease.id) {
          if (!chatLease.autoConnect) fail('interrupted');
          chat.task={requestId:chatLease.id,skillId:chatLease.librarySkillId||'browser-agent',autoConnect:true,planningOnly:chatLease.planningOnly===true,
            goal:chat.messages.find(m=>m.id===chatLease.id)?.inputGoal||chat.messages.findLast(m=>m.role==='user')?.content||'',status:'running',steps:[],plan:[],summary:null,page:null,updatedAt:Date.now()};
        }
        const field=message.kind==='analysis_handoff'?'analysisHandoffs':'researchHandoffs';
        chat.task={...chat.task,[field]:(field==='analysisHandoffs'?storeAnalysisHandoff:storeResearchHandoff)(chat.task[field],message.record),updatedAt:Date.now()};
        await saveChat(chat); return null;
      }
      if (message.kind === 'model') {
        if (!chatLease.modelIds?.includes(message.modelId)) fail('invalid_model');
        const {catalog} = await getSession();
        const model = catalog?.credentialReceivedAt === credential.receivedAt && catalog.models?.find(item => item.name === message.modelId);
        if (!model) fail('invalid_model');
        chat.messages = chat.messages.map(reply => reply.id === chatLease.id && reply.state === 'pending' ? {...reply, modelId: model.name, modelName: model.displayName || model.name} : reply);
        await saveChat(chat); return null;
      }
      if (message.kind === 'trace') {
        if (chat.sessionId !== chatLease.conversationId || chat.provider !== chatLease.provider) fail('interrupted');
        const reply = chat.messages.find(item => item.id === chatLease.id && item.state === 'pending');
        let journal = reply?.traceJournal;
        if (sender === RUNNER && reply && message.event) {
          try {
            const recorded = await traceJournal.append({provider: chatLease.provider, conversationId: chatLease.conversationId, requestId: chatLease.id}, message.event, message.sequence);
            if (recorded) journal = {...journal, available: true};
          } catch {journal = {...journal, incomplete: true};}
        }
        chat.messages = chat.messages.map(reply => reply.id === chatLease.id && reply.state === 'pending' ? {...reply, trace: normalizeTrace(message.trace), ...(journal ? {traceJournal: journal} : {})} : reply);
        await saveChat(chat); return null;
      }
      if (message.kind === 'review') {
        if (chat.task?.requestId !== chatLease.id || !['running', 'complete', 'revise', 'blocked', 'failed', 'limited'].includes(message.status) || !Number.isInteger(message.checks) || message.checks < 0 || message.checks > 8) fail('goal_review_failed');
        const reason = message.status === 'failed' && /^[a-z_]{1,40}$/.test(message.reason || '') ? message.reason : null;
        chat.task = {...chat.task, goalReview: {status: message.status, checks: message.checks, at: Date.now(), ...(reason ? {reason} : {})}};
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
      if (message.type === 'MODEL_DIAGNOSTIC' && message.kind === 'agent') {
        const diagnostic = agentDiagnostic(message);
        if (diagnostic) {
          await agentDiagnosticJournal.append({provider: chatLease.provider, conversationId: chatLease.conversationId, requestId: chatLease.id}, message).catch(() => {});
          await event(`agent_${diagnostic.phase}`, {requestId: chatLease.id, ...diagnostic});
        }
        return null;
      }
      const diagnostic = chatLease.provider === 'fabrix' ? fabrixDiagnostic(message) : ['aipro', 'chatgpt'].includes(chatLease.provider) && message.type === 'MODEL_DIAGNOSTIC' ? completionDiagnostic(message) : null;
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
      // What the latest working request actually read, page contents included, as
      // the provider counted it. The context gauge showed only the conversation text
      // during a run, so reading page after page did not move it.
      const measured = message.scope === 'execution' ? normalizeUsage(message.usage) : null;
      if (measured?.prompt_tokens > 0) {
        try {await chrome.storage.session.set({liveContext: {requestId: chatLease.id, usage: measured, at: Date.now()}});}
        catch { /* Telemetry failure cannot interrupt inference. */ }
      }
      // Time per model call for the connection diagnostics: kind, input size and
      // milliseconds only. A company server is measured where it is reachable.
      if (message.phase === 'finish' && Number.isFinite(message.elapsedMs) && message.elapsedMs >= 0) {
        try {
          const {modelTimings = []} = await chrome.storage.session.get('modelTimings');
          const entry = {at: new Date().toISOString(), provider: chatLease.provider || 'aipro', scope: ['execution', 'planning', 'review', 'analysis', 'compaction'].includes(message.scope) ? message.scope : 'other',
            inputK: Math.round((Number(message.inputCharacters) || 0) / 1000), ...(Number(message.imageInputCharacters) > 0 ? {imageK: Math.round(message.imageInputCharacters / 1000)} : {}),
            tools: Number.isSafeInteger(message.toolCount) ? message.toolCount : 0, ms: Math.round(message.elapsedMs), ...(Number.isFinite(message.firstMs) && message.firstMs >= 0 ? {firstMs: Math.round(message.firstMs)} : {})};
          await chrome.storage.session.set({modelTimings: [...modelTimings.slice(-79), entry]});
        } catch { /* Telemetry failure cannot interrupt inference. */ }
      }
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
      const {skills = [], chat} = await chrome.storage.local.get(['skills','chat']);
      const skill = normalizeSkill(message.skill);
      if (message.draftMessageId && message.conversationId !== chat?.sessionId) fail('conversation_changed');
      const draftChat = message.draftMessageId ? saveSkillDraft(chat, message.draftMessageId, skill) : null;
      const next = skills.filter(item => item.id !== skill.id);
      if (next.length >= 20) fail('skill_invalid');
      await chrome.storage.local.set({skills: [...next, skill], activeSkillId: skill.id, ...(draftChat ? {chat:draftChat} : {})});
      return state();
    }
    case 'DELETE_SKILL': {
      if ((await getSession()).chatLease) fail('busy');
      const {skills = [], activeSkillId = '', skillStats: records} = await chrome.storage.local.get(['skills', 'activeSkillId', 'skillStats']);
      await chrome.storage.local.set({skills: skills.filter(skill => skill.id !== message.id), activeSkillId: activeSkillId === message.id ? '' : activeSkillId, skillStats: forgetSkill(records, message.id)});
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
      const page = await connectPage(sender);
      const {chat, browserWorkMode = 'window'} = await chrome.storage.local.get(['chat','browserWorkMode']);
      const {credential, browserWorkspaces = {}, browserContexts = {}} = await getSession();
      const workspace = browserWorkMode === 'window' && await reconnectWorkspace(browserWorkspaces[chat?.sessionId],
        {conversationId:chat?.sessionId, provider:credential?.provider || 'aipro', credentialReceivedAt:credential?.receivedAt}, page.tabId);
      if (workspace) {
        browserWorkspaces[chat.sessionId] = workspace;
        const previous = browserContexts[chat.sessionId];
        if (previous?.provider === workspace.provider && previous.credentialReceivedAt === workspace.credentialReceivedAt) {
          browserContexts[chat.sessionId] = {...previous, context:{...previous.context, tabId:workspace.tabId, workspace}};
        }
        await chrome.storage.session.set({browserWorkspaces, browserContexts});
      } else await disconnectWorkspace();
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
    case 'RESEARCH_OPERATION': {
      if(sender!==RUNNER)fail('invalid_sender');
      if(message.operation==='close_owner') {await researchBrowser.closeOwner(message.requestId);return {ok:true};}
      return researchBrowser.execute(message.requestId,message);
    }
    case 'RUN_TOOL':
    case 'APPLY_FILL': {
      let {chatLease, page, credential} = await getSession();
      if (!chatLease || chatLease.cancelled || chatLease.id !== message.requestId || !ownsChat(chatLease, sender, message.clientId) || chatLease.until <= Date.now() || credential?.receivedAt !== chatLease.credentialReceivedAt) fail('interrupted');
      await refreshBrowserPolicy();
      if(chatLease.automation)assertBrowserPolicy(page?.id&&page.id===chatLease.pageId?page.url:null);
      await touchChatLease(chatLease);
      if (chatLease.awaitingUser) fail('question_changed');
      if (chatLease.planningOnly && (message.type !== 'RUN_TOOL' || !planToolAllowed(message.name))) fail('plan_read_only');
      if (message.type === 'RUN_TOOL' && !chatLease.toolNames?.includes(message.name) && !(['apply_approved_action','apply_approved_mcp'].includes(message.name) && chatLease.approvalQuestionId)) fail('tools_unavailable');
      if (message.type === 'RUN_TOOL' && message.name === 'open_site_procedure') {
        if(!chatLease.automation || !chatLease.toolNames.includes('click_element') || !chatLease.siteProcedureIds?.includes(message.args?.procedure_id))return {error:'procedure_unavailable',actionIssued:false};
        const stored=await chrome.storage.local.get(['browserKnowledge','browserSiteProcedures']);
        const snapshot=await handle({type:'RUN_TOOL',name:'browser_snapshot',args:{},requestId:message.requestId,clientId:message.clientId},sender);
        if(snapshot.error)return {...snapshot,actionIssued:false};
        const tab=Number.isInteger(snapshot.tabId)?await chrome.tabs.get(snapshot.tabId).catch(()=>null):null;
        const prepared=prepareLinkProcedure(stored.browserSiteProcedures,stored.browserKnowledge,message.args,snapshot,{provider:chatLease.provider,currentURL:tab?.url});
        if(!prepared.prepared)return prepared;
        const procedureToken=crypto.randomUUID();
        await patchChatLease(chatLease,{siteLinkPrepared:{token:procedureToken,args:message.args,ref:prepared.ref}});
        return {...prepared,procedureToken};
      }
      if(message.type==='RUN_TOOL' && message.name==='click_element' && message.procedureToken) {
        const binding=chatLease.siteLinkPrepared;
        if(!binding || binding.token!==message.procedureToken || binding.ref!==message.args?.ref)return {error:'procedure_changed',actionIssued:false};
        // Consume before any browser work. A failed/replayed capability cannot click.
        await patchChatLease(chatLease,{siteLinkPrepared:null});
        const stored=await chrome.storage.local.get(['browserKnowledge','browserSiteProcedures']);
        const snapshot=await handle({type:'RUN_TOOL',name:'browser_snapshot',args:{},requestId:message.requestId,clientId:message.clientId},sender);
        if(snapshot.error)return {...snapshot,actionIssued:false};
        const tab=Number.isInteger(snapshot.tabId)?await chrome.tabs.get(snapshot.tabId).catch(()=>null):null;
        const checked=prepareLinkProcedure(stored.browserSiteProcedures,stored.browserKnowledge,binding.args,snapshot,{provider:chatLease.provider,currentURL:tab?.url});
        if(!checked.prepared)return checked;
        message={...message,args:{ref:checked.ref},siteProcedureBound:{before:snapshot,destination:checked.destination}};
      }
      if (message.type === 'RUN_TOOL' && message.name === 'fill_site_procedure') {
        if (!chatLease.automation || !chatLease.toolNames.includes('fill_form') || !chatLease.siteProcedureIds?.includes(message.args?.procedure_id)) return {error:'procedure_unavailable',actionIssued:false};
        const stored=await chrome.storage.local.get(['browserKnowledge','browserSiteProcedures']);
        const snapshot=await handle({type:'RUN_TOOL',name:'browser_snapshot',args:{},requestId:message.requestId,clientId:message.clientId},sender);
        const prepared=prepareFormProcedure(stored.browserSiteProcedures,stored.browserKnowledge,message.args,snapshot,{provider:chatLease.provider});
        if (!prepared.prepared) return prepared;
        const procedureToken=crypto.randomUUID();
        await patchChatLease(chatLease,{siteProcedurePrepared:{token:procedureToken,args:message.args,fields:prepared.fields,observation:snapshot}});
        return {...prepared,procedureToken};
      }
      if (message.type === 'RUN_TOOL' && message.name === 'fill_form' && message.procedureToken) {
        const binding=chatLease.siteProcedurePrepared;
        if (!binding || binding.token!==message.procedureToken || JSON.stringify(binding.fields)!==JSON.stringify(message.args?.fields)) return {error:'procedure_changed',actionIssued:false};
        const stored=await chrome.storage.local.get(['browserKnowledge','browserSiteProcedures']);
        const snapshot=await handle({type:'RUN_TOOL',name:'browser_snapshot',args:{},requestId:message.requestId,clientId:message.clientId},sender);
        const checked=prepareFormProcedure(stored.browserSiteProcedures,stored.browserKnowledge,binding.args,snapshot,{provider:chatLease.provider});
        await patchChatLease(chatLease,{siteProcedurePrepared:null});
        if (!checked.prepared) return checked;
        message={...message,args:{...message.args,fields:checked.fields},siteProcedureBound:{before:snapshot}};
      }
      if (message.type === 'RUN_TOOL' && message.name === 'attach_images') {
        const attached = await alreadyAttachedScreenshots(chatLease, message.args?.refs);
        if (attached) return attached;
      }
      const question = message.type === 'RUN_TOOL' && message.name === 'ask_user' ? questionArgs(message.args) : null;
      if (message.type === 'RUN_TOOL' && chatLease.autoConnect) {
        const {chat} = await chrome.storage.local.get('chat');
        if (chat.task?.requestId !== chatLease.id) {
          chat.task = {requestId: chatLease.id, skillId: chatLease.librarySkillId || 'browser-agent', autoConnect: true, planningOnly:chatLease.planningOnly === true, goal: chat.messages.find(m => m.id === chatLease.id)?.inputGoal || chat.messages.findLast(m => m.role === 'user')?.content || '', status: 'running', replayLogId: crypto.randomUUID(), steps: [], plan: [], summary: null, page: null, updatedAt: Date.now()};
          await saveChat(chat);
        }
      }
      // Preparing an observed download only creates approval. Request the
      // optional permission from that approval's user gesture, then recheck
      // before storing the answer and consuming the execution approval.
      if(message.name==='list_upload_files'){const {chat}=await chrome.storage.local.get('chat');return {files:uploadMetadata(chat)};}
      if(message.name==='download_status'){
        await checkpointTool(chatLease.id,message.name,'start');
        const result=await downloadStatus(chatLease,message.args?.transfer_id);
        await checkpointTool(chatLease.id,message.name,'end',result);
        return result;
      }
      if (question && !question.refs.length) return saveUserQuestion(chatLease, question);
      if (message.type === 'RUN_TOOL' && message.name === 'ask_openwiki') {
        if (!chatLease.wikiSources?.includes(message.args?.wiki)) return {error:'tools_unavailable'};
        if (message.args.wiki === 'internal') {
          const tabId = chatLease.browserContext?.tabId ?? chatLease.pageTargetTabId;
          const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
          const origin = knowledgeOrigin(tab?.url || '');
          if (!origin) return {error:'wiki_context_missing'};
          return siteWikiSnapshot((await chrome.storage.local.get('browserKnowledge')).browserKnowledge,
            {origin, provider:chatLease.provider});
        }
        const {connection} = await projectBinding(await getSession());
        if (!connection || connection.connectionId !== chatLease.projectConnectionId) return {error:'project_changed'};
        let result;
        try {result = await referenceReads.run(chatLease.id, readSignal => connection.kind === 'folder'
          ? wikiFolderSnapshot(connection) : projectWikiSnapshot(connection,{signal:readSignal}));}
        catch (error) {result = await projectReadFailure(connection, error);}
        if ((await getSession()).chatLease?.cancelled) return {error:'cancelled'};
        return result;
      }
      if (message.type === 'RUN_TOOL' && message.name === 'update_plan') {
        const {chat} = await chrome.storage.local.get('chat');
        if (chat.task?.requestId !== chatLease.id) fail('interrupted');
        const updated = updateTaskPlan(chat.task, message.args?.steps, message.args?.explanation); if (!updated) fail('tool_arguments_invalid');
        if (updated !== chat.task) {chat.task = updated; await saveChat(chat);}
        return {ok: true, plan: updated.plan};
      }
      if (message.type === 'RUN_TOOL' && SITE_WIKI_TOOLS.has(message.name)) {
        await checkpointTool(chatLease.id,message.name,'start');
        const tabId=chatLease.browserContext?.tabId ?? chatLease.pageTargetTabId;
        const tab=Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(()=>null) : null;
        const url=knowledgeURL(tab?.url || '');
        const stored=knowledgeState((await chrome.storage.local.get('browserKnowledge')).browserKnowledge);
        const result=executeSiteWiki(stored,{origin:url ? new URL(url).origin : null,provider:chatLease.provider},message.name,message.args);
        await checkpointTool(chatLease.id,message.name,'end',result);
        return (await getSession()).chatLease?.cancelled ? {error:'cancelled'} : result;
      }
      if (message.type === 'RUN_TOOL' && DOCUMENT_TOOL_NAMES.has(message.name)) {
        await checkpointTool(chatLease.id, message.name, 'start');
        let result;
        try {result = await referenceReads.run(chatLease.id, () => executeDocumentTool({bindings: chatLease.documentBindings || [], owner: {provider: chatLease.provider, conversationId: chatLease.conversationId}}, message.name, message.args));}
        catch (error) {result = {error: ['attachment_missing', 'attachment_storage', 'read_timeout', 'cancelled'].includes(error.message) ? error.message : 'response_invalid', instruction: 'Document read failed. Do not invent its contents. Revise the document ID/range or ask for the missing source.'};}
        await checkpointTool(chatLease.id, message.name, 'end', result);
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        return result;
      }
      if (message.type === 'RUN_TOOL' && ['search_voc','read_voc','export_voc'].includes(message.name)) {
        return trackedVocTool(chatLease,message.name,() => message.name === 'search_voc' ? searchVoc(message.args?.query) : message.name === 'read_voc' ? readVoc(message.args?.id,message.args?.start) : exportVoc(message.args?.id,chatLease.workspaceId));
      }
      if (message.type === 'RUN_TOOL' && SKILL_TOOL_NAMES.has(message.name)) {
        const {skills = []} = await chrome.storage.local.get('skills');
        const {project} = await projectBinding(await getSession());
        const library = skillLibrary(skills, {selectedSkillId: chatLease.librarySkillId, project});
        await checkpointTool(chatLease.id, message.name, 'start');
        const result = await executeSkillTool(library, chatLease.skillBindings || [], message.name, message.args, skillStats((await chrome.storage.local.get('skillStats')).skillStats));
        if (message.name === 'read_skill' && result?.ok === true && typeof result.skill_id === 'string') {
          const current = (await getSession()).chatLease;
          if (current?.id === chatLease.id && !current.skillsRead?.includes(result.skill_id)) await chrome.storage.session.set({chatLease: {...current, skillsRead: [...(current.skillsRead || []), result.skill_id].slice(-5)}});
        }
        await checkpointTool(chatLease.id, message.name, 'end', result);
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        return result;
      }
      if (message.type === 'RUN_TOOL' && DELEGATION_TOOL_NAMES.has(message.name)) {
        await checkpointTool(chatLease.id, message.name, 'start');
        let result;
        // The step id names this call, so a retry does not send a second task.
        try {result = await runDelegationTool(message.name, message.args || {}, {tasks: a2aTasks, conversationId: chatLease.conversationId, key: `${chatLease.id}:${typeof message.traceId === 'string' ? message.traceId.slice(0, 100) : crypto.randomUUID()}`});}
        catch (error) {result = taskError(error);}
        await checkpointTool(chatLease.id, message.name, 'end', result);
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        return result;
      }
      if (message.type === 'RUN_TOOL' && (MCP_TOOL_NAMES.has(message.name) || message.name === 'apply_approved_mcp')) {
        const session = await getSession(), servers = session.mcpServers || [];
        if (message.name === 'list_mcp_tools') {
          const record = servers.find(item => item.id === message.args?.server_id && chatLease.mcpBindings?.some(binding => binding.id === item.id && binding.hash === item.hash));
          return record ? {dataKind:'external_tool_catalog',server_id:record.id,tools:record.tools} : {error:'mcp_changed'};
        }
        if (message.name === 'call_mcp_tool') {
          const record = mcpCallBinding(servers,chatLease.mcpBindings,message.args);
          const server = servers.find(item => item.id === record.serverId);
          return saveActionApproval(chatLease,{...record,action:'실행',label:record.tool,pageTitle:server.name,hasEditableDraft:false,preview:[{label:'전달할 내용',value:JSON.stringify(record.args,null,2)}]});
        }
        const actionApprovals = session.actionApprovals || {}, record = actionApprovals[chatLease.conversationId];
        if (record?.kind !== 'mcp' || record.questionId !== chatLease.approvalQuestionId || record.provider !== chatLease.provider || record.credentialReceivedAt !== credential.receivedAt) fail('approval_changed');
        delete actionApprovals[chatLease.conversationId];
        await chrome.storage.session.set({actionApprovals});
        await checkpointTool(chatLease.id,'apply_approved_mcp','start');
        const result = await callMcp(servers.find(item => item.id === record.serverId),record,{requestId:chatLease.id});
        await checkpointTool(chatLease.id,'apply_approved_mcp','end',result);
        const {chat} = await chrome.storage.local.get('chat');
        const approved = chat?.messages.find(item => item.question?.id === record.questionId)?.question;
        if (approved?.answer) {approved.answer.state = result.ok ? 'issued' : result.actionIssued ? 'unknown' : 'changed'; await saveChat(chat);}
        return result;
      }
      if (message.type === 'RUN_TOOL' && PROJECT_TOOL_NAMES.has(message.name)) {
        const {connection: projectConnection} = await projectBinding(await getSession());
        if (!projectConnection || projectConnection.connectionId !== chatLease.projectConnectionId) return {error: 'project_changed'};
        await checkpointTool(chatLease.id, message.name, 'start');
        let result;
        try {result = await referenceReads.run(chatLease.id, readSignal => projectConnection.kind === 'folder'
          ? executeWikiFolderTool(projectConnection, message.name, message.args)
          : readProjectTool(projectConnection, message.name, message.args, {signal: readSignal}));}
        catch (error) {result = await projectReadFailure(projectConnection, error);}
        await checkpointTool(chatLease.id, message.name, 'end', result);
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        return result;
      }
      const tabRecovery = message.type === 'RUN_TOOL' && chatLease.automation && chatLease.browserWorkMode === 'window' &&
        !chatLease.approvalQuestionId && ['list_tabs','switch_tab','navigate_page'].includes(message.name);
      if (chatLease.browserWorkMode === 'window') {
        const connected = await connectWorkPage(sender, chatLease, page, {tabOnly:tabRecovery});
        page = connected.page; chatLease = connected.lease;
      }
      const restoreClosedPage = message.type === 'RUN_TOOL' && chatLease.automation && !page && chatLease.pageId && chatLease.browserContext;
      if (!tabRecovery && ((message.type === 'RUN_TOOL' && chatLease.autoConnect && !chatLease.pageId) || restoreClosedPage)) {
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
      if (!page || !tabRecovery && page.id !== chatLease.pageId) fail('page_changed');
      if (message.type === 'RUN_TOOL' && ['collect_voc','download_voc_attachment'].includes(message.name)) {
        const context = browserAgentContext(chatLease.id) || chatLease.browserContext;
        const tabId = context ? await resolveBrowserTab(context,context.tabId) : page.tabId;
        if (!Number.isInteger(tabId)) fail('page_changed');
        const tab = await chrome.tabs.get(tabId); if (!browserURL(tab.url)) fail('page_changed');
        return trackedVocTool(chatLease,message.name,async () => {
        let result;
        if (message.name === 'collect_voc') {
          const [capture] = await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:collectVocPage});
          const current = await chrome.tabs.get(tabId);
          if (!capture?.result || capture.result.error || new URL(current.url).origin+new URL(current.url).pathname !== capture.result.sourceUrl) fail(capture?.result?.error || 'page_changed');
          result = await storeVoc(capture.result);
        } else {
          const record = await vocRecord(message.args?.id), attachment = record.packet.attachments[message.args?.index];
          if (!attachment) fail('voc_attachment');
          const [capture] = await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:fetchVocAttachment,args:[record.packet.sourceUrl,attachment.url]});
          if (!capture?.result || capture.result.error) fail(capture?.result?.error || 'voc_attachment');
          result = await saveVocFile(record,message.args.index,capture.result);
        }
        return result;
        });
      }
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
        const {chat:approvalChat}=await chrome.storage.local.get('chat');
        if(unresolvedReconciliations(approvalChat?.task).length)return {error:'action_outcome_unknown',actionIssued:false,instruction:'Verify the prior uncertain input before consuming any approval.'};
        const {actionApprovals = {}} = await getSession();
        const record = actionApprovals[chatLease.conversationId];
        if (!record || record.questionId !== chatLease.approvalQuestionId || record.provider !== chatLease.provider || record.credentialReceivedAt !== credential.receivedAt) fail('approval_changed');
        if (record.operation?.method === 'download' && !await chrome.permissions.contains({permissions:['downloads']})) fail('download_permission');
        // Consume durably before the external action. A timeout/reload never replays it.
        delete actionApprovals[chatLease.conversationId];
        await chrome.storage.session.set({actionApprovals});
        await checkpointTool(chatLease.id, message.name, 'start');
        const {result, tabId} = await runApprovedAction(chatLease.id, {...page, browserContext: chatLease.browserContext}, record, {onNativeDialog:(details,signal)=>nativeDialogRequests.ask(chatLease,details,signal),
          onUpload:async metadata=>{const {chat}=await chrome.storage.local.get('chat');return playwrightFiles(await uploadFiles(chat,metadata.map(f=>f.id),metadata));},
          onDownload:url=>startDownload(chatLease,url)});
        await rememberBrowserContext(chatLease);
        await checkpointTool(chatLease.id, message.name, 'end', result, result.observation || result);
        await recordReplay(approvalChat?.task?.requestId === chatLease.id ? approvalChat.task.replayLogId : null, message.name, {}, null, result, tabId);
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
        let executionName = message.name, executionArgs = message.args;
        if (message.name === 'run_skill_script') {
          const {skills = []} = await chrome.storage.local.get('skills');
          const {project} = await projectBinding(await getSession());
          const library = skillLibrary(skills, {selectedSkillId: chatLease.librarySkillId, project});
          executionArgs = {code: await prepareSkillScript(library, chatLease.skillBindings, message.args)}; executionName = 'run_playwright';
        }
        const {chat: beforeTool} = await chrome.storage.local.get('chat');
        const unresolved=unresolvedReconciliations(beforeTool?.task);
        if(unresolved.length && (MUTATING_TOOLS.has(message.name)||message.name==='request_approval'))return {error:'action_outcome_unknown',actionIssued:false,instruction:unresolved.some(proof=>proof.version===2)?'The prior action lost its receipt and its exact target could not be bound to a document. Stop this run and inspect the page with the user before starting a new task. Do not replay the action or use another tab as proof.':'A prior input or toggle lost its receipt. Re-observe and verify every original target/value before another action. Do not replay it.'};
        const availableFiles=message.name==='prepare_file_upload' ? (await uploadFiles(beforeTool,message.args?.file_ids)).map(f=>f.meta) : undefined;
        const observedBefore=browserAgentObservation(chatLease.id);
        const reconciliation=await reconciliationProof(executionName,executionArgs||{},observedBefore);
        await checkpointTool(chatLease.id, message.name, 'start',MUTATING_TOOLS.has(message.name)?{reconciliation:reconciliation||{version:2,unverifiable:true}}:undefined);
        // Whether the latest user input answered a question: replacing text a field
        // already holds needs that answer.
        const answered = !!beforeTool?.messages?.findLast?.(item => item.role === 'user')?.clarification;
        const {result, tabId} = await runBrowserAgent(chatLease.id, {...page, browserContext: chatLease.browserContext}, executionName, executionArgs, {vision: chatLease.vision, answered, hint: typeof beforeTool?.task?.goal === 'string' ? beforeTool.task.goal : undefined, uploadFiles:availableFiles, informationDestination:message.siteProcedureBound?.destination,
          onNativeDialog: (details,signal) => nativeDialogRequests.ask(chatLease,details,signal),
          onApproval: record => saveActionApproval(chatLease, record, chatLease.replay && Number.isInteger(message.replayIndex) ? {...chatLease.replay, resumeAt: message.replayIndex + 1} : null),
          onCapture: (screenshot, image) => attachCapture(chatLease, screenshot, image, saveCapture, message.traceId),
          onImage: (image, payload) => attachCapture(chatLease, image, payload, savePageImage)});
        await rememberBrowserContext(chatLease);
        if(message.name==='verify_page'&&result.ok===true&&result.verified===true&&!result.error&&result.checks?.length===executionArgs.checks.length&&result.checks.every((check,index)=>check.passed===true&&check.kind===executionArgs.checks[index].kind)&&await reconcilesProofs(unresolved,executionArgs.checks,observedBefore)&&sameVerifiedDocuments(observedBefore,result.observation,executionArgs.checks))result.reconciledAction=true;
        if(unresolved.length&&message.name==='verify_page'&&!result.reconciledAction)Object.assign(result,{unresolvedAction:true,recoveryInstruction:unresolved.some(proof=>proof.version===2)?'The original action target was not durably bound to a browser document. This check cannot clear the uncertain action; stop this run and ask the user to inspect the page.':'This check did not establish the original input values or toggle target. Keep the uncertain action blocked and verify every original target.'});
        await checkpointTool(chatLease.id, message.name, 'end', result, result.observation || result);
        await recordReplay(beforeTool?.task?.requestId === chatLease.id ? beforeTool.task.replayLogId : null, message.name, executionArgs, observedBefore, result, tabId);
        if(message.siteProcedureBound)result.siteProcedurePrimitive={args:executionArgs,before:message.siteProcedureBound.before};
        if ((await getSession()).chatLease?.cancelled) return {error: 'cancelled'};
        // Follow only the tab selected by the authorized action. Old manual fill
        // plans stay document-bound and cannot cross this connection update.
        // Inventory does not establish a document binding. Switching must
        // reconnect the actual selected document before later DOM operations.
        if (!tabRecovery || ['switch_tab','navigate_page'].includes(message.name)) {
          const storedPage = tabRecovery ? (await getSession()).page : page;
          await refreshWorkConnection(storedPage, tabId);
        }
        return browserKnowledgeResult(chatLease, message.name, executionArgs, result, tabId);
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
    case 'GET_REPLAY': {
      const {chat} = await readConversationState();
      const answer = message.conversationId === chat.sessionId ? chat.messages.find(item => item.id === message.messageId && item.role === 'assistant' && item.replay?.version === 1) : null;
      if (!answer) fail('replay_unavailable');
      // The values typed last time, kept in memory only; after a browser restart they are asked again.
      const saved = (await getSession()).replayValues?.[answer.replay.id]?.values || {};
      return {inputs: answer.replay.inputs, values: Object.fromEntries(answer.replay.inputs.filter(input => Object.hasOwn(saved, input.slot)).map(input => [input.slot, saved[input.slot]])),
        steps: answer.replay.steps.length, startPage: answer.replay.startPage || '', scripts: answer.replay.steps.filter(step => ['run_playwright', 'run_skill_script'].includes(step.tool)).length,
        memoryMissing: (answer.replay.memory || []).some(slot => !Object.hasOwn(saved, slot))};
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
    case 'AGENT_INPUT': {
      const {chatLease, credential} = await getSession();
      const {chat} = await chrome.storage.local.get('chat');
      if (!chatLease || chatLease.cancelled || chatLease.compacting || chatLease.awaitingUser || !runner.acceptsInput(chatLease.id) || chatLease.id !== message.requestId || chatLease.conversationId !== message.conversationId || chat.sessionId !== message.conversationId) fail('agent_input_closed');
      if (!credential || credential.rejected || credential.receivedAt !== chatLease.credentialReceivedAt || (credential.provider || 'aipro') !== chatLease.provider) fail('no_credential');
      // Submission IDs are idempotent even after the executor has consumed one.
      if (chat.messages.some(item => item.inputId === message.id)) return state();
      chat.inbox = enqueueInput(chat.inbox, message, {conversationId:chat.sessionId, provider:chatLease.provider, credentialReceivedAt:chatLease.credentialReceivedAt, runId:chatLease.id});
      if (chat.draft?.trim() === message.text.trim()) chat.draft = '';
      await saveChat(chat);
      if (message.mode === 'steer') runner.notifyInput(chatLease.id);
      return state();
    }
    case 'STEER_AGENT_INPUT': {
      const {chatLease, credential} = await getSession();
      const {chat} = await chrome.storage.local.get('chat');
      if (!chatLease || chatLease.cancelled || chatLease.awaitingUser || !runner.acceptsInput(chatLease.id) || chatLease.id !== message.requestId || chat.sessionId !== message.conversationId || chatLease.conversationId !== message.conversationId) fail('agent_input_closed');
      if (!credential || credential.rejected || credential.receivedAt !== chatLease.credentialReceivedAt || (credential.provider || 'aipro') !== chatLease.provider) fail('no_credential');
      const item = chat.inbox?.find(item => item.id === message.id);
      if (!item || !nextInput([item], {...chatLease,runId:chatLease.id})) fail('agent_input_closed');
      item.mode = 'steer';
      await saveChat(chat); runner.notifyInput(chatLease.id);
      return state();
    }
    case 'REORDER_AGENT_INPUT': {
      const {credential} = await getSession();
      const {chat} = await chrome.storage.local.get('chat');
      if (chat.sessionId !== message.conversationId) fail('conversation_changed');
      if (!credential || credential.rejected) fail('no_credential');
      chat.inbox = reorderInput(chat.inbox, message, {conversationId:chat.sessionId, provider:credential.provider || 'aipro', credentialReceivedAt:credential.receivedAt});
      await saveChat(chat);
      return state();
    }
    case 'REMOVE_AGENT_INPUT': {
      const {chat} = await chrome.storage.local.get('chat');
      if (chat.sessionId !== message.conversationId) fail('conversation_changed');
      const item = chat.inbox?.find(item => item.id === message.id);
      if (!item) fail('agent_input_closed');
      chat.inbox = chat.inbox.filter(item => item.id !== message.id);
      if (message.edit) {
        if (chat.draft?.trim()) fail('agent_input_draft');
        chat.draft = item.text;
      }
      await saveChat(chat);
      return {text:message.edit ? item.text : ''};
    }
    case 'TAKE_AGENT_INPUT': {
      const {chatLease, credential} = await getSession();
      if (chatLease?.id !== message.requestId || !ownsChat(chatLease, sender) || chatLease.cancelled || chatLease.awaitingUser) return null;
      if (!credential || credential.rejected || credential.receivedAt !== chatLease.credentialReceivedAt || (credential.provider || 'aipro') !== chatLease.provider) fail('no_credential');
      const {chat} = await chrome.storage.local.get('chat');
      if (chat.sessionId !== chatLease.conversationId) fail('conversation_changed');
      const item = nextInput(chat.inbox, {...chatLease,runId:chatLease.id}, 'steer');
      if (!item) return null;
      // Persist the instruction before giving it to Pi. Interrupted runs resume
      // from this history, never by replaying an in-memory queue.
      await revokeActionApproval(chat.sessionId);
      chat.inbox = chat.inbox.filter(value => value.id !== item.id);
      const position = chat.messages.findIndex(value => value.id === message.requestId);
      const pendingReply = chat.messages[position];
      const previousGoal = chat.task?.requestId === message.requestId ? chat.task.goal : pendingReply?.inputGoal || chat.messages.findLast(value => value.role === 'user')?.content || '';
      const inputGoal = `${previousGoal}\n사용자 변경 요청: ${item.text}`;
      if (pendingReply) pendingReply.inputGoal = inputGoal;
      chat.messages.splice(position < 0 ? chat.messages.length : position, 0, {id:crypto.randomUUID(), inputId:item.id, role:'user', content:item.text});
      if (chat.task?.requestId === message.requestId) {
        chat.task.goal = inputGoal;
        if (chat.task.goalReview) chat.task.goalReview = {status:'running',checks:0};
      }
      await saveChat(chat);
      return item;
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
      const {browserWorkMode:savedWorkMode = 'window', browserKnowledge} = await chrome.storage.local.get(['browserWorkMode', 'browserKnowledge']);
      const browserWorkMode=sender===RUNNER&&Number.isInteger(message.scheduledTabId)?'current':savedWorkMode;
      if (chatLease || attempt) fail('busy');
      if (!credential || credential.rejected) fail('no_credential');
      if (credential.expiresAt && credential.expiresAt <= Date.now() && !(credential.provider === 'chatgpt' && credential.refreshToken)) fail('expired_token');
      if (catalog?.credentialReceivedAt === credential.receivedAt && catalog.models?.length === 0 && !catalog.error) fail('models_empty');
      const {settings = DEFAULT_SETTINGS, chat = {messages: [], draft: ''}, skills = [], activeSkillId = ''} = await chrome.storage.local.get(['settings', 'chat', 'skills', 'activeSkillId']);
      if (message.conversationId && message.conversationId !== chat.sessionId) fail('conversation_changed');
      if ((credential.provider || 'aipro') !== chat.provider) fail('no_credential');
      const model = catalog?.credentialReceivedAt === credential.receivedAt && catalog.models?.find(model => model.name === settings.modelId);
      const visionModel = visionModelFor(chat.provider, model || {name: settings.modelId}, catalog?.credentialReceivedAt === credential.receivedAt ? catalog.models : []);
      const queuedCandidate = chat.inbox?.find(item => item.id === message.queuedInputId);
      const queuedInput = message.queuedInputId ? nextInput(queuedCandidate ? [queuedCandidate] : [], {conversationId:chat.sessionId, provider:credential.provider || 'aipro', credentialReceivedAt:credential.receivedAt}) : null;
      if (message.queuedInputId && queuedInput?.id !== message.queuedInputId) fail('agent_input_closed');
      if (queuedInput && chat.messages.at(-1)?.question && !chat.messages.at(-1).question.answer) fail('agent_input_closed');
      // A replay repeats the recorded steps of a verified answer without the model.
      const replaySource = message.replay ? chat.messages.find(item => item.id === message.replay?.messageId && item.role === 'assistant' && item.state === 'done' && item.replay?.version === 1) : null;
      if (message.replay && (!replaySource || message.retry || message.compact || message.resume || message.choice || message.draftEdit || message.createSkill || message.createWiki || queuedInput ||
        chat.messages.at(-1)?.question && !chat.messages.at(-1).question.answer)) fail('replay_unavailable');
      const creationQuestion = chat.messages.at(-1)?.creatingSkill && chat.messages.at(-1)?.question && !chat.messages.at(-1).question.answer && chat.messages.at(-1).state === 'done' ? chat.messages.at(-1) : null;
      let creationSource = message.createWiki ? wikiSource(chat,message.createWiki) : message.createSkill === true ? skillCreationSource(chat) : creationQuestion?.creationSource || null;
      if (creationSource && (message.retry || message.compact || message.resume || message.choice && !creationQuestion || message.draftEdit || queuedInput || (message.createSkill || message.createWiki) && chat.messages.at(-1)?.question && !chat.messages.at(-1).question.answer)) fail('skill_source_missing');
      const wikiInit = !creationSource && !message.choice && !message.retry && !message.resume && !message.compact && /^\/wiki(?:\s|$)/.test(String(queuedInput?.text || message.text || '').trim());
      const useDraftFiles = !(sender===RUNNER&&Number.isInteger(message.scheduledTabId)) && !creationSource && !queuedInput && !message.retry && !message.compact && !message.resume && !message.choice && !message.draftEdit;
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
      // Reject before marking the question answered or acquiring an execution
      // lease. Permission denial must leave the same approval retryable.
      if (message.choice?.optionId === 'approve' && approvalContext?.operation?.method === 'download' &&
          !await chrome.permissions.contains({permissions:['downloads']})) fail('download_permission');
      let userInput = String(queuedInput?.text || message.text || '').trim().slice(0, 16000) || (useDraftFiles && files.length ? '첨부한 파일을 확인해주세요.' : '');
      // The request of the recorded run, so "작업 이어가기" after a stopped replay hands the model that task.
      if (replaySource) userInput = String(replaySource.replay.goal || '').trim() || '기록한 절차를 다시 실행합니다.';
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
      if (wikiInit && !knowledgeState(browserKnowledge).enabled) fail('wiki_disabled');
      if (creationSource?.kind==='wiki') {
        const knowledge=knowledgeState(browserKnowledge);
        if (!knowledge.enabled) fail('wiki_disabled');
        if (knowledge.revision!==creationSource.revision) fail('wiki_source_missing');
        const previous=knowledge.entries.find(item=>item.url===creationSource.candidate.url && item.provider===chat.provider);
        if (creationSource.targetVersion!==undefined && creationSource.targetVersion!==(previous?.documentVersion || 0)) fail('wiki_changed');
      }
      if (creationSource?.kind==='wiki' && creationSource.targetVersion===undefined) {
        const previous=knowledgeState(browserKnowledge).entries.find(item=>item.url===creationSource.candidate.url && item.provider===chat.provider);
        creationSource={...creationSource,targetVersion:previous?.documentVersion || 0,...(previous ? {previousDocument:{markdown:previous.markdown,verifiedAt:previous.verifiedAt,invalidated:previous.invalidated,sourceHash:previous.sourceHash}} : {})};
      }
      if (creationSource) creationSource = {...creationSource, conversationContext: creationSessionContext(chat)};
      if (creationSource && !creationSource.browserDocumentation) {
        const sourceOrigin = (() => {try{return new URL(creationSource.candidate?.url || creationSource.site || chat.task?.page?.url).origin;}catch{return null;}})();
        const documents = searchKnowledge(browserKnowledge,{origin:sourceOrigin,provider:chat.provider,query:creationSource.goal || creationSource.task?.goal || creationSource.candidate?.title});
        if (documents.length) creationSource = {...creationSource,browserDocumentation:knowledgePacket(documents)};
      }
      if (creationQuestion && creationSource) creationSource = continueSkillCreation(creationSource, creationQuestion.question.text, chosen || userInput);
      let approvalRecord = null;
      if (answeringApproval && message.choice) {
        questionAnswer(pendingQuestion, message.choice);
        if (message.choice.optionId !== 'approve') fail('question_changed');
        approvalRecord = (await getSession()).actionApprovals?.[chat.sessionId];
        if (!approvalRecord || approvalRecord.questionId !== pendingQuestion.id || approvalRecord.provider !== (credential.provider || 'aipro') || approvalRecord.credentialReceivedAt !== credential.receivedAt || approvalRecord.expiresAt <= Date.now()) fail('approval_changed');
      }
      let resumeTask = !creationSource && ((message.retry || message.resume) && chat.task?.status === 'paused' || answeringQuestion && chat.task?.status === 'awaiting_user') ? chat.task : null;
      if (resumeTask) {
        const checkpoint = analysisCheckpoint(resumeTask.analysisCheckpoint, chat.messages.find(item => item.id === resumeTask.requestId && item.role === 'assistant')?.trace, resumeTask.requestId);
        if (checkpoint) resumeTask = {...resumeTask, analysisCheckpoint:checkpoint};
      }
      if (answeringApproval && !message.choice && userInput) {
        await revokeActionApproval(chat.sessionId);
        if (resumeTask) resumeTask = {...resumeTask, goal: `${resumeTask.goal}\n사용자 수정 요청: ${message.draftEdit ? '사용자가 직접 수정한 초안을 그대로 반영하고 다시 승인을 받기' : userInput}`};
      }
      const planCommand = !replaySource && !creationSource && !answeringQuestion && !message.compact && !message.retry && !message.resume && isPlanCommand(userInput);
      const planningOnly = !creationSource && !message.compact && (planCommand || resumeTask?.planningOnly === true || message.retry && chat.messages.at(-1)?.planningOnly === true);
      const commandedSkill = !replaySource && !creationSource && !answeringQuestion && !message.compact && !message.retry && !message.resume ? wikiInit || planCommand ? null : resolveSkillCommand(allSkills(skills), userInput) : null;
      const selectedSkill = replaySource || wikiInit || planningOnly ? null : commandedSkill?.skill || allSkills(skills).find(skill => skill.id === taskSkillId(resumeTask, activeSkillId));
      const autoConnect = !creationSource && !message.compact && automaticSkillTools(selectedSkill);
      const skill = message.compact || creationSource ? null : selectedSkill || allSkills().find(skill => skill.id === 'browser-agent');
      // Bind only the tab identity at send time. Do not inspect or transmit its
      // content until the agent requests a browser tool for this task.
      const savedBrowser = resumeTask || browserWorkMode === 'window' ? (await getSession()).browserContexts?.[chat.sessionId] : null;
      const savedWorkspace = browserWorkspaces[chat.sessionId];
      const ownWorkspace = browserWorkMode === 'window' && workspaceMatches(savedWorkspace,{conversationId:chat.sessionId,provider:credential.provider || 'aipro',credentialReceivedAt:credential.receivedAt}) ? savedWorkspace : null;
      const previousContext = savedBrowser?.provider === (credential.provider || 'aipro') && savedBrowser?.credentialReceivedAt === credential.receivedAt ? savedBrowser.context : null;
      const browserContext = sender===RUNNER&&Number.isInteger(message.scheduledTabId)?null:approvalContext?.browserContext || (ownWorkspace ? {...previousContext,tabId:ownWorkspace.tabId,workspace:ownWorkspace} : browserWorkMode === 'current' ? previousContext : null);
      const continuationTabId = approvalContext?.tabId ?? browserContext?.tabId;
      // Session tab bindings can disappear after a full browser restart. The
      // currently active personal tab is not a continuation of the saved task.
      assertResumeTarget(resumeTask, continuationTabId, connectedPage?.tabId);
      // An approval binds to its exact document. Revisions/resumes may return to
      // a known parent after a child closes, but never to an unrelated active tab.
      const pageTargetTabId = (sender===RUNNER&&Number.isInteger(message.scheduledTabId)?message.scheduledTabId:null) ?? approvalRecord?.tabId ?? (Number.isInteger(continuationTabId) ? await resolveBrowserTab(browserContext, continuationTabId) ?? continuationTabId : connectedPage?.tabId ?? (sender === RUNNER && Number.isInteger(message.queueSourceTabId) ? message.queueSourceTabId : (await pageTarget(sender, true))?.id) ?? null);
      const needsPage = !creationSource && !message.compact && !autoConnect && (skill?.needsPage || skill?.allowFill || connectedPage);
      const page = needsPage && browserWorkMode === 'current' ? await connectPage(sender, pageTargetTabId) : null;
      const binding = await projectBinding(await getSession());
      const projectConnection = binding.connection;
      const project = message.compact || creationSource ? null : binding.project;
      const tools = browserTools(page || (needsPage && browserWorkMode === 'window' ? {tabId:pageTargetTabId} : null), skill, settings.modelId, {autoConnect, vision: !!visionModel, visionModel, project});
      const library = message.compact ? [] : skillLibrary(skills, {selectedSkillId: selectedSkill?.id, project});
      tools.push(...skillLibraryTools(library, {scripts: skill?.allowAutomation === true, find: !selectedSkill?.id?.startsWith('custom-')}));
      const wikiSources = !message.compact && !creationSource ? {
        internal: skill?.allowAutomation === true && hasSiteWiki(browserKnowledge, credential.provider || 'aipro'),
        external: project?.status === 'connected' && project.capabilities?.includes('wiki'),
      } : {};
      // Direct Wiki search/read remain host primitives; the leader delegates to OpenWiki.
      if (wikiSources.internal || wikiSources.external) {
        tools.splice(0, tools.length, ...tools.filter(tool => !['wiki_query','wiki_search','wiki_read','search_site_wiki','read_site_wiki'].includes(tool.function.name)));
        tools.push(...openWikiTools({...wikiSources, sites: wikiSources.internal ? siteWikiOrigins(browserKnowledge, credential.provider || 'aipro') : []}));
      }
      const knowledgeTab = !creationSource && !message.compact && !planningOnly && skill?.allowAutomation && Number.isInteger(pageTargetTabId)
        ? await chrome.tabs.get(pageTargetTabId).catch(()=>null) : null;
      const siteKnowledge = knowledgeTab ? planningKnowledge(browserKnowledge,
        (await chrome.storage.local.get('browserSiteProcedures')).browserSiteProcedures,
        {url:knowledgeTab.url,provider:credential.provider || 'aipro',query:resumeTask?.goal || userInput}) : null;
      if (siteKnowledge?.procedures?.some(card=>card.kind!=='link_read') && tools.some(tool=>tool.function.name==='fill_form')) tools.push(procedureTool());
      if (siteKnowledge?.procedures?.some(card=>card.kind==='link_read') && tools.some(tool=>tool.function.name==='click_element')) tools.push(linkProcedureTool());
      const skillBindings = await bindSkillLibrary(library);
      const mcpServers = message.compact || creationSource ? [] : (await getSession()).mcpServers || [];
      tools.push(...mcpTools(mcpServers));
      // The conversation running a task another Nubi sent reports facts and does
      // not delegate back. Other conversations may ask the paired desktop.
      const delegatedRun = message.compact || creationSource ? null : await a2aTasks.run();
      if (delegatedRun?.conversationId === chat.sessionId && delegatedRun.provider === chat.provider) {
        tools.push(REPORT_FACTS_TOOL);
        if (delegatedRun.stopped) await a2aTasks.updateRun({stopped: false});
      } else if (!message.compact && !creationSource && (await getSession()).a2a?.connection) tools.push(...DELEGATION_TOOLS);
      const mcpBindings = mcpServers.map(({id,hash}) => ({id,hash}));
      if (!message.compact && skill?.allowAutomation) tools.push(...vocTools());
      if (wikiInit) tools.splice(0,tools.length,...tools.filter(tool=>['read_page','browser_snapshot','inspect_dom','verify_page','ask_user','find_skills','read_skill','progress_note'].includes(tool.function.name)));

      let replay = null;
      if (replaySource || approvalRecord?.replay) {
        const source = replaySource || chat.messages.find(item => item.id === approvalRecord.replay.sourceId && item.replay?.id === approvalRecord.replay.id);
        if (!source?.replay) fail('replay_unavailable');
        const {replayValues = {}} = await getSession();
        const saved = replayValues[source.replay.id]?.values || {}, given = replaySource && message.replay.values && typeof message.replay.values === 'object' ? message.replay.values : {};
        const values = {...saved};
        // Scripts and attachments are kept in memory only; after a browser restart they are gone.
        if ((source.replay.memory || []).some(slot => !Object.hasOwn(saved, slot))) fail('replay_memory_missing');
        for (const input of source.replay.inputs) {
          const value = Object.hasOwn(given, input.slot) ? given[input.slot] : saved[input.slot];
          const usable = typeof value === 'string' ? value.length <= 16000 : input.kind === 'choice' && Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === 'string' && item.length <= 400);
          if (!usable) fail('replay_values_missing');
          values[input.slot] = value;
        }
        delete replayValues[source.replay.id]; replayValues[source.replay.id] = {values, at: Date.now()};
        await chrome.storage.session.set({replayValues: Object.fromEntries(Object.entries(replayValues).slice(-REPLAY_VALUES))});
        replay = {id: source.replay.id, sourceId: source.id, steps: source.replay.steps, values, linked: source.replay.linked || {}, startPage: source.replay.startPage || '',
          startURL: typeof saved.__start === 'string' ? saved.__start : '', ...(approvalRecord?.replay ? {startAt: approvalRecord.replay.resumeAt, approved: true} : {})};
      }
      const workspaceId = (await workspaceRecord().catch(() => null))?.id || null;
      if (!settings.modelId) fail('model_required');
      const requestId = crypto.randomUUID();
      const continuedRunId = queuedInput?.runId || resumeTask?.requestId;
      if (continuedRunId) chat.inbox = (chat.inbox || []).map(item => item.runId === continuedRunId ? {...item,runId:requestId} : item);
      if (message.retry && chat.messages.at(-1)?.state !== 'done' && chat.messages.at(-1)?.role === 'assistant') {
        await deleteCaptures(chat.messages.at(-1).captures?.map(capture => capture.id));
        chat.messages.pop();
      }
      else {
        const content = creationSource ? chosen || userInput || (creationSource.kind === 'wiki' ? '확인한 화면으로 사이트 위키 초안을 만들어줘.' : '이 작업으로 재사용할 스킬 초안을 만들어줘.') : chosen || (message.compact ? '/compact' : message.resume && resumeTask ? '중단한 작업을 이어서 진행해 주세요.' : planCommand ? planningRequest(userInput) : wikiInit ? '현재 페이지를 read_page로 읽고 메뉴와 입력 항목을 파악한 뒤 verify_page로 제목 또는 화면 문구를 확인해 주세요. 사이트 위키에 남길 관찰 자료를 수집하는 작업입니다. 입력이나 클릭, 등록은 하지 마세요. 관찰한 정보와 모르는 업무 규칙을 구분해서 짧게 정리하세요. 사용자 요청: ' + userInput : commandedSkill?.input || userInput);
        if (!content) fail('invalid_model');
        if (!message.compact && !message.resume && pendingQuestion && !pendingQuestion.answer) {
          pendingQuestion.answer = {text: message.draftEdit ? '초안을 직접 수정했습니다.' : content, ...(message.choice?.optionId ? {optionId: message.choice.optionId} : {})};
          delete pendingQuestion.draft;
        }
        chat.messages.push({id: crypto.randomUUID(), ...(queuedInput ? {inputId:queuedInput.id} : {}), role: 'user', content, ...(answeringQuestion && !answeringApproval ? {clarification: {questionId: pendingQuestion.id, question: pendingQuestion.text, answer: content}} : {}), ...(useDraftFiles && files.length ? {attachments: files} : {}), ...(wikiInit || planCommand ? {displayContent:userInput} : {}), ...(commandedSkill ? {skillCommandId:commandedSkill.skill.id, displayContent:userInput} : {}), ...(message.draftEdit ? {displayContent: '초안을 수정했습니다.'} : {}), ...(replaySource ? {displayContent: '기록한 절차를 모델 없이 다시 실행', replayOf: replaySource.id} : {}), ...(message.compact ? {contextOnly: true} : {})});
        if (useDraftFiles) {chat.draft = ''; chat.draftAttachments = [];}
        if (queuedInput) chat.inbox = chat.inbox.filter(item => item.id !== queuedInput.id);
      }
      const messages = chat.messages.filter(m => !m.contextOnly && (m.role === 'user' || m.state === 'done')).map(m => ({id: m.id, role: m.role, content: questionContext(m), ...(m.attachments?.length ? {attachments: m.attachments} : {})}));
      const documents = creationSource ? [] : documentBindings(messages);
      if (documents.length && !message.compact) tools.push(...documentToolDefinitions());
      if (planningOnly) tools.splice(0,tools.length,...planTools(tools));
      if (!creationSource && !message.compact) chat.task = skill?.allowAutomation && (!autoConnect || resumeTask) ? {requestId, skillId: skill.id, autoConnect, planningOnly, goal: resumeTask?.goal || messages.findLast(m => m.role === 'user')?.content || '', status: 'running', replayLogId: resumeTask?.replayLogId || crypto.randomUUID(), steps: resumeTask?.steps || [], ...(resumeTask?.pendingReconciliation?{pendingReconciliation:resumeTask.pendingReconciliation}:{}), plan: resumeTask?.plan || [], ...(resumeTask?.planUpdates ? {planUpdates:resumeTask.planUpdates,planRevision:resumeTask.planRevision} : {}), ...(resumeTask?.analysisCheckpoint ? {analysisCheckpoint:resumeTask.analysisCheckpoint} : {}), ...(resumeTask?.analysisHandoffs ? {analysisHandoffs:resumeTask.analysisHandoffs} : {}), ...(resumeTask?.researchHandoffs?{researchHandoffs:resumeTask.researchHandoffs}:{}), summary: resumeTask?.summary || null, ...(resumeTask?.used ? {used: resumeTask.used} : {}), ...(resumedVerification(resumeTask) ? {verification: approvalRecord?.operation?.method === 'download' && resumeTask?.verification?.status === 'passed' && !unresolvedReconciliations(resumeTask).length ? resumeTask.verification : {status: 'pending'}} : {}), ...(resumeTask?.goalReview ? {goalReview: {status: 'running', checks: 0}} : {}), page: page ? {title: page.title, url: page.url} : resumeTask?.page || null, updatedAt: Date.now()} : null;
      chat.messages.push({id: requestId, requestId, role: 'assistant', content: '', state: 'pending', ...(planningOnly ? {planningOnly:true} : {}), ...(creationSource ? {creatingSkill:true, creationSource} : {}), modelId: settings.modelId, modelName: model?.displayName || settings.modelId, skillId: skill?.id || '', pageId: page?.id || '', ...(message.compact ? {contextOnly: true} : {})});
      if (creationSource) tools.splice(0, tools.length, clarificationTool(false), ...skillLibraryTools(library).filter(tool => ['find_skills', 'read_skill'].includes(tool.function.name)));
      await saveChat(chat);
      if((await getSession()).a2a?.binding && !message.compact && !creationSource && !planningOnly && !replay)await (await browserA2A()).bindRun({text:userInput,runId:requestId,conversationId:chat.sessionId,provider:chat.provider,continuation:answeringQuestion || !!message.resume});
      await chrome.storage.session.set({chatLease: {id: requestId, ...(answeringQuestion && !answeringApproval ? {answeredQuestion: pendingQuestion} : {}), ...(owner === RUNNER ? {owner: 'worker'} : {}), conversationId: chat.sessionId, siteProcedureIds:siteKnowledge?.procedures?.map(item=>item.id) || [], wikiInit, planningOnly, wikiSources: Object.keys(wikiSources).filter(key => wikiSources[key]), knowledgeRevision: knowledgeState(browserKnowledge).revision, ...(resumeTask?.used ? {knowledgeRoute: extendRoute(resumeTask.used.route), skillsRead: (Array.isArray(resumeTask.used.skills) ? resumeTask.used.skills : []).filter(id => typeof id === 'string').slice(-5)} : {}), ...(approvalRecord ? {approvalQuestionId: approvalRecord.questionId} : {}), ...(replay ? {replay: {id: replay.id, sourceId: replay.sourceId}} : {}), browserContext, browserWorkMode, documentBindings: documents, creationSource, compacting: !!message.compact, workspaceId, mcpBindings, skillBindings, librarySkillId: selectedSkill?.id || '', modelIds: [settings.modelId, visionModel?.name].filter(Boolean), projectConnectionId: project?.status === 'connected' ? projectConnection?.connectionId : null, provider: credential.provider || 'aipro', automation: skill?.allowAutomation === true, autoConnect, pageTargetTabId, vision: !!visionModel, documentId: sender.documentId, clientId: typeof message.clientId === 'string' ? message.clientId.slice(0, 100) : null, tabId: sender.tab?.id, lastSeenAt: Date.now(), credentialReceivedAt: credential.receivedAt, pageId: page?.id, toolNames: tools.map(tool => tool.function.name), until: Date.now() + CHAT_TIMEOUT_MS + 60000}});
      return {requestId, conversationId: chat.sessionId, ...(siteKnowledge ? {siteKnowledge} : {}), ...(replay ? {replay} : {}), creationSource, planningOnly, documents, provider: credential.provider || 'aipro', modelId: settings.modelId, model: model || {name: settings.modelId}, visionModel, memory: chat.memory || null, compact: !!message.compact, approvedAction: !!approvalRecord, approvedToolName: approvalRecord?.kind === 'mcp' ? 'apply_approved_mcp' : 'apply_approved_action', resumeTask, mode: credential.mode, credentialReceivedAt: credential.receivedAt, messages, skill, skillCatalog: skillCatalog(library), autoConnect, browserWorkMode, project: projectContext(project), page: page ? {title: page.title, url: page.url} : null, tools};
    }
    case 'FINISH_CHAT': {
      const {chatLease, credential} = await getSession();
      if (chatLease?.id !== message.requestId || !ownsChat(chatLease, sender, message.clientId)) return null;
      if (credential?.receivedAt !== chatLease.credentialReceivedAt || (credential?.provider || 'aipro') !== chatLease.provider) message = {...message, content: '', error: 'interrupted'};
      else if (chatLease.cancelled) message = {...message, error: 'cancelled'};
      // Browser ownership ends even if saving the completed reply fails.
      cancelMcp(chatLease.id);
      await stopBrowserAgent(chatLease.id);
      const {chat} = await chrome.storage.local.get('chat');
      if (chatLease.conversationId && chatLease.conversationId !== chat.sessionId) return null;
      const reply = chat.messages.find(item => item.id === message.requestId && item.role === 'assistant');
      let journal = reply?.traceJournal;
      if (sender === RUNNER && reply && chat.provider === chatLease.provider && Number.isSafeInteger(message.traceSequence) && message.traceSequence > 0) {
        try {
          const finalJournal = await traceJournal.finish({provider: chatLease.provider, conversationId: chatLease.conversationId, requestId: chatLease.id}, message.traceSequence);
          if (finalJournal) journal = {...journal, available: true, incomplete: journal?.incomplete === true || finalJournal.incomplete};
        } catch {journal = {...journal, incomplete: true};}
      }
      let skillDraft, wikiDraft;
      if (chatLease.creationSource && !chatLease.awaitingUser && !message.error) {
        try {
          if (chatLease.creationSource.kind==='wiki') {wikiDraft=parseWikiDraft(message.content,{redact:true}); const procedure=createSiteProcedure(chat.messages.find(item=>item.id===chatLease.creationSource.sourceId)?.replay, {...chatLease.creationSource.candidate,documentVersion:1,reviewedAt:Date.now()},{id:'preview'});wikiDraft.procedureAvailable=!!procedure;wikiDraft.procedureKind=procedure?.kind || 'form'; message={...message,content:'사이트 위키 초안을 만들었습니다.'};}
          else {skillDraft = {skill: parseSkillDraft(message.content, chatLease.creationSource), sourceId: chatLease.creationSource.sourceId, status: 'draft'}; message = {...message, content: '스킬 초안을 만들었습니다. 절차와 입력 변수를 확인해 주세요.'};}
        }
        catch {message = {...message, content: '', error: chatLease.creationSource.kind==='wiki' ? 'wiki_draft_invalid' : 'skill_draft_invalid'};}
      }
      const awaitingUser = chatLease.awaitingUser && !!chat.messages.find(m => m.id === message.requestId)?.question && !message.error;
      // An answer released as limited comes from a lookup and names its open checks.
      // A failed page check of that run does not withhold it; an unresolved action still does.
      const limitedLookup = chat.task?.goalReview?.status === 'limited' && unresolvedReconciliations(chat.task).length === 0;
      const unchecked = !awaitingUser && chat.task?.requestId === message.requestId && (['pending', 'failed'].includes(chat.task.verification?.status) && !limitedLookup||unresolvedReconciliations(chat.task).length>0);
      const unreviewed = !awaitingUser && chat.task?.requestId === message.requestId && chat.task.goalReview && !['complete', 'limited'].includes(chat.task.goalReview.status);
      const error = Object.hasOwn(ERROR_TEXT, message.error) ? message.error : message.error ? 'upstream' : unchecked ? 'verification_required' : unreviewed ? 'goal_review_failed' : null;
      chat.messages = chat.messages.map(m => m.id === message.requestId ? {...m, ...(journal ? {traceJournal: journal} : {}), ...(skillDraft ? {skillDraft} : {}), ...(wikiDraft ? {wikiDraft} : {}), content: awaitingUser || (unchecked || unreviewed) && !message.error ? '' : String(message.content || '').slice(0, 400000), state: error ? 'error' : 'done', error, finishReason: error ? null : message.finishReason === 'length' ? 'length' : 'stop', usage: error ? null : normalizeUsage(message.usage), trace: normalizeTrace(message.trace)} : m);
      if (chat.task?.requestId === message.requestId) chat.task = error ? pauseTask(chat.task) : {...chat.task, status: awaitingUser ? 'awaiting_user' : 'done', updatedAt: Date.now()};
      if(error==='cancelled'&&chat.task?.requestId===message.requestId&&chat.task.researchHandoffs)chat.task.researchHandoffs=cancelResearchHandoffs(chat.task.researchHandoffs);
      if (error==='cancelled' && chat.task?.requestId===message.requestId && chat.task.analysisHandoffs) chat.task.analysisHandoffs=cancelAnalysisHandoffs(chat.task.analysisHandoffs);
      if (wikiDraft) {const source=chat.messages.find(item=>item.id===chatLease.creationSource.sourceId);if(source?.wikiOffer)source.wikiOffer.status='drafted';}
      // A finished run counts for the skill it selected or read. A run that was
      // stopped or is waiting for the user says nothing about the skill.
      // What this request used so far. A question or an approval ends the lease,
      // so the record travels with the task and seeds the lease that resumes it.
      const used = chat.task?.requestId === chatLease.id && !chatLease.creationSource ? {
        route: extendRoute([...(chat.task.used?.route || []), ...(chatLease.knowledgeRoute || [])].reduce((route, step) => extendRoute(route, routeStep(step?.url, step?.title)), [])),
        skills: [...new Set([...(chat.task.used?.skills || []), ...(chatLease.skillsRead || [])])].filter(id => typeof id === 'string' && /^custom-[\w-]{1,80}$/.test(id)).slice(-5)} : null;
      if (used) chat.task = {...chat.task, used};
      // A run counts for the skill it selected or read when it finished or failed
      // its own checks. A stopped run, a login or a quota error says nothing about the skill.
      if (used && !chatLease.compacting && !chatLease.planningOnly && !awaitingUser && (!error || ['verification_required', 'goal_review_failed'].includes(error))) {
        const skillsUsed = [chat.task.skillId, ...used.skills].filter(id => typeof id === 'string' && id.startsWith('custom-'));
        if (skillsUsed.length) {
          try {await chrome.storage.local.set({skillStats: recordSkillUse((await chrome.storage.local.get('skillStats')).skillStats, skillsUsed, !error && chat.task.goalReview?.status === 'complete' ? 'passed' : 'failed')});}
          catch { /* A usage count never fails a finished run. */ }
        }
      }
      // The pages this request passed through stay with its answer for a later skill draft.
      if (!error && used?.route.length > 1) {
        const reply = chat.messages.find(item => item.id === message.requestId);
        if (reply) reply.pageRoute = used.route;
      }
      let offered;
      if (!error && !awaitingUser && !chatLease.planningOnly && chat.task?.requestId === chatLease.id && chat.task.goalReview?.status === 'complete' && chat.task.verification?.status === 'passed' && chatLease.knowledgeCandidate) {
        try {
          const stored=knowledgeState((await chrome.storage.local.get('browserKnowledge')).browserKnowledge);
          if (stored.enabled && stored.revision===chatLease.knowledgeRevision) {
            let summary=null;
            try {summary=skillCreationSource(chat);} catch { /* A page document needs no procedure summary. */ }
            if (used?.route.length > 1) summary={...(summary || {}),route:used.route};
            const refreshed=autoRefreshPage(stored,chatLease.knowledgeCandidate,{revision:chatLease.knowledgeRevision,expectedVersion:chatLease.knowledgeCandidate.expectedVersion,completed:true});
            const updated=refreshed.entries.find(item=>item.url===chatLease.knowledgeCandidate.url && item.provider===chatLease.provider);
            const prior=stored.entries.find(item=>item.url===chatLease.knowledgeCandidate.url && item.provider===chatLease.provider);
            if (updated && updated.documentVersion!==prior?.documentVersion) {
              await chrome.storage.local.set({browserKnowledge:refreshed});
            }
            // Explicit /wiki still opens the review flow; ordinary automatic updates need no approval card.
            if (!updated || updated.documentVersion===prior?.documentVersion || chatLease.wikiInit) offered=wikiOffer(chatLease.knowledgeCandidate,stored.revision,summary);
            if (offered) chat.messages.find(item=>item.id===message.requestId).wikiOffer=offered;
          }
        } catch { /* Optional wiki drafting never fails an otherwise completed task. */ }
      }
      // A task that finished verified keeps its steps, so it can be repeated
      // without the model. A stopped or failed one keeps its log for the run that
      // resumes it. The typed values stay in memory only.
      const replayLogId = chat.task?.requestId === chatLease.id && typeof chat.task.replayLogId === 'string' ? chat.task.replayLogId : null;
      if (replayLogId && !awaitingUser) {
        try {
          const {replayLogs = {}, replayValues = {}} = await getSession();
          const log = replayLogs[replayLogId];
          const passed = !error && chat.task.verification?.status === 'passed' && (!!chatLease.replay || chat.task.goalReview?.status === 'complete');
          const record = passed && log ? replayRecord(log, {id: replayLogId, goal: chat.task.goal,goalReviewed:!chatLease.replay && chat.task.goalReview?.status==='complete'}) : null;
          const answer = chat.messages.find(item => item.id === message.requestId && item.role === 'assistant');
          if (record && answer) {
            answer.replay = record;
            for (const old of chat.messages.filter(item => item.replay).slice(0, -5)) delete old.replay;
            delete replayValues[replayLogId]; replayValues[replayLogId] = {values: log.values, at: Date.now()};
          }
          if (!error) delete replayLogs[replayLogId];
          await chrome.storage.session.set({replayLogs, replayValues: Object.fromEntries(Object.entries(replayValues).slice(-REPLAY_VALUES))});
        } catch { /* A replay record never fails a finished run. */ }
      }
      await saveChat(chat);
      await chrome.storage.session.remove(['chatLease', 'agentRun']);
      await chrome.action.setBadgeText({text: awaitingUser ? '?' : ''}).catch(() => {});
      await settleUsage(chatLease.id);
      const verified=chat.task?.verification?.status==='passed'&&chat.task?.goalReview?.status==='complete';
      await finishRoutine(chatLease.id,{error,awaitingUser,verified}).catch(()=>{});
      await notifyRoutineResult(chatLease,{error,awaitingUser,verified});
      // Sending the result waits on the desktop, so it runs outside this queue.
      const delegatedReply = chat.messages.find(item => item.id === message.requestId && item.role === 'assistant');
      void finishDelegatedRun(chatLease, {error, awaitingUser, content: delegatedReply?.content, reviewed: !error && chat.task?.requestId === chatLease.id && chat.task.goalReview?.status === 'complete'}).catch(() => {});
      if (credential?.receivedAt === chatLease.credentialReceivedAt) {
        if (!error && !chatLease.compacting) await chrome.storage.session.set({credential: {...credential, verifiedAt: Date.now()}});
        else if (error === 'unauthorized') await chrome.storage.session.set({credential: {...credential, verifiedAt: null, rejected: true}});
      }
      await event(error || (chatLease.compacting ? 'context_compacted' : 'api_success'), {status: Number.isInteger(message.status) ? message.status : 0});
      // Successful final verification is the only automatic hand-off boundary.
      // Errors, stop and HITL preserve the queue for an explicit user action.
      if (chatLease.wikiInit && offered) {
        try {
          const request=await handle({type:'START_CHAT',createWiki:chatLease.id,conversationId:chat.sessionId},sender,RUNNER);
          runner.start(request); return state();
        } catch { /* The visible offer remains retryable. */ }
      }
      const next = !error && !awaitingUser && !chatLease.compacting && !chatLease.creationSource && nextInput(chat.inbox, {...chatLease,runId:chatLease.id});
      if (next) {
        try {
          const request = await handle({type:'START_CHAT', queuedInputId:next.id, queueSourceTabId:chatLease.pageTargetTabId, conversationId:chat.sessionId}, sender, RUNNER);
          runner.start(request);
        } catch { /* Keep unconsumed input visible; never claim it ran. */ }
      }

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
      const {tab, reused, hash} = await openChatTab({senderTabId:sender.tab?.id, sourceWindowId:source?.windowId, hash:message.hash});
      if (reused && hash) await chrome.runtime.sendMessage({type:'NUBI_OPEN_VIEW', tabId:tab.id, hash}).catch(() => {});
      if (source) {
        const {chatSourceTabs = {}} = await getSession();
        await chrome.storage.session.set({chatSourceTabs: {...Object.fromEntries(Object.entries(chatSourceTabs).slice(-19)), [tab.id]: source.id}});
      }
      return null;
    }
    default: fail('invalid_sender');
  }
}
async function browserKnowledgeResult(lease, tool, args, result, tabId) {
  if (!['read_page','browser_snapshot','verify_page','navigate_page'].includes(tool)) {
    // Looking at the page (inspect, capture, list tabs, wait) leaves the verified page as it was.
    if (!MUTATING_TOOLS.has(tool)) return result;
    try {const current=(await getSession()).chatLease;
      if (current?.id===lease.id && current.knowledgeCandidate) await chrome.storage.session.set({chatLease:{...current,knowledgeCandidate:null}});
    } catch { /* Optional documentation cannot fail a successful action. */ }
    return result;
  }
  try {
    let current = (await getSession()).chatLease;
    if (!current || current.id !== lease.id || current.cancelled) return result;
    const stored = knowledgeState((await chrome.storage.local.get('browserKnowledge')).browserKnowledge);
    if (!stored.enabled || stored.revision !== current.knowledgeRevision) return result;
    const tab = await chrome.tabs.get(tabId), url = knowledgeURL(tab.url || '');
    const observation = result.observation || result;
    // The pages this run passed through, for the document and skill drafts.
    const step = !result.error && url ? routeStep(url, tab.title) : null;
    if (step && current.knowledgeRoute?.at(-1)?.url !== step.url) {
      const fresh = (await getSession()).chatLease;
      if (!fresh || fresh.id !== lease.id || fresh.cancelled) return result;
      current = {...fresh, knowledgeRoute: extendRoute(fresh.knowledgeRoute, step)};
      await chrome.storage.session.set({chatLease: current});
    }
    if (tool === 'navigate_page') {
      // A failed remembered destination stays visible in settings, but is not retrieved.
      if (result.error || !url) await chrome.storage.local.set({browserKnowledge:invalidatePage(stored,args?.url,lease.provider)});
      await chrome.storage.session.set({chatLease:{...current,knowledgeCandidate:null}});
    }
    if (tool === 'verify_page') {
      if (result.error || result.verified !== true) {
        // A failed check is most often the expectation of this run, not a changed
        // site. The stored page is withdrawn only when the observation contradicts it.
        if (url && await observationDrift(stored,url,lease.provider,observation)) await chrome.storage.local.set({browserKnowledge:invalidatePage(stored,url,lease.provider)});
        await chrome.storage.session.set({chatLease:{...current,knowledgeCandidate:null}});
      } else if (url && args?.checks?.length > 0 &&
          observation.url === new URL(url).origin + new URL(url).pathname && observation.title === tab.title) {
        await chrome.storage.session.set({chatLease:{...current,knowledgeCandidate:{url,contradiction:await observationDrift(stored,url,lease.provider,observation),expectedVersion:stored.entries.find(item=>item.url===url && item.provider===lease.provider)?.documentVersion || 0,title:observation.title,provider:lease.provider,verifiedAt:Date.now(),document:documentObservedPage(observation),sourceHash:await observationHash(documentObservedPage(observation))}}});
      }
    }
    if (['read_page','browser_snapshot'].includes(tool) && !result.error && url) {
      const {chat} = await chrome.storage.local.get('chat');
      const drift = !args?.query && !args?.mode && await observationDrift(stored,url,lease.provider,observation);
      const searchable = drift ? invalidatePage(stored,url,lease.provider) : stored;
      if(drift) await chrome.storage.local.set({browserKnowledge:searchable});
      const entries = searchKnowledge(searchable,{origin:new URL(url).origin,provider:lease.provider,query:[chat?.task?.goal,args?.query].filter(Boolean).join(' ')});
      if (entries.length) {
        const key=JSON.stringify(entries.map(entry=>[entry.url,entry.documentVersion,entry.sourceHash,entry.excerpts.map(excerpt=>excerpt.id)]));
        const delivered=current.knowledgeDelivered || [];
        if(!delivered.includes(key)) {
          await chrome.storage.session.set({chatLease:{...current,knowledgeDelivered:[...delivered,key].slice(-8)}});
          return {...result,browserKnowledge:{...knowledgePacket(entries),...(drift ? {invalidated:[url]} : {})}};
        }
      }
      if(drift)return {...result,browserKnowledge:{...knowledgePacket([]),invalidated:[url],instruction:'The current observation contradicts the stored page knowledge. Discard previously retrieved guidance for this URL, use the live observation, and ask about unresolved business rules. Do not repeat actions from the old document.'}};
    }
    // An address with its own parameters is not remembered, but the documents
    // of its site still apply. Nothing is compared or withdrawn for such a page.
    const sitePage = !url && (() => {try {const page = new URL(tab.url || ''); return !!knowledgeURL(page.origin + page.pathname) && knowledgeOrigin(page.href);} catch {return null;}})();
    if (['read_page','browser_snapshot'].includes(tool) && !result.error && sitePage) {
      const {chat} = await chrome.storage.local.get('chat');
      const entries = searchKnowledge(stored,{origin:sitePage,provider:lease.provider,query:[chat?.task?.goal,args?.query].filter(Boolean).join(' ')});
      if (entries.length) {
        const key=JSON.stringify(entries.map(entry=>[entry.url,entry.documentVersion,entry.sourceHash,entry.excerpts.map(excerpt=>excerpt.id)]));
        const delivered=current.knowledgeDelivered || [];
        if(!delivered.includes(key)) {
          await chrome.storage.session.set({chatLease:{...current,knowledgeDelivered:[...delivered,key].slice(-8)}});
          return {...result,browserKnowledge:knowledgePacket(entries)};
        }
      }
    }
  } catch { /* Navigation remains usable when optional local knowledge is unavailable. */ }
  return result;
}
async function trackedVocTool(lease,name,operation) {
  await checkpointTool(lease.id,name,'start');
  let result;
  try {result=await operation();}
  catch (error) {result={error:Object.hasOwn(ERROR_TEXT,error.message) ? error.message : 'workspace_verify',instruction:'Do not claim collection or export completed. Preserve existing evidence and user edits. Resolve the missing page/folder permission or ask a focused question. Do not overwrite a conflicting file.'};}
  await checkpointTool(lease.id,name,'end',result);
  return (await getSession()).chatLease?.cancelled ? {error:'cancelled'} : result;
}
// The steps of a task as a replay repeats them, and the values typed into them,
// in memory only (chrome.storage.session): field values are never saved to disk.
// A question or an approval ends a run, not its task, so the log continues with
// the run that resumes it. Only a run that finished verified keeps its steps.
const REPLAY_LOGS = 8, REPLAY_STEPS = 80, REPLAY_VALUES = 20;
const replayPage = value => {try {const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : '';} catch {return '';}};
async function recordReplay(logId, tool, args, observedBefore, result, tabId) {
  if (typeof logId !== 'string' || !logId) return;
  try {
    const {replayLogs = {}} = await getSession();
    const log = replayLogs[logId] || {steps: [], values: {}, next: 0};
    if (log.unreplayable) return;
    const recorded = recordReplayStep(tool, args || {}, observedBefore, result, () => `v${log.next++}`, {uploadTargets: log.uploadTargets || {}});
    if (!recorded) return;
    if (recorded.uploadTargets) log.uploadTargets = recorded.uploadTargets;
    else if (recorded.unreplayable || log.steps.length >= REPLAY_STEPS) log.unreplayable = recorded.unreplayable || 'too_long';
    else {
      if (!log.steps.length && observedBefore?.url) {
        log.startPage = replayPage(observedBefore.url);
        // The full address, query included, only in memory: it opens the same page.
        const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
        if (tab?.url && replayPage(tab.url) === log.startPage) log.values.__start = tab.url;
      }
      log.steps.push(recorded.step); Object.assign(log.values, recorded.values);
    }
    delete replayLogs[logId]; replayLogs[logId] = log;
    await chrome.storage.session.set({replayLogs: Object.fromEntries(Object.entries(replayLogs).slice(-REPLAY_LOGS))});
  } catch { /* A replay log never fails the run it records. */ }
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
  referenceReads.cancel(chatLease.id);
  endWorkspaceRequest(chatLease.id);
  try {await chrome.storage.session.set({chatLease: {...chatLease, cancelled: true}});}
  finally {cancelMcp(chatLease.id);
      await stopBrowserAgent(chatLease.id);}
  return null;
}
async function cancelDetachedBrowser(requestId) {
  // Stop outside the serialized tool queue: a pending locator must not wait
  // for another model response or silently reconnect after the user cancels.
  runner.cancel(requestId);
  referenceReads.cancel(requestId);
  endWorkspaceRequest(requestId);
  cancelMcp(requestId);
  const stopped = stopBrowserAgent(requestId);
  try {
    const {chatLease} = await getSession();
    if (chatLease?.id === requestId) await chrome.storage.session.set({chatLease: {...chatLease, cancelled: true}});
  } finally {await stopped;}
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if(message?.type==='RECORD_BROWSER_STEP'){serial(()=>recordStep(message,sender)).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;}

  if (message?.target === 'image-renderer') return;
  // A locator or slow page must not block read-only progress or the explicit
  // work-window shortcut. State reads here never recover/replay a running job.
  const task = message?.type === 'ANSWER_NATIVE_DIALOG' ? boot.then(() => answerNativeDialog(message,sender))
    : ['GET_TRACE_JOURNAL', 'GET_AGENT_DIAGNOSTICS', 'SET_DEBUG_MODE'].includes(message?.type) && trustedUI(sender) ? boot.then(() => handle(message, sender))
    : message?.type === 'GET_STATE' && pendingToolOperations > 0 && trustedUI(sender) ? boot.then(() => state(sender, message.clientId, true))
    : message?.type === 'SHOW_BROWSER_WORKSPACE' && trustedUI(sender) ? boot.then(() => handle(message, sender))
    // Task exchange waits on the desktop over the network; it queues only its own chat changes.
    : message?.type === 'A2A_TASKS' && trustedUI(sender) ? boot.then(() => a2aTasksRpc(message, sender))
    : message?.type === 'CANCEL_BROWSER' ? cancelBrowser(message, sender) : message?.type === 'PREPARE_CREDENTIAL' ? prepareCredential(message, sender) : message?.type === 'TEST_FABRIX' ? runFabrixTest(message, sender) : serialTool(message?.type, () => handle(message, sender));
  task.then(data => reply({ok: true, data}), error => reply({ok: false, error: Object.hasOwn(ERROR_TEXT, error.message) ? error.message : 'storage_failed'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if(alarm.name.startsWith('nubi-recording:')){serial(()=>expireRecording(alarm.name)).catch(()=>{});return;}
  if(alarm.name.startsWith('nubi-routine:')){serial(async()=>fireRoutine(alarm.name,await routineOwner(),startScheduledRoutine)).catch(()=>{});return;}
  if(alarm.name===A2A_POLL){boot.then(pollTasks).catch(()=>{});return;}

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
  const {browserRecording}=await getSession();
  if(browserRecording?.tabId===tabId)await stopRecording('tab_closed').catch(()=>{});
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

chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(change.status==='complete')serial(()=>recordingNavigation(tabId,tab)).catch(()=>{});});
function notificationClicked(id){serial(async()=>{
  const {browserNotificationReceipts={}}=await chrome.storage.local.get('browserNotificationReceipts');
  const receipt=browserNotificationReceipts[id];if(!receipt)return;
  await chrome.tabs.create({url:chrome.runtime.getURL('index.html')+'?conversation='+encodeURIComponent(receipt.conversationId)+'#history'});
  await chrome.notifications.clear(id);
}).catch(()=>{});}
function downloadChanged(delta){serial(async()=>{
  const {browserTransfers=[]}=await chrome.storage.local.get('browserTransfers');const owner=browserTransfers.find(r=>r.downloadId===delta.id);if(owner)await downloadStatus(owner,owner.id);
}).catch(()=>{});}
let downloadEvent,notificationEvent;
function registerOptionalBrowserEvents(){
  if(chrome.downloads?.onChanged&&!downloadEvent){downloadEvent=chrome.downloads.onChanged;downloadEvent.addListener(downloadChanged);}
  if(chrome.notifications?.onClicked&&!notificationEvent){notificationEvent=chrome.notifications.onClicked;notificationEvent.addListener(notificationClicked);}
}
registerOptionalBrowserEvents();
chrome.permissions.onAdded?.addListener(()=>registerOptionalBrowserEvents());
chrome.permissions.onRemoved?.addListener(removed=>{
  if(removed.permissions?.includes('downloads')){try{downloadEvent?.removeListener(downloadChanged);}catch{}downloadEvent=null;}
  if(removed.permissions?.includes('notifications')){try{notificationEvent?.removeListener(notificationClicked);}catch{}notificationEvent=null;}
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='managed')return;
  // Interrupt outside the serial queue so a pending action cannot hold up revocation.
  void refreshBrowserPolicy({invalidate:true});
  void (async()=>{
    const {chatLease}=await getSession();if(chatLease){runner.cancel(chatLease.id);referenceReads.cancel(chatLease.id);await stopBrowserAgent(chatLease.id);}
    await serial(()=>stopRecording());
  })().catch(()=>{});
});
