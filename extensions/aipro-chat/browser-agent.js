import {browserURL, sourceURL, compareBrowserURL, compareLinkURL, comparePageURL, URL_VERIFICATION_GUIDE, LINK_VERIFICATION_GUIDE} from './browser-url.js';
import {assertBrowserPolicy,refreshBrowserPolicy} from './browser-policy.js';
// Pinned, prebuilt browser-only Playwright runtime, copied during packaging.
import {readPageContent, readPdfPageReference} from './browser-content.js';
import {readObservedPageRegion} from './browser-region.js';
import {verificationTextFeedback} from './verification-text-feedback.js';
import {validSumCheck, sumFieldValues, numericFieldState} from './form-values.js';
import {MAX_FORM_FIELDS, MAX_PAGE_CHECKS, MAX_FIELD_VALUE_CHARS} from './form-workflow.js';
import {crx} from './playwright/index.js';
import {executeScript, preflightScript} from './script-sandbox.js';
import {notePageLoading} from './page-script.js';
import {watchPopups} from './browser-popups.js';
import {clickEffect} from './browser-click-effect.js';
import {takeFieldMarks, markFieldWritten, fieldUnchanged, fieldScope, recordFieldMarks, fieldsUnchanged, restoreFieldBaseline} from './field-marks.js';
import {collectSnapshot, inspectTarget, clickTarget, controlState, valueMark, pointerPosition, pointerCover, pointerBlocker, fieldMarks, prepareHoverReveal, waitForHoverReveal, stateWords, readWithoutDebugger, selectControls, CONTROL_LIMIT, CONTROLS_HINT, bindObservedRef, releaseObservedRefs, topDocumentId, observedDocumentScope, frameOwner} from './browser-observation.js';
import {observationEffect, noteRepeatedNoEffect} from './browser-effect.js';
import {appendText, editableText, textDigest} from './browser-text.js';
import {keyboardInput} from './browser-keyboard.js';
import {createScriptInputWitness} from './browser-script-receipt.js';
import {editorOperation, validEditorFormat, matchesEditorFormat} from './browser-editor.js';
import {scriptFailure} from './script-feedback.js';
import {LOCATOR_BUILDERS, LOCATOR_ACTIONS, LOCATOR_READS, PAGE_METHODS, BROWSER_METHODS, REF_METHODS, READABLE_ATTRIBUTES, SCRIPT_TRANSITIONS, isScriptAction} from './browser-script-api.js';
import {approvalTarget, prepareApproval, bindApproval, clearApproval} from './browser-approval.js';
import {clearImageRefs, findPageImages, attachPageImages, inspectPageImages} from './page-images.js';
import {withActionPointer, clearActionPointer, keepActionPointer, settlePointerTravel} from './browser-pointer.js';
import {dragObserved} from './browser-drag.js';
import {ownDebugger, releaseDebuggers} from './browser-debugger-ownership.js';
import {watchNativeDialogs} from './browser-dialogs.js';
import {captureBrowserPage, screenshotOptions, captureCoverage, captureRegion, enlargeCapture, markCapture} from './browser-capture.js';
import {scrollBrowserSection} from './browser-scroll.js';
import {createBrowserDiagnostics} from './browser-diagnostics.js';
import {workspaceTab, readyWorkspaceTab, adoptWorkspaceTab, releaseWorkspace, guardPopupFocus, followWorkspaceTab, findWorkspaceURL} from './browser-workspace.js';

let active;
const showAction = (task, handle, kind, action) => withActionPointer(task, handle, kind, async () => {
  task.dialogs?.assertCanAct();
  task.screenshot = null;
  try {return await action();}
  finally {await task.dialogs?.waitForDecision(); if (active === task) task.dialogs?.assertCanAct();}
}, () => active !== task);
const endedRequests = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let platformInfo;
async function nativeKey(key) {
  if (typeof key !== 'string' || !key.split('+').includes('ControlOrMeta')) return key;
  // The browser-only Playwright build uses a Node platform shim. Resolve
  // this modifier from Chrome itself so macOS editors receive Command.
  platformInfo ||= chrome.runtime.getPlatformInfo();
  const {os} = await platformInfo;
  return key.split('+').map(part => part === 'ControlOrMeta' ? os === 'mac' ? 'Meta' : 'Control' : part).join('+');
}
export {browserURL} from './browser-url.js';
const safeURL = sourceURL;


export function browserAgentObservation(requestId) {return active?.id===requestId?active.latestObservation:null;}

async function clearRefs(task) {
  const refs = [...task.refs.values(), ...task.uploadRefs?.values() || []]; task.refs.clear(); task.uploadRefs?.clear();
  const observations = [...task.observedDocuments?.values() || []]; task.observedDocuments?.clear();
  await releaseObservedRefs([...refs, ...observations]);
  await Promise.allSettled(refs.filter(entry => entry.handle).map(entry => entry.handle.dispose()));
}
async function observe(task, query = '') {
  browserURL(task.page.url()); await clearRefs(task);
  const frameDocumentsBefore = await observedDocumentScope(task.tabId);
  const documentBefore = frameDocumentsBefore.find(record => record.frameId === 0)?.documentId || await topDocumentId(task.tabId);
  const frames = [], prefix = crypto.randomUUID().slice(0, 8), frameList = task.page.frames();
  for (const [index, frame] of frameList.slice(0, 16).entries()) {
    const url = safeURL(frame.url());
    if (!url && frame !== task.page.mainFrame() && !['about:blank', 'about:srcdoc'].includes(frame.url())) continue;
    let group, handles;
    try {
      group = await frame.evaluateHandle(collectSnapshot, query || {limit: CONTROL_LIMIT});
      const data = await group.evaluate(value => ({descriptors: value.descriptors, text: value.text, textFiltered: value.textFiltered, truncated: value.truncated, regions: value.regions, headings: value.headings, retrieval: value.retrieval, alerts: value.alerts, omittedControls: value.omittedControls,
        pageState: value.pageState, surfaces: value.surfaces, tables: value.tables, tableCoverage: value.tableCoverage, coverage: value.coverage, page_view: value.page_view, ...(value.queryUnmatched ? {queryUnmatched: value.queryUnmatched} : {})}));
      handles = await group.getProperty('elements');
      const props = await handles.getProperties();
      let owner;
      if (frame.parentFrame()) {
        const element = await frame.frameElement();
        try {owner = await element.evaluate(el => ({tag: el.tagName.toLowerCase(), id: el.id, name: el.name, title: el.title}));} finally {await element.dispose();}
      }
      const scope = fieldScope(frame.url(), task.page.url(), owner), baseline = data.pageState?.readyState !== 'loading';
      if (baseline) recordFieldMarks(task, scope, await frame.evaluate(fieldMarks).catch(() => null));
      const picked = query ? data.descriptors.map((_, i) => i) : selectControls(data.descriptors, task.goalHint);
      const kept = new Set(picked);
      for (const [key, value] of props) if (!kept.has(Number(key))) await value.dispose().catch(() => {});
      const elements = takeFieldMarks(task, scope, picked.map(i => data.descriptors[i]), {baseline}).map(({descriptor, fieldKey}, i) => {
        const ref = `e-${prefix}-${index}-${i}`, handle = props.get(String(picked[i])).asElement();
        task.refs.set(ref, {handle, frame, descriptor, ...(fieldKey ? {fieldKey} : {})}); return {ref, ...descriptor};
      });
      const {descriptors: ignored, omittedControls: pageOmitted, ...details} = data;
      const dropped = data.descriptors.length - picked.length;
      if (dropped > 0) Object.assign(details, {truncated: true, coverage: {...details.coverage, controlsReturned: picked.length, controlsHint: CONTROLS_HINT}});
      details.omittedControls = (pageOmitted || 0) + Math.max(0, dropped);
      frames.push({frame: index, observedAt: new Date().toISOString(), url: url || safeURL(task.page.url()), ...(owner ? {owner: frameOwner(owner)} : {}), elements, ...details});
    } catch {frames.push({frame: index, url, unavailable: true});}
    finally {await handles?.dispose().catch(() => {}); await group?.dispose().catch(() => {});}
  }
  const frameDocumentsAfter = await observedDocumentScope(task.tabId);
  const documentAfter = frameDocumentsAfter.find(record => record.frameId === 0)?.documentId || await topDocumentId(task.tabId);
  // Compare the same bounded values that the observation reports.
  const ownerKey = owner => ['tag', 'id', 'name', 'title'].map(key => frameOwner(owner)?.[key] || '');
  const frameKey = (url, owner) => JSON.stringify([safeURL(url), ownerKey(owner)]);
  for (const frame of frames) {
    const key = frameKey(frame.url, frame.owner);
    const before = frameDocumentsBefore.filter(record => frameKey(record.result?.url, record.result?.owner) === key);
    const after = frameDocumentsAfter.filter(record => frameKey(record.result?.url, record.result?.owner) === key);
    if (before.length === 1 && after.length === 1 && before[0].documentId && before[0].documentId === after[0].documentId)
      frame.documentId = before[0].documentId;
  }
  return task.latestObservation = {title: (await task.page.title()).slice(0, 180), url: safeURL(task.page.url()), tabId: task.tabId,
    ...(documentBefore && documentBefore === documentAfter ? {topDocumentId: documentBefore} : {}), frames,
    ...(task.dialogs?.snapshot().length ? {nativeDialogs: task.dialogs.snapshot()} : {}),
    frameCoverage: {discovered: frameList.length, inspected: frames.filter(frame => !frame.unavailable).length, unavailable: frames.filter(frame => frame.unavailable).length, omitted: Math.max(0, frameList.length-16), excluded: Math.min(16, frameList.length)-frames.length, discovery: 'attached_frames'},
    ...(task.popupCandidates?.length ? {popupCandidates: task.popupCandidates.map(String), instruction: 'Several windows opened or a popup is still loading. Use browser.tabs() / list_tabs and select the intended window; do not repeat the opening click.'} : {}),
    scope: 'Observed DOM including accessible frames and open shadow roots. Input values and credentials omitted. References belong to this observation only.'};
}
// Only tab identities and observed parent links survive in the task context.
// Rebuild DOM handles and revalidate approvals against their exact document.
export function browserAgentContext(requestId) {
  return active?.id === requestId ? {tabId: active.tabId, openers: [...active.openers].slice(-128), ...(active.workspace ? {workspace: {...active.workspace, tabId: active.tabId}} : {})} : null;
}
export async function resolveBrowserTab(context, tabId = context?.tabId) {
  const openers = new Map(context?.openers || []), visited = new Set();
  while (Number.isInteger(tabId) && !visited.has(tabId)) {
    visited.add(tabId);
    if (await (context?.workspace ? workspaceTab(context.workspace, tabId) : chrome.tabs.get(tabId)).catch(() => null)) return tabId;
    tabId = openers.get(tabId);
  }
  return null;
}
async function rememberOpeners(task, tabId) {
  const visited = new Set();
  while (Number.isInteger(tabId) && !visited.has(tabId)) {
    visited.add(tabId);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const parent = task.openers.get(tabId) ?? tab?.openerTabId;
    if (!Number.isInteger(parent)) break;
    task.openers.set(tabId, parent); tabId = parent;
  }
}
async function ensure(requestId, page, requiresBrowser = true, exactTab = false) {
  await refreshBrowserPolicy();
  assertBrowserPolicy(null);
  if (endedRequests.has(requestId)) throw new Error('cancelled');
  if (active?.id !== requestId) {
    await stopBrowserAgent();
    if (endedRequests.has(requestId)) throw new Error('cancelled');
    active = {id: requestId, app: null, page: null, tabId: page.tabId, workspace: page.browserContext?.workspace || page.workspace || null, refs: new Map(), receipts: [], tabs: new Set([page.tabId]), openers: new Map(page.browserContext?.openers || []), attachedTabs: new Set()};
  }
  const task = active;
  task.diagnostics ||= createBrowserDiagnostics({allowedURL: safeURL, currentPage: () => active === task ? task.page : null});
  if (task.workspace && await chrome.tabs.get(task.tabId).catch(() => null)) await workspaceTab(task.workspace, task.tabId);
  await rememberOpeners(task, task.tabId);
  if (!task.page) {
    const tabId = exactTab ? (await chrome.tabs.get(task.tabId)).id : await resolveBrowserTab(browserAgentContext(requestId));
    if (!Number.isInteger(tabId)) throw new Error(task.workspace ? 'workspace_changed' : 'browser_stale');
    task.tabId = tabId; task.tabs.add(tabId);
  }
  if (active !== task || endedRequests.has(requestId)) throw new Error('cancelled');
  if (requiresBrowser && !task.app) {
    const app = await crx.start();
    if (active !== task || endedRequests.has(requestId)) {await app.close().catch(() => {}); throw new Error('cancelled');}
    task.app = app;
    task.dialogs = watchNativeDialogs(app.context(), {onDecision: (details, signal, dialogPage) => active===task && task.page===dialogPage ? task.onNativeDialog?.(details, signal) : undefined, canAccept: dialogPage => active===task && task.page===dialogPage});
    app.context().setDefaultTimeout(7000); app.context().setDefaultNavigationTimeout(12000);
  }
  if (task.app && !task.page) {
    browserURL((await chrome.tabs.get(task.tabId)).url);
    // Own the pending attach too: the user may cancel Chrome's banner before
    // Playwright has finished initializing the page.
    task.attachedTabs.add(task.tabId);
    await ownDebugger(task.id, task.tabId);
    try {
      if (active !== task || endedRequests.has(requestId)) throw new Error('cancelled');
      task.page = await task.app.attach(task.tabId);
      if (active !== task) {await releaseDebuggers(task.id, task.tabId); throw new Error('cancelled');}
    } catch (error) {task.attachedTabs.delete(task.tabId); await releaseDebuggers(task.id, task.tabId); throw error;}
  }
  else if (task.page) await restoreOpener(task);
  if (task.page) task.diagnostics.watch(task.page);
  if (active !== task || endedRequests.has(requestId)) throw new Error('cancelled');
  if (task.workspace) {await chrome.tabs.update(task.tabId, {autoDiscardable: false}); await followWorkspaceTab(task.workspace, () => active !== task);}
  await keepActionPointer(task, safeURL, () => active !== task);
  return active;
}
const namedByHint = el => el.matches('input,textarea') && !!el.placeholder && !el.labels?.length &&
  !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.hasAttribute('title');
