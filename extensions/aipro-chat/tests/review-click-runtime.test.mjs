import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const catalog = browserTools({}, BUILTIN_SKILLS.find(s => s.id === 'browser-agent'));
const tools = catalog.filter(t => ['click_element', 'verify_page', 'ask_user'].includes(t.function.name));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const clicked = () => ({ok: true, actionIssued: true, actionTargetReceipt: {
  dataKind: 'click_target_dispatch', version: 1, status: 'observed', actionIssued: true,
  target: {tabId: 1, frameId: 0, documentId: 'doc', topDocumentId: 'doc', role: 'button', name: 'Play', tag: 'button'},
}});

for (const mode of ['observed', 'missing', 'unissued', 'resumed']) {
  test(`runtime passes actual click receipt to final review: ${mode}`, async () => {
    let round = 0, ledger;
    const sequence = [
      ...(mode === 'resumed' ? [call('verify_page', {checks: [{kind: 'text_present', expected: 'Ready'}]})] : []),
      call('select_tools', {groups: ['interaction']}),
      call('click_element', {ref: 'r1'}),
      call('verify_page', {checks: [{kind: 'text_present', expected: 'Playing'}]}),
    ];
    await runAgent({messages: [{role: 'user', content: '재생 버튼만 누르고 확인해줘. 좋아요는 누르지 마.'}],
      tools, harness: true, stepwise: false, resumeVerification: mode === 'resumed', signal: new AbortController().signal,
      complete: async () => {
        if (round < sequence.length) return sequence[round++];
        if (++round > sequence.length + 2) throw Error('unexpected_retry');
        return {content: '재생 상태를 확인했습니다.'};
      },
      execute: async name => {
        if (name === 'verify_page') return {ok: true, verified: true, checks: [{kind: 'text_present', passed: true}]};
        assert.equal(name, 'click_element');
        if (mode === 'missing') return {ok: true, actionIssued: true};
        if (mode === 'unissued') return {error: 'browser_stale', actionIssued: false};
        return clicked();
      },
      // This tests evidence delivery, not semantic compliance or product scoring.
      reviewGoal: async ({executionLedger}) => {ledger = executionLedger; return {status: 'complete'};},
    });
    assert(ledger, 'final review must run');
    assert.equal(ledger.clickTargetReceipts.length, 1);
    assert.equal(ledger.clickTargetReceipts[0].outcome, mode === 'unissued' ? 'error' : 'returned');
    assert.equal(ledger.clickTargetReceipts[0].status, ['observed', 'resumed'].includes(mode) ? 'observed' : 'unknown');
    assert.equal(ledger.allPageInteractionTargetsObserved, mode === 'observed');
    assert.equal(ledger.taskStartObserved, mode !== 'resumed');
    assert.equal(ledger.noPageInteractionToolsInvoked, false);
  });
}
