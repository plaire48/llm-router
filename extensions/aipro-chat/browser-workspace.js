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

export async function reconnectWorkspace(workspace, binding, targetTabId) {
  if (!workspaceMatches(workspace, binding) || workspace.closed ||
    targetTabId !== workspace.sourceTabId && !workspace.tabIds?.includes(targetTabId)) return null;
  const tabId = workspace.tabIds.includes(targetTabId) ? targetTabId : workspace.tabId;
  // A matching URL/group is never ownership. Reuse only a still-live recorded
  // tab, preserving its DOM and edits instead of cloning it again.
  if (!await workspaceTab(workspace, tabId).catch(() => null)) return null;
  return {...workspace, tabId};
}

export async function openChatTab({senderTabId, sourceWindowId, hash = ''} = {}) {
  const base = chrome.runtime.getURL('index.html');
  const targetHash = ['#settings-wiki', '#settings'].includes(hash) ? hash : '';
  // These regular UI tabs share the active conversation. A history deep link
  // with its own conversation query is not a reusable generic chat surface.
  // tabs.query() redacts even our extension URLs without the broad tabs
  // permission. Runtime contexts identify our own top-level UI documents.
  const contexts = await chrome.runtime.getContexts({contextTypes:['TAB'], frameIds:[0], incognito:false});
  const candidates = (await Promise.all(contexts.filter(context => context.contextType === 'TAB' && context.frameId === 0 &&
    !context.incognito && context.tabId >= 0 && (context.documentUrl || '').split('#')[0] === base).map(async context => {
    const tab = await chrome.tabs.get(context.tabId).catch(() => null);
    if (!tab || tab.incognito || tab.windowId !== context.windowId ||
      tab.pendingUrl && tab.pendingUrl.split('#')[0] !== base || tab.url && tab.url.split('#')[0] !== base) return null;
    return tab;
  }))).filter(Boolean);
  candidates.sort((a, b) => Number(b.id === senderTabId) - Number(a.id === senderTabId) ||
    Number(b.windowId === sourceWindowId) - Number(a.windowId === sourceWindowId) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const candidate of candidates) {
    const tab = await chrome.tabs.update(candidate.id, {active: true}).catch(() => null);
    if (!tab) continue; // The user may have closed it after query.
    const win = await chrome.windows.get(tab.windowId);
    await chrome.windows.update(tab.windowId, {...(win.state === 'minimized' ? {state: 'normal'} : {}), focused: true});
    return {tab, reused: true, hash: targetHash};
  }
  return {tab: await chrome.tabs.create({url: base + targetHash}), reused: false, hash: targetHash};
}

