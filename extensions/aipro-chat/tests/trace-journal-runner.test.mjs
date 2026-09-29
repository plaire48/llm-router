import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('runner sends every event separately while keeping recent trace bounded and active identity stable', async t => {
  const key = `__journalRunner${Date.now()}`;
  globalThis[key] = async (...args) => {
    const progress = args[7];
    progress({index:'parent',tool:'ask_openwiki',status:'running'});
    progress({index:'coordinator',tool:'analysis_research',status:'running',analysis:{role:'coordinator',phase:'planning'}});
    for(let i=0;i<130;i++) progress({index:`worker-${i}`,tool:'analysis_research',status:'done',analysis:{phase:'finished',task:`worker ${i}`}});
    progress({index:'coordinator',tool:'analysis_research',status:'done',analysis:{role:'coordinator',phase:'finished',outcome:'complete',delivered:true,deliveredTo:'main'}});
    progress({index:'parent',tool:'ask_openwiki',status:'done'});
    return 'done';
  };
  t.after(()=>{delete globalThis[key];});
  let source = await readFile(new URL('../background-runner.js',import.meta.url),'utf8');
  source = source.replace("import {completeChat} from './src/api.js';", `const completeChat = globalThis[${JSON.stringify(key)}];`);
  for(const file of ['agent-trace.js','model-recovery.js','chat-contract.js','core.js']) source=source.replace(`'./${file}'`,JSON.stringify(new URL(`../${file}`,import.meta.url).href));
  const {createBackgroundRunner} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const calls=[],snapshots=[]; let resolve;
  const finished = new Promise(done=>{resolve=done;});
  const runner=createBackgroundRunner({call:async(type,value)=>{calls.push({type,...value});if(type==='FINISH_CHAT')resolve(value);},publish:async snapshot=>snapshots.push(snapshot),keepAlive:async()=>{}});
  runner.start({requestId:'request',conversationId:'conversation'});
  const result=await finished;
  assert.equal(result.content,'done');
  assert.equal(result.traceSequence,134);
  const events=calls.filter(call=>call.kind==='trace');
  assert.equal(events.length,134);assert.deepEqual(events.map(event=>event.sequence),Array.from({length:134},(_,index)=>index+1));
  assert(events.every(event=>event.trace.length<=32));assert(result.trace.length<=32);assert(snapshots.every(snapshot=>snapshot.trace.length<=32));
  assert.equal(events[0].event.id,events.at(-1).event.id);
  assert.equal(events[0].event.status,'running');assert.equal(events.at(-1).event.status,'done');
  assert.equal(new Set(events.slice(2,-2).map(event=>event.event.id)).size,130);
  const handoff=result.trace.find(step=>step.id===events[1].event.id), parent=result.trace.find(step=>step.id===events[0].event.id);
  assert(handoff,'Recent completion must survive even when its worker started more than 32 steps ago');
  assert(parent,'Long parent completion remains in the bounded summary');
  assert.equal(handoff.id,events[1].event.id,'Coordinator keeps its original identity after its active pin is released');
  assert.equal(handoff.status,'done');assert.equal(handoff.analysis.deliveredTo,'main');assert.equal(handoff.analysis.delivered,true);
  assert.equal(parent.id,events[0].event.id);assert.equal(parent.tool,'ask_openwiki');assert.equal(parent.status,'done');
  assert.equal(new Set(result.trace.map(step=>step.id)).size,result.trace.length,'Moving updated steps must not duplicate them');
  assert(snapshots.at(-1).trace.some(step=>step.id===handoff.id && step.analysis.deliveredTo==='main'));
  assert(snapshots.at(-1).trace.some(step=>step.id===parent.id && step.status==='done'));
  assert(!JSON.stringify({events,snapshots,result}).includes('progressRevision'),'Retention revisions are private and never persisted or published');
});

test('cancelled runner reports the attempted tail sequence even when progress saves are rejected', async t => {
  const key=`__cancelledJournalRunner${Date.now()}`;
  let started;
  const ready=new Promise(resolve=>{started=resolve;});
  globalThis[key]=async(...args)=>{
    const signal=args[1], progress=args[7];
    progress({index:'worker',tool:'analysis_research',status:'running',analysis:{phase:'reading'}});
    return new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>{
        progress({index:'worker',tool:'analysis_research',status:'cancelled',analysis:{phase:'finished'}});
        reject(new Error('cancelled'));
      },{once:true});
      started();
    });
  };
  t.after(()=>{delete globalThis[key];});
  let source=await readFile(new URL('../background-runner.js',import.meta.url),'utf8');
  source=source.replace("import {completeChat} from './src/api.js';",`const completeChat=globalThis[${JSON.stringify(key)}];`);
  for(const file of ['agent-trace.js','model-recovery.js','chat-contract.js','core.js'])source=source.replace(`'./${file}'`,JSON.stringify(new URL(`../${file}`,import.meta.url).href));
  const {createBackgroundRunner}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const saved=[];let finish;
  const done=new Promise(resolve=>{finish=resolve;});
  const runner=createBackgroundRunner({call:async(type,value)=>{
    if(type==='SAVE_CONTEXT'&&value.kind==='trace'){
      if(value.event.status==='cancelled')throw new Error('interrupted');
      saved.push(value);
    }
    if(type==='FINISH_CHAT')finish(value);
  },publish:async()=>{},keepAlive:async()=>{}});
  runner.start({requestId:'cancel-request',conversationId:'conversation'});
  await ready;runner.cancel('cancel-request');
  const result=await done;
  assert.equal(result.error,'cancelled');assert.equal(result.traceSequence,2);assert.equal(saved.length,1);assert.equal(saved[0].sequence,1);
  assert.equal(result.trace[0].status,'cancelled');assert.equal(result.trace[0].id,saved[0].event.id);
});


