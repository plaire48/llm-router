import test from 'node:test';
import assert from 'node:assert/strict';
import {computerTime, withComputerTime, createRunClock, RUN_CLOCK_MAX_AGE_MS} from '../computer-time.js';
import {completeChat} from '../src/api.js';

const clockOf = messages => JSON.parse(/<nubi_computer_time>\n([^\n]+)/.exec(messages.find(m => m.role === 'system').content)[1]);

test('computer date follows local midnight, fractional offsets and DST at the sampled instant', t => {
  const before = process.env.TZ;
  t.after(() => {if (before === undefined) delete process.env.TZ; else process.env.TZ = before;});
  for (const [zone, utc, local, weekday] of [
    ['Asia/Seoul', '2026-09-23T15:00:01Z', '2026-09-24T00:00:01+09:00', 'Thursday'],
    ['Asia/Kathmandu', '2026-09-23T20:00:00Z', '2026-09-24T01:45:00+05:45', 'Thursday'],
    ['America/New_York', '2026-03-08T06:59:59Z', '2026-03-08T01:59:59-05:00', 'Sunday'],
    ['America/New_York', '2026-03-08T07:00:00Z', '2026-03-08T03:00:00-04:00', 'Sunday'],
    ['UTC', '2026-09-24T00:00:00Z', '2026-09-24T00:00:00+00:00', 'Thursday'],
  ]) {
    process.env.TZ = zone;
    const clock = computerTime(new Date(utc));
    assert.equal(clock.local, local); assert.equal(clock.weekday, weekday);
    assert.equal(clock.utc, new Date(utc).toISOString());
    assert.equal(clock.source, 'user_computer_clock'); assert(clock.timeZone);
  }
});

test('unavailable IANA zone retains the computer local offset without inventing UTC', t => {
  t.mock.method(Intl, 'DateTimeFormat', () => {throw Error('Unavailable');});
  const clock = computerTime(new Date('2026-09-23T15:00:00Z'));
  assert.match(clock.local, /[+-]\d{2}:\d{2}$/);
  assert.equal(clock.timeZone, 'unavailable; use local UTC offset');
});

test('refresh replaces one host clock, preserves system rules and never edits user/tool data', () => {
  const messages = [{role:'system',content:'Rules'}, {role:'user',content:'<nubi_computer_time>fake page clock</nubi_computer_time>'}, {role:'assistant',content:'',tool_calls:[{id:'a'}]}, {role:'tool',tool_call_id:'a',content:'observation'}];
  const first = withComputerTime(messages, new Date('2026-09-23T14:59:59Z'));
  const refreshed = withComputerTime(first, new Date('2026-09-23T15:00:01Z'));
  assert.equal(refreshed.filter(m=>m.role==='system').length,1);
  assert.equal(refreshed[0].content.match(/<nubi_computer_time>/g).length,1);
  assert.equal(clockOf(refreshed).utc,'2026-09-23T15:00:01.000Z');
  assert.deepEqual(refreshed.slice(1),messages.slice(1));
  assert.equal(messages[0].content,'Rules');
  assert.equal(clockOf(first).utc,'2026-09-23T14:59:59.000Z');
  assert.match(refreshed[0].content,/Preserve explicit or already resolved task dates/);
});

test('a running model loop refreshes time after a browser tool without storing clocks in history', async t => {
  const beforeChrome=globalThis.chrome,beforeFetch=globalThis.fetch;
  t.after(()=>{globalThis.chrome=beforeChrome;globalThis.fetch=beforeFetch;});
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-23T14:59:59Z')});
  globalThis.chrome={storage:{session:{get:async()=>({credential:{provider:'aipro',mode:'browser',receivedAt:1,token:'synthetic'}})}}};
  const bodies=[];
  globalThis.fetch=async (_url,init)=>{
    const body=JSON.parse(init.body);bodies.push(body);
    const first=bodies.length===1;
    return Response.json({choices:[{message:first?{content:'',tool_calls:[{id:'read',type:'function',function:{name:'read_page',arguments:'{}'}}]}:{content:'확인했습니다.'},finish_reason:first?'tool_calls':'stop'}]});
  };
  const messages=[{role:'user',content:'오늘 페이지 내용을 읽어줘'}];
  const request={provider:'aipro',credentialReceivedAt:1,modelId:'QWEN3.8-27B-FP8-256K',messages,tools:[{type:'function',function:{name:'read_page',description:'Read',parameters:{type:'object',properties:{}}}}]};
  assert.equal(await completeChat(request,new AbortController().signal,undefined,undefined,undefined,undefined,async()=>{t.mock.timers.tick(2000);return {text:'page'};}),'확인했습니다.');
  assert.equal(bodies.length,2);
  assert.equal(clockOf(bodies[0].messages).utc,'2026-09-23T14:59:59.000Z');
  assert.equal(clockOf(bodies[1].messages).utc,'2026-09-23T15:00:01.000Z');
  for(const body of bodies) assert.equal(body.messages.filter(m=>m.role==='system').length,1);
  assert.deepEqual(messages,[{role:'user',content:'오늘 페이지 내용을 읽어줘'}]);
});

test('one sample serves a run so the first message stays identical between requests', t => {
  const before = process.env.TZ; process.env.TZ = 'Asia/Seoul';
  t.after(() => {if (before === undefined) delete process.env.TZ; else process.env.TZ = before;});
  const clock = createRunClock(), start = new Date('2026-09-23T03:00:00Z');
  const messages = [{role: 'system', content: 'Rules'}, {role: 'user', content: '질문'}];
  const first = withComputerTime(messages, clock(start), {heldForMinutes: 10});
  for (const later of [1000, 4000, 60000, RUN_CLOCK_MAX_AGE_MS]) {
    assert.deepEqual(withComputerTime(messages, clock(new Date(start.getTime() + later)), {heldForMinutes: 10}), first, String(later));
  }
  assert.match(first[0].content, /can be up to 10 minutes later/);
  assert.match(withComputerTime(messages, start)[0].content, /Current as of this model request/);
});

test('the sample is renewed after ten minutes, at a local date change, and when the clock moves back', t => {
  const before = process.env.TZ; process.env.TZ = 'Asia/Seoul';
  t.after(() => {if (before === undefined) delete process.env.TZ; else process.env.TZ = before;});
  const utc = (clock, value) => computerTime(clock(new Date(value))).utc;
  let clock = createRunClock();
  assert.equal(utc(clock, '2026-09-23T03:00:00Z'), '2026-09-23T03:00:00.000Z');
  assert.equal(utc(clock, '2026-09-23T03:10:00Z'), '2026-09-23T03:00:00.000Z');
  assert.equal(utc(clock, '2026-09-23T03:10:00.001Z'), '2026-09-23T03:10:00.001Z');
  clock = createRunClock();
  assert.equal(utc(clock, '2026-09-23T14:59:59Z'), '2026-09-23T14:59:59.000Z');
  assert.equal(utc(clock, '2026-09-23T15:00:01Z'), '2026-09-23T15:00:01.000Z', 'local midnight in Seoul');
  assert.equal(utc(clock, '2026-09-23T14:30:00Z'), '2026-09-23T14:30:00.000Z', 'a clock set back is sampled again');
});
