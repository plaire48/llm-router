import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationView} from '../conversation-view.js';
const input=(id='i',extra={})=>({id,text:'추가 조건',mode:'steer',conversationId:'c',provider:'aipro',runId:'run',...extra});
const base=()=>({sessionId:'c',provider:'aipro',messages:[{id:'u',role:'user',content:'원래 요청'},{id:'run',role:'assistant',state:'pending'}],inbox:[input()]});
test('admitted steering appears once before its run without entering model history',()=>{
  const chat=base(),before=structuredClone(chat),rows=conversationView(chat);
  assert.deepEqual(rows.map(row=>row.key),['u','input:i','run']);
  assert(rows[1].pendingInput);assert(rows[2].separateProgress);
  assert.equal(rows[2].index,1);assert.deepEqual(chat,before);
  chat.messages.splice(1,0,{id:'consumed',inputId:'i',role:'user',content:'추가 조건'});
  chat.messages.at(-1).inputGoal='원래 요청\n추가 조건';
  const promoted=conversationView(chat);
  assert.deepEqual(promoted.map(row=>row.key),rows.map(row=>row.key));
  assert.equal(promoted.filter(row=>row.message.content==='추가 조건').length,1);
  assert(!promoted[1].pendingInput);assert(promoted[2].separateProgress);
});
test('queued work stays in the composer and other conversations/providers never leak into the transcript',()=>{
  const chat=base();chat.inbox=[input('queue',{mode:'queue'}),input('other',{conversationId:'other'}),input('provider',{provider:'chatgpt'})];
  assert.deepEqual(conversationView(chat).map(row=>row.key),['u','run']);
  assert(!conversationView(chat)[1].separateProgress);
});
test('held steering remains visible after reload even without its original run; edited/deleted input disappears',()=>{
  const chat=base();chat.messages=[];
  assert.equal(conversationView(structuredClone(chat))[0].pendingInput.id,'i');
  chat.inbox=[];assert.deepEqual(conversationView(chat),[]);
});
