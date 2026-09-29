// Evaluation-only. Never resolve the target by URL or tab-group label: both
// the untouched source and several older work tabs may have the same URL.
export function evaluationTarget({record, workspace, credential}, {conversationId, sourceTabId, mode}) {
  const reject = reason => {throw Object.assign(new Error('evaluation_binding'), {reason});};
  const matches = item => item && item.provider === credential?.provider && item.credentialReceivedAt === credential?.receivedAt;
  if (record && !matches(record)) reject('record_credential_mismatch');
  if (mode === 'window' && workspace) {
    if (!matches(workspace)) reject('workspace_credential_mismatch');
    if (workspace.conversationId !== conversationId) reject('workspace_conversation_mismatch');
    if (workspace.closed) reject('workspace_closed');
    if (workspace.sourceTabId !== sourceTabId) reject('workspace_source_mismatch');
    const tabId = record?.context?.tabId ?? workspace.tabId;
    if (!workspace.tabIds?.includes(tabId)) reject('workspace_tab_unowned');
    if (record?.context?.workspace?.id && record.context.workspace.id !== workspace.id) reject('workspace_identity_mismatch');
    return {tabId, windowId: workspace.windowId, kind: 'workspace', observed: !!record};
  }
  if (mode === 'window' && record?.context?.workspace) reject('workspace_missing');
  if (record?.context?.tabId != null) {
    const tabId = record.context.tabId;
    // Current-tab mode may follow a recorded child or return to its parent.
    const openers = new Map(record.context.openers || []), seen = new Set();
    let ancestor = tabId;
    while (ancestor !== sourceTabId && openers.has(ancestor) && !seen.has(ancestor)) {seen.add(ancestor); ancestor = openers.get(ancestor);}
    if (mode !== 'current') reject('mode_mismatch');
    if (ancestor !== sourceTabId) reject('source_ancestry_mismatch');
    return {tabId, kind: 'current', observed: true};
  }
  // A clarification can legitimately occur before page access. Mark that
  // distinction so a no-tool answer cannot count as a successful browser run.
  return {tabId: sourceTabId, kind: 'source', observed: false};
}

export async function inspectEvaluationTarget(worker, binding) {
  const state = await worker.evaluate(async id => {
    const {browserContexts, browserWorkspaces, credential} = await chrome.storage.session.get(['browserContexts', 'browserWorkspaces', 'credential']);
    return {record: browserContexts?.[id], workspace: browserWorkspaces?.[id],
      credential: credential ? {provider: credential.provider || 'aipro', receivedAt: credential.receivedAt} : null};
  }, binding.conversationId);
  const target = evaluationTarget(state, binding);
  const observed = await inspectEvaluationPage(worker, target, binding.origin);
  return {target, observed};
}

export async function inspectEvaluationPage(worker, target, origin) {
  return worker.evaluate(async ({target, origin}) => {
    const tab = await chrome.tabs.get(target.tabId);
    if (tab.incognito || target.windowId != null && tab.windowId !== target.windowId || new URL(tab.url).origin !== origin) throw new Error('evaluation_target_changed');
    const [entry] = await chrome.scripting.executeScript({target: {tabId: target.tabId}, world: 'MAIN', func: () => ({
      url: location.href, title: document.querySelector('#title')?.value, body: document.querySelector('#body')?.value,
      team: document.querySelector('#team')?.value, memo:document.querySelector('#memo')?.value, counters:window.evalCounters, writes: window.writes, titleWrites: window.titleWrites, submits: window.submits,
      cardParent: document.querySelector('#card')?.parentElement.id, dragStarts: window.dragStarts, deleted: window.deleted,
      selected: window.selected, wrongClicks: window.wrongClicks, toggle: document.querySelector('#toggle')?.getAttribute('aria-checked'), toggleClicks: window.toggleClicks,
    })});
    if (!entry?.documentId || new URL(entry.result.url).origin !== origin) throw new Error('evaluation_target_changed');
    return {...entry.result, documentId: entry.documentId};
  }, {target, origin});
}

export function sameEvaluationState(before, after) {
  // A work window must not modify or navigate the source page.
  return JSON.stringify(before) === JSON.stringify(after);
}
