// The lifecycle of the Electron host (2026-10-05): the window where the user left it, the service worker restarted
// when it dies, a bounded log of what it printed. The decisions run here without Electron; the real window is checked
// by scripts/check-electron-shell.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {restoreWindowState,windowStateOf,restartDecision,WorkerSupervisor,boundedLog,WINDOW_DEFAULTS,startupMailPrompt}=require('../electron-app/lifecycle.cjs');

test('the mail prompt at start applies only with automatic summaries on and no account (user decision 2026-10-05)',()=>{
  assert.equal(startupMailPrompt({autoWiki:true,connected:false}),true);
  assert.equal(startupMailPrompt({autoWiki:false,connected:false}),false);
  assert.equal(startupMailPrompt({autoWiki:true,connected:true}),false);
  assert.equal(startupMailPrompt(null),false,'no mail status, no prompt');
});

test('a saved window comes back where it was, only where that place is still on a display',()=>{
  const displays=[{workArea:{x:0,y:0,width:1920,height:1055}}];
  assert.deepEqual(restoreWindowState(null,displays),{width:1480,height:960,maximized:false});
  assert.deepEqual(restoreWindowState({x:100,y:50,width:1200,height:800,maximized:true},displays),{x:100,y:50,width:1200,height:800,maximized:true});
  // The monitor it was on is unplugged: the window keeps its size and is centered on what is left.
  assert.deepEqual(restoreWindowState({x:2500,y:50,width:1200,height:800},displays),{width:1200,height:800,maximized:false});
  // Partly off the screen but still reachable, at a size below the minimum.
  assert.deepEqual(restoreWindowState({x:1700,y:900,width:300,height:200},displays),{x:1700,y:900,width:WINDOW_DEFAULTS.minWidth,height:WINDOW_DEFAULTS.minHeight,maximized:false});
  assert.deepEqual(restoreWindowState({x:'a',y:[],width:NaN,maximized:'yes'},displays),{width:1480,height:960,maximized:false});
  const window={isMaximized:()=>true,getNormalBounds:()=>({x:1,y:2,width:700,height:600}),getBounds:()=>({x:0,y:0,width:1920,height:1055})};
  assert.deepEqual(windowStateOf(window),{x:1,y:2,width:700,height:600,maximized:true});
});
test('a worker that dies is started again after a growing pause, and given up after four deaths in ten minutes',()=>{
  const m=60000;
  assert.deepEqual(restartDecision([0],0),{restart:true,delayMs:500,recent:1});
  assert.deepEqual(restartDecision([0,m],m),{restart:true,delayMs:1000,recent:2});
  assert.deepEqual(restartDecision([0,m,2*m],2*m),{restart:true,delayMs:2000,recent:3});
  assert.deepEqual(restartDecision([0,m,2*m,3*m],3*m),{restart:false,delayMs:0,recent:4});
  assert.deepEqual(restartDecision([0,m,2*m,3*m],12*m+1),{restart:true,delayMs:500,recent:1},'deaths older than ten minutes are forgotten');
});
class FakeChild extends EventEmitter{
  constructor(){super();this.connected=true;this.sent=[];this.exitCode=null;this.killed=false;}
  send(message){this.sent.push(message);}
  disconnect(){this.connected=false;}
  kill(){this.killed=true;this.connected=false;this.emit('exit',null,'SIGTERM');}
}
function supervised(){
  const spawned=[],scheduled=[],events=[];let now=1000;
  const supervisor=new WorkerSupervisor({spawn:()=>{const child=new FakeChild();spawned.push(child);return child;},now:()=>now,schedule:(fn,ms)=>{scheduled.push({fn,ms});return {};}});
  for(const name of ['fault','restarting','restarted','failed','exit'])supervisor.on(name,event=>events.push([name,event]));
  return {supervisor,spawned,scheduled,events,clock:value=>{now=value;}};
}
test('the supervisor answers requests, rejects the in-flight ones of a dead worker and starts another for the next',async()=>{
  const {supervisor,spawned,scheduled,events}=supervised();supervisor.start();
  const first=supervisor.invoke('overview',{a:1});const sent=spawned[0].sent[0];assert.equal(sent.method,'overview');assert.deepEqual(sent.args,{a:1});
  spawned[0].emit('message',{id:sent.id,result:{ok:true}});assert.deepEqual(await first,{ok:true});
  const refused=supervisor.invoke('open');spawned[0].emit('message',{id:spawned[0].sent[1].id,error:'project_locked'});await assert.rejects(refused,/project_locked/);
  // The worker dies with a request in flight: its effect is unknown, so it is rejected, not sent again.
  const inflight=supervisor.invoke('overview');spawned[0].connected=false;spawned[0].emit('exit',1,null);
  await assert.rejects(inflight,/host_disconnected/);
  assert.deepEqual(events.map(([name])=>name),['fault','restarting']);assert.equal(events[0][1].reason,'abnormal-exit');
  const restart=scheduled.at(-1);assert.equal(restart.ms,500);
  // A request that arrives while the worker restarts waits for the new worker (its own wait timer is the last scheduled).
  const waiting=supervisor.invoke('overview');assert.equal(scheduled.at(-1).ms,15000);
  restart.fn();assert.equal(spawned.length,2);await new Promise(resolve=>setImmediate(resolve));
  const again=spawned[1].sent[0];assert.equal(again.method,'overview');spawned[1].emit('message',{id:again.id,result:'again'});assert.equal(await waiting,'again');
  assert.deepEqual(events.map(([name])=>name),['fault','restarting','restarted']);
});
test('a worker that keeps dying is given up, and a stopped worker is not started again',async()=>{
  const {supervisor,spawned,scheduled,events,clock}=supervised();supervisor.start();
  for(let n=0;n<3;n++){spawned.at(-1).connected=false;spawned.at(-1).emit('exit',1,null);scheduled.at(-1).fn();}
  assert.equal(spawned.length,4);assert.deepEqual(events.filter(([name])=>name==='restarting').map(([,e])=>e.delayMs),[500,1000,2000]);
  spawned.at(-1).connected=false;spawned.at(-1).emit('exit',null,'SIGKILL');
  assert.equal(events.at(-1)[0],'failed');assert.equal(events.at(-1)[1].restarts,3);await assert.rejects(supervisor.invoke('overview'),/host_disconnected/);
  // Ten minutes later a death is a new first death.
  clock(1000+11*60000);supervisor.start();spawned.at(-1).connected=false;spawned.at(-1).emit('exit',1,null);assert.equal(events.at(-1)[0],'restarting');assert.equal(events.at(-1)[1].delayMs,500);
  // Stopping asks the worker to leave and kills it when it stays.
  const stopped=supervised();stopped.supervisor.start();const child=stopped.spawned[0];const stopping=stopped.supervisor.stop();
  assert.equal(child.connected,false);assert.equal(stopped.scheduled.at(-1).ms,2500);stopped.scheduled.at(-1).fn();assert.equal(child.killed,true);
  await stopping;/* stop() resolves once the worker has exited, so quitting can wait for the project lock to be released */
  assert.deepEqual(stopped.events.map(([name,e])=>[name,e.expected]),[['exit',true]]);assert.equal(stopped.spawned.length,1,'no restart after stop');
});
test('the worker log never grows past its bound',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-worker-log-'));
  try{
    const file=path.join(directory,'worker.log'),write=boundedLog({file,maxBytes:40});
    await write('first line of the worker\n');await write('second line of the worker\n');await write('third\n');
    // The second line would pass the bound: the first line moves to .1 and the file starts again.
    assert.equal(await readFile(file,'utf8'),'second line of the worker\nthird\n');assert.equal(await readFile(file+'.1','utf8'),'first line of the worker\n');
    assert.ok((await stat(file)).size<=40);
  }finally{await rm(directory,{recursive:true,force:true});}
});
