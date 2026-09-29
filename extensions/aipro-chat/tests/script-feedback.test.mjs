import test from 'node:test';
import assert from 'node:assert/strict';
import {executeScript} from '../script-sandbox.js';
import {scriptFailure} from '../script-feedback.js';
import {displayTrace, normalizeTrace} from '../agent-trace.js';
import {runAgent} from '../agent-runtime.js';
import {createHarness} from '../agent-harness.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

test('region read failures retain typed recovery without requesting input or actions', () => {
  const stale = scriptFailure(new Error('region_stale'));
  assert.equal(stale.reason, 'region_stale');
  assert.match(stale.instruction, /fresh observation/);
  assert.match(stale.instruction, /No input or click/);
  const invalid = scriptFailure(new Error('region_arguments_invalid'));
  assert.equal(invalid.reason, 'region_arguments_invalid');
  assert.match(invalid.instruction, /only mode="region" and region_ref/);
});

test('unconfirmed managed policy stays a policy failure with no script-repair guidance', () => {
  const result = scriptFailure(new Error('browser_policy_invalid'));
  assert.equal(result.error, 'browser_policy_invalid');
  assert.equal(result.reason, 'browser_policy_invalid');
  assert.match(result.instruction, /No operation is authorized/);
  assert.match(result.instruction, /do not retry another tool/);
  assert.equal(normalizeTrace([{tool:'browser_snapshot',status:'error',reason:result.reason}])[0].reason, result.reason);
});

test('script feedback distinguishes syntax, unsupported APIs, ambiguous targets and editable controls without raw data', async () => {
  for (const [code, reason] of [['const = ;', 'script_syntax'], ['await page.evaluate(() => 1)', 'script_api']]) {
    const result = await executeScript(code, () => assert.fail('No action expected'));
    assert.equal(result.reason, reason); assert(result.instruction);
  }
  for (const [message, reason] of [['strict mode violation: PRIVATE_SELECTOR resolved to 2 elements','script_locator'], ['Element is not an <input>, <textarea> or [contenteditable] element: PRIVATE_VALUE','script_target']]) {
    const result = await executeScript('await page.getByRole("button").fill("x")', () => {throw new Error(message);});
    assert.equal(result.reason, reason); assert(!JSON.stringify(result).includes('PRIVATE'));
  }
  assert.equal(scriptFailure(new Error('unknown PRIVATE_VALUE')).error, 'script_failed');
});

test('script errors reveal only already-authorized semantic tools and keep previous verification pending', () => {
  const tools = browserTools({}, BUILTIN_SKILLS[0]); const h = createHarness(tools);
  h.observe('click_element', {ok:true});
  h.observe('run_playwright', {error:'script_api', actionIssued:false});
  const names = h.advertised().map(t=>t.function.name);
  assert(names.includes('fill_form')); assert(names.includes('click_element')); assert(names.includes('navigate_page'));
  assert(h.needsCheck());
  const limited = createHarness(tools.filter(t=>!['fill_form','navigate_page'].includes(t.function.name)));
  limited.observe('run_playwright', {error:'script_api',actionIssued:false});
  assert(!limited.advertised().some(t=>['fill_form','navigate_page'].includes(t.function.name)));
});

test('a script returning before its browser promises settle cannot claim successful execution', async () => {
  const result = await executeScript('page.getByLabel("제목").fill("draft"); return "done";', async () => {await new Promise(resolve=>setTimeout(resolve,20));});
  assert.equal(result.reason, 'script_unawaited'); assert.notEqual(result.ok, true);
  const next = await executeScript('await page.getByLabel("제목").fill("draft"); return "done";', async () => null);
  assert.equal(next.ok,true);
});

test('awaited asynchronous RPC completion is not mistaken for an unfinished browser action', async () => {
  let calls=0;
  const result=await executeScript('for(let i=0;i<30;i++) await page.title(); return await page.url();',async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return 'observed';});
  assert.equal(result.ok,true);assert.equal(result.value,'observed');assert.equal(calls,31);
});

test('changing observation refs cannot keep an identical failing script running forever', async () => {
  let calls=0;
  await assert.rejects(runAgent({messages:[{role:'user',content:'작성'}],tools:browserTools({},BUILTIN_SKILLS[0]),signal:new AbortController().signal,
    complete:async()=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name:'run_playwright',arguments:JSON.stringify({code:'await page.evaluate(() => 1)'})}}]}),
    execute:async()=>({error:'script_api',reason:'script_api',actionIssued:false,observation:{id:crypto.randomUUID(),text:'unchanged',frames:[{ref:String(++calls)}]}}),
  }),/agent_stalled/);
  assert.equal(calls,3);
});

test('trace keeps bounded failure reasons, retains recent steps and marks recovery only after a completed goal review', () => {
  const steps = [{tool:'run_playwright',status:'error',reason:'script_api',code:'PRIVATE'}, {tool:'fill_form',status:'done'}, {tool:'verify_page',status:'done'}, {tool:'review_task',status:'done'}];
  assert.equal(displayTrace(steps)[0].status,'error');
  assert.equal(displayTrace(steps.slice(0,-1),true)[0].status,'error');
  assert.equal(displayTrace(steps,true)[0].status,'recovered');
  assert.equal(steps[0].status,'error');
  assert(!JSON.stringify(normalizeTrace([...steps,{tool:'run_playwright',status:'error',reason:'PRIVATE'}])).includes('PRIVATE'));
  const many = Array.from({length:40},()=>({tool:'browser_snapshot',status:'done'})).concat(steps);
  assert.equal(normalizeTrace(many).length,32);assert.equal(normalizeTrace(many).at(-1).tool,'review_task');
});
