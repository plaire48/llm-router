import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Inspect executed scripts, not fetch() responses: an MV3 worker can retain its
// installed module graph when an unpacked directory is overwritten on disk.
export async function inspectEvaluationBuild(browser, worker, extension,
  required = ['background.js', 'task-plan.js', 'browser-workspace.js']) {
  await worker.evaluate(() => chrome.runtime.id);
  const cdp = await browser.newBrowserCDPSession();
  const pending = new Map(), scripts = [];
  let sequence = 0, sessionId;
  const receive = event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id && pending.has(message.id)) pending.get(message.id)(message);
    else if (message.method === 'Debugger.scriptParsed') scripts.push(message.params);
  };
  const send = async (method, params = {}) => {
    const id = ++sequence;
    const response = new Promise((resolveResponse, reject) => {
      const timer = setTimeout(() => {pending.delete(id); reject(Error('evaluation_build_timeout'));}, 5000);
      pending.set(id, message => {
        clearTimeout(timer); pending.delete(id);
        if (message.error) reject(Error('evaluation_build_protocol')); else resolveResponse(message.result);
      });
    });
    await cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})});
    return response;
  };
  try {
    const target = (await cdp.send('Target.getTargets')).targetInfos.find(item => item.type === 'service_worker' && item.url === worker.url());
    if (!target) throw Error('evaluation_build_worker_missing');
    ({sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: false}));
    cdp.on('Target.receivedMessageFromTarget', receive);
    await send('Debugger.enable');
    const base = new URL('./', worker.url()).href;
    const parseDeadline = Date.now() + 5000;
    while (!scripts.some(script => script.url === worker.url()) && Date.now() < parseDeadline) {
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
    const checks = [];
    for (const file of required) {
      if (!/^[a-z0-9-]+\.js$/.test(file)) throw Error('evaluation_build_path');
      const script = scripts.find(item => item.url === base + file);
      const expected = await readFile(resolve(extension, file), 'utf8');
      const loaded = script ? (await send('Debugger.getScriptSource', {scriptId: script.scriptId})).scriptSource : null;
      const hash = value => createHash('sha256').update(value).digest('hex');
      checks.push({file, expectedSha256: hash(expected), loadedSha256: loaded === null ? null : hash(loaded), matches: loaded === expected});
    }
    return {verified: checks.every(check => check.matches), checks};
  } finally {
    if (sessionId) await send('Debugger.disable').catch(() => {});
    cdp.off('Target.receivedMessageFromTarget', receive);
    await cdp.detach().catch(() => {});
  }
}

export async function prepareEvaluationBuild(browser, _context, worker, extension, required) {
  const verification = await inspectEvaluationBuild(browser, worker, extension, required);
  if (!verification.verified) throw Error('evaluation_build_mismatch');
  return {worker, verification};
}
