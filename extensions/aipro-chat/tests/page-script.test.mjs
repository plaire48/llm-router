import test from 'node:test';
import assert from 'node:assert/strict';
import {pageScript, notePageLoading, PARSE_WAIT_MS} from '../page-script.js';

// chrome.scripting waits for an idle document. On a page whose own files arrive
// slowly the call never came back in time: measured, a navigation ended only at
// the tool's 30-second limit.
function browser({status = 'complete', states = []} = {}) {
  const calls = [];
  globalThis.chrome = {
    tabs: {get: async id => ({id, status})},
    scripting: {executeScript: async details => {
      calls.push(details);
      if (String(details.func).includes('readyState')) return [{result: states.length > 1 ? states.shift() : states[0]}];
      return [{documentId: 'document', result: 'read'}];
    }},
  };
  return calls;
}
const details = () => ({target: {tabId: 7, allFrames: true}, world: 'ISOLATED', func: () => 'read', args: [1]});
const clock = () => {let at = 1000; return {now: () => at, pause: async ms => {at += ms;}};};

test('a loaded tab is called exactly as before', async () => {
  const calls = browser(), request = details();
  assert.deepEqual(await pageScript(request), [{documentId: 'document', result: 'read'}]);
  assert.equal(calls.length, 1); assert.equal(calls[0], request); assert.equal(Object.hasOwn(calls[0], 'injectImmediately'), false);
});

test('a tab without a readable state is called exactly as before', async () => {
  const calls = browser(); chrome.tabs.get = async () => {throw new Error('No tab');};
  await pageScript(details());
  assert.equal(calls.length, 1); assert.equal(Object.hasOwn(calls[0], 'injectImmediately'), false);
});

test('a loading tab whose document is parsed is read at once', async () => {
  const calls = browser({status: 'loading', states: ['interactive']}), time = clock();
  await pageScript({...details(), target: {tabId: 8, allFrames: true}}, time);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].target, {tabId: 8, frameIds: [0]}); assert.equal(calls[0].injectImmediately, true); assert.equal(calls[0].world, 'ISOLATED');
  assert.equal(calls[1].injectImmediately, true); assert.deepEqual(calls[1].target, {tabId: 8, allFrames: true}); assert.deepEqual(calls[1].args, [1]);
  assert.equal(time.now(), 1000, 'no wait for a parsed document');
});

test('a document that finishes parsing is waited for', async () => {
  const calls = browser({status: 'loading', states: ['loading', 'loading', 'interactive']}), time = clock();
  await pageScript({...details(), target: {tabId: 9, documentIds: ['d1']}}, time);
  assert.equal(calls.length, 4); assert.equal(time.now(), 1200);
  assert.deepEqual(calls[0].target, {tabId: 9, documentIds: ['d1']}, 'the document that will be read is the one asked');
});

test('a document that does not finish is read after a bounded wait, and later reads do not wait again', async () => {
  const calls = browser({status: 'loading', states: ['loading']}), time = clock(), target = {tabId: 10, frameIds: [0]};
  assert.deepEqual(await pageScript({...details(), target}, time), [{documentId: 'document', result: 'read'}]);
  assert.equal(time.now() - 1000, PARSE_WAIT_MS); assert.equal(calls.at(-1).injectImmediately, true);
  const before = calls.length, at = time.now();
  await pageScript({...details(), target}, time);
  assert.equal(calls.length - before, 2, 'one look at the document and the read'); assert.equal(time.now(), at);
  // Ten seconds later the page gets its bounded wait again.
  await time.pause(10001); const later = time.now();
  await pageScript({...details(), target}, time);
  assert.equal(time.now() - later, PARSE_WAIT_MS);
});

test('a tool that already waited for the page spares the reads that follow', async () => {
  const calls = browser({status: 'loading', states: ['loading']}), time = clock();
  notePageLoading(11);
  const real = Date.now; Date.now = () => 1000;
  try {notePageLoading(11); await pageScript({...details(), target: {tabId: 11, frameIds: [0]}}, time);} finally {Date.now = real;}
  assert.equal(time.now(), 1000); assert.equal(calls.length, 2);
});

test('a document that cannot be looked at is left to the read itself', async () => {
  const calls = browser({status: 'loading'});
  chrome.scripting.executeScript = async request => {calls.push(request); if (String(request.func).includes('readyState')) throw new Error('Frame removed'); return [{result: 'read'}];};
  assert.deepEqual(await pageScript(details(), clock()), [{result: 'read'}]);
  assert.equal(calls.length, 2); assert.equal(calls[1].injectImmediately, true);
});
