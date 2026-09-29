import test from 'node:test';
import assert from 'node:assert/strict';
import {Agent} from '@earendil-works/pi-agent-core';
import {runAgent} from '../agent-runtime.js';
const tool=name=>({type:'function',function:{name,description:name,parameters:{type:'object',properties:{}}}});
const call=name=>({content:'',calls:[{id:'wait',type:'function',function:{name,arguments:'{}'}}],usage:{total_tokens:17}});

test('native Pi stops after question and approval results without fabricating another assistant turn',async t=>{
 const original=Agent.prototype.subscribe;let assistantTurns=0;
 Agent.prototype.subscribe=function(listener){return original.call(this,event=>{if(event.type==='message_end'&&event.message.role==='assistant')assistantTurns++;listener(event);});};
 t.after(()=>{Agent.prototype.subscribe=original;});
 for(const name of ['ask_user','request_approval']){
  assistantTurns=0;let requests=0,actions=0;
  const result=await runAgent({messages:[{role:'user',content:'승인 확인'}],tools:[tool(name)],signal:new AbortController().signal,
   complete:async()=>{assert.equal(++requests,1);return call(name);},execute:async()=>{actions++;return{requiresUserInput:true};}});
  assert.equal(result.awaitingUser,true);assert.equal(result.usage.total_tokens,17);assert.equal(actions,1);assert.equal(assistantTurns,1);
 }
});

test('Pi migration preserves provider errors and user cancellation as hard exits',async()=>{
 for(const cancel of [false,true]){
  const controller=new AbortController();let calls=0,actions=0;
  await assert.rejects(runAgent({messages:[{role:'user',content:'읽기'}],tools:[tool('read_page')],signal:controller.signal,
   complete:async()=>{calls++;if(cancel)controller.abort();throw new Error(cancel?'cancelled':'provider_unavailable');},execute:async()=>{actions++;return{ok:true};}}),cancel?/cancelled/:/provider_unavailable/);
  assert.equal(calls,1);assert.equal(actions,0);
 }
});

test('legacy and current stop hooks share the user boundary without changing error/abort state',async()=>{
 const {userWaitHooks}=await import('../agent-turn-boundary.js');let writes=0;
 const hooks=userWaitHooks(()=>{writes++;return true;});
 for(const stopReason of ['error','aborted'])assert.equal(hooks.finishTurn({message:{stopReason}}),undefined);
 assert.equal(writes,0);assert.deepEqual(hooks.finishTurn({message:{stopReason:'toolUse'}}),{action:'end'});assert.equal(writes,1);
 assert.equal(hooks.shouldStopAfterTurn(),true);assert.equal(writes,2);
 assert.equal(userWaitHooks(()=>false).finishTurn({message:{stopReason:'stop'}}),undefined);
});
