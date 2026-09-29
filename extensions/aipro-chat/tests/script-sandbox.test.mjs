import test from 'node:test';
import assert from 'node:assert/strict';
import {executeScript} from '../script-sandbox.js';
import {LOCATOR_BUILDERS, LOCATOR_ACTIONS, LOCATOR_READS, PAGE_METHODS, SCRIPT_API_GUIDE} from '../browser-script-api.js';

test('observed ref scripts use the same isolated RPC and documented API contract', async () => {
  const calls = [];
  const result = await executeScript('await browser.ref("e-current").fill("draft"); return await browser.ref("e-current").inputValue();', async call => {calls.push(call);return call.method === 'inputValue' ? 'draft' : null;});
  assert.equal(result.ok, true); assert.equal(result.value, 'draft');
  assert.deepEqual(calls[0], {chain: [['ref',['e-current']]],method:'fill',args:['draft']});
  for (const method of [...LOCATOR_BUILDERS, ...LOCATOR_ACTIONS, ...LOCATOR_READS, ...PAGE_METHODS]) assert(SCRIPT_API_GUIDE.includes(method));
  const unavailable = await executeScript('return [typeof browser.ref("e").evaluate,typeof browser.ref("e").request];', () => assert.fail('No RPC expected'));
  assert.deepEqual(unavailable.value,['undefined','undefined']);
});

test('scripts execute async loops, conditionals, regex locators and sequential browser RPC', async () => {
  const calls = [];
  const result = await executeScript(`
    for (const name of ['받는 사람','제목']) await page.getByRole('textbox',{name:new RegExp(name,'i')}).fill('example');
    if (await page.getByText('저장됨').isVisible()) console.log('verified');
    return await page.title();
  `, async call => {calls.push(call); return call.method === 'isVisible' ? true : call.method === 'title' ? 'Draft' : null;});
  assert.equal(result.ok, true); assert.equal(result.value, 'Draft'); assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].chain[0][1][1].name, {__regexp: '받는 사람', flags: 'i'});
  assert(result.logs[0].includes('verified'));
});

test('read-only state and metadata queries preserve their RPC arguments', async () => {
  const calls = [];
  const result = await executeScript('return [await page.getByTitle("보기").getAttribute("id"), await browser.ref("current").isDisabled(), await page.getByAltText("로고").isVisible()];', async call => {
    calls.push(call); return call.method === 'getAttribute' ? 'view' : true;
  });
  assert.equal(result.ok, true); assert.deepEqual(result.value, ['view', true, true]);
  assert.deepEqual(calls[0], {chain: [['getByTitle', ['보기']]], method: 'getAttribute', args: ['id']});
  assert.deepEqual(calls[1].chain, [['ref', ['current']]]);
});

test('browser failures return feedback and the next script can correct its locator', async () => {
  const failed = await executeScript(`await page.getByLabel('missing').fill('draft');`, async () => {throw new Error('Playwright timeout: inspect current page');});
  assert.match(failed.error, /Playwright timeout/);
  const next = await executeScript(`await page.getByLabel('본문').fill('draft'); return 'saved';`, async () => null);
  assert.equal(next.value, 'saved');
});

test('VM cannot reach Chrome, network, Node or privileged JavaScript globals', async () => {
  const result = await executeScript(`return [typeof chrome,typeof fetch,typeof process,typeof require,typeof window,typeof WebAssembly,typeof page.evaluate,typeof page.request];`, async () => assert.fail('No RPC expected'));
  assert.deepEqual(result.value, Array(8).fill('undefined'));
});

test('CPU loop and memory growth are interrupted without poisoning the next VM', async () => {
  const start = Date.now();
  assert.equal((await executeScript('while(true){}', async () => null, {cpuTimeout: 50})).error, 'script_cpu_limit');
  assert(Date.now() - start < 2000);
  assert((await executeScript('let a=[];while(true)a.push(new Array(10000).fill("data"));', async () => null)).error);
  assert.equal((await executeScript('return 42', async () => null)).value, 42);
});

test('queued calls are sequential and cancellation prevents subsequent browser actions', async () => {
  let cancelled = false, calls = 0;
  const result = await executeScript(`await Promise.all([page.title(),page.url(),page.title()]);`, async () => {calls++; cancelled = true; return 'done';}, {cancelled: () => cancelled});
  assert.equal(result.error, 'cancelled'); assert.equal(calls, 1);
  let live = 0, maximum = 0;
  await executeScript(`await Promise.all([page.title(),page.title(),page.title()])`, async () => {live++; maximum = Math.max(maximum, live); await new Promise(r => setTimeout(r, 5)); live--; return 'x';});
  assert.equal(maximum, 1);
});

test('a finite script can complete more than sixty sequential browser actions', async () => {
  let calls = 0;
  const result = await executeScript(`for(let i=0;i<100;i++)await page.getByLabel('field').fill(String(i)); return 'done';`, async () => {calls++;});
  assert.equal(result.ok, true); assert.equal(result.value, 'done'); assert.equal(calls, 100);
});

test('host decision checkpoint ends the script even when it catches errors or queues more commands', async () => {
  for (const code of [
    'await page.getByText("열기").click(); try { await page.getByLabel("제목").fill("x"); } catch {} await page.getByLabel("본문").fill("y");',
    'await Promise.all([page.getByText("열기").click(), page.getByLabel("제목").fill("x"), page.getByLabel("본문").fill("y")]);',
  ]) {
    const issued = [];
    const result = await executeScript(code, async call => {
      if (issued.length) throw new Error('script_checkpoint');
      issued.push(call.method);
    });
    assert.equal(result.yielded, true);
    assert.equal(result.completed, false);
    assert.equal(result.error, undefined);
    assert.deepEqual(issued, ['click']);
  }
  const forged = await executeScript('throw new Error("script_checkpoint")', () => assert.fail('No call'));
  assert.equal(forged.yielded, undefined);
  assert.equal(forged.reason, 'script_failed');
});
