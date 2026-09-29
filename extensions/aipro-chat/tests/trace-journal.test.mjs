import test from 'node:test';
import assert from 'node:assert/strict';
import {createTraceJournal, journalEvent, traceJournalKey} from '../trace-journal.js';

// Storage adapter exercises retention and pagination deterministically without
// adding a fake IndexedDB package to the shipped extension.
function memoryDatabase() {
  const stores = {runs: new Map(), events: new Map()}; let key = 0;
  const store = name => {
    const values = stores[name];
    const cursor = (field, match, direction = 'next') => {
      let entries = [...values].filter(([, value]) => match === undefined || value[field] === match);
      entries.sort((a, b) => field === 'created' ? a[1].created - b[1].created : Number(a[0]) - Number(b[0]));
      if (direction === 'prev') entries.reverse();
      let at = 0;
      const current = () => {
        const entry = entries[at];
        if (!entry) return null;
        return {key: field ? entry[1][field] : entry[0], primaryKey: entry[0], value: structuredClone(entry[1]),
          delete: async () => values.delete(entry[0]), continue: async () => {at++; return current();}};
      };
      return Promise.resolve(current());
    };
    return {get: async key => structuredClone(values.get(key)),
      put: async value => values.set(value.key, structuredClone(value)),
      add: async value => {const record = {...structuredClone(value), key: ++key}; values.set(record.key, record); return record.key;},
      delete: async key => values.delete(key), count: async () => values.size, getAllKeys: async () => [...values.keys()],
      openCursor: () => cursor(), index: field => ({openCursor: (match, direction) => cursor(field, match, direction)})};
  };
  return {open: async () => ({close() {}, transaction: () => ({objectStore: store, done: Promise.resolve()})}), stores};
}
const owner = {provider:'aipro', conversationId:'conversation-a', requestId:'request-a'};
const step = (status = 'running') => ({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tool:'analysis_research', status,
  analysis:{phase: status === 'running' ? 'reading' : 'finished', task:'private task', summary:'private document body', calls:3, reads:2, delivered:status === 'done'}});

test('journal stores only public execution metadata and binds provider, conversation and request', () => {
  const value = journalEvent({...step(), label:'secret label', input:{password:'secret'}, image:'data:image/png;base64,secret', content:'secret', tokens:40});
  assert.deepEqual(value, {id:step().id, tool:'analysis_research', status:'running', analysis:{phase:'reading', delivered:false, calls:3, reads:2}});
  assert.equal(journalEvent({tool:'progress_note', content:'Bearer secret', status:'done'}), null);
  assert.notEqual(traceJournalKey(owner), traceJournalKey({...owner, provider:'chatgpt'}));
  assert.notEqual(traceJournalKey(owner), traceJournalKey({...owner, conversationId:'other'}));
  assert.notEqual(traceJournalKey(owner), traceJournalKey({...owner, requestId:'other'}));
  assert.throws(() => traceJournalKey({...owner, requestId:'../other'}), /trace_owner_invalid/);
});

test('journal preserves more than 32 events across bounded pages without duplicates', async () => {
  const memory = memoryDatabase(), journal = createTraceJournal({open:memory.open});
  for (let i=1; i<=130; i++) await journal.append(owner, step(i % 2 ? 'running' : 'done'), i, i);
  assert.equal(await journal.append(owner, step(), 130), false);
  const first = await journal.page(owner), second = await journal.page(owner,{before:first.next}), third = await journal.page(owner,{before:second.next});
  assert.equal(first.events.length, 50); assert.equal(second.events.length, 50); assert.equal(third.events.length, 30);
  assert.equal(third.next, null); assert.equal(first.retained,130);
  assert.deepEqual([...first.events,...second.events,...third.events].map(event=>event.sequence), Array.from({length:130},(_,i)=>130-i));
  assert.equal((await journal.page({...owner, requestId:'other'})).available,false);
  await assert.rejects(journal.page(owner,{before:-1}),/trace_cursor_invalid/);
});

