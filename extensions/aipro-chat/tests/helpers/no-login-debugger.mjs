import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Instrument only an isolated test copy, including calls whose errors are swallowed.
export async function forbidLoginDebugger(extension) {
  const file = resolve(extension, 'background.js');
  await writeFile(file, `chrome.storage.session.set({testWorkerGeneration: crypto.randomUUID()});
for (const method of ['attach', 'detach', 'sendCommand']) chrome.debugger[method] = async () => {
  const {testLoginDebuggerCalls = []} = await chrome.storage.session.get('testLoginDebuggerCalls');
  await chrome.storage.session.set({testLoginDebuggerCalls: [...testLoginDebuggerCalls, method]});
  throw new Error('Unexpected debugger use during login');
};\n${await readFile(file, 'utf8')}`);
}
export async function assertNoLoginDebugger(page) {
  assert.deepEqual((await page.evaluate(() => chrome.storage.session.get('testLoginDebuggerCalls'))).testLoginDebuggerCalls || [], []);
}
