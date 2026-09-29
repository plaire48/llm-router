import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

// A2A is deferred by the user. Historical state must not reactivate it.
const profile=await mkdtemp(resolve(tmpdir(),'nubi-a2a-disabled-'));
let context;
try {
  await assert.rejects(access(resolve('dist/a2a-connection.js')));
  await assert.rejects(access(resolve('dist/a2a-licenses')));
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.session.set({a2a:{origin:'http://127.0.0.1:9876',token:'synthetic-old-state'}}));
  const ui=await context.newPage(),errors=[],requests=[];
  ui.on('pageerror',error=>errors.push(error.message));
  context.on('request',request=>requests.push(request.url()));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  for(const width of [320,1100]){
    await ui.setViewportSize({width,height:850});
    await ui.getByRole('button',{name:'설정',exact:true}).click();
    assert.equal(await ui.getByRole('button',{name:'누비 작업 연결',exact:true}).count(),0);
    await ui.keyboard.press('Escape');
  }
  for(const action of ['connect','status','import','send']){
    const response=await ui.evaluate(action=>chrome.runtime.sendMessage({type:'A2A',action,url:'http://127.0.0.1:9876'}),action);
    assert.equal(response.ok,false);
  }
  assert(!requests.some(url=>url.startsWith('http://127.0.0.1:9876')));
  assert.deepEqual(errors,[]);
  console.log('PASS: A2A absent from ZIP and UI; legacy state and RPC cannot connect');
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