test('worker lineage and numeric range survive without source names or results', () => {
  const value = step('done');
  value.analysis = {...value.analysis, runId:'wiki-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'recovery',workerId:40,synthesisId:2,completed:39,total:50,deliveredTo:'synthesis',outcome:'partial',
    assignment:{question:'secret question',documentIds:['private-path'],documents:[{id:'private-path',title:'private-title'}],range:{documentId:'private-path',start:24000,end:48000}},
    sources:[{id:'private-source',kind:'text',path:'private-path'}]};
  const record = journalEvent(value);
  assert.equal(record.analysis.runId,value.analysis.runId);assert.equal(record.analysis.workerId,40);assert.equal(record.analysis.role,'recovery');
  assert.equal(record.analysis.deliveredTo,'synthesis');assert.equal(record.analysis.outcome,'partial');
  assert.equal(record.analysis.documentCount,1);assert.deepEqual(record.analysis.range,{start:24000,end:48000});
  assert(!JSON.stringify(record).includes('private'));assert(!JSON.stringify(record).includes('secret'));
});

test('run and global bounds report removed history and missing sequence gaps', async () => {
  const memory=memoryDatabase(), journal=createTraceJournal({open:memory.open, limits:{perRun:3,total:4,runs:3,page:2}});
  for(let i=1;i<=5;i++) await journal.append(owner,step(),i,i);
  let page=await journal.page(owner);
  assert.equal(page.retained,3);assert.equal(page.dropped,2);assert.deepEqual(page.events.map(e=>e.sequence),[5,4]);
  const other={...owner,requestId:'other'};
  await journal.append(other,step(),1,7);await journal.append(other,step('done'),3,8);
  page=await journal.page(owner);
  assert.equal(page.retained,2);assert.equal(page.dropped,3);
  assert.equal((await journal.page(other)).missing,1);assert.equal(memory.stores.events.size,4);
});

test('conversation deletion and metadata retention delete underlying records', async () => {
  const memory=memoryDatabase(), journal=createTraceJournal({open:memory.open,limits:{perRun:3,total:9,runs:2,page:2}});
  const b={...owner,conversationId:'b'},c={...owner,conversationId:'c'};
  await journal.append(owner,step(),1,1);await journal.append(b,step(),1,2);await journal.append(c,step(),1,3);
  assert.equal((await journal.page(owner)).available,false);assert.equal(memory.stores.events.size,2);
  await journal.prune([c]);
  assert.equal((await journal.page(b)).available,false);assert.equal((await journal.page(c)).available,true);
  assert.equal(memory.stores.runs.size,1);assert.equal(memory.stores.events.size,1);
});

test('storage failure propagates to the host for explicit incomplete history', async () => {
  const journal=createTraceJournal({open:async()=>{throw new Error('quota');}});
  await assert.rejects(journal.append(owner,step(),1),/quota/);
  await assert.rejects(journal.finish(owner,2),/quota/);
});

test('finish reports trailing rejected events once and never resumes a closed run', async () => {
  const memory=memoryDatabase(), journal=createTraceJournal({open:memory.open});
  await journal.append(owner,step(),1,1);
  await journal.append(owner,step(),3,3);
  assert.deepEqual(await journal.finish(owner,5),{available:true,incomplete:true});
  let page=await journal.page(owner);
  assert.equal(page.missing,3); // one interior gap plus two rejected tail events
  assert.equal(page.retained,2);assert.deepEqual(page.events.map(event=>event.sequence),[3,1]);
  await journal.finish(owner,5);await journal.finish(owner,4);
  assert.equal((await journal.page(owner)).missing,3);
  assert.equal(await journal.append(owner,step('done'),6,6),false);
  assert.equal((await journal.page(owner)).retained,2);
  const other={...owner,requestId:'never-saved'};
  assert.deepEqual(await journal.finish(other,2),{available:true,incomplete:true});
  page=await journal.page(other);assert.equal(page.missing,2);assert.equal(page.retained,0);assert.deepEqual(page.events,[]);
});

test('a complete final sequence remains complete and absent histories obey run bounds', async () => {
  const memory=memoryDatabase(), journal=createTraceJournal({open:memory.open,limits:{perRun:3,total:6,runs:2,page:2}});
  await journal.append(owner,step('done'),1,1);
  assert.deepEqual(await journal.finish(owner,1),{available:true,incomplete:false});
  assert.equal((await journal.page(owner)).missing,0);
  await journal.finish({...owner,requestId:'missing-b'},3);
  await journal.finish({...owner,requestId:'missing-c'},2);
  assert.equal(memory.stores.runs.size,2);assert.equal((await journal.page(owner)).available,false);
});
