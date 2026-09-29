import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {watchNativeDialogs} from '../browser-dialogs.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('native decisions are dismissed, block further actions, and never read dialog secrets', async () => {
 for (const type of ['confirm','prompt','beforeunload','unknown']) {
  const context=new EventEmitter(), guard=watchNativeDialogs(context);let dismissed=0;
  context.emit('dialog',{type:()=>type,message:()=>{throw Error('PRIVATE');},defaultValue:()=>{throw Error('PRIVATE');},accept:()=>assert.fail('never accept'),dismiss:async()=>{dismissed++;}});
  assert.throws(()=>guard.assertCanAct(),/browser_dialog/);await tick();assert.equal(dismissed,1);
  assert.deepEqual(guard.snapshot(),[{type,disposition:'dismissed'}]);
  const view=guard.snapshot();view[0].type='forged';assert.equal(guard.snapshot()[0].type,type);
  guard.close();assert.equal(context.listenerCount('dialog'),0);
 }
});
test('alerts remain observable without inventing a confirmation choice',async()=>{
 const context=new EventEmitter(),guard=watchNativeDialogs(context);
 context.emit('dialog',{type:()=> 'alert',dismiss:async()=>{}});await tick();
 guard.assertCanAct();assert.deepEqual(guard.snapshot(),[{type:'alert',disposition:'dismissed'}]);guard.close();
});
test('an uncertain dismissal stays blocked, records are bounded, and a new run starts clean',async()=>{
 const context=new EventEmitter(),guard=watchNativeDialogs(context);
 for(let i=0;i<12;i++)context.emit('dialog',{type:()=> 'confirm',dismiss:async()=>{throw Error('PRIVATE upstream');}});
 await tick();assert.equal(guard.snapshot().length,8);assert(guard.snapshot().every(x=>x.disposition==='unknown'));
 assert.throws(()=>guard.assertCanAct(),/browser_dialog/);assert(!JSON.stringify(guard.snapshot()).includes('PRIVATE'));guard.close();
 const fresh=watchNativeDialogs(context);fresh.assertCanAct();assert.deepEqual(fresh.snapshot(),[]);fresh.close();
});

test('later alerts cannot erase a declined decision when bounded receipts rotate', async () => {
 const context=new EventEmitter(),guard=watchNativeDialogs(context);
 context.emit('dialog',{type:()=> 'confirm',dismiss:async()=>{}});await tick();
 for(let i=0;i<12;i++)context.emit('dialog',{type:()=> 'alert',dismiss:async()=>{}});
 await guard.waitForDecision();
 assert.equal(guard.snapshot().length,8);
 assert(guard.snapshot().every(record=>record.type==='alert'));
 assert.throws(()=>guard.assertCanAct(),/browser_dialog/);
 guard.close();
});
test('a pending decision remains blocked after its receipt rotates and clears only on acceptance', async () => {
 const context=new EventEmitter();let decide;
 const guard=watchNativeDialogs(context,{onDecision:()=>new Promise(resolve=>{decide=resolve;})});
 context.emit('dialog',{type:()=> 'confirm',message:()=> 'question',page:()=>({url:()=> 'https://example.test'}),accept:async()=>{},dismiss:async()=>{}});await tick();
 for(let i=0;i<12;i++)context.emit('dialog',{type:()=> 'alert',dismiss:async()=>{}});
 await tick();
 try {assert.throws(()=>guard.assertCanAct(),/browser_dialog/);}
 finally {decide({accept:true});await guard.waitForDecision();guard.close();}
 guard.assertCanAct();
});
