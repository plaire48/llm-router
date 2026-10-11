import {newQuickJSWASMModuleFromVariant} from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import {scriptFailure} from './script-feedback.js';
import {preflightScript} from './script-preflight.js';
export {preflightScript} from './script-preflight.js';
import {LOCATOR_BUILDERS, LOCATOR_ACTIONS, LOCATOR_READS, PAGE_METHODS} from './browser-script-api.js';

let modulePromise;
function boundedValue(value) {
  const seen = new WeakSet();
  const encoded = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return String(item);
    if (item && typeof item === 'object') {if (seen.has(item)) return '[circular]'; seen.add(item);}
    return item;
  }) ?? 'null';
  return encoded.length > 24000 ? {truncated: true, preview: encoded.slice(0, 24000)} : JSON.parse(encoded);
}
const bootstrap = `
const encode = value => JSON.stringify(value, (_, item) => item instanceof RegExp ? {__regexp:item.source,flags:item.flags} : item);
const call = async (chain, method, args) => {
  const result = JSON.parse(await __browserCall(encode({chain,method,args})));
  if (result.error) throw new Error(result.error);
  return result.value;
};
class Remote {
  constructor(chain=[]) {this.chain=chain;}
}
for (const method of ${JSON.stringify(LOCATOR_BUILDERS)}) {
  Remote.prototype[method] = function(...args) {return new Remote([...this.chain,[method,args]]);};
}
for (const method of ${JSON.stringify([...LOCATOR_ACTIONS, ...LOCATOR_READS, ...PAGE_METHODS])}) {
  Remote.prototype[method] = function(...args) {return call(this.chain,method,args);};
}
globalThis.page = new Remote();
globalThis.browser = Object.freeze({ref:id=>new Remote([['ref',[id]]]), snapshot:query=>call([],'snapshot',[query]), screenshot:options=>call([],'screenshot',options===undefined?[]:[options]), tabs:()=>call([],'tabs',[]), switchTab:id=>call([],'switchTab',[id]), open:url=>call([],'open',[url]), scroll:(direction,ref)=>call([],'scroll',ref===undefined?[direction]:[direction,ref]), clickAt:(id,x,y)=>call([],'clickAt',[id,x,y]), drag:(source,target)=>call([],'drag',[source,target])});
globalThis.console=Object.freeze({log:(...args)=>__log(encode(args))});
`;

// JavaScript runs inside a memory/CPU-bounded WASM VM, never in the extension
// global realm. Only the explicit browser RPC and bounded console are exposed.
export async function executeScript(code, dispatch, {timeout = 60000, cpuTimeout = 1000, cancelled = () => false} = {}) {
  const preflight = preflightScript(code);
  if (preflight) return preflight;
  const wasm = await (modulePromise ||= newQuickJSWASMModuleFromVariant(variant));
  const vm = wasm.newContext(), deadline = Date.now() + timeout, logs = [], promises = [], pending = new Set();
  let alive = true, yielded = false, calls = 0, outstanding = 0, queue = Promise.resolve(), root, cpuDeadline = Date.now() + cpuTimeout, cpuExpired = false;
  const expired = () => Date.now() >= deadline || cancelled();
  vm.runtime.setMemoryLimit(32 * 1024 * 1024); vm.runtime.setMaxStackSize(512 * 1024);
  vm.runtime.setInterruptHandler(() => {cpuExpired ||= Date.now() >= cpuDeadline; return expired() || cpuExpired;});
  vm.newFunction('__log', value => {if (logs.join('').length < 12000) logs.push(vm.getString(value).slice(0, 2000));}).consume(fn => vm.setProp(vm.global, '__log', fn));
  vm.newFunction('__browserCall', value => {
    const text = vm.getString(value);
    const promise = vm.newPromise(); promises.push(promise);
    outstanding++;
    const operation = queue = queue.then(async () => {
      if (!alive || yielded || expired()) return;
      let result;
      try {
        if (text.length > 50000) throw new Error('script_invalid');
        calls++;
        result = {value: await dispatch(JSON.parse(text)) ?? null};
      } catch (error) {
        // Only the host can request this boundary. A script cannot catch it
        // and keep dispatching actions, even with queued or unawaited calls.
        if (error?.message === 'script_checkpoint') yielded = true;
        result = scriptFailure(error);
      }
      outstanding--;
      if (alive) vm.newString(JSON.stringify(result)).consume(handle => promise.resolve(handle));
    }).catch(() => {});
    pending.add(operation); operation.finally(() => pending.delete(operation));
    return promise.handle.dup();
  }).consume(fn => vm.setProp(vm.global, '__browserCall', fn));
  try {
    vm.unwrapResult(vm.evalCode(bootstrap)).dispose();
    const evaluated = vm.evalCode(`(async () => {\n${code}\n})()`, 'browser-task.js');
    root = vm.unwrapResult(evaluated);
    while (!expired() && !cpuExpired) {
      if (yielded) return {ok: true, yielded: true, completed: false, logs, calls};
      cpuDeadline = Date.now() + cpuTimeout;
      const jobs = vm.runtime.executePendingJobs(100);
      if (jobs.error) {const message = vm.dump(jobs.error); jobs.error.dispose(); throw new Error(message.message || 'script_failed');}
      const result = vm.getPromiseState(root);
      if (result.type === 'fulfilled') {
        const value = boundedValue(vm.dump(result.value)); result.value.dispose();
        if (outstanding) return {...scriptFailure('script_unawaited'), logs, calls};
        return {ok: true, value, logs, calls};
      }
      if (result.type === 'rejected') {const error = vm.dump(result.error); result.error.dispose(); return {...scriptFailure(cpuExpired ? 'script_cpu_limit' : error), logs, calls};}
      await Promise.race([...pending, new Promise(resolve => setTimeout(resolve, 10))]);
    }
    return {...scriptFailure(cancelled() ? 'cancelled' : cpuExpired ? 'script_cpu_limit' : 'script_timeout'), logs, calls};
  } catch (error) {return {...scriptFailure(cancelled() ? 'cancelled' : cpuExpired ? 'script_cpu_limit' : expired() ? 'script_timeout' : error), logs, calls};}
  finally {
    alive = false; await Promise.allSettled([...pending]);
    root?.dispose(); for (const promise of promises) promise.dispose(); vm.dispose();
  }
}
