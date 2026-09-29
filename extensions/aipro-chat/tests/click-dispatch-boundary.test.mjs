import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import * as scriptAPI from '../browser-script-api.js';
import {executeScript, preflightScript} from '../script-sandbox.js';
import {scriptFailure} from '../script-feedback.js';
import {taskReceipt} from '../context-state.js';
import {unresolvedReconciliations} from '../restart-reconciliation.js';
import {publicSourceURL} from '../browser-public-url.js';
import {createScriptInputWitness} from '../browser-script-receipt.js';
import {observationEffect, noteRepeatedNoEffect} from '../browser-effect.js';

// Execute the actual module functions with host transports stubbed. Import
// removal is AST-based; click preparation, command dispatch/receipts and the
// QuickJS script executor remain production code. No Chrome or build is used.
const source = await readFile(new URL('../browser-agent.js', import.meta.url), 'utf8');
const edits = parse(source, {ecmaVersion: 'latest', sourceType: 'module'}).body.flatMap(node =>
  node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' && !node.declaration
    ? [[node.start, node.end]] : node.type === 'ExportNamedDeclaration' ? [[node.start, node.declaration.start]] : []);
const isolatedSource = edits.reverse().reduce((text, [start, end]) => text.slice(0, start) + text.slice(end), source);

function fixture(failure = 'hover', {receipt = false, childFrame = false, covered = false} = {}) {
  const effects = [];
  const node = {closest: selector => receipt && selector === 'a[href]' ? {href: 'https://example.com/video?token=PRIVATE#secret'} : null,
    tagName: receipt ? 'A' : 'BUTTON', type: 'button', isContentEditable: false, matches: () => true, scrollIntoView() {}};
  const handle = {
    asElement: () => handle,
    evaluate: async (fn, arg) => fn(node, arg), evaluateHandle: async () => handle,
    scrollIntoViewIfNeeded: async () => {effects.push('scroll'); if (failure === 'scroll') throw Error('scroll preparation failed');},
    hover: async () => {effects.push('hover'); if (failure === 'hover') throw Error('element intercepts pointer events');},
    click: async () => {effects.push('click'); if (failure === 'click_obscured') throw Error('element intercepts pointer events'); if (failure === 'click') throw Error('connection closed after dispatch');},
    dblclick: async () => {effects.push('dblclick'); if (failure === 'click_obscured') throw Error('element intercepts pointer events'); if (failure === 'click') throw Error('connection closed after dispatch');},
    fill: async () => {effects.push('fill');}, dispose: async () => {},
  };
  const observation = {url: 'https://example.com/policy', tabId: 10, topDocumentId: 'doc-1', frames: receipt ? [
    {frame: childFrame ? 1 : 0, documentId: failure === 'missing_document' ? undefined : childFrame ? 'child-doc' : 'doc-1', elements: [{ref: 'observed'}]},
  ] : []};
  const frame = {url: () => observation.url, isDetached: () => false};
  const task = {id: 'owned', tabId: 10, app: true, refs: new Map(), receipts: [], popupWatches: new Set(),
    actionRevision: 0, latestObservation: observation, page: {url: () => observation.url}, dialogs: {assertCanAct() {}, async waitForDecision() {}}};
  const viewport = {width: 800, height: 600, scrollX: 0, scrollY: 0};
  task.screenshot = {id: 'shot-1', url: observation.url, at: Date.now(), ...viewport};
  let viewportReads = 0;
  task.page.evaluate = async () => {
    viewportReads++;
    return {...viewport, ...(failure === 'viewport' && viewportReads > 1 ? {scrollY: 10} : {})};
  };
  task.page.evaluateHandle = async () => handle;
  task.page.mouse = {click: async () => {
    effects.push('mouse.click');
    assert.equal(task.actionRevision, 1, 'revision must advance before mouse dispatch');
    if (failure === 'mouse') throw Error('connection closed after dispatch');
  }};
  let documentReads = 0, targetReads = 0;
  const context = vm.createContext({...scriptAPI, executeScript, preflightScript, scriptFailure, createScriptInputWitness, observationEffect, noteRepeatedNoEffect,
    sourceURL: publicSourceURL, browserURL: value => value, assertBrowserPolicy() {},
    observedDocumentScope: async () => {
      if (failure === 'receipt_failed') throw Error('document observation failed');
      documentReads++;
      return [{frameId: 0, documentId: failure === 'document_change' && documentReads > 1 ? 'doc-2' : 'doc-1', result: {url: observation.url}},
        ...(childFrame ? [{frameId: 7, documentId: 'child-doc', result: {url: observation.url}}] : [])];
    },
    inspectTarget: () => {
      targetReads++;
      const state = {connected: true, name: failure === 'identity_change' && targetReads >= 3 ? 'Changed target' : 'Observed target',
        role: receipt ? 'link' : 'button', type: 'button', hidden: false, secret: failure === 'sensitive'};
      const changed = {receipt_name_change: {name: 'Other name'}, receipt_role_change: {role: 'checkbox'},
        receipt_type_change: {type: 'checkbox'}, receipt_secret_change: {secret: true}, receipt_connected_change: {connected: false}};
      return {...state, ...(failure === 'long_name' ? {name: 'x'.repeat(180)} : {}),
        ...(failure === 'long_role' ? {role: 'x'.repeat(81)} : {}), ...(targetReads === 3 ? changed[failure] : {})};
    },
    clickTarget: value => value, pointerPosition: () => covered ? null : {x: 4, y: 4}, pointerCover: () => null, pointerBlocker: () => ({kind: 'same_row', tag: 'button', role: 'button', name: '삭제'}),
    approvalTarget: () => null, restoreFieldBaseline() {}, settlePointerTravel: async () => {},
    withActionPointer: async (_task, _handle, _kind, fn) => {
      if (failure === 'pointer') throw Error('pointer preparation failed');
      return fn();
    }, clearApproval: async () => {},
    bindApproval: async () => handle, crypto: globalThis.crypto,
    // No actual wait is needed for mocked host settlement.
    setTimeout: fn => {queueMicrotask(fn); return 0;}, clearTimeout() {},
    mockTask: task, mockHandle: handle, mockObservation: observation, mockFailure: failure, mockFrame: frame,
  });
  vm.runInContext(isolatedSource + `
    ensure = async () => {active = mockTask; return mockTask;};
    observe = async () => {if (mockFailure === 'observe') throw Error('observation failed'); return mockObservation;};
    target = async () => ({handle: mockHandle, frame: mockFrame, descriptor: {kind: 'button'}});
    settle = async () => {if (mockFailure === 'settle') throw Error('settlement failed');};
    restoreOpener = async () => {};
    clearRefs = async () => {};
    followDeferredPopups = async () => false;
    popupWatch = async () => ({setHint() {},close() {}});
    followPopup = async () => {if (mockFailure === 'popup') throw Error('popup follow failed');};
    linkHint = async () => ({});
    requireApproval = async () => {if (mockFailure === 'approval') throw Error('approval_required');};
    globalThis.host = {runBrowserAgent, runApprovedAction};
  `, context);
  return {effects, task, host: context.host};
}

