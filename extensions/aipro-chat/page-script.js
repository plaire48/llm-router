// chrome.scripting waits until the document is idle before it runs a function.
// A page whose own files arrive slowly stays short of that for a long time, and
// the call waits with it, then the tool and the run. Measured: opening such a
// page ended only at the navigation tool's 30-second limit, and a queued read
// behind it waited as long. While the tab is loading, the document is given a
// bounded time to finish parsing and the function then runs at once, on what has
// loaded. A loaded tab is called exactly as before.
export const PARSE_WAIT_MS = 3000;
const SLOW_MEMORY_MS = 10000, slow = new Map();
// A tool that already waited for this page says so, and reads do not wait again.
export function notePageLoading(tabId) {if (Number.isInteger(tabId)) slow.set(tabId, Date.now());}
export async function pageScript(details, {waitMs = PARSE_WAIT_MS, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const tabId = details?.target?.tabId;
  let status;
  try {status = (await chrome.tabs.get(tabId))?.status;} catch { /* The call below reports a missing tab. */ }
  if (status !== 'loading') {slow.delete(tabId); return chrome.scripting.executeScript(details);}
  const probe = {target: details.target.documentIds ? {tabId, documentIds: details.target.documentIds} : {tabId, frameIds: [0]},
    world: 'ISOLATED', injectImmediately: true, func: () => document.readyState};
  const known = slow.get(tabId), deadline = now() + (known !== undefined && now() - known < SLOW_MEMORY_MS ? 0 : waitMs);
  for (;;) {
    let state;
    try {state = (await chrome.scripting.executeScript(probe))[0]?.result;} catch {break;}
    // Only the page's own document clears the memory: a frame that has loaded says nothing about the page.
    if (state !== 'loading') {if (!details.target.documentIds) slow.delete(tabId); break;}
    if (now() >= deadline) {slow.set(tabId, now()); break;}
    await pause(100);
  }
  return chrome.scripting.executeScript({...details, injectImmediately: true});
}
