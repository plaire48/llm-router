// Register before dispatch: tabs may be created before Playwright's click
// resolves, and window.open() may first create an about:blank document.
export async function watchPopups(tabs, sourceId, hint = {}, {cancelled = () => false, timeout = 7000, interval = 50, workspace, onCreated = () => {}, changed, onClose = () => {}} = {}) {
  const candidates = new Set();
  let stopped = false, before, deadline, expiry, deferred = false;
  const related = tab => (!workspace || tab.openerTabId === sourceId || workspace.tabIds.includes(tab.id) || tab.windowId === workspace.windowId && !before?.has(tab.id)) &&
    (tab.openerTabId === sourceId || !!hint.href && [tab.url, tab.pendingUrl].includes(hint.href));
  const created = tab => {if (tab.id !== sourceId && related(tab)) {candidates.add(tab.id); Promise.resolve(onCreated(tab)).catch(() => {});}};
  const updated = (id, change, tab) => {
    if (id !== sourceId && related(tab) && (change.url || change.status === 'loading')) candidates.add(id);
  };
  const activated = async ({tabId}) => {
    try {
      const tab = await tabs.get(tabId);
      if (!stopped && tab.id !== sourceId && related(tab) && (tab.openerTabId === sourceId || hint.target && !hint.target.startsWith('_'))) candidates.add(tabId);
    } catch { /* Closed before inspection. */ }
  };
  const close = (reason = 'finished') => {
    if (stopped) return;
    stopped = true;
    clearTimeout(expiry);
    tabs.onCreated.removeListener(created); tabs.onUpdated.removeListener(updated); tabs.onActivated.removeListener(activated);
    onClose(reason);
  };
  tabs.onCreated.addListener(created); tabs.onUpdated.addListener(updated); tabs.onActivated.addListener(activated);
  try {before = new Map((await tabs.query({})).map(tab => [tab.id, {...tab}]));}
  catch (error) {close(); throw error;}
  // Events during the inventory are not evidence of this action.
  candidates.clear();
  return {
    close,
    get deferred() {return deferred;},
    // An approved target is rebound after focus/viewport validation, while the
    // watcher is already armed. Supply only its actual observed link hint.
    setHint(value) {hint = value || {};},
    async finish({pollOnly = false} = {}) {
      deadline ??= Date.now() + timeout;
      let retain = false;
      try {
        do {
          if (cancelled()) throw new Error('cancelled');
          const all = await tabs.query({});
          const live = new Set(all.map(tab => tab.id));
          for (const id of candidates) if (!live.has(id)) candidates.delete(id);
          for (const tab of all) {
            if (!stopped && tab.id !== sourceId && related(tab) && (!before.has(tab.id) || before.get(tab.id).url !== tab.url)) candidates.add(tab.id);
          }
          const found = all.filter(tab => candidates.has(tab.id));
          if (found.length > 1) return {candidates: found.map(tab => tab.id), ...(workspace ? {created: found.filter(tab => !before.has(tab.id)).map(tab => tab.id)} : {})};
          const child = found[0];
          // Do not attach the old document of a reused named window while its
          // next navigation is still pending. The caller validates its origin.
          if (child && child.url && !['about:blank', 'about:srcdoc', ''].includes(child.url) && (!child.pendingUrl || child.pendingUrl === child.url)) return {tabId: child.id, ...(workspace ? {created: !before.has(child.id)} : {})};
          if (!child && all.find(tab => tab.id === sourceId)?.url !== before.get(sourceId)?.url) return {};
          const expectsPopup = hint.target && !['_self', '_parent', '_top'].includes(hint.target.toLowerCase());
          // A local effect is enough to return fresh evidence, not proof of
          // task completion. Keep event listeners for delayed popups; consume
          // them only at the next host boundary, never mid-action.
          if (!child && !stopped && Date.now() < deadline && (pollOnly || !expectsPopup && changed && await changed())) {
            retain = deferred = true;
            expiry ||= setTimeout(() => close('expired'), Math.max(0, deadline - Date.now()));
            return {deferred: true};
          }
          if (stopped) break;
          await new Promise(resolve => setTimeout(resolve, interval));
        } while (Date.now() < deadline);
        return {candidates: [...candidates], ...(workspace ? {created: [...candidates].filter(id => !before.has(id))} : {})};
      } finally {if (!retain) {deferred = false; close();}}
    },
  };
}
