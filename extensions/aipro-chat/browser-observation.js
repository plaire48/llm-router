import {takeFieldMarks, fieldScope} from './field-marks.js';
import {rankEvidence} from './evidence-search.js';
import {pageScript} from './page-script.js';
import {collectSnapshot} from './generated/browser-dom.js';
export {collectSnapshot, inspectTarget, clickTarget, controlState, valueMark, pointerPosition, pointerCover, pointerBlocker, fieldMarks, prepareHoverReveal, waitForHoverReveal, stateWords} from './generated/browser-dom.js';

// Some pages put a whole configuration document into an iframe's name. The
// attribute identifies the frame; its first characters are enough for that.
export const FRAME_OWNER_LIMIT = 160;
export const frameOwner = owner => owner ? Object.fromEntries(Object.entries(owner).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, FRAME_OWNER_LIMIT) : value])) : owner;

export async function topDocumentId(tabId) {
  try {
    const [record] = await pageScript({target: {tabId, frameIds: [0]}, world: 'ISOLATED', func: () => null});
    return typeof record?.documentId === 'string' && record.documentId ? record.documentId : null;
  } catch {return null;}
}
export async function observedDocumentScope(tabId) {
  try {
    return await pageScript({target: {tabId, allFrames: true}, world: 'ISOLATED',
      func: () => ({url: location.href, owner: frameElement ? {tag: frameElement.tagName.toLowerCase(), id: frameElement.id, name: frameElement.getAttribute('name'), title: frameElement.getAttribute('title')} : null})});
  } catch {return [];}
}

// Only this static function accesses the isolated world's node cache. The
// model supplies an opaque reference, never JavaScript or an injected selector.
function referenceOperation({operation, nonce, ref, marker, relink}) {
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
  let el = state.refs.get(ref), relinked = false;
  // A list that re-renders replaces the observed anchor with an identical one.
  // Follow it only when exactly one connected anchor has the same full address
  // and the same text. Anything else stays stale; nothing is guessed by position.
  if (relink === true && el && !el.isConnected && el.tagName === 'A' && el.hasAttribute('href')) {
    const text = node => (node.textContent || '').replace(/\s+/g, ' ').trim();
    const matches = [...document.querySelectorAll('a[href]')].filter(anchor => anchor.href === el.href && text(anchor) === text(el));
    if (matches.length === 1) {el = matches[0]; state.refs.set(ref, el); relinked = true;}
  }
  // Visibility/actionability is checked by the shared inspector after binding.
  // A display:contents link legitimately has no rectangle of its own.
  if (!el?.isConnected || el.closest('[hidden],[inert],[aria-hidden="true"]')) return {error: 'browser_stale'};
  if (operation === 'check') return el.getAttribute(attribute) === marker ? {ok: true} : {error: 'browser_stale'};
  if (operation !== 'bind' || !/^[a-f0-9-]{36}$/.test(marker)) return {error: 'browser_stale'};
  state.markers.set(marker, {el, previous: el.getAttribute(attribute)});
  el.setAttribute(attribute, marker);
  return {ok: true, ...(relinked ? {relinked} : {})};
}
async function referenceCall(entry, operation, marker, relink = false) {
  const [result] = await pageScript({target: {tabId: entry.tabId, documentIds: [entry.documentId]}, world: 'ISOLATED', func: referenceOperation,
    args: [{operation, nonce: entry.nonce, ref: entry.ref, marker, relink}]}).catch(() => {throw new Error('browser_stale');});
  if (!result?.result?.ok) throw new Error('browser_stale');
  return result.result;
}
export async function releaseObservedRefs(entries) {
  const documents = new Map();
  for (const entry of entries) {
    const source = entry.contentRef || entry;
    if (source.documentId) documents.set(`${source.tabId}:${source.documentId}:${source.nonce}`, source);
  }
  await Promise.allSettled([...documents.values()].map(source => referenceCall(source, 'clear')));
}
export async function bindObservedRef(task, entry, safeURL, {relink = false} = {}) {
  const marker = crypto.randomUUID();
  let handle;
  try {
    const binding = await referenceCall(entry, 'bind', marker, relink);
    // Bind the exact observed node only when an actual action requires
    // Playwright. No labels/indices are guessed to reconstruct a stale ref.
    for (const frame of task.page.frames()) {
      if (!safeURL(frame.url()) && !['about:blank', 'about:srcdoc'].includes(frame.url())) continue;
      const locator = frame.locator(`[data-nubi-action-target="${marker}"]`);
      if (await locator.count() !== 1) continue;
      handle = await locator.elementHandle({timeout: 1000});
      await referenceCall(entry, 'check', marker);
      const bound = {handle, frame, descriptor: entry.descriptor, ...(entry.fieldKey ? {fieldKey: entry.fieldKey} : {}), contentRef: entry, ...(binding.relinked ? {relinked: true} : {})};
      task.refs.set(entry.ref, bound); return bound;
    }
    throw new Error('browser_stale');
  } catch (error) {await handle?.dispose().catch(() => {}); throw error;}
  finally {await referenceCall(entry, 'release', marker).catch(() => {});}
}

