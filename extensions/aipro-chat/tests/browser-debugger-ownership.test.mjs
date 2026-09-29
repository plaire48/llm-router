import test from 'node:test';
import assert from 'node:assert/strict';
import {ownDebugger,releaseDebuggers} from '../browser-debugger-ownership.js';

test('restart cleanup detaches only persisted request-owned tabs and tolerates closed targets',async()=>{
  let state={},detached=[];
  globalThis.chrome={storage:{session:{get:async()=>structuredClone(state),set:async value=>{Object.assign(state,structuredClone(value));}}},debugger:{detach:async({tabId})=>{detached.push(tabId);if(tabId===2)throw Error('already closed');}}};
  await Promise.all([ownDebugger('old',1),ownDebugger('old',2),ownDebugger('new',3)]);
  await releaseDebuggers('old');
  assert.deepEqual(detached,[1,2]);assert.deepEqual(state.browserDebuggerOwners,[{requestId:'new',tabId:3}]);
  await releaseDebuggers('missing');assert.deepEqual(detached,[1,2]);
  await releaseDebuggers();assert.deepEqual(detached,[1,2,3]);assert.deepEqual(state.browserDebuggerOwners,[]);
});

test('a stale request cannot release a tab now owned by another request',async()=>{
  let state={},detached=[];
  globalThis.chrome={storage:{session:{get:async()=>structuredClone(state),set:async value=>{Object.assign(state,structuredClone(value));}}},debugger:{detach:async({tabId})=>detached.push(tabId)}};
  await ownDebugger('old',4);await ownDebugger('new',4);await releaseDebuggers('old',4);
  assert.deepEqual(detached,[]);assert.deepEqual(state.browserDebuggerOwners,[{requestId:'new',tabId:4}]);
  await releaseDebuggers('new',4);assert.deepEqual(detached,[4]);
});
