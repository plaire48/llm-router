import {openDB} from 'idb';
import {normalizeTrace, normalizeTraceId} from './agent-trace.js';

// This is a presentation event journal, never an execution log or replay queue.
export const TRACE_JOURNAL_LIMITS = Object.freeze({perRun: 10000, total: 50000, runs: 512, page: 50});
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export function traceJournalKey(owner) {
  if (!['aipro', 'chatgpt', 'fabrix'].includes(owner?.provider) ||
      ![owner.conversationId, owner.requestId].every(value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value))) throw new Error('trace_owner_invalid');
  return JSON.stringify([owner.provider, owner.conversationId, owner.requestId]);
}
export function journalEvent(step) {
  const safe = normalizeTrace([step])[0];
  if (!safe?.id || safe.tool === 'progress_note') return null;
  const event = {id: safe.id, tool: safe.tool, status: safe.status};
  if (safe.reason) event.reason = safe.reason;
  const source = safe.analysis;
  if (source) {
    const analysis = {phase: source.phase, delivered: source.delivered === true};
    if (['planner', 'research', 'recovery', 'synthesis', 'coordinator', 'page', 'review'].includes(source.role)) analysis.role = source.role;
    if (['complete', 'partial', 'blocked'].includes(source.outcome)) analysis.outcome = source.outcome;
    if (['internal', 'external'].includes(source.wiki)) analysis.wiki = source.wiki;
    for (const name of ['calls', 'reads', 'completed', 'total', 'workerId', 'synthesisId', 'sourceCount']) if (integer(source[name]) !== undefined) analysis[name] = source[name];
    if (typeof source.runId === 'string' && /^[a-z]+-[a-f0-9-]{36}$/i.test(source.runId)) analysis.runId = source.runId;
    if (['synthesis', 'main'].includes(source.deliveredTo)) analysis.deliveredTo = source.deliveredTo;
    if (normalizeTraceId(source.parentId)) analysis.parentId = source.parentId;
    if (Array.isArray(source.assignment?.documentIds)) analysis.documentCount = source.assignment.documentIds.length;
    const range = source.range || source.assignment?.range;
    if (integer(range?.start) !== undefined && integer(range?.end) !== undefined && range.end > range.start) analysis.range = {start: range.start, end: range.end};
    event.analysis = analysis;
  }
  // No task text, label, summary, input, output, token, image or document body.
  return event;
}
export const journalDatabase = (name = 'nubi-trace-journal') => () => openDB(name, 1, {upgrade(db) {
  const events = db.createObjectStore('events', {keyPath: 'key', autoIncrement: true});
  events.createIndex('run', 'run');
  const runs = db.createObjectStore('runs', {keyPath: 'key'});
  runs.createIndex('created', 'created');
}});

export function createTraceJournal({open = journalDatabase(), limits = TRACE_JOURNAL_LIMITS, eventFor = journalEvent, autoSequence = false} = {}) {
  async function using(action) {const db = await open(); try {return await action(db);} finally {db.close();}}
  async function removeRun(tx, key) {
    let cursor = await tx.objectStore('events').index('run').openCursor(key);
    while (cursor) {await cursor.delete(); cursor = await cursor.continue();}
    await tx.objectStore('runs').delete(key);
  }
  async function append(owner, step, sequence, at = Date.now()) {
    const key = traceJournalKey(owner), event = eventFor(step);
    if (!event || !(autoSequence && sequence === undefined) && (!Number.isSafeInteger(sequence) || sequence < 1)) return false;
    return using(async db => {
      const tx = db.transaction(['runs', 'events'], 'readwrite'), runs = tx.objectStore('runs'), events = tx.objectStore('events');
      const run = await runs.get(key) || {key, created: at, lastSequence: 0, retained: 0, dropped: 0, missing: 0};
      if (autoSequence && sequence === undefined) sequence = run.lastSequence + 1;
      if (run.closed || sequence <= run.lastSequence) {await tx.done; return false;}
      run.missing += sequence - run.lastSequence - 1;
      run.lastSequence = sequence;
      run.retained++;
      await events.add({run: key, sequence, at, event});
      if (run.retained > limits.perRun) {
        const oldest = await events.index('run').openCursor(key);
        await oldest.delete(); run.retained--; run.dropped++;
      }
      await runs.put(run);
      while (await events.count() > limits.total) {
        const oldest = await events.openCursor(), removed = await runs.get(oldest.value.run);
        await oldest.delete(); removed.retained--; removed.dropped++; await runs.put(removed);
      }
      while (await runs.count() > limits.runs) {
        const oldest = await runs.index('created').openCursor();
        await removeRun(tx, oldest.primaryKey);
      }
      await tx.done;
      return true;
    });
  }
  async function finish(owner, sequence) {
    const key = traceJournalKey(owner);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
    return using(async db => {
      const tx = db.transaction(['runs', 'events'], 'readwrite'), runs = tx.objectStore('runs');
      const run = await runs.get(key) || {key, created: Date.now(), lastSequence: 0, retained: 0, dropped: 0, missing: 0};
      // The final host sequence acknowledges events rejected after cancellation.
      // It records their absence without replaying an event or reviving a lease.
      run.finalSequence = Math.max(run.finalSequence || 0, sequence);
      run.tailMissing = Math.max(0, run.finalSequence - run.lastSequence);
      run.closed = true;
      await runs.put(run);
      while (await runs.count() > limits.runs) {
        const oldest = await runs.index('created').openCursor();
        await removeRun(tx, oldest.primaryKey);
      }
      await tx.done;
      return {available: true, incomplete: run.missing + run.tailMissing > 0};
    });
  }
  async function page(owner, {before, limit = limits.page} = {}) {
    const key = traceJournalKey(owner), size = Math.min(limits.page, Math.max(1, integer(limit) || limits.page));
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new Error('trace_cursor_invalid');
    return using(async db => {
      const tx = db.transaction(['runs', 'events']), run = await tx.objectStore('runs').get(key);
      if (!run) {await tx.done; return {events: [], retained: 0, dropped: 0, missing: 0, available: false, next: null};}
      const records = [];
      let cursor = await tx.objectStore('events').index('run').openCursor(key, 'prev');
      while (cursor && records.length <= size) {
        if (before === undefined || cursor.value.sequence < before) records.push(cursor.value);
        cursor = await cursor.continue();
      }
      await tx.done;
      const more = records.length > size;
      return {events: records.slice(0, size).map(({sequence, at, event}) => ({sequence, at, ...event})),
        available: true, retained: run.retained, dropped: run.dropped, missing: run.missing + (run.tailMissing || 0),
        next: more ? records[size - 1].sequence : null};
    });
  }
  async function prune(owners) {
    const keep = new Set(owners.map(traceJournalKey));
    return using(async db => {
      const tx = db.transaction(['runs', 'events'], 'readwrite');
      for (const key of await tx.objectStore('runs').getAllKeys()) if (!keep.has(key)) await removeRun(tx, key);
      await tx.done;
    });
  }
  return {append, finish, page, prune};
}
export const traceJournal = createTraceJournal();
