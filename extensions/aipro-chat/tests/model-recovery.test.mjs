import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverModel, retryableModelError, activityDeadline, retryAfterMs, createModelCooldown} from '../model-recovery.js';

test('transient inference retries preserve the transcript and never repeat a completed browser write', async () => {
  const receipt = {tool: 'setChecked', changed: true}, wire = [{role: 'tool', content: JSON.stringify(receipt)}];
  let modelCalls = 0, browserWrites = 1; const retries = [];
  const result = await recoverModel(async () => {
    assert.equal(browserWrites, 1); assert.equal(JSON.parse(wire[0].content).changed, true);
    if (++modelCalls < 3) throw Object.assign(new Error('http'), {status: 503});
    return {next: 'verify_control_state'};
  }, {signal: new AbortController().signal, minTimeout: 1, onRetry: number => retries.push(number)});
  assert.equal(result.next, 'verify_control_state'); assert.deepEqual(retries, [1, 2]); assert.equal(browserWrites, 1);
});
test('a silent model attempt is cancelled and automatically replaced; late output is discarded', async () => {
  let attempts = 0, firstSignal;
  const result = await recoverModel(async ({signal}) => {
    if (++attempts === 1) {firstSignal = signal; return new Promise(resolve => setTimeout(() => resolve('late'), 40));}
    return 'recovered';
  }, {signal: new AbortController().signal, idleMs: 8, minTimeout: 1});
  assert.equal(result, 'recovered'); assert(firstSignal.aborted); assert.equal(attempts, 2);
});
test('auth rejection and user cancellation never resume the model automatically', async () => {
  for (const error of [Object.assign(new Error('unauthorized'), {status: 401}), new Error('cancelled')]) {
    let calls = 0;
    await assert.rejects(recoverModel(async () => {calls++; throw error;}, {signal: new AbortController().signal, minTimeout: 1}));
    assert.equal(calls, 1);
  }
  const controller = new AbortController(); let attempts = 0;
  await assert.rejects(recoverModel(async () => {attempts++; throw new Error('network');}, {signal: controller.signal, onRetry: () => controller.abort(), minTimeout: 1}), /cancelled/);
  assert.equal(attempts, 1);
  assert(!retryableModelError({message: 'fabrix_tool_protocol', status: 502}));
});
test('working tasks renew the inactivity deadline beyond the original duration', () => {
  let now = 0, id = 0, expired = 0; const timers = new Map();
  const clock = {setTimeout(fn, ms) {const key = ++id; timers.set(key, {fn, at: now + ms}); return key;}, clearTimeout(key) {timers.delete(key);}};
  const tick = ms => {now += ms; for (const [key, timer] of timers) if (timer.at <= now) {timers.delete(key); timer.fn();}};
  const deadline = activityDeadline(() => expired++, 100, clock);
  deadline.touch(); tick(80); deadline.touch(); tick(80); deadline.touch(); tick(80);
  assert.equal(expired, 0); tick(21); assert.equal(expired, 1);
  deadline.touch(); deadline.stop(); tick(200); assert.equal(expired, 1);
});

test('ongoing model events renew the request deadline through a long reasoning phase', async () => {
  let attempts = 0;
  const result = await recoverModel(async ({activity}) => {
    attempts++;
    for (let i=0;i<6;i++) {await new Promise(resolve=>setTimeout(resolve,4)); activity();}
    return 'complete';
  }, {signal: new AbortController().signal, idleMs: 18, minTimeout: 1});
  assert.equal(result,'complete'); assert.equal(attempts,1);
});

test('slow feedback measures inactivity, not total generation time, and ends on a parsed delta', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let activity, finish, ready;
  const started = new Promise(resolve => {ready = resolve;});
  const events = [];
  const result = recoverModel(scope => {
    activity = scope.activity; ready();
    return new Promise(resolve => {finish = resolve;});
  }, {signal: new AbortController().signal, slowMs: 15, idleMs: 120, attemptMs: 300,
    onSlow: attempt => events.push(['slow', attempt]), onResumed: attempt => events.push(['resumed', attempt])});
  await started;
  for (let i = 0; i < 10; i++) {t.mock.timers.tick(10); activity();}
  assert.deepEqual(events, [], '100ms of active generation must not be shown as waiting');
  t.mock.timers.tick(16);
  assert.deepEqual(events, [['slow', 1]]);
  activity();
  assert.deepEqual(events, [['slow', 1], ['resumed', 1]]);
  t.mock.timers.tick(16);
  assert.deepEqual(events, [['slow', 1], ['resumed', 1], ['slow', 1]], 'a distinct silent interval remains observable');
  finish('answer');
  assert.equal(await result, 'answer');
  t.mock.timers.tick(1000); activity();
  assert.equal(events.length, 3, 'no late progress after settlement');
});

