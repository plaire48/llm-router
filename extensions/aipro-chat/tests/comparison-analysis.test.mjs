import test from 'node:test';
import assert from 'node:assert/strict';
import {createComparisonAnalysis} from '../comparison-analysis.js';

function setup(execute) {
  const jobs = [], batches = [], steps = [], launched = [];
  let enabled = true;
  const scheduler = createComparisonAnalysis({goal: '출처 비교', allowed: () => enabled,
    onStep: step => steps.push(step), onLaunch: id => launched.push(id),
    analyses: {status: () => jobs, execute: async (_, {tasks}) => {
      batches.push(tasks);
      if (execute) return execute(tasks);
      const added = tasks.map((task, i) => ({task_id: `task-${jobs.length + i}`, status: 'complete', delivered: false, task}));
      jobs.push(...added); return {ok: true, tasks: added};
    }}});
  const observe = (i, evidence = `ev_${i}`) => scheduler.observe(`source-${i}`, `https://source${i}.example/article`, evidence);
  return {...scheduler, observeSource: observe, jobs, batches, steps, launched, disable: () => {enabled = false;}};
}

test('new sources wait for undelivered reports, then fill freed slots without repeating delivered jobs', async () => {
  const s = setup();
  for (let i = 1; i <= 9; i++) {s.observeSource(i); await s.flush();}
  assert.equal(s.launched.length, 6);
  for (const job of s.jobs) job.delivered = true;
  await s.flush(); await s.flush();
  assert.equal(s.launched.length, 9);
  assert.deepEqual(s.batches.flat().map(task => task.evidence_ids[0]), Array.from({length: 9}, (_, i) => `ev_${i + 1}`));
  for (const job of s.jobs) job.delivered = true;
  s.observeSource(1, 'ev_reread'); await s.flush(); assert.equal(s.launched.length, 9);
});

test('capacity rejection retains the latest pending snapshot; noncapacity failures are attempted once', async () => {
  let busy = true;
  const s = setup(tasks => busy ? {ok: false, error: 'analysis_busy'} : {ok: true, tasks: tasks.map((_, i) => ({task_id: String(i)}))});
  s.observeSource(1); s.observeSource(2); await s.flush();
  s.observeSource(1, 'ev_fresh'); busy = false; await s.flush(); await s.flush();
  assert.equal(s.batches.length, 2); assert.equal(s.batches[1][0].evidence_ids[0], 'ev_fresh');
  for (const execute of [() => ({ok: false, error: 'analysis_scope'}), () => {throw Error('transport');}]) {
    const failed = setup(execute); failed.observeSource(1); failed.observeSource(2);
    await failed.flush().catch(() => {}); await failed.flush();
    assert.equal(failed.batches.length, 1);
  }
});

test('display snapshots do not duplicate query sources, while separate captured queries stay distinct', async () => {
  const s = setup(), url = 'https://search.example/results';
  s.observe(url, url, 'ev_display'); s.observeSource(2); await s.flush();
  s.observe('query-hash-a', url, 'ev_a'); s.observe(url, url, 'ev_display_again');
  await s.flush(); assert.equal(s.launched.length, 2);
  s.observe('query-hash-b', url, 'ev_b'); await s.flush();
  assert.equal(s.launched.length, 3); assert.equal(s.batches.at(-1)[0].evidence_ids[0], 'ev_b');
});

test('automatic source budget and disabling preserve pending work without dispatching it', async () => {
  const s = setup();
  for (let i = 1; i <= 20; i++) {s.observeSource(i); s.jobs.forEach(job => {job.delivered = true;}); await s.flush();}
  assert.equal(s.launched.length, 16);
  const cancelled = setup(); cancelled.observeSource(1); cancelled.observeSource(2); cancelled.disable();
  await cancelled.flush(); assert.equal(cancelled.batches.length, 0);
});
