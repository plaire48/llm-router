import test from 'node:test';
import assert from 'node:assert/strict';
import {dragObserved} from '../browser-drag.js';

function fixture() {
  const commands = [], frame = {};
  const source = {frame, handle: {hover: async options => commands.push(options.trial ? 'source:trial' : 'source:hover')}};
  const destination = {frame, handle: {hover: async options => commands.push(options.trial ? 'target:trial' : 'target:hover')}};
  const task = {page: {mouse: {down: async()=>commands.push('down'), up: async()=>commands.push('up')}, keyboard: {press: async key=>commands.push(key)}}};
  const options = {present: fn=>fn(), cancelled: ()=>false, onIssued: ()=>commands.push('issued')};
  return {commands, task, source, destination, options};
}
test('drag resolves both actionable endpoints before input and returns a receipt without claiming verification', async () => {
  const {commands, task, source, destination, options} = fixture();
  const result = await dragObserved(task, source, destination, options);
  assert.deepEqual(commands, ['source:trial','target:trial','source:hover','issued','down','target:hover','target:hover','up']);
  assert.deepEqual(result, {ok:true,actionIssued:true,verified:false});
});
test('a failed or cancelled drag releases the mouse without replay or a second drop', async () => {
  for (const cancel of [false,true]) {
    const {commands, task, source, destination, options} = fixture();
    let cancelled = false;
    destination.handle.hover = async ({trial}) => {if (!trial) {if (cancel) cancelled=true; else throw new Error('detached');}};
    await assert.rejects(dragObserved(task, source, destination, {...options,cancelled:()=>cancelled}), cancel ? /cancelled/ : /detached/);
    assert.equal(commands.filter(value=>value==='down').length,1);
    assert.deepEqual(commands.slice(-2), ['Escape','up']);
  }
});
test('unsupported cross-frame dragging issues no input', async () => {
  const {commands, task, source, destination, options} = fixture();
  destination.frame={};
  await assert.rejects(dragObserved(task, source, destination, options), /drag_cross_frame/);
  assert.deepEqual(commands,[]);
});
