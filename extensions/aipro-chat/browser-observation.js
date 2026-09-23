import {collectSnapshot} from './generated/browser-dom.js';
export {collectSnapshot, inspectTarget, clickTarget, controlState, pointerPosition, waitForHoverReveal} from './generated/browser-dom.js';

// Only this static function accesses the isolated world's node cache. The
// model supplies an opaque reference, never JavaScript or an injected selector.
function referenceOperation({operation, nonce, ref, marker}) {
  const state = globalThis.__nubiBrowserObservationV1;
  if (!state || state.nonce !== nonce || state.url !== location.href) return {error: 'browser_stale'};
  const attribute = 'data-nubi-action-target';
  const cleanup = token => {
    const item = state.markers.get(token);
    if (!item) return;
    if (item.el.getAttribute(attribute) === token) {
      if (item.previous === null) item.el.removeAttribute(attribute); else item.el.setAttribute(attribute, item.previous);
    }
    state.markers.delete(token);
  };
  if (operation === 'clear') {
    for (const token of state.markers.keys()) cleanup(token);
    delete globalThis.__nubiBrowserObservationV1; return {ok: true};
  }
  if (operation === 'release') {cleanup(marker); return {ok: true};}
  const el = state.refs.get(ref);
  // Visibility/actionability is checked by the shared inspector after binding.
  // A display:contents link legitimately has no rectangle of its own.
  if (!el?.isConnected || el.closest('[hidden],[inert],[aria-hidden="true"]')) return {error: 'browser_stale'};
  if (operation === 'check') return el.getAttribute(attribute) === marker ? {ok: true} : {error: 'browser_stale'};
  if (operation !== 'bind' || !/^[a-f0-9-]{36}$/.test(marker)) return {error: 'browser_stale'};
  state.markers.set(marker, {el, previous: el.getAttribute(attribute)});
  el.setAttribute(attribute, marker);
  return {ok: true};
}
async function referenceCall(entry, operation, marker) {
  const [result] = await chrome.scripting.executeScript({target: {tabId: entry.tabId, documentIds: [entry.documentId]}, world: 'ISOLATED', func: referenceOperation,
    args: [{operation, nonce: entry.nonce, ref: entry.ref, marker}]}).catch(() => {throw new Error('browser_stale');});
  if (!result?.result?.ok) throw new Error('browser_stale');
}
export async function releaseObservedRefs(entries) {
  const documents = new Map();
  for (const entry of entries) {
    const source = entry.contentRef || entry;
    if (source.documentId) documents.set(`${source.tabId}:${source.documentId}:${source.nonce}`, source);
  }
  await Promise.allSettled([...documents.values()].map(source => referenceCall(source, 'clear')));
}
export async function bindObservedRef(task, entry, safeURL) {
  const marker = crypto.randomUUID();
  let handle;
  try {
    await referenceCall(entry, 'bind', marker);
    // Bind the exact observed node only when an actual action requires
    // Playwright. No labels/indices are guessed to reconstruct a stale ref.
    for (const frame of task.page.frames()) {
      if (!safeURL(frame.url()) && !['about:blank', 'about:srcdoc'].includes(frame.url())) continue;
      const locator = frame.locator(`[data-nubi-action-target="${marker}"]`);
      if (await locator.count() !== 1) continue;
      handle = await locator.elementHandle({timeout: 1000});
      await referenceCall(entry, 'check', marker);
      const bound = {handle, frame, descriptor: entry.descriptor, contentRef: entry};
      task.refs.set(entry.ref, bound); return bound;
    }
    throw new Error('browser_stale');
  } catch (error) {await handle?.dispose().catch(() => {}); throw error;}
  finally {await referenceCall(entry, 'release', marker).catch(() => {});}
}

export async function readWithoutDebugger(task, query, safeURL, cancelled, expectedTexts) {
  const metadata = await chrome.scripting.executeScript({target: {tabId: task.tabId, allFrames: true}, world: 'ISOLATED',
    func: () => ({url: location.href, title: document.title, owner: frameElement ? {tag: frameElement.tagName.toLowerCase(), id: frameElement.id, name: frameElement.getAttribute('name'), title: frameElement.getAttribute('title')} : null})});
  const top = metadata.find(item => item.frameId === 0)?.result;
  if (!top || !safeURL(top.url)) throw new Error('page_restricted');
  const frames = [];
  for (const meta of metadata.sort((a, b) => a.frameId - b.frameId).slice(0, 16)) {
    if (cancelled()) throw new Error('cancelled');
    const url = safeURL(meta.result?.url);
    if (!url && !['about:blank', 'about:srcdoc'].includes(meta.result?.url)) continue;
    const frame = frames.length, nonce = crypto.randomUUID();
    try {
      const [record] = await chrome.scripting.executeScript({target: {tabId: task.tabId, documentIds: [meta.documentId]}, world: 'ISOLATED', func: collectSnapshot,
        args: [{query, nonce, expectedURL: meta.result.url, expectedTexts}]});
      if (cancelled()) {
        await referenceCall({tabId: task.tabId, documentId: meta.documentId, nonce}, 'clear').catch(() => {});
        throw new Error('cancelled');
      }
      if (!record?.result || record.result.error) throw new Error('browser_stale');
      const {descriptors, text, textFiltered, textChecks, truncated, regions, headings, retrieval, alerts, omittedControls, pageState, surfaces, tables, tableCoverage, coverage} = record.result;
      task.observedDocuments ||= new Map();
      task.observedDocuments.set(meta.documentId, {tabId: task.tabId, documentId: meta.documentId, nonce});
      for (const descriptor of descriptors) {
        task.refs.set(descriptor.ref, {ref: descriptor.ref, descriptor, tabId: task.tabId, documentId: meta.documentId, nonce});
      }
      frames.push({frame, url: url || safeURL(top.url), ...(meta.result.owner ? {owner: meta.result.owner} : {}), elements: descriptors, text, textFiltered, ...(textChecks ? {textChecks} : {}), truncated, regions, headings, ...(retrieval ? {retrieval} : {}), alerts, omittedControls, pageState, surfaces, tables, tableCoverage, coverage});
    } catch (error) {if (cancelled()) throw new Error('cancelled'); frames.push({frame, url, unavailable: true});}
  }
  if (cancelled()) throw new Error('cancelled');
  return {title: top.title.slice(0, 180), url: safeURL(top.url), frames,
    frameCoverage: {discovered: metadata.length, inspected: frames.filter(frame => !frame.unavailable).length, unavailable: frames.filter(frame => frame.unavailable).length, omitted: Math.max(0, metadata.length-16), excluded: Math.min(16, metadata.length)-frames.length, discovery: 'accessible_documents_only'},
    scope: 'Observed DOM in accessible frames and open shadow roots. Input values and credentials omitted. References belong to this observation only.'};
}