export async function readyWorkspaceTab(workspace, tabId, cancelled = () => false, {committedOnly = false} = {}) {
  const until = Date.now() + 12000;
  for (;;) {
    if (cancelled()) throw new Error('cancelled');
    const tab = await workspaceTab(workspace, tabId);
    if (/^https?:\/\//.test(tab.url || '') && (committedOnly || tab.status !== 'loading')) return tab;
    if (Date.now() >= until) throw new Error('workspace_loading');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// tabs.create resolves before the first HTTP document necessarily commits.
// pendingUrl is an intention, never a readable document or permission grant.
export async function readyCreatedTab(tabId, cancelled = () => false, {waitMs = 12000} = {}) {
  const until = Date.now() + waitMs;
  for (;;) {
    if (cancelled()) throw new Error('cancelled');
    const tab = await chrome.tabs.get(tabId);
    if (/^https?:\/\//.test(tab.url || '')) return tab;
    if (Date.now() >= until) throw new Error('workspace_loading');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

let groupChanges = Promise.resolve();
function joinWorkspaceGroup(workspace, requestedIds) {
  const change = groupChanges.then(async () => {
    const {nubiWorkspaceGroups = {}, browserWorkspaces = {}} = await chrome.storage.session.get(['nubiWorkspaceGroups', 'browserWorkspaces']);
    const prior = nubiWorkspaceGroups[workspace.windowId];
    const records = Object.values(browserWorkspaces).filter(record => !record.closed && record.windowId === workspace.windowId);
    // This registry owns presentation only. It must never expand a conversation's
    // tabIds, observation scope or approval binding to another conversation.
    const ownedIds = new Set([...(prior?.tabIds || []), ...records.flatMap(record => record.tabIds || []), ...requestedIds]);
    const knownGroups = new Set([prior?.groupId, ...records.map(record => record.groupId)].filter(Number.isInteger));
    const tabs = await chrome.tabs.query({windowId: workspace.windowId});
    const live = tabs.filter(tab => ownedIds.has(tab.id) && !tab.incognito);
    const grouped = live.filter(tab => requestedIds.includes(tab.id) || knownGroups.has(tab.groupId));
    const reusable = live.find(tab => tab.groupId === prior?.groupId && tab.groupId >= 0) ||
      live.find(tab => knownGroups.has(tab.groupId) && tab.groupId >= 0);
    const groupId = await chrome.tabs.group({tabIds: grouped.map(tab => tab.id),
      ...(reusable ? {groupId: reusable.groupId} : {createProperties: {windowId: workspace.windowId}})});
    await chrome.tabGroups.update(groupId, {title: '✦ 누비', color: 'cyan', collapsed: false});
    nubiWorkspaceGroups[workspace.windowId] = {groupId, tabIds: live.map(tab => tab.id)};
    await chrome.storage.session.set({nubiWorkspaceGroups});
    workspace.groupId = groupId;
    return groupId;
  });
  groupChanges = change.catch(() => {});
  return change;
}

export async function releaseWorkspace(workspace) {
  // Restore normal Chrome memory management without closing the user's draft.
  await Promise.allSettled((workspace?.tabIds || []).map(async id => {
    await workspaceTab(workspace, id);
    await chrome.tabs.update(id, {autoDiscardable: true});
  }));
  if (!workspace || workspace.closed) return;
  const release = groupChanges.then(() => compactWorkspaceGroup(workspace));
  groupChanges = release.catch(() => {});
  return release;
}

async function compactWorkspaceGroup(workspace) {
  // Compact the owned group at rest, without closing drafts or changing the
  // selected page. A manually grouped user tab is never hidden by this policy.
  const tabs = await chrome.tabs.query({windowId: workspace.windowId}).catch(() => null);
  if (!tabs) return {status: 'preserved', reason: 'inventory_unavailable'};
  const {nubiWorkspaceGroups = {}} = await chrome.storage.session.get('nubiWorkspaceGroups');
  const shared = nubiWorkspaceGroups[workspace.windowId];
  // Respect manual regrouping. A tab still being owned does not authorize
  // collapsing a different group the user created around it.
  const groupId = shared?.groupId ?? workspace.groupId;
  if (shared) {
    shared.tabIds = shared.tabIds.filter(id => tabs.some(tab => tab.id === id && !tab.incognito));
    if (!shared.tabIds.length) delete nubiWorkspaceGroups[workspace.windowId];
    await chrome.storage.session.set({nubiWorkspaceGroups});
  }
  const owned = new Set([...workspace.tabIds, ...(shared?.groupId === groupId ? shared.tabIds : [])]);
  const grouped = tabs.filter(tab => tab.groupId === groupId);
  if (groupId >= 0 && grouped.length && grouped.every(tab => !tab.active && owned.has(tab.id))) {
    try {await chrome.tabGroups.update(groupId, {collapsed: true}); return {status: 'collapsed'};}
    catch {return {status: 'preserved', reason: 'group_changed'};}
  }
  return {status: 'preserved', reason: 'active_or_user_group'};
}

export async function findWorkspaceURL(workspace, url) {
  if (!workspace || workspace.closed) return null;
  for (const id of [workspace.tabId, ...workspace.tabIds.filter(id => id !== workspace.tabId)]) {
    const tab = await workspaceTab(workspace, id).catch(() => null);
    // Preserve hashes/query strings and pending navigations. URL similarity is
    // not ownership and reopening must not reload an existing draft.
    if (tab?.url === url && (!tab.pendingUrl || tab.pendingUrl === url)) return tab;
  }
  return null;
}

const focusGuards = new Map();
export async function guardPopupFocus(workspace) {
  if (!workspace) return null;
  const foreground = await chrome.windows.getLastFocused();
  // Last-focused Chrome is not necessarily the foreground application.
  const initialTabs = await chrome.tabs.query({windowId: workspace.windowId});
  const initialIds = new Set(initialTabs.map(tab => tab.id));
  const userTab = initialTabs.find(tab => tab.active && !workspace.tabIds.includes(tab.id));
  let protectTab = !!userTab;
  const createdTabs = new Set();
  const restoreTab = async () => {
    if (stopped || !protectTab) return;
    const current = (await chrome.tabs.query({windowId: workspace.windowId, active: true}).catch(() => []))[0];
    if (stopped || !protectTab) return;
    if (current && (createdTabs.has(current.id) || !initialIds.has(current.id) && workspace.tabIds.includes(current.id))) await chrome.tabs.update(userTab.id, {active: true}).catch(() => {});
  };
  const activated = async ({tabId, windowId}) => {
    if (stopped || !protectTab || windowId !== workspace.windowId || tabId === userTab.id) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (stopped || !tab) return;
    if (!initialIds.has(tabId) && workspace.tabIds.includes(tab.openerTabId)) createdTabs.add(tabId);
    if (createdTabs.has(tabId)) await restoreTab();
    else if (initialIds.has(tabId)) protectTab = false; // A different existing user selection wins.
  };
  let stopped = false, restoring = null;
  const createdWindows = new Set();
  const restoreOnce = async id => {
    if (stopped || !foreground.focused || !createdWindows.has(id) || id === foreground.id) return;
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
    stopped = true; chrome.windows.onFocusChanged.removeListener(focused); chrome.tabs.onActivated.removeListener(activated);
    if (focusGuards.get(workspace.id) === close) focusGuards.delete(workspace.id);
  };
  focusGuards.get(workspace.id)?.(); focusGuards.set(workspace.id, close);
  chrome.windows.onFocusChanged.addListener(focused);
  chrome.tabs.onActivated.addListener(activated);
  return {created: async tab => {
    createdTabs.add(tab.id);
    await restoreTab();
    createdWindows.add(tab.windowId);
    // Moving a native popup into the work window may focus that destination.
    createdWindows.add(workspace.windowId);
    await restore(tab.windowId);
  }, finish: async () => {await restoreTab();const current = await chrome.windows.getLastFocused().catch(() => null); if (current) await restore(current.id);}, close};
}

export async function createWorkspace(source, binding) {
  if (!source || source.incognito || !/^https?:\/\//.test(source.url || '')) throw new Error('page_target_missing');
  let win = await chrome.windows.get(source.windowId);
  if (win.type !== 'normal') win = await chrome.windows.getLastFocused({windowTypes: ['normal']});
  if (!win || win.type !== 'normal' || win.incognito) throw new Error('workspace_unavailable');
  const tab = await chrome.tabs.create({url: source.url, windowId: win.id, active: false});
  if (!tab?.id) throw new Error('workspace_unavailable');
  // Open a fresh page in the source window. Never copy unsaved form state.
  // Keep the legacy work-mode key for saved preferences and resumable tasks.
  const workspace = {id: crypto.randomUUID(), ...binding, layout: 'tab-group', sourceTabId: source.id, windowId: win.id, tabId: tab.id, tabIds: [tab.id]};
  try {
    await joinWorkspaceGroup(workspace, [tab.id]);
    await chrome.tabs.update(tab.id, {autoDiscardable: false});
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
  await joinWorkspaceGroup(workspace, [tabId]);
  await chrome.tabs.update(tabId, {autoDiscardable: false});
  workspace.tabIds = [...new Set([...workspace.tabIds, tabId])];
  workspace.tabId = tabId;
  return tab;
}

// Follow only while the selected tab belongs to this workspace. Selecting an
// unrelated tab pauses following; selecting an owned tab resumes it. Never raise
// a window or activate another window here (showWorkspace is the explicit UI).
export async function followWorkspaceTab(workspace, cancelled = () => false) {
  if (!workspace || cancelled()) return false;
  let overridden = false;
  const selected = ({windowId, tabId}) => {if (windowId === workspace.windowId && !workspace.tabIds.includes(tabId)) overridden = true;};
  chrome.tabs.onActivated?.addListener(selected);
  try {
    const target = await workspaceTab(workspace, workspace.tabId);
    const current = (await chrome.tabs.query({windowId:workspace.windowId, active:true}))[0];
    if (cancelled() || overridden || !current || !workspace.tabIds.includes(current.id) || current.id === target.id) return false;
    await chrome.tabs.update(target.id, {active:true});
    return true;
  } catch {return false;}
  finally {chrome.tabs.onActivated?.removeListener(selected);}
}

export async function showWorkspace(workspace) {
  const tab = await workspaceTab(workspace, workspace.tabId);
  focusGuards.get(workspace.id)?.();
  await chrome.tabGroups.update(tab.groupId ?? workspace.groupId, {collapsed: false}).catch(() => {});
  await chrome.tabs.update(tab.id, {active: true});
  // Only an explicit UI click may raise the work window.
  const win = await chrome.windows.get(tab.windowId);
  await chrome.windows.update(tab.windowId, {...(win.state === 'minimized' ? {state: 'normal'} : {}), focused: true});
}
