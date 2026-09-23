// Pinned, prebuilt browser-only Playwright runtime, copied during packaging.
import {readPageContent} from './browser-content.js';
import {crx} from './playwright/index.js';
import {executeScript, preflightScript} from './script-sandbox.js';
import {watchPopups} from './browser-popups.js';
import {clickEffect} from './browser-click-effect.js';
import {collectSnapshot, inspectTarget, clickTarget, controlState, pointerPosition, waitForHoverReveal, readWithoutDebugger, bindObservedRef, releaseObservedRefs} from './browser-observation.js';
import {appendText, editableText, textDigest} from './browser-text.js';
import {keyboardInput} from './browser-keyboard.js';
import {editorOperation, validEditorFormat, matchesEditorFormat} from './browser-editor.js';
import {scriptFailure} from './script-feedback.js';
import {LOCATOR_BUILDERS, LOCATOR_ACTIONS, LOCATOR_READS, PAGE_METHODS, BROWSER_METHODS, REF_METHODS, READABLE_ATTRIBUTES, SCRIPT_TRANSITIONS, isScriptAction} from './browser-script-api.js';
import {approvalTarget, prepareApproval, bindApproval, clearApproval} from './browser-approval.js';
import {clearImageRefs, findPageImages, attachPageImages, inspectPageImages} from './page-images.js';
import {withActionPointer, clearActionPointer} from './browser-pointer.js';
import {dragObserved} from './browser-drag.js';
import {watchNativeDialogs} from './browser-dialogs.js';
import {captureBrowserPage, screenshotOptions, captureCoverage} from './browser-capture.js';
import {scrollBrowserSection} from './browser-scroll.js';
import {workspaceTab, readyWorkspaceTab, adoptWorkspaceTab, releaseWorkspace, guardPopupFocus} from './browser-workspace.js';

