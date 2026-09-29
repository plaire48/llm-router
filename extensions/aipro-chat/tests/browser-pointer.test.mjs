import test from 'node:test';
import assert from 'node:assert/strict';
import {withActionPointer, clearActionPointer, keepActionPointer} from '../browser-pointer.js';

test('passive pointer restores navigation without a debugger and stops renewal on cancellation', async t => {
  t.mock.timers.enable({apis:['setInterval','setTimeout']});
  const calls = [], listeners = new Set(); let cancelled = false;
  globalThis.chrome = {tabs: {get: async id => ({id, url: 'https://site.test/', windowId: 1}),
    onUpdated: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)}},
    scripting: {executeScript: async args => {calls.push(args);}}};
  t.after(() => {delete globalThis.chrome;});
  const task = {id: 'passive', tabId: 3, workspace: {windowId: 1, tabIds: [3]}};
  await keepActionPointer(task, () => true, () => cancelled);
  assert.deepEqual(calls.map(call => call.args[0].operation), ['touch', 'idle']);
  assert(calls.every(call => call.target.tabId === 3));
  for (const fn of listeners) fn(2, {status:'complete'});
  assert.equal(calls.length, 2);
  for (const fn of listeners) fn(3, {status:'complete'});
  for (let i=0;i<10;i++) await Promise.resolve();
  assert.equal(calls.at(-1).args[0].operation, 'idle');
  cancelled = true; const before = calls.length;
  t.mock.timers.tick(10000); for (let i=0;i<10;i++) await Promise.resolve();
  assert.equal(calls.length, before);
  await clearActionPointer(task); assert.equal(listeners.size, 0);
  assert.equal(calls.at(-1).args[0].operation, 'clear');
});

test('pointer presentation failures never block, replay or change an action result', async () => {
  for (const failure of ['sync', 'async']) {
    const handle = {evaluate: () => {if (failure === 'sync') throw new Error('overlay unavailable'); return Promise.reject(new Error('overlay unavailable'));}};
    const task = {page: {}}; let issued = 0;
    const result = await withActionPointer(task, handle, 'click', async () => {issued++; return {receipt: 'returned'};});
    assert.equal(issued, 1); assert.deepEqual(result, {receipt: 'returned'});
  }
});

test('pointer cleanup preserves the original action error and honors cancellation before dispatch', async () => {
  const calls = [], task = {page: {}};
  const handle = {evaluate: async (_fn, args) => {calls.push(args);}};
  const cause = new Error('action outcome unknown'); let issued = 0;
  await assert.rejects(withActionPointer(task, handle, 'click', () => {issued++; throw cause;}), error => error === cause);
  assert.equal(issued, 1); assert.equal(calls.at(-1).operation, 'finish'); assert.equal(calls.at(-1).failed, true);
  assert.equal(calls[0].id, calls.at(-1).id);
  await assert.rejects(withActionPointer(task, handle, 'click', () => {issued++;}, () => true), /cancelled/);
  assert.equal(issued, 1);
  let cancelled = false;
  const late = {evaluate: async (_fn, args) => {if (args.operation === 'arm') cancelled = true;}};
  await assert.rejects(withActionPointer(task, late, 'click', () => {issued++;}, () => cancelled), /cancelled/);
  assert.equal(issued, 1);
});

test('ending presentation clears every affected frame without accessing unrelated pages', async () => {
  const commands = [];
  const frame = {evaluate: async (_fn, args) => {commands.push(args.operation);}};
  const page = {isClosed: () => false, frames: () => [frame, {evaluate: async () => {throw new Error('detached');}}]};
  const task = {pointerPages: new Set([page, {isClosed: () => true}])};
  await clearActionPointer(task);
  assert.deepEqual(commands, ['clear']); assert.equal(task.pointerPages.size, 0);
});

test('an unresponsive presentation has a bounded wait and cannot trap the real action', async () => {
  const task = {id:'run',page:{}}, handle = {evaluate:()=>new Promise(()=>{})}; let issued=0;
  const started=Date.now();
  await withActionPointer(task,handle,'click',async()=>{issued++;});
  assert.equal(issued,1);assert(Date.now()-started<2000);
});

test('one task renews only its own markers and stopping removes the heartbeat',async t=>{
  t.mock.timers.enable({apis:['setInterval','setTimeout']});
  const calls=[],frame={evaluate:async(_fn,args)=>calls.push(args)},page={frames:()=>[frame],isClosed:()=>false};
  const task={id:'owned-run',page};
  await withActionPointer(task,frame,'hover',async()=>{});
  const heartbeat=task.pointerHeartbeat;
  await withActionPointer(task,frame,'click',async()=>{});
  assert.equal(task.pointerHeartbeat,heartbeat);
  t.mock.timers.tick(10000);await Promise.resolve();await Promise.resolve();
  assert.equal(calls.filter(c=>c.operation==='touch').length,1);
  assert.equal(calls.find(c=>c.operation==='touch').owner,'owned-run');
  await clearActionPointer(task);assert.equal(task.pointerHeartbeat,null);
  t.mock.timers.tick(30000);await Promise.resolve();await Promise.resolve();
  assert.equal(calls.filter(c=>c.operation==='touch').length,1);
  assert.equal(calls.at(-1).operation,'clear');
});
