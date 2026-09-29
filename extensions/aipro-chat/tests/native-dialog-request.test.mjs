import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeDialogRequests} from '../native-dialog-request.js';
import {watchNativeDialogs} from '../browser-dialogs.js';
import {EventEmitter} from 'node:events';
const lease={id:'run',conversationId:'chat',provider:'aipro',credentialReceivedAt:1};
const credential={provider:'aipro',receivedAt:1};
const details={type:'confirm',message:'사이트에서 요청한 확인',site:'https://example.test'};
const tick=()=>new Promise(r=>setImmediate(r));
test('native confirmation is one use and bound to request, conversation and credential',async()=>{
 const requests=createNativeDialogRequests(),controller=new AbortController();const response=requests.ask(lease,details,controller.signal);
 const question=requests.view(lease,credential,'chat');assert(question);
 assert.equal(requests.view({...lease,id:'other'},credential,'chat'),null);
 const answer={questionId:question.id,requestId:'run',choice:{questionId:question.id,optionId:'accept'}};
 for(const altered of [{...lease,id:'other'},{...lease,cancelled:true},{...lease,conversationId:'other'}])assert.throws(()=>requests.answer(answer,altered,credential,'chat'));
 assert.throws(()=>requests.answer(answer,lease,{...credential,receivedAt:2},'chat'));
 assert.throws(()=>requests.answer({...answer,choice:{text:'yes'}},lease,credential,'chat'));
 requests.answer(answer,lease,credential,'chat');assert.throws(()=>requests.answer(answer,lease,credential,'chat'));
 assert.equal((await response).accept,true);assert.equal(requests.view(lease,credential,'chat'),null);
});
test('prompt text stays out of public state; expiry and abort decline without accepting',async()=>{
 const requests=createNativeDialogRequests({timeoutMs:10});let controller=new AbortController();
 let response=requests.ask(lease,{...details,type:'prompt'},controller.signal);let q=requests.view(lease,credential,'chat');
 requests.answer({questionId:q.id,requestId:'run',choice:{questionId:q.id,text:'private answer'}},lease,credential,'chat');
 assert.equal(requests.view(lease,credential,'chat'),null);assert.equal((await response).promptText,'private answer');
 response=requests.ask(lease,details,controller.signal);assert.equal((await response).accept,false);
 response=requests.ask(lease,details,controller.signal);controller.abort();assert.equal((await response).accept,false);
});
test('dialog acceptance resumes only its pending action; close declines and receipts omit secrets',async()=>{
 const context=new EventEmitter();let resolveDecision,accepted=[],dismissed=0;
 const guard=watchNativeDialogs(context,{onDecision:(_details,signal)=>new Promise(resolve=>{resolveDecision=resolve;signal.addEventListener('abort',()=>resolve({accept:false}),{once:true});})});
 const dialog={type:()=> 'prompt',message:()=> 'UI only',page:()=>({url:()=> 'https://example.test/path'}),accept:async value=>accepted.push(value),dismiss:async()=>{dismissed++;}};
 context.emit('dialog',dialog);await tick();assert.throws(()=>guard.assertCanAct());resolveDecision({accept:true,promptText:'answer'});await guard.waitForDecision();guard.assertCanAct();assert.deepEqual(accepted,['answer']);
 assert.deepEqual(guard.snapshot(),[{type:'prompt',disposition:'accepted'}]);
 context.emit('dialog',dialog);await tick();guard.close();await guard.waitForDecision();assert.equal(dismissed,1);assert.deepEqual(accepted,['answer']);
});

test('changing the active page while a decision is pending cannot accept the old dialog',async()=>{
 const context=new EventEmitter();let resolveDecision,accepted=0,dismissed=0,current=true;
 const guard=watchNativeDialogs(context,{canAccept:()=>current,onDecision:()=>new Promise(resolve=>{resolveDecision=resolve;})});
 context.emit('dialog',{type:()=> 'confirm',message:()=> 'UI only',page:()=>({url:()=> 'https://example.test'}),accept:async()=>{accepted++;},dismiss:async()=>{dismissed++;}});
 await tick();current=false;resolveDecision({accept:true});await guard.waitForDecision();assert.equal(accepted,0);assert.equal(dismissed,1);assert.throws(()=>guard.assertCanAct());guard.close();
});

test('mixed or malformed prompt choices never consume a live question', async () => {
 for(const choice of [
   {optionId:'cancel',text:'must not accept'}, {optionId:'accept',text:'x'.repeat(4001)},
   {optionId:'accept',text:42}, {optionId:'unknown',text:'must not accept'},
   {optionId:'accept',text:''}, {text:'x'.repeat(4001)},
 ]) {
   const requests=createNativeDialogRequests(),controller=new AbortController();
   const response=requests.ask(lease,{...details,type:'prompt'},controller.signal);
   const q=requests.view(lease,credential,'chat');
   try {
     assert.throws(()=>requests.answer({questionId:q.id,requestId:'run',choice},lease,credential,'chat'),/tool_arguments_invalid/);
     assert.equal(requests.view(lease,credential,'chat').id,q.id);
     assert.throws(()=>requests.answer({questionId:q.id,requestId:'run',choice:{questionId:'other',optionId:'accept'}},lease,credential,'chat'),/question_changed/);
     requests.answer({questionId:q.id,requestId:'run',choice:{optionId:'cancel'}},lease,credential,'chat');
     assert.equal((await response).accept,false);
   } finally {controller.abort();await response;}
 }
});
