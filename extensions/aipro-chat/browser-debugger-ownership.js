// Session-scoped ownership survives MV3 worker loss, but expires with Chrome.
// Store before attach: a worker can disappear between attach and its response.
const KEY = 'browserDebuggerOwners';
let pending = Promise.resolve();

export function assertDebuggerAvailable() {
  if (typeof chrome?.debugger?.attach !== 'function' || typeof chrome?.debugger?.sendCommand !== 'function')
    throw Object.assign(new Error('debugger_unavailable'), {phase: 'debugger_attach', actionIssued: false});
}

// Classify only at the host attach/handshake boundary. Never pass raw protocol
// messages (which may include URLs or page data) to the model or saved trace.
export function debuggerConnectionFailure(error, attached = false) {
  if (error?.message === 'cancelled') return error;
  const message = String(error?.message || '');
  const reason = /^debugger_(?:unavailable|conflict|policy_blocked|protocol_unsupported|attach_failed|disconnected)$/.test(message) ? message :
    /Host access is restricted by policy|Screenshot capture is restricted by policy/i.test(message) ? 'debugger_policy_blocked' :
    /Another debugger is already attached|already attached to (?:the |this )?tab/i.test(message) ? 'debugger_conflict' :
    /method.*(?:wasn.t found|not found|not supported)|protocol version.*(?:not supported|unsupported)/i.test(message) ? 'debugger_protocol_unsupported' :
    attached ? 'debugger_disconnected' : 'debugger_attach_failed';
  return Object.assign(new Error(reason), {phase: attached ? 'debugger_handshake' : 'debugger_attach', actionIssued: false});
}
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