test('parallel analysts keep independent inactivity feedback and cancellation clocks', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const controllers = [new AbortController(), new AbortController()];
  const activity = [], finishes = [], events = [], starts = [];
  const runs = controllers.map((controller, index) => {
    let ready; starts.push(new Promise(resolve => {ready = resolve;}));
    return recoverModel(scope => {
      activity[index] = scope.activity; ready();
      return new Promise(resolve => {finishes[index] = resolve;});
    }, {signal: controller.signal, slowMs: 15, idleMs: 120, attemptMs: 300,
      onSlow: () => events.push(index), onResumed: () => events.push(`resumed-${index}`)});
  });
  await Promise.all(starts);
  t.mock.timers.tick(10); activity[0]();
  t.mock.timers.tick(6);
  assert.deepEqual(events, [1]);
  controllers[1].abort();
  await assert.rejects(runs[1], /cancelled/);
  activity[1]();
  assert.deepEqual(events, [1], 'cancelled child output cannot clear or renew another call');
  finishes[0]('complete');
  assert.equal(await runs[0], 'complete');
});

test('Retry-After accepts seconds and HTTP dates, without treating malformed values as a delay', () => {
  const now = Date.parse('Tue, 22 Sep 2026 14:00:00 GMT');
  const read = value => retryAfterMs(new Headers({'Retry-After': value}), now);
  assert.equal(read('12'), 12000);
  assert.equal(read('Tue, 22 Sep 2026 14:00:05 GMT'), 5000);
  assert.equal(read('Tue, 22 Sep 2026 13:00:05 GMT'), 0);
  for (const value of ['', '-1', '0.5', 'Infinity', 'secret text']) assert.equal(read(value), undefined);
  assert.equal(read('9'.repeat(80)), Number.MAX_SAFE_INTEGER);
});

test('parallel inference shares the server cooldown and does not replay browser receipts', async () => {
  const cooldown = createModelCooldown(), signal = new AbortController().signal;
  const receipt = [{role: 'tool', content: '{"applied":1}'}], starts = [];
  let failedAt, firstAttempts = 0, second;
  const first = recoverModel(async () => {
    starts.push(['first', performance.now()]); assert.equal(JSON.parse(receipt[0].content).applied, 1);
    if (++firstAttempts === 1) {failedAt = performance.now(); throw Object.assign(new Error('rate_limited'), {status: 429, retryAfterMs: 40});}
    return 'first result';
  }, {signal, cooldown, minTimeout: 0, onRetry: () => {
    second ||= recoverModel(async () => {starts.push(['second', performance.now()]); return 'second result';}, {signal, cooldown, minTimeout: 0});
  }});
  assert.equal(await first, 'first result'); assert.equal(await second, 'second result');
  assert.equal(starts.length, 3); assert(starts.slice(1).every(([, time]) => time - failedAt >= 38));
});

test('long Retry-After pauses without an early retry and gates later analysts too', async () => {
  const cooldown = createModelCooldown(), signal = new AbortController().signal; let calls = 0;
  const invoke = () => recoverModel(async () => {calls++; throw Object.assign(new Error('upstream'), {status: 503, retryAfterMs: 3600000});}, {signal, cooldown, minTimeout: 0});
  await assert.rejects(invoke(), error => error.status === 503 && error.retryAfterMs === 3600000);
  await assert.rejects(invoke(), /upstream/); assert.equal(calls, 1);
});

test('cancelling while waiting for Retry-After prevents every later attempt', async () => {
  const controller = new AbortController(); let calls = 0;
  const run = recoverModel(async () => {calls++; throw Object.assign(new Error('rate_limited'), {status: 429, retryAfterMs: 1000});}, {
    signal: controller.signal, minTimeout: 0, onRetry: () => setTimeout(() => controller.abort(), 5),
  });
  await assert.rejects(run, /cancelled/); assert.equal(calls, 1);
});

test('retry exhaustion is bounded and optional progress errors do not break recovery', async () => {
  let calls = 0;
  await assert.rejects(recoverModel(async () => {calls++; throw Object.assign(new Error('upstream'), {status: 502});}, {
    signal: new AbortController().signal, minTimeout: 0, onRetry: () => {throw new Error('UI failed');},
  }), /upstream/);
  assert.equal(calls, 4);
  for (const status of [400, 401, 403, 404, 422]) assert.equal(retryableModelError({message: 'network', status}), false);
  assert(retryableModelError(new Error('model_stream_incomplete')));
});
