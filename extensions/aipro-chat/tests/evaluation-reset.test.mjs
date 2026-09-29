import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEvaluationTrial} from '../scripts/evaluation-reset.mjs';

test('evaluation waits for the previous approval run to release its lease before creating a new conversation', async () => {
  let time = 0, reads = 0, created = false;
  const state = async () => created ? {busy: false, chat: {sessionId: 'next', messages: []}} : {busy: ++reads < 4, chat: {sessionId: 'previous', messages: [{question: {kind: 'approval'}}]}};
  const result = await prepareEvaluationTrial({state, now: () => time, wait: async ms => {time += ms;}, rpc: async request => {
    assert.equal(request.type, 'NEW_CHAT'); assert(reads >= 4); created = true; return {data: await state()};
  }});
  assert.equal(result.chat.sessionId, 'next');
});

test('evaluation never proceeds on a rejected reset, unchanged session, or unreleased run', async () => {
  const idle = async () => ({busy: false, chat: {sessionId: 'old', messages: []}});
  await assert.rejects(prepareEvaluationTrial({state: idle, rpc: async () => ({error: 'busy'})}), /evaluation_new_chat_busy/);
  await assert.rejects(prepareEvaluationTrial({state: idle, rpc: async () => ({data: await idle()})}), /evaluation_new_chat_not_ready/);
  let time = 0;
  await assert.rejects(prepareEvaluationTrial({state: async () => ({busy: true}), now: () => time, wait: async ms => {time += ms;}, timeoutMs: 200, rpc: () => assert.fail('Cannot reset active task')}), /evaluation_previous_run_busy/);
});

test('new background conversation waits for the corresponding applied UI session',async()=>{
  let created=false,release;
  const applied=new Promise(resolve=>{release=resolve;}),events=[];
  const state=async()=>({busy:false,chat:{sessionId:created?'new':'old',messages:[]}});
  const reset=prepareEvaluationTrial({state,wait:async()=>{},rpc:async()=>{created=true;return {data:await state()};},
    waitForUI:async id=>{events.push(id);await applied;}}).then(result=>{events.push('returned');return result;});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['new']);
  release();assert.equal((await reset).chat.sessionId,'new');assert.deepEqual(events,['new','returned']);
});
