// Session-scoped ownership survives MV3 worker loss, but expires with Chrome.
// Store before attach: a worker can disappear between attach and its response.
const KEY = 'browserDebuggerOwners';
let pending = Promise.resolve();
function serial(action) {
  const next = pending.then(action, action);
  pending = next.catch(() => {});
  return next;
}
export function ownDebugger(requestId, tabId) {
  return serial(async () => {
    const {[KEY]: saved = []} = await chrome.storage.session.get(KEY);
    const owners = saved.filter(item => item.tabId !== tabId);
    owners.push({requestId, tabId});
    await chrome.storage.session.set({[KEY]: owners});
  });
}
export function releaseDebuggers(requestId, tabId) {
  return serial(async () => {
    const {[KEY]: owners = []} = await chrome.storage.session.get(KEY);
    const matches = item => (!requestId || item.requestId === requestId) && (tabId === undefined || item.tabId === tabId);
    for (const owner of owners.filter(matches)) {
      // Chrome resolves this extension's client, not another debugger's session.
      await chrome.debugger.detach({tabId: owner.tabId}).catch(() => {});
    }
    await chrome.storage.session.set({[KEY]: owners.filter(item => !matches(item))});
  });
}