test('nested form verification preserves operation start order while journal events preserve update order', async t => {
  const key=`__nestedJournalRunner${Date.now()}`;
  globalThis[key]=async(...args)=>{
    const progress=args[7];
    progress({index:'fill',tool:'fill_form',status:'running'});
    progress({index:'verify',tool:'verify_form',status:'running'});
    progress({index:'verify',tool:'verify_form',status:'done'});
    progress({index:'fill',tool:'fill_form',status:'done'});
    return 'verified';
  };
  t.after(()=>{delete globalThis[key];});
  let source=await readFile(new URL('../background-runner.js',import.meta.url),'utf8');
  source=source.replace("import {completeChat} from './src/api.js';",`const completeChat=globalThis[${JSON.stringify(key)}];`);
  for(const file of ['agent-trace.js','model-recovery.js','chat-contract.js','core.js'])source=source.replace(`'./${file}'`,JSON.stringify(new URL(`../${file}`,import.meta.url).href));
  const {createBackgroundRunner}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const saved=[],snapshots=[];let finish;
  const done=new Promise(resolve=>{finish=resolve;});
  const runner=createBackgroundRunner({call:async(type,value)=>{
    if(type==='SAVE_CONTEXT'&&value.kind==='trace')saved.push(value);
    if(type==='FINISH_CHAT')finish(value);
  },publish:async snapshot=>snapshots.push(snapshot),keepAlive:async()=>{}});
  runner.start({requestId:'nested-request',conversationId:'conversation'});
  const result=await done;
  assert.equal(result.content,'verified');assert.equal(result.traceSequence,4);
  assert.deepEqual(result.trace.map(step=>[step.tool,step.status]),[['fill_form','done'],['verify_form','done']]);
  assert.deepEqual(saved.map(item=>[item.event.tool,item.event.status]),[['fill_form','running'],['verify_form','running'],['verify_form','done'],['fill_form','done']]);
  assert.equal(result.trace[0].id,saved[0].event.id);assert.equal(result.trace[1].id,saved[1].event.id);
  assert.deepEqual(saved.at(-1).trace,result.trace);assert.deepEqual(snapshots.at(-1).trace,result.trace);
});

test('human fill review survives the inactivity deadline without model calls and resumes only on approval', async t => {
  const key = `__humanWait${Date.now()}`;
  let models = 0;
  globalThis[key] = async (...args) => {models++; return JSON.stringify(await args[6]('fill_form', {}));};
  t.after(() => {delete globalThis[key];});
  let source = await readFile(new URL('../background-runner.js', import.meta.url), 'utf8');
  source = source.replace("import {completeChat} from './src/api.js';", `const completeChat = globalThis[${JSON.stringify(key)}];`);
  for (const file of ['agent-trace.js','model-recovery.js','chat-contract.js','core.js']) source = source.replace(`'./${file}'`, JSON.stringify(new URL(`../${file}`, import.meta.url).href));
  const {createBackgroundRunner} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'], now:1000});
  const calls = [], snapshots = [];
  let finish;
  const done = new Promise(resolve => {finish = resolve;});
  const runner = createBackgroundRunner({keepAlive:async()=>{},publish:async snapshot=>snapshots.push(snapshot),call:async(type,value)=>{
    calls.push({type,...value});
    if (type === 'RUN_TOOL') return value.name === 'fill_form' ? {planId:'plan',fields:[]} : {ok:true};
    if (type === 'APPLY_FILL') return {ok:true,applied:1};
    if (type === 'FINISH_CHAT') finish(value);
  }});
  runner.start({requestId:'wait',conversationId:'conversation'});
  for (let i=0;i<30;i++) await Promise.resolve();
  assert.equal(runner.acceptsInput('wait'),false);
  for (let i=0;i<36;i++) {t.mock.timers.tick(25000);for(let j=0;j<10;j++)await Promise.resolve();}
  assert.equal(models,1);assert.equal(calls.filter(item=>item.type==='APPLY_FILL').length,0);
  assert.equal(calls.filter(item=>item.type==='FINISH_CHAT').length,0);
  assert(calls.filter(item=>item.kind==='heartbeat').length>=30);
  assert(snapshots.some(item=>item.fillReview?.planId==='plan'));
  assert.throws(()=>runner.resolveFill('wait','old-plan',true),/fill_invalid/);
  runner.resolveFill('wait','plan',true);
  const result=await done;
  assert.equal(result.error,undefined);assert.equal(calls.filter(item=>item.type==='APPLY_FILL').length,1);
});
