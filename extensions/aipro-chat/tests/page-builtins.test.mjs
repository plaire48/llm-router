import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {PAGE_BUILTINS} from '../scripts/page-builtins.mjs';

// Measured on a public library site that declares its own `function Map()`: every
// observation under the debugger failed, seventeen of seventeen.
function page(script = '') {
  const frames = {made: 0, attached: 0};
  const clean = () => vm.runInNewContext('({Map, Set, WeakMap, WeakSet, Array, Object})');
  const context = vm.createContext({calls: 0, document: {
    createElement: tag => {
      assert.equal(tag, 'iframe'); frames.made++;
      const frame = {style: {}, setAttribute() {}, parentNode: null, contentWindow: clean()};
      return frame;
    },
    documentElement: {appendChild(frame) {frames.attached++; frame.parentNode = {removeChild(child) {frames.attached--; child.parentNode = null;}};}},
  }});
  vm.runInContext(script, context);
  const result = vm.runInContext(`(function () {${PAGE_BUILTINS}
    var m = new Map([[1, 2]]); m.set(3, 4); var s = new Set([1, 1]);
    return {map: m.get(3) === 4 && m.size === 2, set: s.size === 1, weak: new WeakMap().set({}, 1) instanceof WeakMap,
      list: Array.from(new Set([1, 2])).length === 2, entries: Object.entries({a: 1}).length === 1,
      pageMap: Map === globalThis.Map, pageArray: Array === globalThis.Array, pageObject: Object === globalThis.Object, calls: globalThis.calls};
  })()`, context);
  return {result, frames, context};
}

test('the text can be placed inside a template literal', () => {
  assert.equal(/[`\\]|\$\{/.test(PAGE_BUILTINS), false);
});

test('a page whose built-ins work is not touched', () => {
  const {result, frames} = page();
  assert.deepEqual(frames, {made: 0, attached: 0});
  assert.equal(result.pageMap && result.pageArray && result.pageObject, true);
  assert.equal(result.map && result.set && result.weak && result.list && result.entries, true);
});

test('a page with its own Map gets a working one, and the page keeps its own', () => {
  const {result, frames, context} = page('function Map(){calls++; this.items={};} Map.prototype.put=function(k,v){this.items[k]=v;}; Map.prototype.get=function(k){return this.items[k];};');
  assert.equal(result.map, true); assert.equal(result.pageMap, false);
  assert.equal(result.pageArray && result.pageObject, true, 'only what does not work is replaced');
  assert.deepEqual(frames, {made: 1, attached: 0}, 'the frame is removed at once');
  assert.equal(result.calls, 0, 'a function written by the page is never called');
  assert.equal(vm.runInContext('typeof Map.prototype.put', context), 'function');
});

test('a page function named Map that has set and get is not called either', () => {
  const {result} = page('function Map(){calls++;} Map.prototype.set=function(){calls++;}; Map.prototype.get=function(){calls++;};');
  assert.equal(result.calls, 0); assert.equal(result.map, true);
});

test('replaced static helpers are taken from the clean frame', () => {
  const {result, frames} = page('Array.from=function(list){calls++;return [];}; Object.entries=function(){calls++;return [];}; globalThis.Set=function(){calls++;};');
  assert.equal(result.list && result.entries && result.set && result.map, true);
  assert.equal(result.pageArray, false); assert.equal(result.pageObject, false); assert.equal(result.pageMap, true);
  assert.equal(result.calls, 0); assert.equal(frames.made, 1);
});

test('a page that forbids frames keeps its own built-ins and the code still runs', () => {
  const context = vm.createContext({document: {createElement() {throw new Error('Refused');}, documentElement: {}}});
  vm.runInContext('globalThis.WeakSet=function(){};', context);
  const kept = vm.runInContext(`(function () {${PAGE_BUILTINS} return {weakSet: WeakSet === globalThis.WeakSet, map: new Map([[1, 2]]).get(1)};})()`, context);
  assert.deepEqual({...kept}, {weakSet: true, map: 2});
});

test('the generated page functions and the packaged Playwright script carry the text', async () => {
  const generated = await readFile(new URL('../generated/browser-dom.js', import.meta.url), 'utf8');
  assert.equal(generated.split('var NubiBuiltins = ').length - 1, (generated.match(/^export function /gm) || []).length, 'one in front of each generated function');
  assert(generated.includes('export function pointerCover('), 'the covered-click helpers are generated too');
  const build = await readFile(new URL('../scripts/package.mjs', import.meta.url), 'utf8');
  assert.match(build, /playwright_utility_script_place_missing/);
  assert.match(build, /page_builtins_not_embeddable/);
});
