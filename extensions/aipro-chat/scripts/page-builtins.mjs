// Source text placed in front of code that runs in a page's own world: the generated
// page functions and Playwright's utility script, both evaluated under the debugger.
// There a page can have replaced the built-in collections. Older public sites declare a
// site-wide `function Map()` with put/get. Measured on one such site, every observation
// failed with "set is not a function", and values passed to or returned from the page
// were lost. Each built-in is tried out, and only the ones that do not work are taken
// from a frame that is added and removed at once. A page whose built-ins work is not
// touched. Extension page scripts run in their own world and always pass.
export const PAGE_BUILTINS = `var NubiBuiltins = (function () {
  // The names below are also declared in the enclosing function, so the page's
  // versions are reached through the global object here.
  var page = globalThis, key = {}, names = ['Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'Object'], works = {
    Map: function () {var m = new page.Map([[key, 2]]); m.set(1, 3); return m.get(key) === 2 && m.get(1) === 3 && m.size === 2 && m.has(1) && typeof m[Symbol.iterator] === 'function' && typeof m.forEach === 'function' && m.delete(1) === true;},
    Set: function () {var s = new page.Set([1, 1, 2]); s.add(key); return s.size === 3 && s.has(key) && typeof s[Symbol.iterator] === 'function' && s.delete(1) === true;},
    WeakMap: function () {var w = new page.WeakMap(); w.set(key, 1); return w.get(key) === 1 && w.has(key) && w.delete(key) === true;},
    WeakSet: function () {var w = new page.WeakSet(); w.add(key); return w.has(key) && w.delete(key) === true;},
    Array: function () {var list = {}; list[Symbol.iterator] = function () {var i = 0; return {next: function () {return i < 2 ? {value: i++, done: false} : {value: undefined, done: true};}};};
      return page.Array.from(list).length === 2 && page.Array.from({length: 2}, function (_, i) {return i;})[1] === 1 && page.Array.from('ab').length === 2 && page.Array.isArray([]) && !page.Array.isArray({length: 0}) && page.Array.of(7)[0] === 7;},
    Object: function () {return page.Object.entries({a: 1})[0][1] === 1 && page.Object.fromEntries([['a', 1]]).a === 1 && page.Object.assign({}, {a: 1}).a === 1 && page.Object.keys({a: 1})[0] === 'a' && page.Object.values({a: 1})[0] === 1 && page.Object.getPrototypeOf([]) === page.Array.prototype;}
  }, parts = {Map: ['Map'], Set: ['Set'], WeakMap: ['WeakMap'], WeakSet: ['WeakSet'],
    Array: ['Array', 'Array.from', 'Array.isArray', 'Array.of'],
    Object: ['Object', 'Object.entries', 'Object.fromEntries', 'Object.assign', 'Object.keys', 'Object.values', 'Object.getPrototypeOf']},
  // A function written by the page is never called: a page can give the name Map to
  // something that acts when constructed. Only the browser's own functions are tried.
  own = function (path) {
    var at = path.split('.'), value = page[at[0]];
    if (at.length > 1 && value) value = value[at[1]];
    return typeof value === 'function' && Function.prototype.toString.call(value).indexOf('[native code]') > 0;
  }, found = {}, missing = [];
  for (var n = 0; n < names.length; n++) {
    var ok = false;
    try {
      ok = true;
      for (var p = 0; p < parts[names[n]].length; p++) if (!own(parts[names[n]][p])) ok = false;
      ok = ok && works[names[n]]() === true;
    } catch (error) {ok = false;}
    if (ok) found[names[n]] = page[names[n]]; else missing.push(names[n]);
  }
  if (missing.length) {
    var frame;
    try {
      frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true'); frame.style.display = 'none';
      (document.documentElement || document.body).appendChild(frame);
      for (var i = 0; i < missing.length; i++) found[missing[i]] = frame.contentWindow[missing[i]];
    } catch (error) { /* A page that forbids frames keeps its own built-ins. */ }
    finally {try {if (frame && frame.parentNode) frame.parentNode.removeChild(frame);} catch (error) { /* Already gone. */ }}
    for (var j = 0; j < missing.length; j++) if (typeof found[missing[j]] !== 'function') found[missing[j]] = page[missing[j]];
  }
  return found;
})();
var Map = NubiBuiltins.Map, Set = NubiBuiltins.Set, WeakMap = NubiBuiltins.WeakMap, WeakSet = NubiBuiltins.WeakSet, Array = NubiBuiltins.Array, Object = NubiBuiltins.Object;`;