let active;
const showAction = (task, handle, kind, action) => withActionPointer(task, handle, kind, async () => {
  task.dialogs?.assertCanAct();
  task.screenshot = null;
  try {return await action();}
  finally {if (active === task) task.dialogs?.assertCanAct();}
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
export function browserURL(value) {
  let url; try {url = new URL(value);} catch {throw new Error('page_restricted');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.hostname === 'auth.openai.com' || url.hostname === 'epsso.samsung.net' ||
    (url.hostname === 'aipro.sdsdev.co.kr' && url.pathname.startsWith('/auth/')) ||
    (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/auth'))) throw new Error('page_restricted');
  return url;
}
const safeURL = value => {try {const url = browserURL(value); return url.origin + url.pathname;} catch {return null;}};


async function clearRefs(task) {
  const refs = [...task.refs.values()]; task.refs.clear();
  const observations = [...task.observedDocuments?.values() || []]; task.observedDocuments?.clear();
  await releaseObservedRefs([...refs, ...observations]);
  await Promise.allSettled(refs.filter(entry => entry.handle).map(entry => entry.handle.dispose()));
}
async function observe(task, query = '') {
  browserURL(task.page.url()); await clearRefs(task);
  const frames = [], prefix = crypto.randomUUID().slice(0, 8), frameList = task.page.frames();
  for (const [index, frame] of frameList.slice(0, 16).entries()) {
    const url = safeURL(frame.url());
    if (!url && frame !== task.page.mainFrame() && !['about:blank', 'about:srcdoc'].includes(frame.url())) continue;
    let group, handles;
    try {
      group = await frame.evaluateHandle(collectSnapshot, query);
      const data = await group.evaluate(value => ({descriptors: value.descriptors, text: value.text, textFiltered: value.textFiltered, truncated: value.truncated, regions: value.regions, headings: value.headings, retrieval: value.retrieval, alerts: value.alerts, omittedControls: value.omittedControls,
        pageState: value.pageState, surfaces: value.surfaces, tables: value.tables, tableCoverage: value.tableCoverage, coverage: value.coverage}));
      handles = await group.getProperty('elements');
      const props = await handles.getProperties();
      const elements = data.descriptors.map((descriptor, i) => {
        const ref = `e-${prefix}-${index}-${i}`, handle = props.get(String(i)).asElement();
        task.refs.set(ref, {handle, frame, descriptor}); return {ref, ...descriptor};
      });
      let owner;
      if (frame.parentFrame()) {
        const element = await frame.frameElement();
        try {owner = await element.evaluate(el => ({tag: el.tagName.toLowerCase(), id: el.id, name: el.name, title: el.title}));} finally {await element.dispose();}
      }
      const {descriptors: ignored, ...details} = data;
      frames.push({frame: index, url: url || safeURL(task.page.url()), ...(owner ? {owner} : {}), elements, ...details});
    } catch {frames.push({frame: index, url, unavailable: true});}
    finally {await handles?.dispose().catch(() => {}); await group?.dispose().catch(() => {});}
  }
  return task.latestObservation = {title: (await task.page.title()).slice(0, 180), url: safeURL(task.page.url()), frames,
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
  if (endedRequests.has(requestId)) throw new Error('cancelled');
  if (active?.id !== requestId) {
    await stopBrowserAgent();
    if (endedRequests.has(requestId)) throw new Error('cancelled');
    active = {id: requestId, app: null, page: null, tabId: page.tabId, workspace: page.browserContext?.workspace || page.workspace || null, refs: new Map(), receipts: [], tabs: new Set([page.tabId]), openers: new Map(page.browserContext?.openers || []), attachedTabs: new Set()};
  }
  const task = active;
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
    task.dialogs = watchNativeDialogs(app.context());
    app.context().setDefaultTimeout(7000); app.context().setDefaultNavigationTimeout(12000);
  }
  if (task.app && !task.page) {
    browserURL((await chrome.tabs.get(task.tabId)).url);
    // Own the pending attach too: the user may cancel Chrome's banner before
    // Playwright has finished initializing the page.
    task.attachedTabs.add(task.tabId);
    try {task.page = await task.app.attach(task.tabId);}
    catch (error) {task.attachedTabs.delete(task.tabId); throw error;}
  }
  else if (task.page) await restoreOpener(task);
  if (active !== task || endedRequests.has(requestId)) throw new Error('cancelled');
  if (task.workspace) await chrome.tabs.update(task.tabId, {autoDiscardable: false});
  return active;
}
async function target(task, ref, {readOnly = false} = {}) {
  let entry = task.refs.get(ref);
  if (entry?.documentId) entry = await bindObservedRef(task, entry, safeURL);
  if (active !== task) throw new Error('cancelled');
  if (!entry || entry.frame.isDetached() || !await entry.handle.evaluate(el => el.isConnected)) throw new Error('browser_stale');
  if (!readOnly && entry.descriptor.disabled) throw new Error('script_disabled');
  const current = await entry.handle.evaluate(inspectTarget);
  if (current.secret || !readOnly && current.disabled || current.hidden || !current.connected || current.type !== entry.descriptor.type || current.name && current.name !== entry.descriptor.name) throw new Error('browser_stale');
  return entry;
}
async function verifyPage(task, checks) {
  if (!Array.isArray(checks) || !checks.length || checks.length > 8 || checks.some(check => !['field_value', 'field_digest', 'field_contains', 'text_style', 'control_state', 'control_expanded', 'element_in', 'text_present', 'url_is'].includes(check?.kind) || typeof check.expected !== 'string' || check.expected.length > 16000 || check.kind !== 'field_value' && !check.expected.trim() || check.kind === 'field_digest' && !/^[a-f0-9]{64}$/.test(check.expected) || check.kind === 'text_style' && !validEditorFormat(check.format) || check.kind?.startsWith('control_') && !['true', 'false', 'mixed'].includes(check.expected))) throw new Error('tool_arguments_invalid');
  const deadline = Date.now() + 5000;
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
      url = observation.url;
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
      let passed = false;
      if (check.kind === 'url_is') passed = safeURL(check.expected) !== null && safeURL(check.expected) === safeURL(url);
      if (check.kind === 'text_present') {passed = textChecks.some(matches => matches[textIndex] === true); textIndex++;}
      if (check.kind.startsWith('field_') || check.kind.startsWith('control_') || check.kind === 'text_style' || check.kind === 'element_in') {
        try {
          const entry = await target(task, check.ref, {readOnly: true});
          if (check.kind === 'element_in') {
            const destination = await target(task, check.expected, {readOnly: true});
            passed = entry.frame === destination.frame && await destination.handle.evaluate((parent, child) => parent !== child && parent.contains(child), entry.handle);
          } else if (check.kind === 'text_style') {
            passed = matchesEditorFormat(await entry.handle.evaluate(editorOperation, {query: check.expected}), check.format);
          } else if (check.kind.startsWith('control_')) {
            const state = await entry.handle.evaluate(controlState);
            const value = state[check.kind === 'control_expanded' ? 'expanded' : 'state'];
            if (value === undefined) throw new Error('tool_arguments_invalid');
            passed = String(value) === check.expected;
          } else if (!['field', 'select', 'checkbox', 'radio'].includes(entry.descriptor.kind)) throw new Error('tool_arguments_invalid');
          else if (check.kind === 'field_value') passed = entry.descriptor.stateKind ? String((await entry.handle.evaluate(controlState)).state) === check.expected : await entry.handle.evaluate((el, expected) => el.isConnected && (el.isContentEditable ? el.innerText : el.value) === expected, check.expected);
          else {
            const value = await entry.handle.evaluate(editableText);
            passed = check.kind === 'field_digest' ? await textDigest(value) === check.expected : value.includes(check.expected);
          }
        } catch (error) {
          if (error.message === 'cancelled' || active !== task) throw new Error('cancelled');
          if (error.message === 'tool_arguments_invalid') throw error;
          stale = true;
        }
      }
      results.push({index, kind: check.kind, passed, ...(stale ? {reason: 'target_changed'} : {})});
      if (stale) break;
    }
    consecutive = results.every(check => check.passed) ? consecutive + 1 : 0;
    if (consecutive >= 2 || stale || Date.now() >= deadline) break;
    await delay(Math.max(0, Math.min(250, deadline - Date.now())));
  }
  const verified = consecutive >= 2;
  return {ok: verified, verified, checks: results, ...(verified ? {} : stale ? {error: 'browser_stale', reason: 'browser_stale', instruction: 'A checked field changed. Use the fresh observation to identify it and retry only verification. This is not evidence that earlier input failed; never replay the write automatically.'} : {error: 'verification_failed', instruction: 'The requested checks did not pass after waiting. Inspect the fresh observation before choosing a correction. Do not replay earlier writes.'}), scope: 'Fresh visible page evidence only. Input values and expected text are not returned. DOM retention and visible application confirmation are not an independent backend audit.', observation: task.app ? await observe(task) : observation};
}
async function attachTab(task, tabId, openerId, created = false) {
  if (active !== task) throw new Error('cancelled');
  if (task.workspace) {
    if (!task.workspace.tabIds.includes(tabId)) await adoptWorkspaceTab(task.workspace, tabId, openerId, {created});
    await workspaceTab(task.workspace, tabId);
    if (created) await readyWorkspaceTab(task.workspace, tabId, () => active !== task);
  }
  const tab = await chrome.tabs.get(tabId); browserURL(tab.url);
  await chrome.tabs.update(tabId, {active: true});
  if (!task.workspace) await chrome.windows.update(tab.windowId, {focused: true});
  task.attachedTabs.add(tabId);
  let page;
  try {page = await task.app.attach(tabId);}
  catch (error) {task.attachedTabs.delete(tabId); throw error;}
  if (active !== task) throw new Error('cancelled');
  await clearActionPointer(task); await clearRefs(task); task.screenshot = null;
  task.page = page; task.tabId = tabId; task.tabs.add(tabId); task.popupCandidates = [];
  if (task.workspace) task.workspace.tabId = tabId;
  if (openerId || tab.openerTabId) task.openers.set(tabId, openerId || tab.openerTabId);
  await rememberOpeners(task, tabId);
}
async function restoreOpener(task) {
  if (!task.page?.isClosed() && await chrome.tabs.get(task.tabId).catch(() => null)) return;
  let parent = task.openers.get(task.tabId);
  const visited = new Set([task.tabId]);
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    if (await chrome.tabs.get(parent).catch(() => null)) {await attachTab(task, parent); return;}
    parent = task.openers.get(parent);
  }
  throw new Error('browser_stale');
}
async function settle(task) {
  await restoreOpener(task);
  await task.page.waitForLoadState('domcontentloaded', {timeout: 5000}).catch(() => {});
  await delay(250); browserURL(task.page.url());
}
async function popupWatch(task, handle) {
  if (active !== task) throw new Error('cancelled');
  // Chrome can attribute a popup from a background target to the selected
  // tab. Activate the actual action source before observing popup ownership.
  if (task.workspace) await workspaceTab(task.workspace, task.tabId);
  const tab = await chrome.tabs.update(task.tabId, {active: true});
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
async function clickObserved(task, handle, options = {}, double = false) {
  const target = await handle.evaluateHandle(clickTarget);
  try {return await showAction(task, target, 'click', async () => {
    const before = await target.evaluate(inspectTarget);
    // Hover may close a tooltip or move layout. Settle at the exact node first,
    // then let Playwright recompute its click point and normal actionability.
    await target.scrollIntoViewIfNeeded({timeout: 7000});
    const position = options.position || await target.evaluate(pointerPosition);
    await target.hover({...options, ...(position ? {position} : {}), force: false, timeout: 7000});
    task.dialogs?.assertCanAct();
    if (active !== task) throw new Error('cancelled');
    const after = await target.evaluate(inspectTarget);
    if (!after.connected || after.secret || after.name !== before.name || after.type !== before.type) throw new Error('browser_stale');
    const clickPosition = options.position || await target.evaluate(pointerPosition);
    return target[double ? 'dblclick' : 'click']({...options, ...(clickPosition ? {position:clickPosition} : {}), force: false, timeout: 7000});
  });}
  finally {await target.dispose().catch(() => {});}
}
async function hoverObserved(task, handle, options = {}) {
  const target = await handle.evaluateHandle(clickTarget);
  try {return await showAction(task, target, 'hover', async () => {
    await target.scrollIntoViewIfNeeded({timeout:7000});
    const position = options.position || await target.evaluate(pointerPosition);
    if (active !== task) throw new Error('cancelled');
    await target.hover({...options, ...(position ? {position} : {}), force:false, timeout:7000});
    await handle.evaluate(waitForHoverReveal);
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
  if (!active || requestId && active.id !== requestId) return;
  const task = active; active = null;
  task.dialogs?.close();
  for (const watcher of task.popupWatches || []) watcher.close();
  // A blocked renderer must not trap cancellation behind handle disposal.
  let timer;
  try {await Promise.race([
    (async () => {await task.releaseDrag?.(); await clearActionPointer(task); await clearRefs(task); await clearImageRefs(task); await Promise.allSettled(task.receipts.map(entry => entry.handle.dispose()));})().catch(() => {}),
    new Promise(resolve => {timer = setTimeout(resolve, 1000);}),
  ]);} finally {
    clearTimeout(timer);
    await task.app?.close().catch(() => {});
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
export async function runApprovedAction(requestId,page,record) {
  let task,handle,watcher,issued=false;
  try {
    task=await ensure(requestId,{tabId:record.tabId,browserContext:page?.browserContext||record.browserContext},true,true);
    task.dialogs?.assertCanAct();
    watcher=await popupWatch(task,null);
    handle=await bindApproval(task,record);
    watcher.setHint(await linkHint(handle));
    if(active!==task)throw new Error('cancelled');
    const onIssued=()=>{task.actionRevision=(task.actionRevision||0)+1;issued=true;};
    if(record.operation.method==='press')await showAction(task,handle,'input',async()=>keyboardInput(handle,task.page,'press',await nativeKey(record.operation.key),{}, {cancelled:()=>active!==task||task.dialogs?.blocked,onIssued}));
    else {onIssued();if(record.operation.method==='point')await showAction(task,null,'click',()=>task.page.mouse.click(record.operation.x,record.operation.y));else await clickObserved(task,handle);}
    await followPopup(task,watcher);watcher=null;await settle(task);
    task.dialogs?.assertCanAct();
    return {result:{ok:true,actionIssued:true,observation:await observe(task),instruction:'The user-approved action was issued once. Verify the visible result before reporting completion. Do not click it again.'},tabId:task.tabId};
  } catch(error) {
    if (active === task && task?.dialogs?.blocked && error.message !== 'cancelled') error = new Error('browser_dialog');
    if (error.message === 'browser_dialog') return {result: {error: 'browser_dialog', reason: 'browser_dialog', actionIssued: issued,
      nativeDialogs: task.dialogs.snapshot(), instruction: scriptFailure(error).instruction}, tabId: task.tabId};
    return {result:{error:error.message==='cancelled'?'cancelled':issued?'approval_outcome_unknown':'approval_changed',actionIssued:issued,
      instruction:issued?'The approved action may have completed. Observe and verify the outcome; never repeat it automatically.':'The approved page, document, target or draft changed. Preserve current edits, re-observe and request a fresh approval before any final action.'},tabId:task?.tabId||record.tabId};
  } finally {
    await handle?.dispose().catch(()=>{});
    if(watcher){if(issued)await followPopup(task,watcher).catch(()=>{});else{watcher.close();task?.popupWatches.delete(watcher);}}
    await clearApproval(record);
  }
}
export async function runBrowserAgent(requestId, page, name, args = {}, {vision = false, onCapture, onImage, onApproval} = {}) {
  let task, issued = false;
  try {
    const preflight = name === 'run_playwright' ? preflightScript(args.code) : null;
    const passive = ['read_page', 'inspect_dom', 'browser_snapshot', 'list_tabs'].includes(name) || name === 'verify_page' && args.checks?.every(check => ['text_present', 'url_is'].includes(check.kind));
    task = await ensure(requestId, page, !preflight && !passive);
    if (['fill_form', 'click_element', 'hover_element', 'press_key', 'select_option', 'navigate_page', 'go_back', 'switch_tab', 'click_at', 'drag_element', 'scroll_page', 'request_approval'].includes(name)) task.dialogs?.assertCanAct();
    if (!task.approvalPause && await followDeferredPopups(task)) {
      await settle(task);
      return {result: {popupChanged: true, actionIssued: false, observation: await observe(task),
        instruction: 'A delayed popup from the earlier click is now available. This requested operation was not executed. Inspect this fresh page and choose the next action; do not repeat the opener click or reuse old refs.'}, tabId: task.tabId};
    }
    if(onApproval){task.onApproval=onApproval;task.approvalBaseRevision=task.actionRevision||0;}
    if(task.approvalPause)return {result:task.approvalPause,tabId:task.tabId};
    if (name === 'read_page' && args.mode === 'content') return {result: await readPageContent(task, args, safeURL, () => active !== task), tabId: task.tabId};
    if (preflight) {
      await clearRefs(task);
      const observation = task.app ? await observe(task) : await readWithoutDebugger(task, '', safeURL, () => active !== task);
      return {result: {...preflight, execution: {commands: [], omitted: 0}, actionIssued: false, observation}, tabId: task.tabId};
    }
    if (!task.app && ['read_page', 'inspect_dom', 'browser_snapshot'].includes(name)) {
      await clearRefs(task);
      return {result: await readWithoutDebugger(task, args.query || '', safeURL, () => active !== task), tabId: task.tabId};
    }
    if (name === 'verify_page') return {result: await verifyPage(task, args.checks), tabId: task.tabId};
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
          const value = await scriptCall(task, page, call, vision, onCapture);
          if (isScriptAction(call.method)) task.dialogs?.assertCanAct();
          command.state = 'returned';
          decisionBoundary ||= SCRIPT_TRANSITIONS.has(call.method) || priorTab !== task.tabId || priorURL !== task.page.url();
          return value;
        }
        catch (error) {command.state = 'failed'; command.reason = scriptFailure(error).reason; throw error;}
        finally {command.actionIssued = (task.actionRevision || 0) !== before;}
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
      if (args.full_page !== undefined && typeof args.full_page !== 'boolean') throw new Error('tool_arguments_invalid');
      const fullPage = args.full_page === true;
      task.screenshot = null;
      await clearActionPointer(task);
      await settle(task);
      const {screenshot, viewport, image} = await captureBrowserPage(task.page, {fullPage, cancelled: () => active !== task});
      browserURL(task.page.url());
      if (!fullPage) task.screenshot = screenshot;
      const observation = await observe(task), visualTargets = [];
      for (const [ref, entry] of fullPage ? [] : [...task.refs].slice(0, 180)) {
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
      const attachment = await onCapture?.(screenshot, image);
      return {result: {screenshot_id: screenshot.id, ...viewport, width: screenshot.width, height: screenshot.height, viewport, capture_mode: screenshot.mode, coverage: captureCoverage(screenshot, observation), image, observation, visualTargets, ...(attachment ? {attachment} : {}), scope: fullPage
        ? 'Full currently rendered top-level document, known secret fields masked. Reading/download evidence only, NOT click_at coordinates. Nested scroll areas, virtualized lists, collapsed sections and lazy/unloaded content are not expanded. Inspect observation.frames and their surfaces; scroll the relevant observed area, re-observe and capture each required section. Never claim all data was captured. For clicks scroll to the target, then use a fresh viewport capture or semantic ref.'
        : 'Current browser viewport only; known secret fields masked. Bounds use CSS pixels in this image. Match visual appearance to exact observed refs first. State hints are not verified state. Never infer a successful toggle from color alone.'}, tabId: task.tabId};
    }
    if (['read_page', 'inspect_dom', 'browser_snapshot'].includes(name)) return {result: await observe(task, args.query || ''), tabId: task.tabId};
    if (name === 'list_tabs') {
      const tabs = (await chrome.tabs.query(task.workspace ? {windowId: task.workspace.windowId} : {})).filter(tab => safeURL(tab.url) && (!task.workspace || task.workspace.tabIds.includes(tab.id))).slice(0, 40);
      task.tabs = new Set(tabs.map(tab => tab.id));
      return {result: {tabs: tabs.map(tab => ({tab_id: String(tab.id), window_id: String(tab.windowId), ...(tab.openerTabId ? {opener_tab_id: String(tab.openerTabId)} : {}), title: String(tab.title || '').slice(0, 180), url: safeURL(tab.url), current: tab.id === task.tabId}))}, tabId: task.tabId};
    }
    let action = {ok: true};
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
        await showAction(task, null, 'click', () => task.page.mouse.click(args.x, args.y));
      }
      finally {await followPopup(task, watcher);}
      action = {ok: true, actionIssued: true};
    } else if (name === 'switch_tab') {
      const id = Number(args.tab_id); if (!task.tabs.has(id)) throw new Error('browser_stale');
      await attachTab(task, id);
    } else if (name === 'navigate_page') {
      task.screenshot = null;
      const url = browserURL(args.url).href;
      if (args.new_tab === 'yes') {const openerId = task.tabId; const tab = await chrome.tabs.create({url, active: !task.workspace, openerTabId: openerId, ...(task.workspace ? {windowId: task.workspace.windowId} : {})}); await attachTab(task, tab.id, openerId, true);}
      else await task.page.goto(url, {waitUntil: 'domcontentloaded'});
    } else if (name === 'go_back') {task.screenshot = null; await task.page.goBack({waitUntil: 'domcontentloaded'});}
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
      if (!Array.isArray(args.fields) || !args.fields.length || args.fields.length > 20) throw new Error('fill_invalid');
      // Validate the complete set before any write. No auto-replay after partial failure.
      const entries = [];
      for (const field of args.fields) {
        if (typeof field.value !== 'string' || field.value.length > 16000) throw new Error('fill_invalid');
        const entry = await target(task, field.field_id);
        if (!['field', 'select', 'checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind)) throw new Error('fill_invalid');
        if (['checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind) && !['true', 'false'].includes(field.value)) throw new Error('fill_invalid');
        entries.push({...entry, value: field.value});
      }
      let applied = 0; await Promise.allSettled(task.receipts.map(entry => entry.handle.dispose())); task.receipts = [];
      for (const entry of entries) {
        issued = true;
        try {
          if (['checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind)) await setCheckedObserved(task, entry.handle, entry.value === 'true');
          else await showAction(task, entry.handle, 'input', () => entry.descriptor.kind === 'select' ? entry.handle.selectOption(entry.value) : entry.handle.fill(entry.value));
          applied++; task.receipts.push({...entry, handle: await entry.handle.evaluateHandle(el => el)});
        } catch (error) {return {result: {...scriptFailure(error), applied, actionIssued: issued, observation: await observe(task), instruction: 'Inspect the page and current control state. Do not replay fields already applied or blindly flip a toggle.'}, tabId: task.tabId};}
      }
      await delay(250);
      const matched = (await Promise.all(task.receipts.map(async entry => {
        try {return ['checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind) ? String((await entry.handle.evaluate(controlState)).state) === entry.value : await entry.handle.evaluate((el, expected) => el.isContentEditable ? el.innerText === expected : el.value === expected, entry.value);} catch {return false;}
      }))).filter(Boolean).length;
      action = {ok: matched === applied, applied, matched, verified: matched === applied, submitted: false, ...(matched !== applied ? {error: 'fill_not_retained'} : {})};
    } else if (name === 'verify_form') {
      if (!task.receipts.length) throw new Error('fill_no_receipt');
      const matched = (await Promise.all(task.receipts.map(async entry => {try {return ['checkbox', 'radio', 'switch', 'toggle'].includes(entry.descriptor.kind) ? String((await entry.handle.evaluate(controlState)).state) === entry.value : await entry.handle.evaluate((el, value) => el.isConnected && (el.isContentEditable ? el.innerText : el.value) === value, entry.value);} catch {return false;}}))).filter(Boolean).length;
      return {result: {ok: matched === task.receipts.length, matched, expected: task.receipts.length, submitted: false, ...(matched !== task.receipts.length ? {error: 'fill_not_retained'} : {})}, tabId: task.tabId};
    } else if (['click_element', 'hover_element', 'press_key', 'select_option'].includes(name)) {
      const entry = await target(task, args.ref);
      if(name==='click_element'||name==='press_key'&&/(?:Enter|Space|(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS])$/.test(args.key))await requireApproval(task,entry.handle,name==='press_key'?{method:'press',key:args.key}:{method:'click'});
      // Consume an action ref before dispatch, including uncertain timeout results.
      task.refs.delete(args.ref); issued = name !== 'press_key';
      const watcher = name === 'click_element' || name === 'press_key' && /(?:Enter|Space|(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS])$/.test(args.key) ? await popupWatch(task, entry.handle) : null;
      try {
        if (name === 'click_element') await clickObserved(task, entry.handle, {button: args.button === 'right' ? 'right' : 'left', clickCount: args.double === 'yes' ? 2 : 1});
        else if (name === 'hover_element') await hoverObserved(task, entry.handle);
        else if (name === 'select_option') await showAction(task, entry.handle, 'input', () => entry.handle.selectOption(args.values));
        else {
          if (!/^(?:(?:Control|Meta|Shift|Alt|ControlOrMeta)\+)*(?:Enter|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Backspace|Delete|Space|[a-zA-Z])$/.test(args.key)) throw new Error('tool_arguments_invalid');
          await showAction(task, entry.handle, 'input', async () => keyboardInput(entry.handle, task.page, 'press', await nativeKey(args.key), {}, {
            cancelled: () => active !== task || task.dialogs?.blocked, onIssued: () => {issued = true;},
          }));
        }
      } finally {try {await followPopup(task, watcher);} finally {await entry.handle.dispose().catch(() => {});}}
      action = {ok: true, actionIssued: true};
    } else throw new Error('tools_unavailable');
    await settle(task);
    task.dialogs?.assertCanAct();
    task.screenshot = null;
    return {result: {...action, observation: await observe(task)}, tabId: task.tabId};
  } catch (error) {
    if (active === task && task?.dialogs?.blocked && error.message !== 'cancelled') error = new Error('browser_dialog');
    if(task?.approvalPause)return {result:{...task.approvalPause,actionIssued:false},tabId:task.tabId};
    const allowed = ['workspace_changed', 'workspace_loading', 'drag_cross_frame', 'drag_approval_required', 'approval_required','approval_verification_required','approval_changed','cancelled', 'page_restricted', 'browser_stale', 'script_disabled', 'fill_invalid', 'fill_no_receipt', 'tool_arguments_invalid', 'tools_unavailable'];
    let observation;
    if (task && active === task && !['cancelled', 'page_restricted', 'tools_unavailable', 'workspace_changed'].includes(error.message)) {
      try {await clearRefs(task); observation = task.app ? await observe(task) : await readWithoutDebugger(task, '', safeURL, () => active !== task);} catch { /* Keep the original error when the page cannot be inspected. */ }
    }
    const feedback = scriptFailure(error);
    return {result: {error: allowed.includes(error.message) ? error.message : feedback.reason, reason: feedback.reason, actionIssued: issued, ...(observation ? {observation} : {}), ...(error.message === 'browser_dialog' ? {nativeDialogs: task.dialogs.snapshot()} : {}), ...(error.message === 'workspace_changed' ? {recovery:{strategy:'user_action',execution:'not_started'}} : {}), instruction: error.message === 'workspace_changed' ? 'The owned work tab was closed or moved. Ask the user to reconnect the intended page. Never switch to an unrelated user tab, recreate the workspace or replay prior writes automatically.' : error.message === 'drag_cross_frame' ? 'No drag was issued. Both endpoints must be in one frame. Inspect a supported same-frame target or ask about the intended outcome.' : error.message === 'drag_approval_required' ? 'No drag was issued. This target may finalize a transaction. Inspect the site explicit action, prepare and verify the draft, then use request_approval. Never substitute an unapproved click or coordinate drag.' : feedback.instruction}, tabId: task?.tabId || page.tabId};
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
async function scriptCall(task, originalPage, call, vision, onCapture) {
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
  let value, watcher;
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
      if(['click','dblclick'].includes(method)||method==='press'&&/(?:Enter|Space|(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS])$/.test(args[0]))await requireApproval(task,actionHandle,method==='press'?{method:'press',key:args[0]}:{method:'click'});
      if (['click', 'dblclick'].includes(method) || method === 'press' && /(?:Enter|Space|(?:Control|Meta|ControlOrMeta)\+(?:Shift\+)?[sS])$/.test(args[0])) watcher = await popupWatch(task, actionHandle);
    }
    if (mutating.has(method) && !['press', 'pressSequentially'].includes(method)) task.actionRevision = (task.actionRevision || 0) + 1;
    if (method === 'editorState' || method === 'selectText') {
      const operation = () => actionHandle.evaluate(editorOperation, {query: args[0] ?? '', select: method === 'selectText', expectedDigest: args[1]?.expectedDigest});
      value = method === 'selectText' ? await showAction(task, actionHandle, 'input', operation) : await operation();
    } else if (method === 'isChecked') {
      const state = await (actionHandle || locator).evaluate(controlState);
      if (state.state === undefined) throw new Error('script_control_state');
      value = state.state === true;
    } else if (['click', 'dblclick'].includes(method)) value = await clickObserved(task, actionHandle, args[0], method === 'dblclick');
    else if (method === 'hover') value = await hoverObserved(task, actionHandle, args[0]);
    else if (['check', 'uncheck', 'setChecked'].includes(method)) value = await setCheckedObserved(task, actionHandle, method === 'setChecked' ? args[0] : method === 'check');
    else if (['press', 'pressSequentially'].includes(method)) value = await showAction(task, actionHandle, 'input', () => keyboardInput(actionHandle, task.page, method, args[0], args[1], {
      cancelled: () => active !== task || task.dialogs?.blocked, onIssued: () => {task.actionRevision = (task.actionRevision || 0) + 1;},
    }));
    else {
      const operation = () => method === 'appendText' ? appendText(actionHandle, task.page, args[0], args[1], () => active !== task || task.dialogs?.blocked) : (actionHandle || locator)[method](...args);
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
  } finally {try {await followPopup(task, watcher);} finally {await actionHandle?.dispose().catch(() => {});}}
  if (mutating.has(method)) {
    task.screenshot = null; await delay(150);
  }
  return typeof value === 'string' ? value.slice(0, 16000) : Array.isArray(value) ? value.slice(0, 100).map(value => String(value).slice(0, 1000)) : value;
}