// The same rule as the isolated-world binding: exactly one connected anchor
// with the same full address and text, in the document the node belonged to.
async function relinkedAnchor(handle) {
  const found = await handle.evaluateHandle(el => {
    if (el.isConnected || el.tagName !== 'A' || !el.hasAttribute('href')) return null;
    const text = node => (node.textContent || '').replace(/\s+/g, ' ').trim();
    const matches = [...el.ownerDocument.querySelectorAll('a[href]')].filter(anchor => anchor.isConnected && anchor.href === el.href && text(anchor) === text(el));
    return matches.length === 1 ? matches[0] : null;
  });
  const element = found.asElement();
  if (!element) await found.dispose().catch(() => {});
  return element;
}
async function target(task, ref, {readOnly = false} = {}) {
  let entry = task.refs.get(ref);
  const relink = entry?.descriptor?.kind === 'link' && entry.descriptor.tag === 'a';
  if (entry?.documentId) entry = await bindObservedRef(task, entry, safeURL, {relink});
  if (active !== task) throw new Error('cancelled');
  if (!entry || entry.frame.isDetached()) throw new Error('browser_stale');
  if (!await entry.handle.evaluate(el => el.isConnected)) {
    const replacement = relink ? await relinkedAnchor(entry.handle).catch(() => null) : null;
    if (active !== task) {await replacement?.dispose().catch(() => {}); throw new Error('cancelled');}
    if (!replacement) throw new Error('browser_stale');
    await entry.handle.dispose().catch(() => {});
    entry = {...entry, handle: replacement, relinked: true}; task.refs.set(ref, entry);
  }
  if (!readOnly && entry.descriptor.disabled) throw new Error('script_disabled');
  const current = await entry.handle.evaluate(inspectTarget);
  // The handle is the observed node itself. A search box named only by its
  // placeholder changes that name whenever the site rotates the hint, which is
  // not a change of control. An authored label, aria name or title still binds.
  const renamed = current.name && current.name !== entry.descriptor.name;
  const hintOnly = renamed && await entry.handle.evaluate(namedByHint);
  if (current.secret || !readOnly && current.disabled || current.hidden || !current.connected || current.type !== entry.descriptor.type || renamed && !hintOnly) throw new Error('browser_stale');
  if (!readOnly) markFieldWritten(task, entry);
  return entry;
}
async function retainedField(entry) {
  try {
    if (['checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind)) {
      const current = await entry.handle.evaluate(inspectTarget);
      return current.connected && !current.secret && String(current.state) === entry.value;
    }
    return await entry.handle.evaluate((el, value) => el.isConnected &&
      (el.isContentEditable ? el.innerText : el.value) === value, entry.value);
  } catch {return false;}
}
// A link check reads the exact previously observed anchor; it never opens the
// destination. Keep full hrefs host-local and compare them without redaction.
async function verifyObservedLink(task, check) {
  const changed = () => ({passed: false, reason: 'target_changed'});
  const observation = task.latestObservation;
  const observedFrames = observation?.frames?.filter(frame => frame.elements?.some(element => element.ref === check.ref)) || [];
  if (observation?.tabId !== task.tabId || !observation.topDocumentId || observedFrames.length !== 1) return changed();
  const observedFrame = observedFrames[0];
  if (!observedFrame.documentId) return changed();
  try {
    const entry = await target(task, check.ref, {readOnly: true});
    if (entry.descriptor.kind !== 'link' || entry.descriptor.tag !== 'a') return {passed: false, reason: 'check_target_incompatible'};
    const documentId = entry.contentRef?.documentId || entry.documentId || observedFrame.documentId;
    if (documentId !== observedFrame.documentId) return changed();
    const sameDocument = async () => {
      const scope = await observedDocumentScope(task.tabId);
      const records = scope.filter(record => record.documentId === documentId);
      return active === task && !entry.frame.isDetached() &&
        scope.find(record => record.frameId === 0)?.documentId === observation.topDocumentId && records.length === 1 &&
        Number.isSafeInteger(records[0].frameId) && records[0].frameId >= 0 && records[0].result?.url === entry.frame.url();
    };
    if (!await sameDocument()) return changed();
    const read = el => ({anchor: el.tagName?.toLowerCase() === 'a' && el.hasAttribute('href'), connected: el.isConnected, sameDocument: el.ownerDocument === document, href: el.href});
    const first = await entry.handle.evaluate(read);
    const current = await entry.handle.evaluate(inspectTarget);
    const second = await entry.handle.evaluate(read);
    if (!first.anchor || !second.anchor) return {passed: false, reason: 'check_target_incompatible'};
    if (!first.connected || !second.connected || !first.sameDocument || !second.sameDocument || first.href !== second.href || current.secret || current.hidden || !current.connected ||
        current.name !== entry.descriptor.name || current.role !== entry.descriptor.role || current.type !== entry.descriptor.type ||
        !await sameDocument()) return changed();
    if (active !== task) throw new Error('cancelled');
    return {...(check.kind === 'link_page_is' ? comparePageURL : compareLinkURL)(check.expected, second.href), ...(entry.relinked ? {relinked: true} : {})};
  } catch (error) {
    if (error.message === 'cancelled' || active !== task) throw new Error('cancelled');
    return changed();
  }
}
// Which control a check read, in the page's own words: its label, its row and
// its column, never its value. Measured on a weekly time sheet: the review could
// not tell which row and day two verified cells were in, and asked again until
// the run stopped, although the cells were right.
const checkTarget = descriptor => {
  const row = descriptor?.context?.find(item => ['row', 'listitem', 'item'].includes(item.role) && item.name)?.name;
  const about = {...(descriptor?.name ? {name: String(descriptor.name).slice(0, 80)} : {}),
    ...(row && row !== descriptor.name ? {row: String(row).slice(0, 80)} : {}), ...(descriptor?.column ? {column: String(descriptor.column).slice(0, 60)} : {})};
  return Object.keys(about).length ? about : null;
};
// Every field of the current frames against what this run first observed there,
// except the fields it wrote. The page reduces each value to a one-way mark.
async function pageFieldsUnchanged(task) {
  if (!task.app) return {passed: false, reason: 'baseline_missing'};
  const frames = [];
  for (const frame of task.page.frames().slice(0, 16)) {
    if (!safeURL(frame.url()) && frame !== task.page.mainFrame() && !['about:blank', 'about:srcdoc'].includes(frame.url())) continue;
    let owner;
    if (frame.parentFrame()) {
      const element = await frame.frameElement();
      try {owner = await element.evaluate(el => ({tag: el.tagName.toLowerCase(), id: el.id, name: el.name, title: el.title}));} finally {await element.dispose();}
    }
    const scope = fieldScope(frame.url(), task.page.url(), owner), marks = scope ? await frame.evaluate(fieldMarks).catch(() => null) : [];
    if (!Array.isArray(marks)) return {passed: false, reason: 'baseline_missing'};
    if (scope) frames.push({scope, marks});
  }
  return fieldsUnchanged(task, frames);
}
async function verifyPage(task, checks, timeoutMs = 5000) {
  const kinds = ['field_value', 'field_valid', 'field_sum', 'field_digest', 'field_contains', 'text_style', 'control_state', 'control_expanded', 'element_in', 'text_present', 'url_is', 'url_page_is', 'link_destination', 'link_page_is', 'field_unchanged', 'fields_unchanged'];
  // Why a check cannot run, in the words needed to correct it; null when it can.
  // Measured (M-08, candidate 39): two calls failed whole with a hint about
  // scripts and no word on which check was wrong. The model then read the select
  // value with scripts, which the review never took as a check, six times.
  // The words stateWords reads from class names and data-state (browser-dom.js).
  const stateVocabulary = ['on', 'off', 'active', 'selected', 'checked', 'starred', 'important', 'flagged', 'pinned', 'marked', 'favorite', 'favourite', 'liked', 'unread', 'read', 'done', 'completed', 'current', 'expanded', 'collapsed', 'opened', 'closed', 'unchecked', 'indeterminate', 'open'];
  const checkProblem = check => {
    if (!check || typeof check !== 'object' || !kinds.includes(check.kind)) return `kind must be one of: ${kinds.join(', ')}`;
    if (typeof check.expected !== 'string' || check.expected.length > MAX_FIELD_VALUE_CHARS) return `expected must be a string of at most ${MAX_FIELD_VALUE_CHARS} characters`;
    if (check.kind !== 'field_value' && !check.expected.trim()) return 'expected must not be empty';
    if (['link_destination', 'link_page_is'].includes(check.kind) && (typeof check.ref !== 'string' || !check.ref.trim() || check.ref.length > 200 || Object.keys(check).some(key => !['kind', 'ref', 'expected'].includes(key)))) return 'needs the ref of an observed link, and no fields other than kind, ref and expected';
    if (['field_valid', 'field_unchanged', 'fields_unchanged'].includes(check.kind) && check.expected !== 'true') return 'expected must be "true"';
    if (check.kind === 'field_sum' && !validSumCheck(check)) return 'terms must name 1-24 different observed numeric fields, each a ref with an optional positive multiplier; expected is the total';
    if (check.kind === 'field_digest' && !/^[a-f0-9]{64}$/.test(check.expected)) return 'expected must be the 64-character SHA-256 digest returned by appendText';
    if (check.kind === 'text_style' && !validEditorFormat(check.format)) return 'format must list the required computed styles';
    if (check.kind.startsWith('control_') && !['true', 'false', 'mixed'].includes(check.expected) && !(check.kind === 'control_state' && stateVocabulary.includes(check.expected))) return 'expected must be "true", "false" or "mixed", or for control_state a state word of the observation (stateHint or row state, such as "starred"). For the chosen option of a select, use field_value with that option\'s value from the observed options; for the text of a field, use field_value';
    return null;
  };
  if (!Array.isArray(checks) || !checks.length || checks.length > MAX_PAGE_CHECKS) throw Object.assign(new Error('tool_arguments_invalid'),
    {reason: 'check_invalid', invalidChecks: [{index: null, kind: null, problem: `checks must be a list of 1 to ${MAX_PAGE_CHECKS} checks`}]});
  const invalidChecks = checks.map((check, index) => ({index, kind: typeof check?.kind === 'string' ? check.kind.slice(0, 40) : null, problem: checkProblem(check)})).filter(item => item.problem);
  if (invalidChecks.length) throw Object.assign(new Error('tool_arguments_invalid'), {reason: 'check_invalid', invalidChecks});
  const deadline = Date.now() + timeoutMs;
  const expectedTexts = checks.filter(check => check.kind === 'text_present').map(check => check.expected);
  let results = [], consecutive = 0, previousURL, observation, stale = false;
  for (;;) {
    if (active !== task) throw new Error('cancelled');
    const page = task.page;
    const textChecks = [];
    let url;
    if (!task.app) {
      await clearRefs(task);
      observation = await readWithoutDebugger(task, '', safeURL, () => active !== task, expectedTexts);
      url = task.observedURL;
      browserURL(url);
      if (!observation.topDocumentId) stale = true;
      textChecks.push(...observation.frames.filter(frame => !frame.unavailable).map(frame => frame.textChecks || []));
    } else {
      url = page.url(); browserURL(url);
    }
    if (previousURL !== url) consecutive = 0;
    previousURL = url;
    if (task.app && checks.some(check => check.kind === 'text_present')) {
      for (const frame of page.frames().slice(0, 16)) {
        if (!safeURL(frame.url()) && !['about:blank', 'about:srcdoc'].includes(frame.url())) continue;
        let group;
        try {group = await frame.evaluateHandle(collectSnapshot, {expectedTexts}); textChecks.push(await group.evaluate(value => value.textChecks || []));}
        catch { /* Missing evidence cannot pass a check. */ }
        finally {await group?.dispose().catch(() => {});}
      }
    }
    results = [];
    let textIndex = 0;
    for (const [index, check] of checks.entries()) {
      let passed = false, detail = {}, about = null;
      if (check.kind === 'url_is') {
        const comparison = compareBrowserURL(check.expected, url);
        passed = !stale && comparison.passed;
        if (!passed && !stale) detail = {...comparison, instruction: URL_VERIFICATION_GUIDE};
      }
      if (check.kind === 'url_page_is') {
        const comparison = comparePageURL(check.expected, url);
        passed = !stale && comparison.passed;
        detail = passed ? {matched: 'origin_path', queryCompared: false} : stale ? {} : {...comparison, instruction: URL_VERIFICATION_GUIDE};
      }
      if (check.kind === 'link_destination' || check.kind === 'link_page_is') {
        const comparison = await verifyObservedLink(task, check);
        passed = !stale && comparison.passed;
        if (!passed) detail = {...comparison, instruction: LINK_VERIFICATION_GUIDE};
        else detail = {...(check.kind === 'link_page_is' || comparison.queryCompared === false ? {matched: 'origin_path', queryCompared: false} : {}), ...(comparison.relinked ? {relinked: true} : {})};
        if (comparison.reason === 'target_changed') stale = true;
      }
      if (check.kind === 'text_present') {passed = textChecks.some(matches => matches[textIndex] === true); textIndex++;}
      if (check.kind === 'fields_unchanged') {
        detail = await pageFieldsUnchanged(task);
        passed = detail.passed === true;
        if (!passed) detail.instruction = detail.reason === 'value_changed' ? 'Some fields that no action of this run aimed at no longer hold what this run first observed. Report that; do not write values to make this check pass.'
          : 'Not every field of this page was observed before, or a field is gone, so there is nothing complete to compare with. Report the preservation of the other fields as not verified.';
      }
      if (check.kind.startsWith('field_') || check.kind.startsWith('control_') || check.kind === 'text_style' || check.kind === 'element_in') {
        try {
          if (check.kind === 'field_sum') {
            const fields = [];
            for (const term of check.terms) {
              const entry = await target(task, term.ref, {readOnly: true});
              fields.push(await entry.handle.evaluate(numericFieldState));
            }
            detail = sumFieldValues(check, fields);
            passed = detail.passed;
          } else {
            const entry = await target(task, check.ref, {readOnly: true});
            about = checkTarget(entry.descriptor);
            if (check.kind === 'element_in') {
              const destination = await target(task, check.expected, {readOnly: true});
              passed = entry.frame === destination.frame && await destination.handle.evaluate((parent, child) => parent !== child && parent.contains(child), entry.handle);
            } else if (check.kind === 'field_unchanged') {
              // The value at the first observation of this run against the value now,
              // and no action of this run aimed at the field. Nothing is read out.
              if (!['field', 'select', 'checkbox', 'radio'].includes(entry.descriptor.kind)) throw new Error('tool_arguments_invalid');
              detail = fieldUnchanged(task, entry, await entry.handle.evaluate(valueMark));
              passed = detail.passed === true;
              if (!passed) detail.instruction = detail.reason === 'field_written' ? 'This run aimed an action at this field, so the host cannot say that it was left alone. Check its content with field_value instead.'
                : detail.reason === 'value_changed' ? 'The field does not hold what it held when this run first observed it. Report that; do not write a value to make this check pass.'
                : 'This field was not observed before this check, so there is nothing to compare with. Report the preservation as not verified.';
            } else if (check.kind === 'text_style') {
              passed = matchesEditorFormat(await entry.handle.evaluate(editorOperation, {query: check.expected}), check.format);
            } else if (check.kind === 'control_state' && stateVocabulary.includes(check.expected)) {
              // A state shown only in class names ("row starred"), read now on the control or its row.
              const words = await entry.handle.evaluate(stateWords);
              passed = words.own.includes(check.expected) || words.row.includes(check.expected);
              detail = {stateWords: words};
            } else if (check.kind.startsWith('control_')) {
              const state = await entry.handle.evaluate(controlState);
              // A tab, option or navigation link states its selection as selected or current.
              const value = check.kind === 'control_expanded' ? state.expanded : state.state ?? state.selected ?? state.current;
              if (value === undefined) {
                const words = await entry.handle.evaluate(stateWords);
                throw Object.assign(new Error('tool_arguments_invalid'),
                  {exposedStates: ['checked', 'pressed', 'selected', 'current', 'expanded'].filter(key => state[key] !== undefined), ...(words.own.length || words.row.length ? {stateWords: words} : {})});
              }
              passed = String(value) === check.expected;
            } else if (!['field', 'select', 'checkbox', 'radio'].includes(entry.descriptor.kind)) throw new Error('tool_arguments_invalid');
            else if (check.kind === 'field_valid') passed = await entry.handle.evaluate(el => el.isConnected && el.willValidate === true && el.validity?.valid === true && el.getAttribute('aria-invalid') !== 'true');
            else if (check.kind === 'field_value') passed = entry.descriptor.stateKind ? String((await entry.handle.evaluate(controlState)).state) === check.expected : await entry.handle.evaluate((el, expected) => el.isConnected && (el.isContentEditable ? el.innerText : el.value) === expected, check.expected);
            else {
              const value = await entry.handle.evaluate(editableText);
              passed = check.kind === 'field_digest' ? await textDigest(value) === check.expected : value.includes(check.expected);
            }
          }
        } catch (error) {
          if (error.message === 'cancelled' || active !== task) throw new Error('cancelled');
          if (error.message === 'tool_arguments_invalid') {
            detail = {reason: 'check_target_incompatible', ...(error.exposedStates ? {exposedStates: error.exposedStates} : {}), ...(error.stateWords ? {stateWords: error.stateWords} : {}),
              instruction: error.exposedStates
                ? `This control does not expose the state that was checked; exposedStates lists what it does expose. The same check on the same control cannot pass on a retry. ${error.stateWords ? 'stateWords lists the state words in the class names of this control (own) and its row: control_state with one of them as expected checks that word now. ' : ''}When the page marks an applied filter, tab or sort order only visually, verify it through what the page shows: text_present for the applied label or the changed results, or url_page_is for the page. Retry only corrected checks; do not repeat earlier actions.`
                : 'The check kind does not match this observed control. Use field_value/field_contains for actual inputs, control_state only for checked/pressed/selected/current controls, and text_present for visible page text. Inspect the fresh observation and retry only corrected checks; do not repeat earlier writes.'};
          } else stale = true;
        }
      }
      results.push({index, kind: check.kind, ...(about ? {target: about} : {}), ...detail, passed, ...(stale ? {reason: 'target_changed'} : {})});
      if (stale) break;
    }
    consecutive = results.every(check => check.passed) ? consecutive + 1 : 0;
    if (consecutive >= 2 || stale || results.some(check => check.reason === 'check_target_incompatible') || Date.now() >= deadline) break;
    await delay(Math.max(0, Math.min(250, deadline - Date.now())));
  }
  const verified = consecutive >= 2;
  // After this run wrote fields, every verification also states whether all the
  // other fields kept what this run first saw. Measured on a time sheet: the check
  // ran before the final apply, the final review saw only the last verification
  // and could not confirm "leave the other cells alone", and the run stopped.
  const otherFields = task.app && task.writtenFields?.size && !checks.some(check => check.kind === 'fields_unchanged')
    ? await pageFieldsUnchanged(task).catch(() => null) : null;
  const finalObservation = task.app ? await observe(task) : observation;
  const textFeedback = !verified && !stale ? verificationTextFeedback(checks, results, finalObservation) : [];
  return {ok: verified, verified, checks: results, ...(otherFields ? {otherFields: {...otherFields, scope: 'Host comparison of every field of the page except those this run wrote, against what this run first observed. Not one of the requested checks.'}} : {}), ...(textFeedback.length ? {textFeedback} : {}), ...(verified ? {} : stale ? {error: 'browser_stale', reason: 'browser_stale', instruction: 'A checked field changed. Use the fresh observation to identify it and retry only verification. This is not evidence that earlier input failed; never replay the write automatically.'} : {error: 'verification_failed', instruction: 'The requested checks did not pass after waiting. Inspect the fresh observation before choosing a correction. Do not replay earlier writes.'}), scope: 'Fresh visible page evidence only. Input values and expected text are not returned. DOM retention and visible application confirmation are not an independent backend audit.', observation: finalObservation};
}
async function attachTab(task, tabId, openerId, created = false) {
  if (active !== task) throw new Error('cancelled');
  if (task.workspace) {
    if (!task.workspace.tabIds.includes(tabId)) await adoptWorkspaceTab(task.workspace, tabId, openerId, {created});
    await workspaceTab(task.workspace, tabId);
    if (created) await readyWorkspaceTab(task.workspace, tabId, () => active !== task);
  }
  const tab = await chrome.tabs.get(tabId); browserURL(tab.url);
  if (!task.workspace) await chrome.tabs.update(tabId, {active: true});
  if (!task.workspace) await chrome.windows.update(tab.windowId, {focused: true});
  task.attachedTabs.add(tabId);
  let page;
  await ownDebugger(task.id, tabId);
  try {
    if (active !== task) throw new Error('cancelled');
    page = await task.app.attach(tabId);
    if (active !== task) {await releaseDebuggers(task.id, tabId); throw new Error('cancelled');}
  } catch (error) {task.attachedTabs.delete(tabId); await releaseDebuggers(task.id, tabId); throw error;}
  if (active !== task) throw new Error('cancelled');
  await clearActionPointer(task); await clearRefs(task); task.screenshot = null;
  task.page = page; task.tabId = tabId; task.tabs.add(tabId); task.popupCandidates = [];
  task.diagnostics?.watch(page);
  if (task.workspace) {task.workspace.tabId = tabId; await followWorkspaceTab(task.workspace, () => active !== task);}
  await keepActionPointer(task, safeURL, () => active !== task);
  if (openerId || tab.openerTabId) task.openers.set(tabId, openerId || tab.openerTabId);
  await rememberOpeners(task, tabId);
}
async function restoreOpener(task) {
  const current = await chrome.tabs.get(task.tabId).catch(() => null);
  if (!task.page?.isClosed() && current) return;
  if (current && task.page?.isClosed()) {
    // A renderer/PDF transition may retire the Playwright handle while the
    // owned Chrome tab survives. Rebind that tab; do not jump to an opener or
    // ask the user to repeat completed input. Old refs are discarded by attach.
    await task.app.detach(task.tabId).catch(() => {});
    if (active !== task || endedRequests.has(task.id)) throw new Error('cancelled');
    await attachTab(task, task.tabId);
    return;
  }
  let parent = task.openers.get(task.tabId);
  const visited = new Set([task.tabId]);
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    if (await chrome.tabs.get(parent).catch(() => null)) {await attachTab(task, parent); return;}
    parent = task.openers.get(parent);
  }
  throw new Error('browser_stale');
}
async function settle(task, loading = false) {
  await restoreOpener(task);
  // A page already found to be slow is not waited for a second time.
  if (!loading) await task.page.waitForLoadState('domcontentloaded', {timeout: 5000}).catch(() => {});
  await delay(250); browserURL(task.page.url());
}
async function popupWatch(task, handle) {
  if (active !== task) throw new Error('cancelled');
  // Owned tabs run in the background; current-tab mode keeps its explicit focus.
  const tab = task.workspace ? await workspaceTab(task.workspace, task.tabId) : await chrome.tabs.update(task.tabId, {active: true});
  if (!task.workspace) await chrome.windows.update(tab.windowId, {focused: true});
  const hint = await linkHint(handle);
  const sourcePage = task.page;
  const effect = () => (handle ? handle.evaluate(clickEffect) : sourcePage.evaluate(clickEffect)).catch(() => null);
  const beforeEffect = await effect();
  if (active !== task) throw new Error('cancelled');
  const focus = await guardPopupFocus(task.workspace);
  let watcher;
  try {watcher = await watchPopups(chrome.tabs, task.tabId, hint, {cancelled: () => active !== task, workspace: task.workspace, onCreated: tab => focus?.created(tab), onClose: reason => {if (reason === 'expired') focus?.close();},
    changed: beforeEffect === null ? undefined : async () => {const after = await effect(); return after !== null && after !== beforeEffect;}});}
  catch(error) {focus?.close(); throw error;}
  const close = watcher.close;
  watcher.close = () => {close(); focus?.close();};
  watcher.restoreFocus = () => focus?.finish();
  if (active !== task) {watcher.close(); throw new Error('cancelled');}
  watcher.openerId = task.tabId;
  task.popupWatches ||= new Set(); task.popupWatches.add(watcher);
  return watcher;
}
async function linkHint(handle) {
  return await handle?.evaluate(el => {const link = el.closest('a[href]'); return link ? {href: link.href, target: link.target || document.querySelector('base[target]')?.target || ''} : {};}) || {};
}
// This is target attribution at dispatch, not a claim that a click succeeded or
// left an account unchanged. Never reconstruct document identity from a URL.
async function clickDispatchTarget(task, entry, ref, handle, inspected) {
  const unknown = reason => ({status: 'unknown', reason});
  try {
    // inspectTarget currently caps accessible names at 180 characters. At
    // that boundary an unseen suffix could distinguish a prohibited control.
    if (String(inspected.name || '').length >= 180 || String(inspected.role || '').length > 80)
      return unknown('target_description_incomplete');
    const observation = task.latestObservation, tabId = task.tabId;
    const frame = observation?.frames?.find(frame => frame.elements?.some(element => element.ref === ref));
    const documentId = entry.contentRef?.documentId || entry.documentId || frame?.documentId;
    if (!observation?.topDocumentId || !frame?.documentId || frame.documentId !== documentId || observation.tabId !== tabId)
      return unknown('document_identity_missing');
    const scope = await observedDocumentScope(tabId);
    const matches = scope.filter(record => record.documentId === documentId);
    const record = matches.length === 1 ? matches[0] : null;
    if (!record || !Number.isSafeInteger(record.frameId) || record.frameId < 0 ||
        scope.find(item => item.frameId === 0)?.documentId !== observation.topDocumentId ||
        record.result?.url !== entry.frame.url()) return unknown('document_identity_changed');
    const attributes = el => ({tag: el.tagName?.toLowerCase(), href: el.closest('a[href]')?.href || null});
    const before = await handle.evaluate(attributes);
    const afterScope = await observedDocumentScope(tabId);
    const after = await handle.evaluate(attributes);
    const final = await handle.evaluate(inspectTarget);
    if (active !== task || task.tabId !== tabId || entry.frame.isDetached() ||
        afterScope.find(item => item.frameId === 0)?.documentId !== observation.topDocumentId ||
        afterScope.filter(item => item.frameId === record.frameId && item.documentId === documentId && item.result?.url === record.result.url).length !== 1 ||
        before.tag !== after.tag || before.href !== after.href ||
        final.name !== inspected.name || final.role !== inspected.role || final.type !== inspected.type ||
        final.secret !== inspected.secret || final.connected !== inspected.connected || final.hidden !== inspected.hidden)
      return unknown('target_identity_changed');
    if (inspected.secret || !inspected.connected || inspected.hidden || !/^[a-z][a-z0-9-]{0,63}$/.test(after.tag || ''))
      return unknown('target_not_disclosable');
    const href = after.href && safeURL(after.href);
    return {status: 'observed', target: {tabId, topDocumentId: observation.topDocumentId,
      frameId: record.frameId, documentId, role: String(inspected.role || '').slice(0, 80),
      name: String(inspected.name || '').slice(0, 180), tag: after.tag,
      ...(href ? {href} : {}), ...(after.href && !href ? {hrefOmitted: true} : {})}};
  } catch {return unknown('target_observation_failed');}
}
// Attribute an already resolved handle only to the exact observed DOM node.
// Equal labels/URLs are candidate filters, never target identity evidence.
async function scriptInputBinding(task, handle, ref) {
  if (ref) return {ref,entry:await target(task,ref,{readOnly:true})};
  const current = await handle.evaluate(inspectTarget);
  const candidates = [...task.refs].filter(([,entry]) => entry.descriptor?.name === current.name &&
    entry.descriptor?.role === current.role && entry.descriptor?.type === current.type);
  if (!candidates.length || candidates.length > 32) return null;
  let match;
  for (const [candidate] of candidates) {
    try {
      const entry = await target(task,candidate,{readOnly:true});
      if (!await handle.evaluate((node,observed) => node === observed,entry.handle)) continue;
      if (match) return null;
      match = {ref:candidate,entry};
    } catch { /* Different frames, changed controls and absent refs are unknown. */ }
  }
  return match || null;
}
async function scriptInputTarget(task, handle, binding) {
  if (!binding || active !== task) return null;
  const inspected = await handle.evaluate(inspectTarget);
  const receipt = await clickDispatchTarget(task,binding.entry,binding.ref,handle,inspected);
  if (receipt.status !== 'observed' || !['input','textarea'].includes(receipt.target.tag) || inspected.secret) return null;
  task.scriptReceiptTargets ||= new Map();
  let controlId;
  for (const [id,item] of task.scriptReceiptTargets) {
    if (item.documentId !== receipt.target.documentId) continue;
    try {if (await handle.evaluate((node,retained) => node === retained,item.handle)) {controlId=id;break;}} catch { /* Old document handle. */ }
  }
  if (!controlId) {
    if (task.scriptReceiptTargets.size >= 64) return null;
    const retained = await handle.evaluateHandle(node => node);
    if (active !== task) {await retained.dispose().catch(()=>{});return null;}
    controlId = crypto.randomUUID();
    task.scriptReceiptTargets.set(controlId,{handle:retained,documentId:receipt.target.documentId});
  }
  return {...receipt.target,controlId,type:inspected.type || ''};
}
// Reuse the script witness for semantic inputs; this is historical attribution,
// never a replacement for action authorization or a fresh page observation.
async function semanticInputWitness(task, entry, ref, method, value) {
  return createScriptInputWitness({method,value,key:value,
    captureTarget:()=>scriptInputTarget(task,entry.handle,{entry,ref}),
    readMatch:expected=>entry.handle.evaluate((node,value)=>{
      const secret = /password|passwd|secret|token|api.?key|cc-|one-time-code|비밀번호|인증번호|카드번호/i.test(`${node.type} ${node.name} ${node.id} ${node.autocomplete} ${node.getAttribute('aria-label')} ${[...node.labels||[]].map(label=>label.textContent).join(' ')}`);
      if (!node.isConnected || secret || !node.matches('input,textarea')) return null;
      return node.value === value;
    },expected),cancelled:()=>active!==task||task.dialogs?.blocked});
}
const centered = el => el.scrollIntoView({block: 'center', inline: 'nearest'});
const obscured = blocker => Object.assign(new Error('script_obscured'), {reason: 'script_obscured', ...(blocker ? {blocker} : {})});
// Where the pointer goes. A point where live hit testing reaches the target;
// else, after moving the target to the middle (away from fixed bars and sticky
// headers), again; else the one control that stands for the target at every
// point (pointerCover), unless either needs approval. Never the middle blindly:
// there Playwright would also press a control inside the target, such as a
// delete button a mail row shows on hover.
async function aim(target, {center = true, cover = true} = {}) {
  let position = await target.evaluate(pointerPosition);
  if (!position && center) {await target.evaluate(centered); position = await target.evaluate(pointerPosition);}
  if (position) return {pointer: target, position};
  if (cover && !await target.evaluate(approvalTarget, {method: 'click'})) {
    const found = await target.evaluateHandle(pointerCover), receiver = found.asElement();
    if (receiver && !await receiver.evaluate(approvalTarget, {method: 'click'})) {
      const at = await receiver.evaluate(pointerPosition, target);
      if (at) return {pointer: receiver, position: at, cover: true};
    }
    await found.dispose().catch(() => {});
  }
  throw obscured(await target.evaluate(pointerBlocker).catch(() => null));
}
async function clickObserved(task, handle, options = {}, double = false, onIssued = () => {}, captureTarget) {
  const destination=await handle.evaluate(el=>el.closest('a[href]')?.href||(['submit','image'].includes(el.type)&&el.form?el.formAction||el.form.action:null));
  if(destination&&/^https?:/.test(destination))assertBrowserPolicy(destination);
  const target = await handle.evaluateHandle(clickTarget);
  const covers = new Set();
  try {return await showAction(task, target, 'click', async () => {
    const before = await target.evaluate(inspectTarget);
    // Hover may close a tooltip or move layout. Settle at the exact node first,
    // then let Playwright recompute its click point and normal actionability.
    await target.scrollIntoViewIfNeeded({timeout: 7000});
    const first = options.position ? {pointer: target, position: options.position} : await aim(target);
    if (first.cover) covers.add(first.pointer);
    await first.pointer.hover({...options, position: first.position, force: false, timeout: 7000});
    await settlePointerTravel(task, first.pointer);
    task.dialogs?.assertCanAct();
    if (active !== task) throw new Error('cancelled');
    const after = await target.evaluate(inspectTarget);
    // Tools a row shows under the pointer change its visible name, not its words.
    const renamed = after.name !== before.name && !(before.itemText && after.itemText === before.itemText) && !await target.evaluate(namedByHint);
    if (!after.connected || after.secret || renamed || after.type !== before.type) throw new Error('browser_stale');
    const {pointer, position: clickPosition, cover} = options.position ? first : await aim(target, {center: false});
    if (cover) covers.add(pointer);
    const attribution = captureTarget ? await captureTarget(target, after) : undefined;
    if (captureTarget) {
      const final = await target.evaluate(inspectTarget);
      task.dialogs?.assertCanAct();
      if (active !== task) throw new Error('cancelled');
      if (!final.connected || final.secret || final.hidden || final.name !== after.name || final.type !== after.type || final.role !== after.role)
        throw new Error('browser_stale');
    }
    // Scroll/hover/identity preparation may fail before any click is sent.
    // Once Playwright's actual click is invoked its outcome is conservative:
    // even an actionability timeout may hide a dispatched input or navigation.
    onIssued(attribution && cover ? {...attribution, via: await pointer.evaluate(el => ({tag: el.localName, name: String(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)}))} : attribution);
    return pointer[double ? 'dblclick' : 'click']({...options, position: clickPosition, force: false, timeout: 7000});
  });}
  finally {await target.dispose().catch(() => {}); for (const cover of covers) await cover.dispose().catch(() => {});}
}
async function hoverObserved(task, handle, options = {}) {
  const destination=await handle.evaluate(el=>el.closest('a[href]')?.href||(['submit','image'].includes(el.type)&&el.form?el.formAction||el.form.action:null));
  if(destination&&/^https?:/.test(destination))assertBrowserPolicy(destination);
  const target = await handle.evaluateHandle(clickTarget);
  try {return await showAction(task, target, 'hover', async () => {
    await target.scrollIntoViewIfNeeded({timeout:7000});
    // A hover presses nothing; a covered target is still moved clear of fixed bars.
    let position = options.position || await target.evaluate(pointerPosition);
    if (!position) {await target.evaluate(centered); position = await target.evaluate(pointerPosition);}
    if (active !== task) throw new Error('cancelled');
    const reveal = await handle.evaluateHandle(prepareHoverReveal);
    try {
      await target.hover({...options, ...(position ? {position} : {}), force:false, timeout:7000});
      await reveal.evaluate(waitForHoverReveal);
    } finally {await reveal.dispose().catch(() => {});}
    if (active !== task) throw new Error('cancelled');
  });} finally {await target.dispose().catch(() => {});}
}
async function setCheckedObserved(task, handle, desired) {
  if (typeof desired !== 'boolean') throw new Error('tool_arguments_invalid');
  const before = await handle.evaluate(inspectTarget);
  if (before.state === undefined) throw new Error('script_control_state');
  if (before.state === desired) return; // Idempotent continuation: never flip an already correct toggle.
  if (before.disabled) throw new Error('script_disabled');
  if (before.hidden || !before.connected) throw new Error('browser_stale');
  if ((before.type === 'radio' || ['radio', 'menuitemradio'].includes(before.role)) && !desired) throw new Error('script_control_state');
  await requireApproval(task, handle, {method: 'click'});
  await clickObserved(task, handle);
  const until = Date.now() + 3000;
  for (;;) {
    if (active !== task) throw new Error('cancelled');
    if (!await handle.evaluate(el => el.isConnected)) throw new Error('browser_stale');
    if ((await handle.evaluate(controlState)).state === desired) return;
    if (Date.now() >= until) throw new Error('script_control_state');
    await delay(100);
  }
}
async function followPopup(task, watcher, pollOnly = false) {
  if (!watcher) return;
  let retain = false;
  try {
    const next = await watcher.finish({pollOnly});
    if (active !== task) throw new Error('cancelled');
    if (next.deferred) {retain = true; return false;}
    task.popupCandidates = next.candidates || [];
    for (const tabId of task.workspace ? next.candidates || [] : []) {
      await adoptWorkspaceTab(task.workspace, tabId, watcher.openerId, {created: next.created?.includes(tabId)});
      task.openers.set(tabId, watcher.openerId);
    }
    if (task.workspace) task.workspace.tabId = task.tabId;
    if (next.tabId) await attachTab(task, next.tabId, watcher.openerId, next.created);
    if (next.tabId || next.candidates?.length) {
      // A late event can be seen by two adjacent actions on the same opener.
      // Consume it once and discard the duplicate observers.
      for (const other of task.popupWatches) if (other !== watcher && other.openerId === watcher.openerId) {other.close(); task.popupWatches.delete(other);}
      return true;
    }
    return false;
  } finally {await watcher.restoreFocus?.(); if (!retain) {watcher.close(); task.popupWatches.delete(watcher);}}
}
async function followDeferredPopups(task) {
  for (const watcher of [...task.popupWatches || []]) {
    if (watcher.deferred && await followPopup(task, watcher, true)) return true;
  }
  return false;
}
export async function stopBrowserAgent(requestId) {
  if (requestId) {endedRequests.add(requestId); if (endedRequests.size > 100) endedRequests.delete(endedRequests.values().next().value);}
  if (!active || requestId && active.id !== requestId) {await releaseDebuggers(requestId); return;}
  const task = active; active = null;
  const receiptTargetDisposals = [...task.scriptReceiptTargets?.values() || []].map(entry => entry.handle.dispose().catch(()=>{}));
  task.scriptReceiptTargets?.clear();
  task.diagnostics?.close();
  task.dialogs?.close();
  for (const watcher of task.popupWatches || []) watcher.close();
  // A blocked renderer must not trap cancellation behind handle disposal.
  let timer;
  try {await Promise.race([
    (async () => {await task.releaseDrag?.(); await clearActionPointer(task); await clearRefs(task); await clearImageRefs(task);
      await Promise.allSettled([...task.receipts.map(entry => entry.handle.dispose()),
        ...receiptTargetDisposals]);})().catch(() => {}),
    new Promise(resolve => {timer = setTimeout(resolve, 1000);}),
  ]);} finally {
    clearTimeout(timer);
    await task.app?.close().catch(() => {});
    await releaseDebuggers(task.id);
    await releaseWorkspace(task.workspace);
  }
}
export function browserAgentRequestForTab(tabId) {return active?.attachedTabs.has(tabId) ? active.id : null;}