// Which of the controls a page returned go to the model. Up to 180 always, as
// before; more while the grouped lines stay within about 12K tokens, up to 400.
// When not all fit: dialog controls, the focused control, then the controls that
// match the user's request (ranked here in the extension; the request is never
// sent into the page), then the rest in page order. Kept in page order, so the
// controls of one row stay together. Measured on a 30-row time sheet: the first
// 180 controls in page order left out the two cells the request named.
const CONTROL_FLOOR = 180, CONTROL_CHARACTERS = 36000;
export const CONTROL_LIMIT = 400;
export const CONTROLS_HINT = 'Not every control was returned. To act on a table row or a field that is not listed, observe again with a query naming its row, column or label; matching controls come first.';
// About the characters a control takes in the grouped lines the model reads: its
// line, and a share of the line naming its row or form.
function controlSize(d) {
  const context = (d.context || []).map(item => `${item.role || ''} ${item.name || ''}`).join(' < ');
  const extra = JSON.stringify({...(d.column ? {column: d.column} : {}), ...(d.description ? {description: d.description} : {}),
    ...(d.options ? {options: d.options} : {}), ...(d.scroll ? {scroll: d.scroll} : {})});
  return 28 + String(d.role || '').length + String(d.name || '').length + (d.destination ? String(d.destination).length + 4 : 0) +
    (extra.length > 2 ? extra.length + 2 : 0) + Math.ceil(context.length / 4);
}
export function selectControls(descriptors, hint) {
  const all = descriptors.map((_, index) => index);
  const sizes = descriptors.map(controlSize), total = sizes.reduce((sum, size) => sum + size, 0);
  if (descriptors.length <= CONTROL_FLOOR || total <= CONTROL_CHARACTERS) return all;
  const dialog = index => descriptors[index].context?.some(item => ['dialog', 'alertdialog'].includes(item.role));
  const hinted = typeof hint === 'string' && hint.trim() ? rankEvidence(descriptors.map((d, id) => ({id, name: `${d.name || ''} ${d.accessibleName || ''}`,
    context: `${(d.context || []).map(c => c.name || '').join(' ')} ${d.column || ''}`, text: `${d.role || ''} ${d.description || ''}`})), hint).map(hit => hit.id) : [];
  const order = [...all.filter(dialog), ...all.filter(index => descriptors[index].focused === true), ...hinted, ...all];
  const picked = new Set();
  let used = 0;
  for (const index of order) {
    if (picked.has(index)) continue;
    if (picked.size >= CONTROL_FLOOR && (used + sizes[index] > CONTROL_CHARACTERS || picked.size >= CONTROL_LIMIT)) break;
    picked.add(index); used += sizes[index];
  }
  return [...picked].sort((a, b) => a - b);
}
export async function readWithoutDebugger(task, query, safeURL, cancelled, expectedTexts) {
  const metadata = await pageScript({target: {tabId: task.tabId, allFrames: true}, world: 'ISOLATED',
    func: () => ({url: location.href, title: document.title, owner: frameElement ? {tag: frameElement.tagName.toLowerCase(), id: frameElement.id, name: frameElement.getAttribute('name'), title: frameElement.getAttribute('title')} : null})});
  const top = metadata.find(item => item.frameId === 0)?.result;
  const topId = metadata.find(item => item.frameId === 0)?.documentId;
  if (!top || !safeURL(top.url)) throw new Error('page_restricted');
  const frames = [];
  for (const meta of metadata.sort((a, b) => a.frameId - b.frameId).slice(0, 16)) {
    if (cancelled()) throw new Error('cancelled');
    const url = safeURL(meta.result?.url);
    if (!url && !['about:blank', 'about:srcdoc'].includes(meta.result?.url)) continue;
    const frame = frames.length, nonce = crypto.randomUUID();
    try {
      const [record] = await pageScript({target: {tabId: task.tabId, documentIds: [meta.documentId]}, world: 'ISOLATED', func: collectSnapshot,
        args: [{query, nonce, expectedURL: meta.result.url, expectedTexts, ...(query ? {} : {limit: CONTROL_LIMIT, ...(task.goalHint ? {hint: task.goalHint} : {})})}]});
      if (cancelled()) {
        await referenceCall({tabId: task.tabId, documentId: meta.documentId, nonce}, 'clear').catch(() => {});
        throw new Error('cancelled');
      }
      if (!record?.result || record.result.error) throw new Error('browser_stale');
      const {descriptors: returned, text, textFiltered, textChecks, truncated: pageTruncated, regions, headings, retrieval, alerts, omittedControls: pageOmitted, pageState, surfaces, tables, tableCoverage, coverage: pageCoverage, page_view, queryUnmatched} = record.result;
      // The page may return up to 400 controls; the budget and the user's request choose among them here.
      const descriptors = query ? returned : selectControls(returned, task.goalHint).map(index => returned[index]);
      const dropped = returned.length - descriptors.length, truncated = pageTruncated || dropped > 0, omittedControls = (pageOmitted || 0) + dropped;
      const coverage = dropped > 0 ? {...pageCoverage, controlsReturned: descriptors.length, controlsHint: CONTROLS_HINT} : pageCoverage;
      task.observedDocuments ||= new Map();
      task.observedDocuments.set(meta.documentId, {tabId: task.tabId, documentId: meta.documentId, nonce});
      const taken = takeFieldMarks(task, fieldScope(meta.result.url, top.url, meta.result.owner), descriptors, {baseline: pageState?.readyState !== 'loading'}), visible = taken.map(item => item.descriptor);
      for (const {descriptor, fieldKey} of taken) {
        task.refs.set(descriptor.ref, {ref: descriptor.ref, descriptor, ...(fieldKey ? {fieldKey} : {}), tabId: task.tabId, documentId: meta.documentId, nonce});
      }
      frames.push({frame, observedAt: new Date().toISOString(), url: url || safeURL(top.url), ...(meta.result.owner ? {owner: frameOwner(meta.result.owner)} : {}), ...(meta.documentId ? {documentId: meta.documentId} : {}), elements: visible, text, textFiltered, ...(textChecks ? {textChecks} : {}), truncated, regions, headings, ...(retrieval ? {retrieval} : {}), alerts, omittedControls, pageState, surfaces, tables, tableCoverage, coverage, ...(page_view ? {page_view} : {}), ...(queryUnmatched ? {queryUnmatched} : {})});
    } catch (error) {if (cancelled()) throw new Error('cancelled'); frames.push({frame, url, unavailable: true});}
  }
  if (cancelled()) throw new Error('cancelled');
  const stillTop = await topDocumentId(task.tabId);
  // Host-only identity for exact URL verification; never emit private query values.
  task.observedURL = top.url;
  return {title: top.title.slice(0, 180), url: safeURL(top.url), tabId: task.tabId,
    ...(topId && stillTop === topId ? {topDocumentId: topId} : {}), frames,
    frameCoverage: {discovered: metadata.length, inspected: frames.filter(frame => !frame.unavailable).length, unavailable: frames.filter(frame => frame.unavailable).length, omitted: Math.max(0, metadata.length-16), excluded: Math.min(16, metadata.length)-frames.length, discovery: 'accessible_documents_only'},
    scope: 'Observed DOM in accessible frames and open shadow roots. Input values and credentials omitted. References belong to this observation only.'};
}