function pendingAfter(result) {
  const before = taskReceipt({requestId: 'owned', steps: []}, 'run_playwright', 'start', {reconciliation: {version: 2, unverifiable: true}});
  return unresolvedReconciliations(taskReceipt(before, 'run_playwright', 'end', result, result.observation));
}

test('script preparation failure records no click and does not create an unreconcilable action', async () => {
  for (const stage of ['scroll', 'hover']) {
    const {host, effects, task} = fixture(stage);
    const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'run_playwright', {code: 'await browser.ref("observed").click();'});
    assert(result.error); assert.equal(result.actionIssued, false); assert.equal(task.actionRevision, 0);
    assert.equal(result.execution.commands[0].actionIssued, false);
    assert(effects.includes(stage)); assert(!effects.includes('click')); assert.equal(pendingAfter(result).length, 0);
    if (stage === 'hover') assert.equal(result.reason, 'script_obscured');
  }
});

test('a target covered at every point is never clicked in the middle blindly', async () => {
  // Playwright accepts a hit on a control inside the target, such as a delete
  // button a mail row shows on hover. With no clear point nothing is pressed.
  const {host, effects, task} = fixture('none', {covered: true});
  const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'click_element', {ref: 'observed'});
  assert.equal(result.reason, 'script_obscured', JSON.stringify(result)); assert.equal(result.actionIssued, false);
  assert.deepEqual(result.blocker, {kind: 'same_row', tag: 'button', role: 'button', name: '삭제'});
  assert(!effects.includes('hover') && !effects.includes('click'), JSON.stringify(effects)); assert.equal(task.actionRevision, 0);
});

