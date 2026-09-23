// Session-bound tab ownership. Chrome groups are presentation, not authority.
export const workspaceMatches = (workspace, binding) => !!workspace &&
  workspace.conversationId === binding.conversationId && workspace.provider === binding.provider &&
  workspace.credentialReceivedAt === binding.credentialReceivedAt;

export async function workspaceTab(workspace, tabId) {
  if (workspace?.closed || !workspace?.tabIds?.includes(tabId)) throw new Error('workspace_changed');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.windowId !== workspace.windowId || tab.incognito) throw new Error('workspace_changed');
  return tab;
}

export async function readyWorkspaceTab(workspace, tabId, cancelled = () => false) {
  const until = Date.now() + 12000;
  for (;;) {
    if (cancelled()) throw new Error('cancelled');
    const tab = await workspaceTab(workspace, tabId);
    if (/^https?:\/\//.test(tab.url || '') && tab.status !== 'loading') return tab;
    if (Date.now() >= until) throw new Error('workspace_loading');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export async function releaseWorkspace(workspace) {
  // Restore normal Chrome memory management without closing the user's draft.
  await Promise.allSettled((workspace?.tabIds || []).map(async id => {
    await workspaceTab(workspace, id);
    await chrome.tabs.update(id, {autoDiscardable: true});
  }));
}

const focusGuards = new Map();
export async function guardPopupFocus(workspace) {
  if (!workspace) return null;
  const foreground = await chrome.windows.getLastFocused();
  // Last-focused Chrome is not necessarily the foreground application.
  if (!foreground.focused || foreground.id === workspace.windowId) return null;
  let stopped = false, restoring = null;
  const createdWindows = new Set();
  const restoreOnce = async id => {
    if (stopped || !createdWindows.has(id)) return;
    const current = await chrome.windows.getLastFocused().catch(() => null);
    // Do not pull the user back from a different window they chose meanwhile.
    if (!stopped && current?.focused && current.id === id) {
      await chrome.windows.update(foreground.id, {focused: true}).catch(() => {});
    }
  };
  const restore = id => restoring || (restoring = restoreOnce(id).finally(() => {restoring = null;}));
  const focused = async id => {
    if (id === chrome.windows.WINDOW_ID_NONE) {close(); return;}
    if (id === foreground.id || stopped) return;
    if (createdWindows.has(id)) {void restore(id); return;}
    // onFocusChanged can precede onCreated. Classify only through an actual
    // owned opener, never through a matching URL or a window/group title.
    const tabs = await chrome.tabs.query({windowId: id}).catch(() => []);
    if (stopped) return;
    if (tabs.some(tab => workspace.tabIds.includes(tab.openerTabId))) {
      createdWindows.add(id); void restore(id);
    } else close(); // A different user-selected window invalidates the guard.
  };
  const close = () => {
    stopped = true; chrome.windows.onFocusChanged.removeListener(focused);
    if (focusGuards.get(workspace.id) === close) focusGuards.delete(workspace.id);
  };
  focusGuards.get(workspace.id)?.(); focusGuards.set(workspace.id, close);
  chrome.windows.onFocusChanged.addListener(focused);
  return {created: async tab => {
    createdWindows.add(tab.windowId);
    // Moving a native popup into the work window may focus that destination.
    createdWindows.add(workspace.windowId);
    await restore(tab.windowId);
  }, finish: async () => {const current = await chrome.windows.getLastFocused().catch(() => null); if (current) await restore(current.id);}, close};
}

export async function createWorkspace(source, binding) {
  if (!source || source.incognito || !/^https?:\/\//.test(source.url || '')) throw new Error('page_target_missing');
  const foreground = await chrome.windows.getLastFocused().catch(() => null);
  const win = await chrome.windows.create({url: source.url, type: 'normal', focused: false, width: 1100, height: 850});
  const tab = win.tabs?.[0] || (await chrome.tabs.query({windowId: win.id}))[0];
  if (!tab?.id) throw new Error('workspace_unavailable');
  // Do not copy field values, cookies or sessionStorage. A fresh page uses the
  // current profile's normal login; unsaved DOM state is not transferred.
  const workspace = {id: crypto.randomUUID(), ...binding, sourceTabId: source.id, windowId: win.id, tabId: tab.id, tabIds: [tab.id]};
  try {
    workspace.groupId = await chrome.tabs.group({tabIds: [tab.id], createProperties: {windowId: win.id}});
    await chrome.tabGroups.update(workspace.groupId, {title: '누비', color: 'cyan', collapsed: false});
    await chrome.tabs.update(tab.id, {autoDiscardable: false});
    // Some desktop Chrome builds focus a newly created normal window despite
    // focused:false. Repair only that exact new window, once; never wake Chrome
    // from another application or undo a different user-selected window.
    const current = foreground?.focused && await chrome.windows.getLastFocused().catch(() => null);
    if (current?.focused && current.id === win.id && foreground.id !== win.id) await chrome.windows.update(foreground.id, {focused: true}).catch(() => {});
    return workspace;
  } catch (error) {
    // No user edits exist in this newly created, not-yet-adopted tab.
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw new Error('workspace_unavailable', {cause: error});
  }
}

export async function adoptWorkspaceTab(workspace, tabId, openerId, {created = false} = {}) {
  await workspaceTab(workspace, openerId);
  let tab = await chrome.tabs.get(tabId);
  if (tab.incognito || !workspace.tabIds.includes(tabId) && (!created || tab.openerTabId !== openerId && tab.windowId !== workspace.windowId)) throw new Error('workspace_changed');
  if (tab.windowId !== workspace.windowId) tab = await chrome.tabs.move(tabId, {windowId: workspace.windowId, index: -1});
  await chrome.tabs.group({groupId: workspace.groupId, tabIds: [tabId]});
  await chrome.tabs.update(tabId, {autoDiscardable: false});
  workspace.tabIds = [...new Set([...workspace.tabIds, tabId])];
  workspace.tabId = tabId;
  return tab;
}

export async function showWorkspace(workspace) {
  const tab = await workspaceTab(workspace, workspace.tabId);
  focusGuards.get(workspace.id)?.();
  await chrome.tabGroups.update(workspace.groupId, {collapsed: false}).catch(() => {});
  await chrome.tabs.update(tab.id, {active: true});
  // Only an explicit UI click may raise the work window.
  await chrome.windows.update(tab.windowId, {state: 'normal', focused: true});
}
