import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {createStateSync} from '../state-sync.js';

const fast = {retryDelay: () => 1, timeoutMs: 20, intervalMs: 5};
test('three failed reads pause even when notifications continue; explicit resume only reads state', async () => {
  let calls = 0, fail = true; const updates = [], statuses = [];
  const sync = createStateSync({...fast, read: async () => {calls++; if (fail) throw new Error('storage_failed'); return {busy: false, revision: 2};}, onData: value => updates.push(value), onStatus: value => statuses.push(value)});
  try {
    await sync.refresh(); assert.equal(calls, 3); assert.equal(statuses.at(-1).paused, true);
    for (let i = 0; i < 20; i++) {sync.invalidate(); await sync.refresh();}
    await sleep(25); assert.equal(calls, 3); assert.deepEqual(updates, []);
    fail = false; await sync.resume(); assert.equal(calls, 4); assert.equal(updates[0].revision, 2); assert.equal(statuses.at(-1).paused, false);
    await sleep(25); assert.equal(calls, 4, 'Completed jobs do not poll');
  } finally {sync.dispose();}
});

test('the last confirmed state survives failed refresh and is replaced only by a successful read', async () => {
  let fail = false, revision = 1; const updates = [];
  const sync = createStateSync({...fast, read: async () => {if (fail) throw new Error('temporary'); return {revision};}, onData: value => updates.push(value)});
  try {
    await sync.refresh(); fail = true; await sync.refresh(); assert.deepEqual(updates, [{revision: 1}]);
    fail = false; revision = 2; await sync.resume(); assert.deepEqual(updates, [{revision: 1}, {revision: 2}]);
  } finally {sync.dispose();}
});

test('a burst during an in-flight read produces one trailing refresh without overlap or lost changes', async () => {
  let calls = 0, active = 0, maxActive = 0; const resolve = [], updates = [];
  const sync = createStateSync({...fast, timeoutMs: 1000, read: () => {calls++; maxActive = Math.max(maxActive, ++active); return new Promise(done => resolve.push(value => {active--; done(value);}));}, onData: value => updates.push(value)});
  try {
    const first = sync.refresh(); await sleep(0);
    const burst = Array.from({length: 20}, () => sync.refresh()); assert.equal(calls, 1);
    resolve.shift()({revision: 1}); await first; await sleep(0); assert.equal(calls, 2);
    resolve.shift()({revision: 2}); await Promise.all(burst);
    assert.equal(calls, 2); assert.equal(maxActive, 1); assert.deepEqual(updates, [{revision: 1}, {revision: 2}]);
  } finally {sync.dispose();}
});

test('hung reads time out finitely and late responses cannot overwrite resumed state', async () => {
  const pending = [], updates = [], statuses = []; let hang = true;
  const sync = createStateSync({...fast, read: () => hang ? new Promise(resolve => pending.push(resolve)) : {revision: 4}, onData: value => updates.push(value), onStatus: value => statuses.push(value)});
  try {
    await sync.refresh(); assert.equal(pending.length, 3); assert.equal(statuses.at(-1).paused, true);
    hang = false; await sync.resume(); pending.forEach(resolve => resolve({revision: 0})); await sleep(0);
    assert.deepEqual(updates, [{revision: 4}]);
  } finally {sync.dispose();}
});

test('invalidated extension contexts do not retry and unmount cancels pending retries', async () => {
  let calls = 0; const statuses = [];
  const sync = createStateSync({...fast, read: async () => {calls++; throw new Error('Extension context invalidated.');}, onData: () => assert.fail('No result'), onStatus: value => statuses.push(value)});
  await sync.refresh(); sync.dispose(); assert.equal(calls, 1); assert.deepEqual(statuses, [{paused: true, reload: true}]);
  const stopped = createStateSync({...fast, retryDelay: () => 30, read: async () => {calls++; throw new Error('temporary');}, onData: () => assert.fail('Disposed'), onStatus: () => assert.fail('Disposed')});
  const waiting = stopped.refresh(); await sleep(1); stopped.dispose(); await waiting; await sleep(40); assert.equal(calls, 2);
});

test('polling follows active jobs and stops on completion or while hidden', async () => {
  let calls = 0;
  const sync = createStateSync({...fast, read: async () => ({busy: ++calls < 2}), onData: () => {}});
  try {await sync.refresh(); await sleep(40); assert.equal(calls, 2);} finally {sync.dispose();}
  let visible = false; calls = 0;
  const hidden = createStateSync({...fast, visible: () => visible, read: async () => ({busy: ++calls < 2}), onData: () => {}});
  try {
    await hidden.refresh(); await sleep(25); hidden.invalidate(); assert.equal(calls, 1);
    visible = true; hidden.invalidate(); await sleep(110); assert.equal(calls, 2);
  } finally {hidden.dispose();}
});