test('failure after actual click or double-click invocation remains uncertain', async () => {
  for (const method of ['click', 'dblclick']) for (const failure of ['click', 'click_obscured']) {
    const {host, effects} = fixture(failure);
    const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'run_playwright', {code: `await browser.ref("observed").${method}();`});
    assert(result.error); assert.equal(result.actionIssued, true, JSON.stringify({result,effects}));
    assert.equal(result.execution.commands[0].actionIssued, true); assert(effects.includes(method));
    assert.equal(pendingAfter(result).length, 1);
    if (failure === 'click_obscured') assert.equal(result.reason, 'script_obscured');
  }
});

test('a completed earlier fill is preserved when a later click fails during preparation', async () => {
  const {host, effects} = fixture('hover');
  const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'run_playwright', {
    code: 'await browser.ref("field").fill("draft"); await browser.ref("link").click();'});
  assert(result.error); assert.equal(result.actionIssued, true, JSON.stringify({result,effects}));
  assert.deepEqual(Array.from(result.execution.commands, command => [command.method, command.state, command.actionIssued]),
    [['fill', 'returned', true], ['click', 'failed', false]]);
  // This dispatch-boundary fixture has no observed input/document identity.
  // Its completed fill remains issued, but cannot mint a target/readback proof.
  assert.equal(result.execution.commands[0].inputReceipt.targetStatus,'unknown');
  assert.equal(result.execution.commands[0].inputReceipt.readback.status,'unknown');
  assert(effects.includes('fill')); assert(!effects.includes('click')); assert.equal(pendingAfter(result).length, 1);
});

test('semantic and approved clicks share the same dispatch boundary', async () => {
  for (const stage of ['hover', 'click', 'success']) {
    for (const approved of [false, true]) {
      const {host, effects} = fixture(stage);
      const {result} = approved
        ? await host.runApprovedAction('owned', {tabId: 10}, {tabId: 10, operation: {method: 'click'}})
        : await host.runBrowserAgent('owned', {tabId: 10}, 'click_element', {ref: 'observed'});
      assert.equal(result.actionIssued, stage !== 'hover', JSON.stringify(result));
      assert.equal(effects.includes('click'), stage !== 'hover');
      if (stage === 'success') assert.equal(result.ok, true, JSON.stringify({result,effects}));
      else assert(result.error);
      if (approved) assert.equal(result.error, stage === 'hover' ? 'approval_changed' : stage === 'click' ? 'approval_outcome_unknown' : undefined);
    }
  }
});

test('coordinate click preparation failures retain an unissued receipt', async () => {
  for (const stage of ['screenshot', 'viewport', 'approval', 'pointer']) {
    const {host, effects, task} = fixture(stage);
    const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'click_at', {
      screenshot_id: stage === 'screenshot' ? 'old-shot' : 'shot-1', x: 50, y: 50,
    }, {vision: true});
    assert(result.error, stage);
    assert.equal(result.actionIssued, false, stage);
    assert.equal(task.actionRevision, 0, stage);
    assert(!effects.includes('mouse.click'), stage);
  }
});

test('coordinate click dispatch and later failures retain an issued receipt', async () => {
  for (const stage of ['mouse', 'popup', 'settle', 'observe', 'success']) {
    const {host, effects, task} = fixture(stage);
    const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'click_at', {
      screenshot_id: 'shot-1', x: 50, y: 50,
    }, {vision: true});
    assert.equal(result.actionIssued, true, JSON.stringify({stage, result}));
    assert.equal(task.actionRevision, 1, stage);
    assert.deepEqual(effects, ['mouse.click'], stage);
    if (stage === 'success') assert.equal(result.ok, true);
    else assert(result.error, stage);
  }
});

