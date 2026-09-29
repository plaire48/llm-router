import test from 'node:test';
import assert from 'node:assert/strict';
import {watchPopups} from '../browser-popups.js';

function fixture(initial = []) {
  const rows = new Map([{id: 1, url: 'https://portal.test/', windowId: 1}, ...initial].map(tab => [tab.id, tab]));
  const event = () => {const handlers = new Set(); return {addListener: fn => handlers.add(fn), removeListener: fn => handlers.delete(fn), emit: (...args) => handlers.forEach(fn => fn(...args)), count: () => handlers.size};};
  const tabs = {onCreated: event(), onUpdated: event(), onActivated: event(), query: async () => [...rows.values()], get: async id => rows.get(id)};
  return {tabs, create(tab) {rows.set(tab.id, tab); tabs.onCreated.emit(tab);}, remove(id) {rows.delete(id);}, update(id, change) {Object.assign(rows.get(id), change); tabs.onUpdated.emit(id, change, rows.get(id));}, listeners: () => tabs.onCreated.count() + tabs.onUpdated.count() + tabs.onActivated.count()};
}
// Production waits 7 seconds. Leave scheduling headroom while the unit suite
// runs beside real Chrome; 100 ms could expire before its 20 ms fixture tick.
const options = {timeout: 1000, interval: 2};
test('workspace popup discovery ignores other user windows even with the same href', async () => {
  const f=fixture([{id:4,windowId:9,url:'https://mail.test/'}]);
  const watcher=await watchPopups(f.tabs,1,{href:'https://mail.test/'},{...options,workspace:{windowId:1,tabIds:[1]}});
  f.create({id:5,windowId:9,url:'https://mail.test/'});
  f.create({id:6,windowId:1,url:'https://mail.test/'});
  assert.deepEqual(await watcher.finish(),{tabId:6,created:true});
});
test('workspace multiple children retain created identity for adoption', async () => {
  const f=fixture(),watcher=await watchPopups(f.tabs,1,{}, {...options,workspace:{windowId:1,tabIds:[1]}});
  f.create({id:2,windowId:2,openerTabId:1,url:'https://one.test/'});
  f.create({id:3,windowId:3,openerTabId:1,url:'https://two.test/'});
  assert.deepEqual(await watcher.finish(),{candidates:[2,3],created:[2,3]});
});
test('a blank popup is observed before the action finishes and followed only after navigation commits', async () => {
  const f = fixture(), watcher = await watchPopups(f.tabs, 1, {}, options);
  f.create({id: 2, openerTabId: 1, url: 'about:blank'});
  setTimeout(() => f.update(2, {url: 'https://mail.test/draft'}), 20);
  assert.deepEqual(await watcher.finish(), {tabId: 2}); assert.equal(f.listeners(), 0);
});
test('a delayed child is discovered while an unrelated new tab is ignored', async () => {
  const f = fixture(), watcher = await watchPopups(f.tabs, 1, {}, options);
  f.create({id: 2, openerTabId: 99, url: 'https://unrelated.test/'});
  setTimeout(() => f.create({id: 3, openerTabId: 1, url: 'https://mail.test/'}), 20);
  assert.deepEqual(await watcher.finish(), {tabId: 3}); assert.equal(f.listeners(), 0);
});
test('noopener links can be matched to their observed href without selecting unrelated tabs', async () => {
  const f = fixture(), watcher = await watchPopups(f.tabs, 1, {href: 'https://mail.test/'}, options);
  f.create({id: 2, url: 'https://unrelated.test/'}); f.create({id: 3, url: 'https://mail.test/'});
  assert.deepEqual(await watcher.finish(), {tabId: 3});
});
test('an approved link can supply its bound target after the watcher is armed', async () => {
  const f = fixture(), watcher = await watchPopups(f.tabs, 1, {}, options);
  watcher.setHint({href: 'https://mail.test/'});
  f.create({id: 2, url: 'https://unrelated.test/'}); f.create({id: 3, url: 'https://mail.test/'});
  assert.deepEqual(await watcher.finish(), {tabId: 3}); assert.equal(f.listeners(), 0);
});
test('reused named windows wait for the new document and can follow same-URL activation', async () => {
  const f = fixture([{id: 2, openerTabId: 1, url: 'https://mail.test/old'}]);
  let watcher = await watchPopups(f.tabs, 1, {}, options);
  f.update(2, {pendingUrl: 'https://mail.test/new', status: 'loading'});
  setTimeout(() => f.update(2, {url: 'https://mail.test/new', pendingUrl: undefined, status: 'complete'}), 20);
  assert.deepEqual(await watcher.finish(), {tabId: 2});
  watcher = await watchPopups(f.tabs, 1, {}, options);
  f.tabs.onActivated.emit({tabId: 2});
  assert.deepEqual(await watcher.finish(), {tabId: 2}); assert.equal(f.listeners(), 0);
});
test('multiple related windows return a choice instead of silently choosing the wrong one', async () => {
  const f = fixture(), watcher = await watchPopups(f.tabs, 1, {}, options);
  f.create({id: 2, openerTabId: 1, url: 'https://mail.test/'}); f.create({id: 3, openerTabId: 1, url: 'https://calendar.test/'});
  assert.deepEqual(await watcher.finish(), {candidates: [2, 3]}); assert.equal(f.listeners(), 0);
});
test('no popup, same-tab navigation and cancellation clean up all observers', async () => {
  const f = fixture();
  let watcher = await watchPopups(f.tabs, 1, {}, {...options, timeout: 5});
  assert.deepEqual(await watcher.finish(), {candidates: []}); assert.equal(f.listeners(), 0);
  watcher = await watchPopups(f.tabs, 1, {}, options); f.update(1, {url: 'https://portal.test/next'});
  assert.deepEqual(await watcher.finish(), {}); assert.equal(f.listeners(), 0);
  watcher = await watchPopups(f.tabs, 1, {}, {...options, cancelled: () => true});
  await assert.rejects(watcher.finish(), /cancelled/); assert.equal(f.listeners(), 0);
});
test('a local effect returns promptly but retains delayed popup evidence until consumed', async()=>{
  const f=fixture();let closes=0;
  const watcher=await watchPopups(f.tabs,1,{}, {...options,changed:async()=>true,onClose:()=>closes++});
  assert.deepEqual(await watcher.finish(),{deferred:true});assert.equal(f.listeners(),3);
  assert.deepEqual(await watcher.finish({pollOnly:true}),{deferred:true});
  f.create({id:2,openerTabId:1,url:'about:blank'});
  setTimeout(()=>f.update(2,{url:'https://mail.test/draft'}),20);
  assert.deepEqual(await watcher.finish({pollOnly:true}),{tabId:2});assert.equal(f.listeners(),0);assert.equal(closes,1);
});
test('an explicit popup target still waits for its event even with a local progress change',async()=>{
  const f=fixture(),watcher=await watchPopups(f.tabs,1,{target:'_blank'}, {...options,changed:async()=>true});
  setTimeout(()=>f.create({id:2,openerTabId:1,url:'https://mail.test/'}),20);
  assert.deepEqual(await watcher.finish(),{tabId:2});assert.equal(f.listeners(),0);
});
test('deferred observers expire without polling and preserve an already received child for the next boundary',async()=>{
  const f=fixture(),watcher=await watchPopups(f.tabs,1,{}, {...options,timeout:10,changed:async()=>true});
  assert.deepEqual(await watcher.finish(),{deferred:true});
  f.create({id:2,openerTabId:1,url:'https://mail.test/'});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.listeners(),0);
  f.create({id:3,openerTabId:1,url:'https://too-late.test/'});
  assert.deepEqual(await watcher.finish({pollOnly:true}),{tabId:2});
});
test('cancellation closes deferred observers without following a pending popup',async()=>{
  const f=fixture();let cancelled=false;
  const watcher=await watchPopups(f.tabs,1,{}, {...options,changed:async()=>true,cancelled:()=>cancelled});
  await watcher.finish();cancelled=true;f.create({id:2,openerTabId:1,url:'https://mail.test/'});
  await assert.rejects(watcher.finish({pollOnly:true}),/cancelled/);assert.equal(f.listeners(),0);
});
test('a deferred child closed before the next step is not returned as a live target',async()=>{
  const f=fixture(),watcher=await watchPopups(f.tabs,1,{}, {...options,timeout:10,changed:async()=>true});
  await watcher.finish();f.create({id:2,openerTabId:1,url:'https://mail.test/'});f.remove(2);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(await watcher.finish({pollOnly:true}),{candidates:[]});assert.equal(f.listeners(),0);
});
