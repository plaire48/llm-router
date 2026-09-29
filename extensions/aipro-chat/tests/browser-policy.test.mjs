import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserPolicyReader, assertBrowserPolicy} from '../browser-policy.js';
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const flush = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
function fixture() {
  const calls = [], timers = new Map(); let timerId = 0;
  const reader = createBrowserPolicyReader({read: () => {const call = deferred(); calls.push(call); return call.promise;},
    setTimer: (callback, delay) => {assert.equal(delay, 5000); timers.set(++timerId, callback); return timerId;}, clearTimer: id => timers.delete(id)});
  return {...reader, calls, expire: () => {for (const [id, callback] of timers) {timers.delete(id); callback();}}};
}
const blocked = reader => assert.throws(() => assertBrowserPolicy('https://example.org', 'AutomationEnabled', reader.snapshot()), /browser_policy_invalid/);

test('pending managed startup is fail-closed; concurrent and timed-out waiters share one API call', async () => {
  const reader = fixture(); blocked(reader);
  const waits = Array.from({length: 20}, () => reader.refresh()); await flush();
  assert.equal(reader.calls.length, 1); blocked(reader);
  reader.expire(); assert((await Promise.all(waits)).every(policy => policy.invalid));
  for (let i = 0; i < 20; i++) assert.equal((await reader.refresh()).invalid, true);
  assert.equal(reader.calls.length, 1); blocked(reader);
});
test('a late valid response recovers only its current generation, without a retry', async () => {
  const reader = fixture(), pending = reader.refresh(); await flush(); reader.expire(); await pending;
  reader.calls[0].resolve({AllowedOrigins: ['https://example.org']}); await flush();
  assert.doesNotThrow(() => assertBrowserPolicy('https://example.org', 'AutomationEnabled', reader.snapshot()));
  const copy = reader.snapshot(); copy.AllowedOrigins[0] = 'https://other.org';
  assert.equal(reader.snapshot().AllowedOrigins[0], 'https://example.org'); assert.equal(reader.calls.length, 1);
});
test('refresh never allows a previous successful policy while the fresh read is unresolved', async () => {
  const reader = fixture(), first = reader.refresh(); await flush(); reader.calls[0].resolve({}); await first;
  assert.deepEqual(reader.snapshot(), {});
  const second = reader.refresh(); blocked(reader); await flush(); assert.equal(reader.calls.length, 2);
  reader.calls[1].reject(Error('unavailable')); assert.equal((await second).invalid, true); blocked(reader);
});
test('policy changes invalidate an in-flight result without overlapping or accumulating reads', async () => {
  const reader = fixture(), first = reader.refresh(); await flush();
  const changed = reader.refresh({invalidate:true});
  reader.expire(); await Promise.all([first, changed]);
  for (let i = 0; i < 20; i++) await reader.refresh({invalidate:true});
  assert.equal(reader.calls.length, 1);
  reader.calls[0].resolve({AutomationEnabled:true}); await flush(); blocked(reader);
  const fresh = reader.refresh(); await flush(); assert.equal(reader.calls.length, 2);
  reader.calls[1].resolve({AutomationEnabled:false}); await fresh;
  assert.deepEqual(reader.snapshot(), {AutomationEnabled:false});
  assert.throws(() => assertBrowserPolicy(null, 'AutomationEnabled', reader.snapshot()), /browser_policy_blocked/);
});
test('malformed policy and synchronous failures settle fail-closed and permit only an explicit next attempt', async () => {
  const reader = fixture(), first = reader.refresh(); await flush(); reader.calls[0].resolve({AutomationEnabled:'yes'}); await first; blocked(reader);
  const immediate = createBrowserPolicyReader({read: () => {throw Error('unavailable');}});
  assert.equal((await immediate.refresh()).invalid, true);
  assert.equal(reader.calls.length, 1);
});

test('actual managed change handler invalidates immediately and cancels work without waiting for policy I/O', async () => {
  const {readFile} = await import('node:fs/promises'), {runInNewContext} = await import('node:vm');
  const source = await readFile(new URL('../public/background.js', import.meta.url), 'utf8');
  const start = source.lastIndexOf('chrome.storage.onChanged.addListener((changes,area)=>{');
  assert(start >= 0);
  const events = [], reader = fixture(); let listener;
  runInNewContext(source.slice(start), {
    chrome: {storage: {onChanged: {addListener: callback => {listener = callback;}}}},
    refreshBrowserPolicy: options => {events.push('invalidate'); assert.equal(options.invalidate, true); return reader.refresh(options);},
    getSession: async () => {events.push('session'); return {chatLease:{id:'running-request'}};},
    runner: {cancel: id => {assert.equal(id,'running-request'); events.push('runner-cancel');}},
    referenceReads: {cancel: id => {assert.equal(id,'running-request'); events.push('reads-cancel');}},
    stopBrowserAgent: async id => {assert.equal(id,'running-request'); events.push('browser-stop');},
    serial: async callback => {events.push('serial'); await callback();},
    stopRecording: async () => {events.push('recording-stop');},
  });
  listener({}, 'local'); assert.deepEqual(events, []);
  listener({}, 'managed'); blocked(reader); await flush();
  assert.equal(reader.calls.length, 1);
  assert.deepEqual(events, ['invalidate','session','runner-cancel','reads-cancel','browser-stop','serial','recording-stop']);
  // Policy never resolved and its wait timer never fired before cancellation.
  reader.calls[0].resolve({AutomationEnabled:false}); await flush();
  assert.deepEqual(reader.snapshot(), {AutomationEnabled:false});
});