test('semantic click target receipt binds fresh document identity and survives post-dispatch failures', async () => {
  for (const stage of ['success', 'click', 'popup', 'settle', 'observe']) {
    const {host, effects} = fixture(stage, {receipt: true});
    const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'click_element', {ref: 'observed'});
    const receipt = result.actionTargetReceipt;
    assert.equal(receipt.status, 'observed', JSON.stringify({stage, result}));
    assert.equal(receipt.actionIssued, true);
    assert.deepEqual(JSON.parse(JSON.stringify(receipt.target)), {tabId: 10, topDocumentId: 'doc-1', frameId: 0,
      documentId: 'doc-1', role: 'link', name: 'Observed target', tag: 'a', href: 'https://example.com/video'});
    assert(!JSON.stringify(receipt).includes('PRIVATE'));
    assert(effects.includes('click'));
    if (stage !== 'success') assert(result.error);
  }
});

test('missing or changed document identity never certifies a semantic click target', async () => {
  for (const stage of ['missing_document', 'document_change', 'receipt_failed']) {
    const {host, effects} = fixture(stage, {receipt: true});
    const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'click_element', {ref: 'observed'});
    assert.equal(result.actionTargetReceipt.status, 'unknown', stage);
    assert.equal(result.actionTargetReceipt.actionIssued, true, stage);
    assert.equal(result.actionTargetReceipt.target, undefined, stage);
    assert(effects.includes('click'));
  }
});

test('same-URL child target uses the observed child document and host frame ID', async () => {
  const {host} = fixture('success', {receipt: true, childFrame: true});
  const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'click_element', {ref: 'observed'});
  assert.equal(result.actionTargetReceipt.status, 'observed');
  assert.equal(result.actionTargetReceipt.target.topDocumentId, 'doc-1');
  assert.equal(result.actionTargetReceipt.target.documentId, 'child-doc');
  assert.equal(result.actionTargetReceipt.target.frameId, 7);
});

test('a target change during receipt capture stays unknown even if it returns before dispatch', async () => {
  for(const stage of ['receipt_name_change','receipt_role_change','receipt_type_change','receipt_secret_change','receipt_connected_change']) {
    const {host,effects}=fixture(stage,{receipt:true});
    const {result}=await host.runBrowserAgent('owned',{tabId:10},'click_element',{ref:'observed'});
    assert.equal(result.actionIssued,true,stage);
    assert.equal(result.actionTargetReceipt.status,'unknown',stage);
    assert.equal(result.actionTargetReceipt.reason,'target_identity_changed',stage);
    assert.equal(result.actionTargetReceipt.target,undefined,stage);
    assert(effects.includes('click'));
  }
});

test('semantic target changes, sensitive targets and preparation failures do not publish a dispatch target', async () => {
  for (const stage of ['hover', 'identity_change', 'sensitive']) {
    const {host, effects} = fixture(stage, {receipt: true});
    const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'click_element', {ref: 'observed'});
    assert(result.error, stage);
    assert.equal(result.actionIssued, false, stage);
    assert.equal(result.actionTargetReceipt.status, 'unknown', stage);
    assert.equal(result.actionTargetReceipt.actionIssued, false, stage);
    assert.equal(result.actionTargetReceipt.target, undefined, stage);
    assert(!effects.includes('click'), stage);
  }
});

test('possibly truncated names or roles cannot certify complete click-target attribution', async () => {
  for (const stage of ['long_name', 'long_role']) {
    const {host} = fixture(stage, {receipt: true});
    const {result} = await host.runBrowserAgent('owned', {tabId: 10}, 'click_element', {ref: 'observed'});
    assert.equal(result.actionIssued, true);
    assert.equal(result.actionTargetReceipt.status, 'unknown');
    assert.equal(result.actionTargetReceipt.reason, 'target_description_incomplete');
    assert.equal(result.actionTargetReceipt.target, undefined);
  }
});