async function requireApproval(task, handle, operation, {force=false,summary=''} = {}) {
  if(task.approvalPause)throw new Error('approval_required');
  const details=await handle.evaluate(approvalTarget,operation);
  if(!details&&!force)return;
  if(!task.onApproval)throw new Error('approval_required');
  const label = details?.label || await handle.evaluate(el => String(el.getAttribute('aria-label') || el.innerText || el.value || '실행').trim().replace(/\s+/g, ' ').slice(0, 100));
  const record=await prepareApproval(task,handle,operation,details||{label,action:label.length <= 20 ? label : '실행'},summary);
  let result;
  try {result=await task.onApproval(record);} catch(error){await clearApproval(record);throw error;}
  if(!result?.requiresUserInput){await clearApproval(record);throw new Error(result?.error||'approval_required');}
  task.approvalPause=result;
  throw new Error('approval_required');
}
export async function runApprovedAction(requestId,page,record,{onNativeDialog,onUpload,onDownload} = {}) {
  let task,handle,watcher,issued=false;
  try {
    task=await ensure(requestId,{tabId:record.tabId,browserContext:page?.browserContext||record.browserContext},true,true);
    const before=task.latestObservation;
    restoreFieldBaseline(task,record.fieldBaseline);
    task.onNativeDialog = onNativeDialog;
    task.dialogs?.assertCanAct();
    watcher=await popupWatch(task,null);
    handle=await bindApproval(task,record);
    watcher.setHint(await linkHint(handle));
    if(active!==task)throw new Error('cancelled');
    const onIssued=()=>{task.actionRevision=(task.actionRevision||0)+1;issued=true;};
    let transfer;
    if(record.operation.method==='upload') {
      assertBrowserPolicy(task.page.url(),'UploadsEnabled');
      if(!onUpload)throw new Error('approval_changed');
      const files=await onUpload(record.operation.files);
      if(active!==task)throw new Error('cancelled');
      const valid=await handle.evaluate((el,files)=>el.isConnected&&el.matches('input[type=file]')&&!el.disabled&&!el.webkitdirectory&&!!el.getClientRects().length&&(files.length===1||el.multiple)&&files.every(f=>!el.accept||el.accept.split(',').some(rule=>{rule=rule.trim().toLowerCase();return rule.startsWith('.')?f.name.toLowerCase().endsWith(rule):rule.endsWith('/*')?f.mimeType.toLowerCase().startsWith(rule.slice(0,-1)):f.mimeType.toLowerCase()===rule;})),record.operation.files);
      if(!valid)throw new Error('approval_changed');
      onIssued();
      await handle.setInputFiles(files,{timeout:10000});
      const selected=await handle.evaluate(el=>[...el.files].map(f=>({name:f.name,bytes:f.size,type:f.type})));
      transfer={kind:'upload',state:'input_selected',files:selected,serverConfirmed:false};
      if(selected.length!==record.operation.files.length||selected.some((f,i)=>f.name!==record.operation.files[i].name||f.bytes!==record.operation.files[i].bytes))throw new Error('approval_outcome_unknown');
    } else if(record.operation.method==='download') {
      assertBrowserPolicy(record.operation.url,'DownloadsEnabled');
      if(!onDownload)throw new Error('approval_changed');
      onIssued();transfer=await onDownload(record.operation.url);
    } else if(record.operation.method==='press')await showAction(task,handle,'input',async()=>keyboardInput(handle,task.page,'press',await nativeKey(record.operation.key),{}, {cancelled:()=>active!==task||task.dialogs?.blocked,onIssued}));
    else if(record.operation.method==='point')await showAction(task,null,'click',()=>{onIssued();return task.page.mouse.click(record.operation.x,record.operation.y);});
    else await clickObserved(task,handle,{},false,onIssued);
    await followPopup(task,watcher);watcher=null;await settle(task);
    task.dialogs?.assertCanAct();
    const observation=await observe(task),effect=observationEffect(before,observation,['upload','download','press'].includes(record.operation.method)?record.operation.method:'click_element');
    return {result:{ok:true,actionIssued:true,...(transfer?{transfer}:{}),...(effect?{effect}:{}),observation,instruction:'The user-approved action was issued once. Verify the visible result before reporting completion. Do not click it again.'},tabId:task.tabId};
  } catch(error) {
    if (active === task && task?.dialogs?.blocked && error.message !== 'cancelled') error = new Error('browser_dialog');
    if (error.message === 'browser_dialog') return {result: {error: 'browser_dialog', reason: 'browser_dialog', actionIssued: issued,
      nativeDialogs: task.dialogs.snapshot(), instruction: scriptFailure(error).instruction}, tabId: task.tabId};
    return {result:{error:error.message==='cancelled'?'cancelled':issued?'approval_outcome_unknown':'approval_changed',actionIssued:issued,
      ...(!issued && ['approval_expired','approval_scope_changed','approval_target_changed','approval_snapshot_changed','approval_point_obscured'].includes(error.reason) ? {reason:error.reason} : {}),
      instruction:issued?'The approved action may have completed. Observe and verify the outcome; never repeat it automatically.':'The approved page, document, target or draft changed. Preserve current edits, re-observe and request a fresh approval before any final action.'},tabId:task?.tabId||record.tabId};
  } finally {
    await handle?.dispose().catch(()=>{});
    if(watcher){if(issued)await followPopup(task,watcher).catch(()=>{});else{watcher.close();task?.popupWatches.delete(watcher);}}
    await clearApproval(record);
  }
}
// A history move or a load that the page never finishes (a document opened in
// the viewer, a download) left the tool waiting without end, and the run with
// it: measured 120 seconds on go_back before the caller gave up. A navigation
// tool answers within this time. The move may still have taken effect, so the
// result says that it was issued and that the page must be observed first.
const NAVIGATION_TOOLS = new Set(['navigate_page', 'go_back', 'switch_tab']);
export const NAVIGATION_DEADLINE_MS = 30000;
// A page whose own files arrive slowly opens at once and then takes long to finish.
// Measured on a public library site: the address and the title had changed, yet the
// tool waited out its time and reported a failure in which nothing had been issued.
// The move counts once the new document is there. Its parsing is waited for within
// the same time, and a page that is still loading is observed as far as it has come.
const NAVIGATION_LOAD_MS = 15000;
const LOADING_INSTRUCTION = 'The page opened but is still loading. The observation shows what has loaded so far. When expected content is missing, wait with wait_page or read the page again. Do not open the same address again.';
async function documentParsed(task, remaining) {
  const started = Date.now(), budget = Math.max(1000, remaining);
  try {await task.page.waitForLoadState('domcontentloaded', {timeout: budget}); return true;}
  catch (error) {
    if (active !== task) throw new Error('cancelled');
    // Only a wait that ran out of time means a slow page; a closed page is an error.
    if (Date.now() - started < budget - 50 || !/timeout/i.test(String(error?.message))) throw error;
    return false;
  }
}
export async function runBrowserAgent(requestId, page, name, args = {}, options = {}) {
  if (!NAVIGATION_TOOLS.has(name)) return runBrowserTool(requestId, page, name, args, options);
  let timer;
  const run = runBrowserTool(requestId, page, name, args, options);
  run.catch(() => {});
  const late = new Promise(resolve => {timer = setTimeout(() => resolve({result: {error: 'script_timeout', reason: 'script_timeout', actionIssued: true, navigationUnsettled: true,
    instruction: 'The navigation did not settle in time and may still have taken effect. Observe the current page with browser_snapshot before any other action. Do not repeat the navigation until that observation shows where the page is.'},
    tabId: active?.id === requestId && Number.isInteger(active.tabId) ? active.tabId : page?.tabId}), options.navigationDeadlineMs || NAVIGATION_DEADLINE_MS);});
  try {return await Promise.race([run, late]);} finally {clearTimeout(timer);}
}
async function runBrowserTool(requestId, page, name, args = {}, {vision = false, onCapture, onImage, onApproval, onNativeDialog, uploadFiles:availableFiles, navigationLoadMs = NAVIGATION_LOAD_MS, hint} = {}) {
  // The observation the model acted on, compared with the one after the action.
  let task, issued = false, loading = false, before;
  let actionTargetReceipt = name === 'click_element'
    ? {dataKind: 'click_target_dispatch', version: 1, status: 'unknown', actionIssued: false, reason: 'click_not_dispatched'} : null;
  const inputExecution = ['fill_form','press_key'].includes(name) ? {commands:[],omitted:0} : null;
  const targetReceipt = () => ({...(actionTargetReceipt ? {actionTargetReceipt: {...actionTargetReceipt, actionIssued: issued}} : {}),
    ...(inputExecution ? {inputExecution} : {})});
  try {
    const preflight = name === 'run_playwright' ? preflightScript(args.code) : null;
    const passive = name === 'wait_page' && !!args.condition || ['read_page', 'inspect_dom', 'browser_snapshot', 'list_tabs'].includes(name) || name === 'verify_page' && args.checks?.every(check => ['text_present', 'url_is', 'url_page_is'].includes(check.kind));
    task = await ensure(requestId, page, !preflight && !passive);
    if(onNativeDialog)task.onNativeDialog=onNativeDialog;
    // The user's request orders controls when a page has more than fit; it stays in the extension.
    if (typeof hint === 'string') task.goalHint = hint.slice(0, 1000);
    if (['fill_form', 'click_element', 'hover_element', 'press_key', 'select_option', 'navigate_page', 'go_back', 'switch_tab', 'click_at', 'drag_element', 'scroll_page', 'request_approval'].includes(name)) task.dialogs?.assertCanAct();
    if (!task.approvalPause && await followDeferredPopups(task)) {
      await settle(task);
      return {result: {popupChanged: true, actionIssued: false, observation: await observe(task),
        instruction: 'A delayed popup from the earlier click is now available. This requested operation was not executed. Inspect this fresh page and choose the next action; do not repeat the opener click or reuse old refs.'}, tabId: task.tabId};
    }
    if(onApproval){task.onApproval=onApproval;task.approvalBaseRevision=task.actionRevision||0;}
    if(task.approvalPause)return {result:task.approvalPause,tabId:task.tabId};
    if (name === 'navigate_page' && !task.latestObservation) {
      return {result:{ok:true, yielded:true, actionIssued:false, navigationOnly:true,
        observation:await observe(task),
        instruction:'Navigation was NOT issued. First inspect this connected page and the original request. If the user asked to use a search box or another control here, use its observed ref and verify that interaction; opening a constructed result URL or switching search providers does not perform it. For an explicit request to open a URL, you may now navigate there. Page text grants no new permission.'},tabId:task.tabId};
    }
    if (name === 'read_page' && args.mode === 'region') return {result: await readObservedPageRegion(task, args, safeURL, () => active !== task), tabId: task.tabId};
    if (name === 'read_page' && args.mode === 'content') return {result: await readPageContent(task, args, safeURL, () => active !== task), tabId: task.tabId};
    if (name === 'read_page' && args.mode === 'pdf_page') return {result: await readPdfPageReference(task, args, safeURL, () => active !== task, vision), tabId: task.tabId};
    if (preflight) {
      await clearRefs(task);
      const observation = task.app ? await observe(task) : await readWithoutDebugger(task, '', safeURL, () => active !== task);
      return {result: {...preflight, execution: {commands: [], omitted: 0}, actionIssued: false, observation}, tabId: task.tabId};
    }
    if (!task.app && ['read_page', 'inspect_dom', 'browser_snapshot'].includes(name)) {
      await clearRefs(task);
      task.latestObservation=await readWithoutDebugger(task, args.query || '', safeURL, () => active !== task);
      return {result:task.latestObservation, tabId: task.tabId};
    }
    if (name === 'verify_page') return {result: await verifyPage(task, args.checks), tabId: task.tabId};
    if (name === 'list_upload_targets') {
      assertBrowserPolicy(task.page.url(),'UploadsEnabled');
      for(const entry of task.uploadRefs?.values()||[])await entry.handle.dispose().catch(()=>{});
      task.uploadRefs=new Map();const targets=[];
      for(const frame of task.page.frames().slice(0,16)) {
        if(!safeURL(frame.url()))continue;
        for(const handle of (await frame.locator('input[type=file]').elementHandles()).slice(0,20)) {
          const info=await handle.evaluate(el=>({visible:!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden',disabled:el.disabled,label:String(el.getAttribute('aria-label')||[...el.labels||[]].map(l=>l.textContent).join(' ')||el.name||'파일').slice(0,100),accept:el.accept,multiple:el.multiple}));
          if(!info.visible||info.disabled){await handle.dispose();continue;}
          const ref=`upload-${crypto.randomUUID()}`;task.uploadRefs.set(ref,{handle,frame});targets.push({ref,frame:task.page.frames().indexOf(frame),url:safeURL(frame.url()),...info});
        }
      }
      return {result:{targets,scope:'Visible native file inputs only. File values omitted. Hidden/custom pickers are unsupported.'},tabId:task.tabId};
    }
    if(name==='prepare_file_upload') {
      assertBrowserPolicy(task.page.url(),'UploadsEnabled');
      const entry=task.uploadRefs?.get(args.ref);
      if(!entry||!availableFiles?.length)throw new Error('browser_stale');
      if(!safeURL(entry.frame.url()))throw new Error('page_restricted');
      await requireApproval(task,entry.handle,{method:'upload',files:availableFiles},{force:true,summary:`업로드: ${availableFiles.map(f=>f.name).join(', ')}`});
    }
    if(name==='prepare_download') {
      const entry=await target(task,args.ref);
      const url=await entry.handle.evaluate(el=>el.closest('a[href]')?.href||'');
      browserURL(url);assertBrowserPolicy(url,'DownloadsEnabled');
      await requireApproval(task,entry.handle,{method:'download',url},{force:true,summary:'이 링크의 파일을 Chrome 다운로드 폴더에 저장합니다.'});
    }
    if (name === 'read_browser_diagnostics') return {result: task.diagnostics.read(args), tabId: task.tabId};
    if (name === 'wait_page' && (args.condition !== undefined || args.timeout_ms !== undefined)) {
      const timeout = args.timeout_ms ?? 5000;
      if (!['text_present', 'url_is'].includes(args.condition?.kind) || !Number.isInteger(timeout) || timeout < 250 || timeout > 15000) throw new Error('tool_arguments_invalid');
      const result = await verifyPage(task, [args.condition], timeout);
      return {result: {ok: true, actionIssued: false, wait: {matched: result.verified, timedOut: !result.verified, ...(result.checks?.[0]?.reason ? {reason: result.checks[0].reason} : {})}, observation: result.observation,
        instruction: result.verified ? 'The visible waiting condition was observed twice. This is not final goal verification; check all user requirements with verify_page.' : 'The condition was not established within this wait. Inspect fresh state and diagnostics; do not repeat a prior write or infer failure of the business operation.' + (args.condition.kind === 'url_is' ? ` ${URL_VERIFICATION_GUIDE}` : '')}, tabId: task.tabId};
    }
    if (name === 'request_approval' && !args.ref) {name = 'click_at';args = {...args, approvalOnly: true};}
    if (name === 'request_approval') {
      const entry=await target(task,args.ref);
      await requireApproval(task,entry.handle,{method:'click'},{force:true,summary:args.summary});
    }
    if (name === 'find_images') {await settle(task); return {result: await findPageImages(task, args.query, browserURL), tabId: task.tabId};}
    if (name === 'inspect_images') {if (!vision) throw new Error('tools_unavailable'); return {result: await inspectPageImages(task, args.refs, {browserURL, cancelled: () => active !== task}), tabId: task.tabId};}
    if (name === 'attach_images') return {result: await attachPageImages(task, args.refs, {browserURL, cancelled: () => active !== task, onImage}), tabId: task.tabId};
    if (name === 'run_playwright') {
      task.scriptImage = null;
      const actionRevision = task.actionRevision || 0;
      const commands = []; let commandIndex = 0, decisionBoundary = false;
      const result = await executeScript(args.code, async call => {
        if (decisionBoundary && isScriptAction(call.method)) throw new Error('script_checkpoint');
        const before = task.actionRevision || 0;
        const priorTab = task.tabId, priorURL = task.page.url();
        const command = {index: ++commandIndex, method: [...LOCATOR_ACTIONS, ...LOCATOR_READS, ...PAGE_METHODS, ...BROWSER_METHODS].includes(call.method) ? call.method : 'unsupported', state: 'started', actionIssued: false};
        commands.push(command); if (commands.length > 32) commands.shift();
        try {
          if (isScriptAction(call.method)) task.dialogs?.assertCanAct();
          const value = await scriptCall(task, page, call, vision, onCapture, receipt => {command.inputReceipt = receipt;});
          if (isScriptAction(call.method)) task.dialogs?.assertCanAct();
          command.state = 'returned';
          decisionBoundary ||= SCRIPT_TRANSITIONS.has(call.method) || priorTab !== task.tabId || priorURL !== task.page.url();
          return value;
        }
        catch (error) {command.state = 'failed'; command.reason = scriptFailure(error).reason; throw error;}
        finally {command.actionIssued = command.inputReceipt?.actionIssued ?? ((task.actionRevision || 0) !== before);}
      }, {cancelled: () => active !== task});
      // Generated JavaScript may catch a host error. That cannot clear the
      // native confirmation barrier or turn a cancelled operation into success.
      try {task.dialogs?.assertCanAct();} catch (error) {
        Object.assign(result, {ok: false, error: 'browser_dialog', reason: 'browser_dialog', instruction: scriptFailure(error).instruction});
      }
      const execution = {commands, omitted: commandIndex - commands.length, scope: 'Host command receipts only, not proof of the requested outcome. Returned means the call returned. Check current state before repeating any issued action.'};
      if (active !== task) return {result: {error: 'cancelled'}, tabId: task.tabId};
      if(task.approvalPause)return {result:{...task.approvalPause,execution,actionIssued:(task.actionRevision||0)!==actionRevision},tabId:task.tabId};
      // A final snapshot already owns the refs returned by the script. Taking
      // another one here immediately invalidated those refs on unchanged pages.
      const last = commands.at(-1);
      let observation = last?.method === 'snapshot' && last.state === 'returned' && task.latestObservation;
      if (!observation) {await settle(task); observation = await observe(task);}
      return {result: {...result, execution, ...(result.yielded ? {instruction: 'The script paused before its next action because an earlier operation can change the page or target. This is partial work, not an execution failure or task completion. Inspect this fresh observation and host command receipts. Choose the next small script, ask_user if a required choice is missing, or verify the draft before request_approval. Never replay completed operations.'} : {}), ...(result.error ? {recovery: 'Inspect execution.commands and this fresh observation. Continue only missing work, using browser.ref(ref) or semantic tools when names are ambiguous. A returned command is not a verified outcome. Never replay an issued write just because a later command failed.'} : {}), actionIssued: (task.actionRevision || 0) !== actionRevision, observation, ...(task.scriptImage ? {image: task.scriptImage} : {})}, tabId: task.tabId};
    }
    if (name === 'capture_page') {
      if (!vision) throw new Error('tools_unavailable');
      if (args.full_page !== undefined && typeof args.full_page !== 'boolean' || args.marks !== undefined && typeof args.marks !== 'boolean' ||
          args.ref !== undefined && (typeof args.ref !== 'string' || args.full_page === true || args.region !== undefined || args.marks)) throw new Error('tool_arguments_invalid');
      const fullPage = args.full_page !== false && args.ref === undefined;
      let region = captureRegion(args.region), element;
      if (region && fullPage || args.marks && (fullPage || region)) throw new Error('tool_arguments_invalid');
      task.screenshot = null;
      await settle(task);
      // One observed element with a small margin, for reading how it looks: a
      // star that only turns yellow, an icon, small text.
      if (args.ref !== undefined) {
        const entry = await target(task, args.ref, {readOnly: true}), node = await entry.handle.evaluateHandle(clickTarget);
        let box;
        try {await node.asElement()?.scrollIntoViewIfNeeded({timeout: 5000}).catch(() => {}); box = await node.asElement()?.boundingBox();}
        finally {await node.dispose().catch(() => {});}
        const view = await task.page.evaluate(() => ({width: innerWidth, height: innerHeight}));
        if (!box || box.width <= 0 || box.height <= 0) throw new Error('script_hidden');
        let x = Math.floor(box.x - 12), y = Math.floor(box.y - 12), width = Math.ceil(box.width + 24), height = Math.ceil(box.height + 24);
        if (width < 160) {x -= Math.floor((160 - width) / 2); width = 160;}
        if (height < 64) {y -= Math.floor((64 - height) / 2); height = 64;}
        x = Math.max(0, x); y = Math.max(0, y); width = Math.min(width, view.width - x); height = Math.min(height, view.height - y);
        if (width < 1 || height < 1) throw new Error('script_hidden');
        region = captureRegion({x, y, width, height});
        element = {ref: args.ref, name: String(entry.descriptor.name || '').slice(0, 120), role: entry.descriptor.role || ''};
      }
      let {screenshot, viewport, image} = await captureBrowserPage(task.page, {fullPage, ...(region ? {region} : {}), cancelled: () => active !== task});
      let enlarged = 1;
      if (element && region.width < 400) {
        const factor = Math.min(3, Math.floor(1200 / region.width * 10) / 10), bigger = await enlargeCapture(image, factor);
        if (bigger) {image = bigger.image; enlarged = factor; screenshot = {...screenshot, width: bigger.dimensions.width, height: bigger.dimensions.height};}
      }
      browserURL(task.page.url());
      if (screenshot.mode === 'viewport') task.screenshot = screenshot;
      const observation = await observe(task), visualTargets = [];
      for (const [ref, entry] of screenshot.mode === 'viewport' ? [...task.refs].slice(0, 180) : []) {
        let target;
        try {
          target = await entry.handle.evaluateHandle(clickTarget);
          const box = await target.asElement()?.boundingBox();
          if (!box || box.width <= 0 || box.height <= 0 || box.x + box.width <= 0 || box.y + box.height <= 0 || box.x >= viewport.width || box.y >= viewport.height) continue;
          const {name, role, kind, state, stateKind, stateHint, disabled} = entry.descriptor;
          visualTargets.push({ref, name, role, kind, state, stateKind, stateHint, disabled, bounds: Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value)]))});
          if (visualTargets.length >= 60) break;
        } catch { /* A changed element is not a visual action target. */ }
        finally {await target?.dispose().catch(() => {});}
      }
      // Numbered boxes on the image, each number listed with its ref here.
      if (args.marks && visualTargets.length) {
        visualTargets.slice(0, 40).forEach((item, index) => {item.mark = index + 1;});
        image = await markCapture(image, {viewportWidth: viewport.width, viewportHeight: viewport.height,
          items: visualTargets.filter(item => item.mark).map(({mark, bounds}) => ({mark, bounds}))}).catch(() => image);
      }
      const attachment = await onCapture?.(screenshot, image);
      return {result: {screenshot_id: screenshot.id, ...viewport, width: screenshot.width, height: screenshot.height, viewport, capture_mode: element ? 'element' : screenshot.mode,
        ...(element ? {element, ...(enlarged > 1 ? {image_scale: enlarged, scale_note: 'The element region was enlarged: image pixels are page pixels times image_scale.'} : {})} : {}), ...(screenshot.scale ? {image_scale: screenshot.scale, scale_note: 'The whole page was reduced to fit one image: image pixels are page pixels times image_scale.'} : {}), ...(screenshot.documentCovered === false ? {document_note: `The browser returned a ${screenshot.width}x${screenshot.height} image for a page measured at ${screenshot.documentWidth}x${screenshot.documentHeight}. The image holds only the part it shows; capture scrolled sections or read the text for the rest.`} : {}), coverage: captureCoverage(screenshot, observation), image, observation, visualTargets, ...(attachment ? {attachment} : {}), scope: fullPage
        ? 'Full currently rendered top-level document, known secret fields masked. Reading/download evidence only, NOT click_at coordinates. Nested scroll areas, virtualized lists, collapsed sections and lazy/unloaded content are not expanded. Inspect observation.frames and their surfaces; scroll the relevant observed area, re-observe and capture each required section. Never claim all data was captured. For clicks scroll to the target, then use a fresh viewport capture or semantic ref.'
        : region ? 'Selected rectangle within the current browser viewport. Known secret fields masked. Reading/download evidence only, NOT click_at coordinates. Use a fresh uncropped viewport capture or semantic ref to act. Never infer saving or complete content coverage from this image.'
        : 'Current browser viewport only; known secret fields masked. Bounds use CSS pixels in this image. Match visual appearance to exact observed refs first. State hints are not verified state. Never infer a successful toggle from color alone.'}, tabId: task.tabId};
    }
    if (['read_page', 'inspect_dom', 'browser_snapshot'].includes(name)) return {result: await observe(task, args.query || ''), tabId: task.tabId};
    if (name === 'list_tabs') {
      // An owned tab whose first page has not arrived yet has no url, only a
      // pendingUrl. It is still the conversation's tab and stays listed.
      const address = tab => safeURL(tab.url) || (task.workspace && !tab.url ? safeURL(tab.pendingUrl) : null);
      const tabs = (await chrome.tabs.query(task.workspace ? {windowId: task.workspace.windowId} : {})).filter(tab => address(tab) && (!task.workspace || task.workspace.tabIds.includes(tab.id))).slice(0, 40);
      task.tabs = new Set(tabs.map(tab => tab.id));
      return {result: {tabs: tabs.map(tab => ({tab_id: String(tab.id), window_id: String(tab.windowId), ...(tab.openerTabId ? {opener_tab_id: String(tab.openerTabId)} : {}), title: String(tab.title || '').slice(0, 180), url: address(tab), current: tab.id === task.tabId,
        ...(safeURL(tab.url) ? {} : {loading: true})}))}, tabId: task.tabId};
    }
    let action = {ok: true};
    before = task.latestObservation;
    if (name === 'drag_element') {
      const source = await target(task, args.source_ref), destination = await target(task, args.target_ref);
      if (source.handle === destination.handle) throw new Error('tool_arguments_invalid');
      // Final destructive/submission drops are not silently converted to clicks.
      // Use the site's explicit action and existing one-shot approval flow.
      if (await source.handle.evaluate(approvalTarget) || await destination.handle.evaluate(approvalTarget)) throw new Error('drag_approval_required');
      const watcher = await popupWatch(task);
      try {action = await dragObserved(task, source, destination, {
        present: operation => showAction(task, null, 'drag', operation), cancelled: () => active !== task || task.dialogs?.blocked,
        onIssued: () => {issued = true; task.actionRevision = (task.actionRevision || 0) + 1;},
      });} finally {await followPopup(task, watcher);}
    } else if (name === 'click_at') {
      const shot = task.screenshot;
      const viewport = await task.page.evaluate(() => ({width: innerWidth, height: innerHeight, scrollX, scrollY}));
      const reason = !vision || !shot ? 'missing_screenshot' : shot.id !== args.screenshot_id ? 'screenshot_changed' : shot.url !== task.page.url() ? 'page_changed' : Object.keys(viewport).some(key => viewport[key] !== shot[key]) ? 'viewport_changed' : Date.now() - shot.at > 30000 ? 'screenshot_expired' : !Number.isFinite(args.x) || !Number.isFinite(args.y) || args.x < 0 || args.y < 0 || args.x >= shot.width || args.y >= shot.height ? 'point_outside_viewport' : null;
      if (reason) throw Object.assign(new Error('browser_stale'), {reason});
      const pointed=await task.page.evaluateHandle(({x,y})=>document.elementFromPoint(x,y),{x:args.x,y:args.y});
      try {if(pointed.asElement())await requireApproval(task,pointed.asElement(),{method:'point',x:args.x,y:args.y},{force:args.approvalOnly===true,summary:args.summary});else if(args.approvalOnly)throw new Error('browser_stale');} finally {await pointed.dispose();}
      task.screenshot = null;
      const watcher = await popupWatch(task);
      try {
        const focusedViewport = await task.page.evaluate(() => ({width: innerWidth, height: innerHeight, scrollX, scrollY}));
        if (task.page.url() !== shot.url || Object.keys(focusedViewport).some(key => focusedViewport[key] !== shot[key])) throw Object.assign(new Error('browser_stale'), {reason: 'viewport_changed'});
        if (active !== task) throw new Error('cancelled');
        await showAction(task, null, 'click', () => {
          issued = true;
          task.actionRevision = (task.actionRevision || 0) + 1;
          return task.page.mouse.click(args.x, args.y);
        });
      }
      finally {await followPopup(task, watcher);}
      action = {ok: true, actionIssued: true};
    } else if (name === 'switch_tab') {
      const id = Number(args.tab_id); if (!task.tabs.has(id)) throw new Error('browser_stale');
      await attachTab(task, id);
    } else if (name === 'navigate_page') {
      task.screenshot = null;
      const url = browserURL(args.url).href;
      const existing = args.new_tab === 'yes' ? await findWorkspaceURL(task.workspace, url) : null;
      if (existing) {if (existing.id !== task.tabId) await attachTab(task, existing.id);}
      else if (args.new_tab === 'yes') {const openerId = task.tabId; const tab = await chrome.tabs.create({url, active: !task.workspace, openerTabId: openerId, ...(task.workspace ? {windowId: task.workspace.windowId} : {})}); await attachTab(task, tab.id, openerId, true);}
      else {const started = Date.now(); await task.page.goto(url, {waitUntil: 'commit', timeout: navigationLoadMs}); loading = !await documentParsed(task, navigationLoadMs - (Date.now() - started));}
    } else if (name === 'go_back') {
      task.screenshot = null;
      const started = Date.now(), budget = Math.min(12000, navigationLoadMs);
      await task.page.goBack({waitUntil: 'commit', timeout: budget}); loading = !await documentParsed(task, budget - (Date.now() - started));
    }
    else if (name === 'scroll_page') {
      const entry = args.ref ? await target(task, args.ref) : null;
      try {
        const scroll = await showAction(task, null, 'scroll', () => scrollBrowserSection(task.page, {
          handle: entry?.handle, direction: args.direction, cancelled: () => active !== task,
          onIssued: () => {issued = true; task.actionRevision = (task.actionRevision || 0)+1;},
        }));
        action = {ok: scroll.status !== 'blocked', actionIssued: issued, scroll,
          ...(scroll.status === 'blocked' ? {error: 'scroll_not_moved', reason: 'scroll_not_moved', instruction: scroll.instruction} : {})};
      } finally {await entry?.handle.dispose().catch(() => {});}
    } else if (name === 'wait_page') await delay(1000);
    else if (name === 'fill_form') {
      if (!Array.isArray(args.fields) || !args.fields.length || args.fields.length > MAX_FORM_FIELDS) throw new Error('fill_invalid');
      // Validate the complete set before any write. No auto-replay after partial failure.
      const entries = [], seen = new Set();
      for (const field of args.fields) {
        if (typeof field.field_id !== 'string' || seen.has(field.field_id) || typeof field.value !== 'string' || field.value.length > MAX_FIELD_VALUE_CHARS) throw new Error('fill_invalid');
        seen.add(field.field_id);
        const entry = await target(task, field.field_id);
        if (!['field', 'select', 'checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind)) throw new Error('fill_invalid');
        if (['checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind) && !['true', 'false'].includes(field.value)) throw new Error('fill_invalid');
        entries.push({...entry, fieldId:field.field_id, value: field.value});
      }
      let applied = 0; await Promise.allSettled(task.receipts.map(entry => entry.handle.dispose())); task.receipts = [];
      for (const entry of entries) {
        const method = entry.descriptor.kind === 'field' ? 'fill' : 'unsupported';
        const witness = method === 'fill' ? await semanticInputWitness(task,entry,entry.fieldId,'fill',entry.value) : null;
        const command = {method,state:'failed',actionIssued:false};
        inputExecution.commands.push(command);
        try {
          if (['checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind)) {
            issued = command.actionIssued = true;
            await setCheckedObserved(task, entry.handle, entry.value === 'true');
          } else await showAction(task, entry.handle, 'input', async () => {
            await witness?.beforeIssued();
            if (active !== task || task.dialogs?.blocked) throw new Error('cancelled');
            const current = await entry.handle.evaluate(inspectTarget);
            if (current.secret) throw new Error('script_secret_field');
            if (!current.connected || current.hidden) throw new Error('browser_stale');
            issued = command.actionIssued = true; witness?.onIssued();
            return entry.descriptor.kind === 'select' ? entry.handle.selectOption(entry.value) : entry.handle.fill(entry.value);
          });
          command.state = 'returned';
          applied++; task.receipts.push({...entry, handle: await entry.handle.evaluateHandle(el => el)});
        } catch (error) {
          command.state = 'failed';
          if (witness) command.inputReceipt = await witness.finish('failed');
          // Do not replace a cancelled/partial write receipt with an error from
          // trying to observe the task after its handles have been released.
          if (active !== task) error = new Error('cancelled');
          let observation;
          if (active === task) {try {observation = await observe(task);} catch { /* Preserve the original write failure. */ }}
          return {result: {...scriptFailure(error), applied, actionIssued: issued, ...targetReceipt(), ...(observation ? {observation} : {}), instruction: 'Inspect the page and current control state. Do not replay fields already applied or blindly flip a toggle.'}, tabId: task.tabId};
        }
        if (witness) command.inputReceipt = await witness.finish(command.state);
      }
      await delay(250);
      const matched = (await Promise.all(task.receipts.map(retainedField))).filter(Boolean).length;
      action = {ok: matched === applied, actionIssued:issued, applied, matched, verified: matched === applied, submitted: false, ...(matched !== applied ? {error: 'fill_not_retained'} : {})};
    } else if (name === 'verify_form') {
      if (!task.receipts.length) throw new Error('fill_no_receipt');
      const matched = (await Promise.all(task.receipts.map(retainedField))).filter(Boolean).length;
      return {result: {ok: matched === task.receipts.length, matched, expected: task.receipts.length, submitted: false, ...(matched !== task.receipts.length ? {error: 'fill_not_retained'} : {})}, tabId: task.tabId};
    } else if (['click_element', 'hover_element', 'press_key', 'select_option'].includes(name)) {
      const entry = await target(task, args.ref);
      const linkBefore = name === 'click_element' && entry.descriptor.kind === 'link' && entry.descriptor.destination && args.button !== 'right'
        ? {tabId: task.tabId, url: task.page.url(), frame: entry.frame, frameURL: entry.frame.url()} : null;
      if(name==='click_element'||name==='press_key'&&/(?:Enter|Space|(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS])$/.test(args.key))await requireApproval(task,entry.handle,name==='press_key'?{method:'press',key:args.key}:{method:'click'});
      // Consume an action ref before dispatch, including uncertain timeout results.
      task.refs.delete(args.ref); issued = !['press_key', 'click_element'].includes(name);
      const watcher = name === 'click_element' || name === 'press_key' && /(?:Enter|Space|(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS])$/.test(args.key) ? await popupWatch(task, entry.handle) : null;
      try {
        if (name === 'click_element') await clickObserved(task, entry.handle, {button: args.button === 'right' ? 'right' : 'left', clickCount: args.double === 'yes' ? 2 : 1}, false,
          attribution => {issued = true; task.actionRevision = (task.actionRevision || 0) + 1;
            actionTargetReceipt = {dataKind: 'click_target_dispatch', version: 1, ...attribution, actionIssued: true};},
          (handle, inspected) => clickDispatchTarget(task, entry, args.ref, handle, inspected));
        else if (name === 'hover_element') await hoverObserved(task, entry.handle);
        else if (name === 'select_option') await showAction(task, entry.handle, 'input', () => entry.handle.selectOption(args.values));
        else {
          if (!/^(?:(?:Control|Meta|Shift|Alt|ControlOrMeta)\+)*(?:Enter|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|Space|[a-zA-Z])$/.test(args.key)) throw new Error('keyboard_key_invalid');
          const witness = await semanticInputWitness(task,entry,args.ref,'press',args.key);
          const command = {method:'press',state:'failed',actionIssued:false};
          inputExecution.commands.push(command);
          try {
            await showAction(task, entry.handle, 'input', async () => keyboardInput(entry.handle, task.page, 'press', await nativeKey(args.key), {}, {
              cancelled: () => active !== task || task.dialogs?.blocked,
              ...(witness ? {beforeIssued:()=>witness.beforeIssued()} : {}),
              onIssued: () => {issued = command.actionIssued = true;witness?.onIssued();},
            }));
            command.state = 'returned';
          } finally {if (witness) command.inputReceipt = await witness.finish(command.state);}
        }
      } finally {try {await followPopup(task, watcher);} finally {await entry.handle.dispose().catch(() => {});}}
      action = {ok: true, actionIssued: true,
        ...(linkBefore && (task.tabId !== linkBefore.tabId || task.page.url() !== linkBefore.url ||
          linkBefore.frame.isDetached() || linkBefore.frame.url() !== linkBefore.frameURL) ? {navigationOnly: true} : {})};
    } else throw new Error('tools_unavailable');
    if (loading) notePageLoading(task.tabId);
    await settle(task, loading);
    task.dialogs?.assertCanAct();
    task.screenshot = null;
    const observation = await observe(task), effect = noteRepeatedNoEffect(task, name, observationEffect(before, observation, name));
    return {result: {...action, ...targetReceipt(), ...(loading ? {navigationUnsettled: true, instruction: LOADING_INSTRUCTION} : {}), ...(effect ? {effect} : {}), observation}, tabId: task.tabId};
  } catch (error) {
    if (active === task && task?.dialogs?.blocked && error.message !== 'cancelled') error = new Error('browser_dialog');
    if(task?.approvalPause)return {result:{...task.approvalPause,actionIssued:issued,...targetReceipt()},tabId:task.tabId};
    const allowed = ['workspace_changed', 'workspace_loading', 'drag_cross_frame', 'drag_approval_required', 'approval_required','approval_verification_required','approval_changed','cancelled', 'page_restricted', 'browser_stale', 'script_disabled', 'fill_invalid', 'fill_no_receipt', 'tool_arguments_invalid', 'tools_unavailable'];
    let observation;
    if (task && active === task && !['cancelled', 'page_restricted', 'tools_unavailable', 'workspace_changed'].includes(error.message)) {
      try {await clearRefs(task); observation = task.app ? await observe(task) : await readWithoutDebugger(task, '', safeURL, () => active !== task);} catch { /* Keep the original error when the page cannot be inspected. */ }
    }
    const feedback = scriptFailure(error), effect = issued && observation ? noteRepeatedNoEffect(task, name, observationEffect(before, observation, name)) : null;
    return {result: {error: allowed.includes(error.message) ? error.message : feedback.reason, reason: feedback.reason, actionIssued: issued, ...targetReceipt(), ...(error.blocker ? {blocker: error.blocker} : {}), ...(error.invalidChecks ? {invalidChecks: error.invalidChecks} : {}), ...(effect ? {effect} : {}), ...(observation ? {observation} : {}), ...(error.message === 'browser_dialog' ? {nativeDialogs: task.dialogs.snapshot()} : {}), ...(error.message === 'workspace_changed' ? {recovery:{strategy:'user_action',execution:'not_started'}} : {}), instruction: error.message === 'workspace_changed' ? 'The owned work tab was closed or moved. Ask the user to reconnect the intended page. Never switch to an unrelated user tab, recreate the workspace or replay prior writes automatically.' : error.message === 'drag_cross_frame' ? 'No drag was issued. Both endpoints must be in one frame. Inspect a supported same-frame target or ask about the intended outcome.' : error.message === 'drag_approval_required' ? 'No drag was issued. This target may finalize a transaction. Inspect the site explicit action, prepare and verify the draft, then use request_approval. Never substitute an unapproved click or coordinate drag.' : feedback.instruction}, tabId: task?.tabId || page.tabId};
  }
}

const builders = new Set(LOCATOR_BUILDERS);
const terminal = new Set([...LOCATOR_ACTIONS, ...LOCATOR_READS]);
  const mutating = new Set(['click', 'dblclick', 'hover', 'fill', 'appendText', 'selectText', 'press', 'pressSequentially', 'check', 'uncheck', 'setChecked', 'selectOption']);
function revive(value) {
  if (value?.__regexp && typeof value.__regexp === 'string') {if (value.__regexp.length > 500) throw new Error('script_invalid'); return new RegExp(value.__regexp, String(value.flags || '').replace(/[^imsu]/g, ''));}
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, item]) => [key, revive(item)]));
  return value;
}
async function scriptCall(task, originalPage, call, vision, onCapture, onInputReceipt = () => {}) {
  if (active !== task) throw new Error('cancelled');
  if(task.approvalPause)throw new Error('approval_required');
  await restoreOpener(task);
  browserURL(task.page.url());
  const {chain, method} = call, args = revive(call.args);
  if (!Array.isArray(chain) || chain.length > 12 || !Array.isArray(args)) throw new Error('script_invalid');
  if (method === 'press') args[0] = await nativeKey(args[0]);
  const invoke = async (name, values = {}) => {
    if (['switch_tab', 'navigate_page', 'go_back', 'click_at'].includes(name)) task.actionRevision = (task.actionRevision || 0) + 1;
    const {result} = await runBrowserAgent(task.id, originalPage, name, values, {vision, onCapture});
    if (result.error) throw new Error(result.error);
    if (result.image) {task.scriptImage = result.image; const {image, ...metadata} = result; return metadata;}
    return result;
  };
  if (!chain.length) {
    if (method === 'snapshot') return observe(task, typeof args[0] === 'string' ? args[0] : '');
    if (method === 'screenshot') return invoke('capture_page', screenshotOptions(args[0]));
    if (method === 'tabs') return (await invoke('list_tabs')).tabs;
    if (method === 'switchTab') return invoke('switch_tab', {tab_id: String(args[0])});
    if (method === 'open') return invoke('navigate_page', {url: args[0], new_tab: 'yes'});
    if (method === 'scroll') return invoke('scroll_page', {direction: args[0], ...(args[1] !== undefined ? {ref: args[1]} : {})});
    if (method === 'drag') return invoke('drag_element', {source_ref: args[0], target_ref: args[1]});
    if (method === 'clickAt') return invoke('click_at', {screenshot_id: args[0], x: args[1], y: args[2]});
    if (method === 'goto') return invoke('navigate_page', {url: args[0]});
    if (method === 'goBack') return invoke('go_back');
    if (method === 'reload') {task.screenshot = null; task.actionRevision = (task.actionRevision || 0) + 1; await task.page.reload({waitUntil: 'domcontentloaded'}); return observe(task);}
    if (method === 'title') return (await task.page.title()).slice(0, 500);
    if (method === 'url') return safeURL(task.page.url());
    if (method === 'waitForLoadState') {await settle(task); return null;}
    if (method === 'waitForTimeout') {await delay(Math.max(0, Math.min(Number(args[0]) || 0, 1500))); return null;}
  }
  if (!chain.length || !terminal.has(method)) throw new Error(`Unsupported Playwright method: ${String(method).slice(0, 50)}`);
  const refMode = chain[0]?.[0] === 'ref';
  if (refMode && (chain.length !== 1 || !Array.isArray(chain[0][1]) || chain[0][1].length !== 1 || typeof chain[0][1][0] !== 'string' || !REF_METHODS.includes(method))) throw new Error('script_api');
  let locator = task.page;
  for (const [name, values] of refMode ? [] : chain) {
    if (!builders.has(name) || !Array.isArray(values)) throw new Error('Unsupported locator method');
    locator = locator[name](...revive(values));
  }
  // Resolve write targets once, then guard and act on that exact node. A
  // locator must not pass validation empty and later match a secret field.
  let actionHandle;
  const guard = elements => {
    const secret = el => /password|passwd|secret|token|api.?key|cc-|one-time-code|비밀번호|인증번호|카드번호/i.test(`${el.type} ${el.name} ${el.id} ${el.autocomplete} ${el.getAttribute('aria-label')} ${[...el.labels || []].map(label => label.textContent).join(' ')}`);
    return {url: location.href, unsafe: elements.some(el => secret(el) || el.matches('script,style,noscript,template,input[type="file"]'))};
  };
  const optionsIndex = ['fill', 'appendText', 'selectText', 'press', 'pressSequentially', 'setChecked', 'selectOption'].includes(method) ? 1 : 0;
  if (!LOCATOR_READS.includes(method) || method === 'waitFor') args[optionsIndex] = {...(args[optionsIndex] && typeof args[optionsIndex] === 'object' ? args[optionsIndex] : {}), timeout: 7000, force: false};
  let value, watcher, inputWitness, inputState = 'failed';
  try {
    if (refMode) {
      const entry = await target(task, chain[0][1][0], {readOnly: LOCATOR_READS.includes(method)});
      actionHandle = await entry.handle.evaluateHandle(el => el);
    } else {
      const inspected = await locator.evaluateAll(guard);
      if (!['about:blank', 'about:srcdoc'].includes(inspected.url)) browserURL(inspected.url);
      if (inspected.unsafe) throw new Error('script_secret_field');
    }
    if (method === 'getAttribute' && (typeof args[0] !== 'string' || !READABLE_ATTRIBUTES.includes(args[0].toLowerCase()))) throw new Error('script_attribute');
    if (mutating.has(method) || ['inputValue', 'editorState'].includes(method)) {
      actionHandle ||= await locator.elementHandle({timeout: 7000});
      const current = await actionHandle.evaluate(inspectTarget);
      if (current.secret) throw new Error('script_secret_field');
      if (!current.connected) throw new Error('browser_stale');
      if (current.hidden) throw new Error('script_hidden');
      // A definite non-input target cannot receive fill. Reject it before
      // recording a possible write, so a repairable script error does not
      // leave an unverifiable pending action that blocks the next tool.
      if (method === 'fill' && !await actionHandle.evaluate(el =>
        el.isContentEditable || el.matches('textarea,input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="file"],[type="hidden"],[type="image"])')
      )) throw new Error('script_target');
      if(['click','dblclick'].includes(method)||method==='press'&&/(?:Enter|Space|(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS])$/.test(args[0]))await requireApproval(task,actionHandle,method==='press'?{method:'press',key:args[0]}:{method:'click'});
      if (['click', 'dblclick'].includes(method) || method === 'press' && /(?:Enter|Space|(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS])$/.test(args[0])) watcher = await popupWatch(task, actionHandle);
    }
    if (actionHandle && (method === 'fill' || method === 'press' && args[0] === 'Enter')) {
      let binding;
      try {binding = await scriptInputBinding(task,actionHandle,refMode?chain[0][1][0]:null);} catch { /* Attribution failure does not authorize or replay an action. */ }
      inputWitness = await createScriptInputWitness({method,value:args[0],key:args[0],
        captureTarget:()=>scriptInputTarget(task,actionHandle,binding),
        readMatch:expected=>actionHandle.evaluate((node,value)=>{
          const secret = /password|passwd|secret|token|api.?key|cc-|one-time-code|비밀번호|인증번호|카드번호/i.test(`${node.type} ${node.name} ${node.id} ${node.autocomplete} ${node.getAttribute('aria-label')} ${[...node.labels||[]].map(label=>label.textContent).join(' ')}`);
          if (!node.isConnected || secret || !node.matches('input,textarea')) return null;
          return node.value === value;
        },expected),cancelled:()=>active!==task||task.dialogs?.blocked});
    }
    if (mutating.has(method) && !['press', 'pressSequentially', 'click', 'dblclick'].includes(method)) task.actionRevision = (task.actionRevision || 0) + 1;
    if (method === 'editorState' || method === 'selectText') {
      const operation = () => actionHandle.evaluate(editorOperation, {query: args[0] ?? '', select: method === 'selectText', expectedDigest: args[1]?.expectedDigest});
      value = method === 'selectText' ? await showAction(task, actionHandle, 'input', operation) : await operation();
    } else if (method === 'isChecked') {
      const state = await (actionHandle || locator).evaluate(controlState);
      if (state.state === undefined) throw new Error('script_control_state');
      value = state.state === true;
    } else if (['click', 'dblclick'].includes(method)) value = await clickObserved(task, actionHandle, args[0], method === 'dblclick',
      () => {task.actionRevision = (task.actionRevision || 0) + 1;});
    else if (method === 'hover') value = await hoverObserved(task, actionHandle, args[0]);
    else if (['check', 'uncheck', 'setChecked'].includes(method)) value = await setCheckedObserved(task, actionHandle, method === 'setChecked' ? args[0] : method === 'check');
    else if (['press', 'pressSequentially'].includes(method)) value = await showAction(task, actionHandle, 'input', () => keyboardInput(actionHandle, task.page, method, args[0], args[1], {
      cancelled: () => active !== task || task.dialogs?.blocked,
      ...(inputWitness ? {beforeIssued:()=>inputWitness.beforeIssued()} : {}),
      onIssued: () => {task.actionRevision = (task.actionRevision || 0) + 1;inputWitness?.onIssued();},
    }));
    else {
      const operation = async () => {
        if (method === 'fill' && inputWitness) {
          await inputWitness.beforeIssued();
          if (active !== task || task.dialogs?.blocked) throw new Error('cancelled');
          const current = await actionHandle.evaluate(inspectTarget);
          if (current.secret) throw new Error('script_secret_field');
          if (!current.connected || current.hidden) throw new Error('browser_stale');
          inputWitness.onIssued();
        }
        const result = method === 'appendText' ? await appendText(actionHandle, task.page, args[0], args[1], () => active !== task || task.dialogs?.blocked) : await (actionHandle || locator)[method](...args);
        inputState = 'returned';
        return result;
      };
      value = LOCATOR_ACTIONS.includes(method) ? await showAction(task, actionHandle, method === 'hover' ? 'hover' : 'input', operation) : await operation();
    }
  } catch (error) {
    if (['page_restricted', 'script_secret_field'].includes(error.message)) throw error;
    // Classify only after Playwright's normal wait. A missing control may be
    // inserted or enabled asynchronously, so do not preempt auto-waiting.
    let evidence;
    if (error.name === 'TimeoutError') {
      try {
        if (!refMode && !await locator.count()) evidence = 'missing';
        else if (actionHandle) {
          const current = await actionHandle.evaluate(inspectTarget);
          if (current.disabled) evidence = 'disabled';
          else if (current.hidden) evidence = 'hidden';
        }
      } catch { /* Keep the original bounded failure when the page moved. */ }
    }
    const feedback = scriptFailure(error, evidence);
    throw Object.assign(new Error(feedback.error), {reason: feedback.reason});
  } finally {
    if (inputWitness) {
      try {onInputReceipt(await inputWitness.finish(inputState));} catch { /* Telemetry cannot cause action retries. */ }
    }
    try {await followPopup(task, watcher);} finally {await actionHandle?.dispose().catch(() => {});}
  }
  if (mutating.has(method)) {
    task.screenshot = null; await delay(150);
  }
  return typeof value === 'string' ? value.slice(0, 16000) : Array.isArray(value) ? value.slice(0, 100).map(value => String(value).slice(0, 1000)) : value;
}
