import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeEvaluationDialogs} from '../scripts/evaluation-dialogs.mjs';

const profile = await mkdtemp(join(tmpdir(), 'nubi-dialog-test-'));
const child = spawn(chromium.executablePath(), [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', 'about:blank'], {stdio:'ignore'});
let owner, observer;
try {
  let port;
  for (let attempt=0; attempt<100 && !port; attempt++) {
    port=await readFile(join(profile,'DevToolsActivePort'),'utf8').then(value=>Number(value.split('\n')[0])).catch(()=>null);
    if (!port) await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(port);
  owner=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
  const events=[], ownerContext=owner.contexts()[0];
  observeEvaluationDialogs(ownerContext, events);
  observer=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{noDefaults:true});
  const observed=[]; observeEvaluationDialogs(observer.contexts()[0], observed);
  const page=ownerContext.pages()[0];
  await page.setContent('<button onclick="window.result=prompt(\'PRIVATE_PROMPT\',\'PRIVATE_DEFAULT\')">Open</button>');
  for (const accept of [true,false]) {
    const opened=ownerContext.waitForEvent('dialog');
    const seen=observer.contexts()[0].waitForEvent('dialog');
    let settled=false;
    const click=page.getByRole('button').click().then(()=>{settled=true;});
    const dialog=await opened; await seen;
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(settled,false,'observation cannot implicitly dismiss the dialog');
    if (accept) await dialog.accept('fixture approval'); else await dialog.dismiss();
    await click;
    assert.equal(await page.evaluate(()=>window.result),accept?'fixture approval':null);
  }
  assert.equal(events.length,2); assert.equal(observed.length,2);
  assert(!JSON.stringify([...events,...observed]).includes('PRIVATE_'));
  console.log('PASS two CDP observers preserve prompt/HITL until fixture owner accepts or dismisses; no prompt text recorded');
} finally {
  await observer?.close(); await owner?.close();
  child.kill(); await once(child,'exit').catch(()=>{});
  await rm(profile,{recursive:true,force:true});
}
