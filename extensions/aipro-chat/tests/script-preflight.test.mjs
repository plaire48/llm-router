import test from 'node:test';
import assert from 'node:assert/strict';
import {executeScript} from '../script-sandbox.js';
import {preflightScript} from '../script-preflight.js';
import {scriptFailure} from '../script-feedback.js';

test('unsupported late calls and syntax are rejected before an earlier valid write', async () => {
  for (const tail of [
    'await page.evaluate(() => document.title);',
    'await page.keyboard.press("Enter");',
    'const p = page; await p["evaluate"](() => 1);',
    'const input = page.getByLabel("Title"); await input.evaluate(() => 1);',
    'await browser.ref("observed").locator("input").fill("x");',
    'await fetch("https://private.example");',
    'await import("PRIVATE_MODULE");',
    'const broken = ;',
  ]) {
    let calls = 0;
    const result = await executeScript(`await page.getByLabel("PRIVATE_FIELD").fill("PRIVATE_VALUE");\n${tail}`, async () => {calls++;});
    assert.equal(calls, 0); assert.equal(result.phase, 'preflight'); assert.equal(result.calls, 0);
    assert.equal(result.location.line, 2); assert(result.location.column > 0);
    assert(!JSON.stringify(result).includes('PRIVATE')); assert.notEqual(result.ok, true);
  }
});

test('direct unawaited writes are rejected without side effects', async () => {
  let writes = 0;
  const result = await executeScript('const input = page.getByLabel("Title"); input.fill("draft");', async () => {writes++;});
  assert.equal(result.reason, 'script_unawaited'); assert.equal(writes, 0);
});

test('awaited aliases, helpers, frames, Promise.all and delayed promise awaits remain executable', async () => {
  const code = `
    const p = page, input = p.frameLocator("iframe").getByLabel(/title/i);
    async function fill(target) { await target.fill("draft"); }
    await fill(input);
    await Promise.all([page.title(), page.url()]);
    const pending = browser.snapshot();
    return await pending;
  `;
  let calls = 0;
  const result = await executeScript(code, async () => {calls++; return 'observed';});
  assert.equal(result.ok, true); assert.equal(calls, 4); assert.equal(result.value, 'observed');
});

test('ordinary objects and shadowed globals are not mistaken for the browser facade', async () => {
  const code = `
    const local = { evaluate() { return 7; } };
    async function inspect(page) { return page.evaluate(); }
    const values = [await inspect(local)];
    { const page = local; values.push(page.evaluate()); }
    for (const browser of [local]) values.push(browser.evaluate());
    try { throw local; } catch (page) { values.push(page.evaluate()); }
    function hoisted() { if (true) { var page = local; } return page.evaluate(); }
    values.push(hoisted());
    return values;
  `;
  const result = await executeScript(code, () => assert.fail('No browser action expected'));
  assert.equal(result.ok, true); assert.deepEqual(result.value, [7, 7, 7, 7, 7]);
});

test('comments, strings, regular expressions and harmless typeof probes are not scanned as code', async () => {
  const result = await executeScript(`
    // await page.evaluate(() => 1);
    const text = 'page.keyboard.press("Enter")';
    return [/page\\.evaluate/.test(text), typeof page.evaluate, typeof fetch, typeof chrome];
  `, () => assert.fail('No browser action expected'));
  assert.equal(result.ok, true); assert.deepEqual(result.value, [false, 'undefined', 'undefined', 'undefined']);
});

test('dynamic calls still go through the isolated VM and host instead of claiming full static validation', async () => {
  assert.equal(preflightScript('const method = "title"; return await page[method]();'), null);
  const result = await executeScript('const method = "evaluate"; return await page[method](() => 1);', () => assert.fail('Unsupported RPC'));
  assert.equal(result.reason, 'script_api'); assert.notEqual(result.phase, 'preflight');
});

test('bounded failure categories prioritize actionability over a generic timeout and omit raw page data', () => {
  for (const [message, evidence, reason] of [
    ['Timeout 7000ms: PRIVATE_OVERLAY intercepts pointer events', undefined, 'script_obscured'],
    ['Timeout 7000ms: waiting for PRIVATE_SELECTOR', 'missing', 'script_missing'],
    ['Timeout 7000ms: element is not enabled PRIVATE_VALUE', undefined, 'script_disabled'],
    ['Timeout 7000ms: waiting', 'disabled', 'script_disabled'],
    ['Timeout 7000ms: element is not visible PRIVATE_VALUE', undefined, 'script_hidden'],
    ['Timeout 7000ms: Element is not attached to the DOM PRIVATE_VALUE', undefined, 'browser_stale'],
    ['Timeout 7000ms: element is not editable PRIVATE_VALUE', undefined, 'script_target'],
    ['Timeout 7000ms: PRIVATE_VALUE', undefined, 'script_timeout'],
  ]) {
    const result = scriptFailure(Object.assign(new Error(message), {name: 'TimeoutError'}), evidence);
    assert.equal(result.reason, reason); assert(result.instruction); assert(!JSON.stringify(result).includes('PRIVATE'));
  }
});
