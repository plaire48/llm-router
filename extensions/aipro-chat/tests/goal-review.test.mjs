import {contextTokens} from '../context-manager.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {zstdDecompressSync} from 'node:zlib';
import {reviewEvidence, goalReviewMessages, parseGoalReview, GOAL_REVIEW_PROMPT} from '../goal-review.js';
import {runAgent} from '../agent-runtime.js';
import {resumedVerification} from '../context-state.js';
import {completeChat} from '../src/api.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {chatgptToken, responsesSSE} from './fixtures/chatgpt.mjs';
import {CLARIFICATION_PROMPT} from '../user-question.js';
import {planMessages} from '../task-plan.js';

const skill = BUILTIN_SKILLS.find(s => s.id === 'browser-agent');
// This unit isolates review transport; task-plan tests cover the planning call.
const tools = browserTools({}, skill).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const done = {content: '제목과 본문을 저장했습니다.', calls: null};
const options = () => ({messages: [{role: 'user', content: '제목과 본문을 입력하고 초안을 저장해줘. 발송하지 마.'}], tools, signal: new AbortController().signal, harness: true});
const accepted = id => ({status: 'complete', checks: [{requirement: '요청한 결과', status: 'met', evidence_ids: [id]}], next_step: ''});
const response = value => ({content: JSON.stringify(value), finishReason: 'stop'});

test('review requires real current evidence IDs and rejects unsupported completion and malformed responses', () => {
  const evidence = [reviewEvidence(1, 'verify_page', {}, {ok: true, verified: true}), reviewEvidence(2, 'read_page', {}, {error: 'page_changed'})];
  assert.equal(parseGoalReview(response(accepted(1)), evidence).status, 'complete');
  assert.throws(() => parseGoalReview(response({...accepted(1),status:'revise',next_step:'Proceed to the next plan stage.'}), evidence), error => error.reviewReason === 'status_inconsistent');
  for (const value of [accepted(99), accepted(2), {...accepted(1), checks: []}, {...accepted(1), checks: [{requirement: '본문', status: 'unknown', evidence_ids: []}]}]) assert.throws(() => parseGoalReview(response(value), evidence), /goal_review_failed/);
  assert.throws(() => parseGoalReview({content: '완료했습니다.'}, evidence), /goal_review_failed/);
  assert.throws(() => parseGoalReview({...response(accepted(1)), finishReason: 'length'}, evidence), /goal_review_failed/);
  assert.throws(() => parseGoalReview({...response(accepted(1)), calls: [{}]}, evidence), /goal_review_failed/);
  evidence[0].usable = false;
  assert.throws(() => parseGoalReview(response(accepted(1)), evidence), /goal_review_failed/);
  assert.throws(() => parseGoalReview(response(accepted(1)), evidence), error => error.message === 'goal_review_failed' && error.reviewReason === 'evidence_invalid');
  assert.throws(() => parseGoalReview({content: '완료했습니다.'}, evidence), error => error.message === 'goal_review_failed' && error.reviewReason === 'json_invalid');
  const downgraded = parseGoalReview(response(accepted(1)), evidence, {downgradeInvalidEvidence: true});
  assert.equal(downgraded.status, 'revise');
  assert.equal(downgraded.checks[0].status, 'unknown');
  assert.deepEqual(downgraded.checks[0].evidence_ids, []);
  assert.throws(() => parseGoalReview({content: 'Not JSON'}, evidence, {downgradeInvalidEvidence: true}), /goal_review_failed/);
});

test('script claims and image bytes are excluded, truncation cannot prove completion, context is bounded', () => {
  const a = reviewEvidence(1, 'run_playwright', {code: 'PRIVATE_CODE'}, {ok: true, value: {saved: 'UNTRUSTED_CLAIM'}, observation: {text: 'actual page'}, image: {data: 'PRIVATE_IMAGE'}});
  assert(!JSON.stringify(a).includes('PRIVATE')); assert(!JSON.stringify(a).includes('UNTRUSTED_CLAIM'));
  const b = reviewEvidence(2, 'read_page', {}, {text: 'x'.repeat(20000)});
  assert(b.truncated); assert(!b.usable);
  const input = goalReviewMessages({goal: '본문 확인', history: [{role: 'assistant', content: 'x'.repeat(30000)}, {role: 'user', content: '본문 확인'}], evidence: [b, a], answer: '확인했습니다', inputBudget: 8000});
  assert(input.messages[0].content.startsWith(GOAL_REVIEW_PROMPT));
  assert.match(input.messages[0].content, /FINAL TASK/);
  assert.equal(input.evidence.length, 1); assert(JSON.parse(input.messages[1].content).omitted);
});

test('large verification observations retain current proof without accepting script claims or failed writes', () => {
  const observation={frames:[{text:'실제 결과 '.repeat(6000),url:'https://example.test/result'}]};
  for(const tool of ['verify_page','fill_form','run_playwright']) {
    const item=reviewEvidence(1,tool,{checks:[{kind:'text_present',expected:'실제 결과'}]},{ok:true,verified:true,observation,value:'UNTRUSTED_SCRIPT_RESULT'});
    assert.equal(item.truncated,false);assert.equal(item.usable,true);
    const input=goalReviewMessages({goal:'결과 확인',history:[],evidence:[item],answer:'결과',inputBudget:100000});
    assert.deepEqual(JSON.parse(input.messages[1].content).citeable_evidence_ids,[1]);
    assert.equal(input.evidence[0].result.observation.frames[0].text,observation.frames[0].text);
    if(tool==='run_playwright')assert(!JSON.stringify(item).includes('UNTRUSTED_SCRIPT_RESULT'));
    assert.equal(reviewEvidence(2,tool,{}, {ok:false,error:'action_outcome_unknown',observation}).usable,false);
  }
});
test('review exposes only retained usable citation IDs and read-only plans do not demand abstract verification', () => {
  const usable = reviewEvidence(1, 'read_page', {}, {ok: true, text: '관찰한 기사'});
  const failed = reviewEvidence(2, 'verify_page', {}, {ok: false, error: 'verification_failed'});
  const superseded = {...reviewEvidence(3, 'browser_snapshot', {}, {ok: true, frames: []}), usable: false, superseded: true};
  const review = goalReviewMessages({goal: '기사 조사', history: [{role: 'user', content: '기사 조사'}], evidence: [usable, failed, superseded], answer: '조사했습니다.', inputBudget: 10000});
  const payload = JSON.parse(review.messages[1].content);
  assert.deepEqual(payload.citeable_evidence_ids, [1]);
  assert.match(GOAL_REVIEW_PROMPT, /citeable_evidence_ids/);
  assert.match(planMessages('기사 조사')[0].content, /read-only research/);
});
test('final review includes reference images from every user turn or fails when the full input cannot fit',()=>{
  const first={type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}};
  const second={type:'image_url',image_url:{url:'data:image/png;base64,BBBB'}};
  const request={goal:'첫 이미지 배치와 두 번째 이미지 색상을 모두 확인',history:[
    {role:'user',content:[{type:'text',text:'첫 이미지 배치'},first]},
    {role:'assistant',content:'확인했습니다'},
    {role:'user',content:[{type:'text',text:'두 번째 이미지 색상'},second]}],evidence:[],answer:'완료',inputBudget:200000};
  const result=goalReviewMessages(request),parts=result.messages[1].content;
  assert.deepEqual(parts.filter(part=>part.type==='image_url').map(part=>part.image_url.url),[first.image_url.url,second.image_url.url]);
  assert(parts.some(part=>part.type==='text'&&part.text==='User turn 1, image 1'));
  assert(parts.some(part=>part.type==='text'&&part.text==='User turn 3, image 1'));
  assert.throws(()=>goalReviewMessages({...request,inputBudget:5000}),/goal_review_failed/);
});

test('requirements review repairs a missed body without replaying the already verified title', async () => {
  let round = 0, reviews = 0; const executed = [], held = [];
  const value = await runAgent({...options(), complete: async (messages, _, state) => {
    held.push(state.reviewPending);
    switch (++round) {
      case 1: return call('fill_form', {fields: [{field_id: 'title', value: '제목'}]});
      case 2: return call('verify_page', {checks: [{kind: 'field_value', ref: 'title', expected: '제목'}]});
      case 3: return done;
      case 4: assert.match(messages.at(-1).content, /Independent requirement review/); return call('fill_form', {fields: [{field_id: 'body', value: '본문'}]});
      case 5: return call('verify_page', {checks: [{kind: 'field_value', ref: 'body', expected: '본문'}]});
      default: return done;
    }
  }, execute: async (name, args) => {executed.push([name, args]); return {ok: true, applied: 1, verified: true};},
  reviewGoal: async ({evidence}) => {
    if (++reviews === 1) return {status: 'revise', checks: [{requirement: '본문 입력', status: 'unmet', evidence_ids: []}], next_step: '누락한 본문만 입력하고 결과를 확인하세요.'};
    assert(evidence[0].superseded); assert.equal(evidence[0].usable, false); return accepted(evidence.at(-1).id);
  }});
  assert.equal(value, done); assert.equal(reviews, 2);
  assert.equal(executed.filter(([n, a]) => n === 'fill_form' && a.fields[0].field_id === 'title').length, 1);
  assert(held.slice(1).every(Boolean));
});

test('ordinary conversation has no review and read-only browser answers do have one', async () => {
  let reviews = 0, round = 0;
  await runAgent({...options(), complete: async () => done, reviewGoal: async () => {reviews++;}});
  assert.equal(reviews, 0);
  await runAgent({...options(), complete: async () => ++round === 1 ? call('read_page') : done, execute: async () => ({text: 'Evidence'}), reviewGoal: async () => {reviews++; return accepted(1);}});
  assert.equal(reviews, 1);
});

test('document snapshots remain draft references after page writes while newer file content supersedes old reads', async () => {
  for (const reread of [false, true]) {
    let round = 0, reads = 0, reviewed = false;
    const project = {id: 'wiki', name: '안내', kind: 'folder', status: 'connected', capabilities: ['wiki']};
    await runAgent({...options(), tools: browserTools({}, skill, '', {project}), complete: async () => {
      const steps = [call('wiki_read', {id: 'guide.md'}), call('read_page'), call('fill_form', {fields: [{field_id: 'body', value: '안내문'}]}),
        ...(reread ? [call('wiki_read', {id: 'guide.md'})] : []), call('verify_page', {checks: [{kind: 'field_value', ref: 'body', expected: '안내문'}]})];
      return steps[round++] || done;
    }, execute: async name => {
      if (name === 'wiki_read') return {ok: true, dataKind: 'project_reference', projectId: 'wiki', content: '안내문',
        provenance: {path: 'guide.md', hash: (++reads === 1 ? 'a' : 'b').repeat(64), start: 1, end: 1}};
      return name === 'verify_page' ? {ok: true, verified: true} : {ok: true, text: '안내문'};
    }, reviewGoal: async ({evidence}) => {
      reviewed = true;
      const references = evidence.filter(item => item.tool === 'wiki_read');
      assert.equal(references[0].usable, !reread);
      assert.equal(references.at(-1).usable, true);
      assert.equal(evidence.find(item => item.tool === 'read_page').usable, false);
      const verified = evidence.findLast(item => item.tool === 'verify_page'); assert.equal(verified.usable, true);
      return {status: 'complete', checks: [{requirement: '문서에 따른 본문 입력', status: 'met', evidence_ids: [references.at(-1).id, verified.id]}], next_step: ''};
    }});
    assert(reviewed);
  }
});

test('no-progress reviews without analysts offer a technical retry and wait without inventing missing user input', async () => {
  let round = 0, reads = 0, reviews = 0, questions = 0;
  const question = {question: '같은 완료 조건을 검증하지 못했습니다. 현재 결과를 유지하고 다시 확인할까요?', choices: [{label: '다시 확인'}, {label: '중지'}]};
  const result = await runAgent({...options(), complete: async (messages, selected) => {
    if (messages.at(-1).content?.startsWith(CLARIFICATION_PROMPT)) {
      assert.deepEqual(selected.map(t => t.function.name), ['ask_user']);
      return call('ask_user', question);
    }
    return ++round === 1 ? call('read_page') : done;
  }, execute: async (name, args) => {
    if (name === 'ask_user') {questions++; assert.deepEqual(args, question); return {requiresUserInput: true};}
    assert.equal(name, 'read_page'); reads++; return {text: 'Evidence'};
  }, reviewGoal: async () => {reviews++; return {status: 'revise', next_step: '본문을 다시 확인하세요.'};}});
  assert.equal(result.awaitingUser, true); assert.equal(result.content, '');
  assert.equal(reviews, 2); assert.equal(reads, 1); assert.equal(questions, 1);
});

test('requirements review keeps correcting beyond two reviews when fresh evidence changes', async () => {
  let round = 0, reviews = 0, reads = 0;
  await runAgent({...options(), complete: async () => ++round % 2 ? call('read_page') : done,
    execute: async () => ({text: `Observed requirement ${++reads}`}),
    reviewGoal: async () => ++reviews < 4 ? {status: 'revise', next_step: '다음 누락 항목을 읽으세요.'} : {status: 'complete'}});
  assert.equal(reviews, 4); assert.equal(reads, 4);
});

test('a blocked review becomes a durable question without another model call or action', async () => {
  for (const saved of [true, false]) {
    let round = 0, reviews = 0; const executed = [], steps = [];
    const run = runAgent({...options(), complete: async () => ++round === 1 ? call('read_page') : done,
      onStep: step => steps.push(step), execute: async (name, args) => {
        executed.push(name);
        if (name === 'read_page') return {text: 'Recipient is missing'};
        assert.equal(name, 'ask_user'); assert.deepEqual(args, {question: '누구에게 보낼 내용인가요?'});
        return saved ? {requiresUserInput: true, questionId: 'recipient'} : {error: 'interrupted'};
      }, reviewGoal: async () => {reviews++; return {status: 'blocked', next_step: '누구에게 보낼 내용인가요?'};}});
    if (saved) {const result = await run; assert.equal(result.awaitingUser, true); assert.equal(result.content, '');}
    else await assert.rejects(run, e => e.message === 'question_failed');
    assert.equal(round, 2); assert.equal(reviews, 1); assert.deepEqual(executed, ['read_page', 'ask_user']);
    assert(steps.some(step => step.tool === 'review_task' && step.status === 'waiting'));
  }
});

test('blocked review questions must be concise and never accept blank or oversized next steps', () => {
  const blocked = {status: 'blocked', checks: [{requirement: '수신자 확인', status: 'unknown', evidence_ids: []}], next_step: '누구에게 보낼까요?'};
  assert.equal(parseGoalReview(response(blocked), []).status, 'blocked');
  for (const next_step of ['', ' ', 'x'.repeat(181)]) assert.throws(() => parseGoalReview(response({...blocked, next_step}), []), /goal_review_failed/);
  const question = {question: '담당 팀은 어디인가요?', choices: [{label: '개발팀'}, {label: '디자인팀'}]};
  assert.deepEqual(parseGoalReview(response({...blocked, question}), []).question, question);
  assert.equal(parseGoalReview(response({...blocked, question: {question: '필요한 내용을 알려주세요.', input_mode: 'long_text'}}), []).question.input_mode, 'long_text');
  for (const invalid of [{...question, choices: [{label: '임의 항목'}]}, {...question, image_refs: ['made-up']}, {...question, question: ''}]) assert.throws(() => parseGoalReview(response({...blocked, question: invalid}), []), /goal_review_failed/);
  assert.throws(() => parseGoalReview(response({...blocked, status: 'revise', question}), []), /goal_review_failed/);
});

test('resumed actions require fresh verification before review, with no repeated mutation', async () => {
  assert.deepEqual(resumedVerification({verification: {status: 'passed'}}), {status: 'pending'});
  assert.deepEqual(resumedVerification({steps: [{tool: 'click_element', status: 'unknown'}]}), {status: 'pending'});
  assert.equal(resumedVerification({verification: {status: 'not_required'}, steps: [{tool: 'run_playwright'}]}), null);
  let round = 0, verified = false;
  await runAgent({...options(), resumeVerification: true, resumedObservation: {text: 'Saved draft'},
    complete: async () => ++round === 2 ? call('verify_page', {checks: [{kind: 'text_present', expected: '저장됨'}]}) : done,
    execute: async name => {assert.equal(name, 'verify_page'); verified = true; return {ok: true, verified: true};},
    reviewGoal: async () => {assert(verified); return accepted(2);}});
  assert.equal(round, 3);
});

test('AI Pro and ChatGPT reviews use the same provider without tools, record usage and keep final context usage separate', async t => {
  const beforeFetch = globalThis.fetch, beforeChrome = globalThis.chrome;
  t.after(() => {globalThis.fetch = beforeFetch; globalThis.chrome = beforeChrome;});
  for (const provider of ['aipro', 'chatgpt']) {
    let count = 0; const saved = [], usage = [], emitted = [], contextUsage = [];
    const credential = {provider, mode: 'browser', token: provider === 'chatgpt' ? chatgptToken() : 'synthetic', receivedAt: 4};
    globalThis.chrome = {runtime: {sendMessage: async () => ({ok: true})}, storage: {session: {get: async () => ({credential})}}};
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : zstdDecompressSync(init.body).toString()); count++;
      assert.match(provider === 'chatgpt' ? body.instructions : body.messages[0].content, /<nubi_computer_time>/);
      const isReview = provider === 'chatgpt' ? body.instructions.startsWith(GOAL_REVIEW_PROMPT) : body.messages[0].content.startsWith(GOAL_REVIEW_PROMPT);
      if (count === 3) {assert(isReview); assert(!body.tools?.length); assert.notEqual(body.tool_choice, 'required');}
      const content = isReview ? JSON.stringify(accepted(1)) : '페이지 제목을 확인했습니다.';
      const measured = {input_tokens: 10 * count, output_tokens: count, total_tokens: 11 * count};
      if (provider === 'chatgpt') return new Response(responsesSSE({...(count === 1 ? {tool: {name: 'read_page', arguments: {}}} : {text: content}), usage: measured}), {headers: {'content-type': 'text/event-stream'}});
      assert.equal(init.headers.Authorization, 'Bearer synthetic');
      return new Response(`data: ${JSON.stringify({choices: [{delta: count === 1 ? {tool_calls: [{index: 0, id: 'read', type: 'function', function: {name: 'read_page', arguments: '{}'}}]} : {content}, finish_reason: count === 1 ? 'tool_calls' : 'stop'}]})}\n\ndata: ${JSON.stringify({choices: [], usage: {prompt_tokens: measured.input_tokens, completion_tokens: measured.output_tokens, total_tokens: measured.total_tokens}})}\n\ndata: [DONE]\n\n`, {headers: {'content-type': 'text/event-stream'}});
    };
    const answer = await completeChat({provider, credentialReceivedAt: 4, modelId: provider === 'chatgpt' ? 'gpt-5.6-sol' : 'glm', messages: [{role: 'user', content: '페이지 제목 확인'}], tools, skill}, new AbortController().signal,
      text => emitted.push(text), value => contextUsage.push(value), () => {}, () => {}, async () => ({text: '현재 제목'}), () => {}, value => usage.push(value), value => saved.push(value));
    assert.equal(count, 3); assert.equal(answer, '페이지 제목을 확인했습니다.'); assert(!emitted.some(text => text.includes('페이지 제목') || text.includes('evidence_ids')));
    assert.equal(saved.at(-1).status, 'complete'); assert(!JSON.stringify(saved).includes('현재 제목'));
    assert.equal(usage.filter(e => e.phase === 'start').length, 3); assert.equal(usage.filter(e => e.phase === 'report').length, 3);
    assert.equal(contextUsage.at(-1).total_tokens, 22);
  }
});

test('script success without executor observation cannot count as outcome evidence', () => {
  const proof = reviewEvidence(1, 'run_playwright', {}, {ok: true, value: {saved: true}, actionIssued: true});
  assert.equal(proof.usable, false);
  assert.throws(() => parseGoalReview(response(accepted(1)), [proof]), /goal_review_failed/);
  const input = goalReviewMessages({goal: '결과 확인', history: [], evidence: [proof], answer: '완료', image: {data: 'unused', evidenceId: 99}, inputBudget: 8000});
  assert.equal(typeof input.messages[1].content, 'string');
});

test('output-limited requirement review retries the same evidence with a larger bounded budget and no browser replay', async t => {
  const oldFetch=globalThis.fetch,oldChrome=globalThis.chrome;
  t.after(()=>{globalThis.fetch=oldFetch;globalThis.chrome=oldChrome;});
  globalThis.chrome={storage:{session:{get:async()=>({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:1}})}}};
  let count=0,reads=0;const saved=[],usage=[];
  globalThis.fetch=async(_,options)=>{
    const body=JSON.parse(options.body);count++;
    if(count===3){assert.equal(body.max_tokens,2048);return Response.json({choices:[{message:{content:null},finish_reason:'length'}],usage:{prompt_tokens:10,completion_tokens:2048,total_tokens:2058}});}
    if(count===4){assert.equal(body.max_tokens,8192);assert(body.messages[0].content.includes('previous review was incomplete'));}
    return Response.json({choices:[{message:count===1?{content:'',tool_calls:[{id:'read-once',type:'function',function:{name:'read_page',arguments:'{}'}}]}:{content:count===4?JSON.stringify(accepted(1)):'확인했습니다.'},finish_reason:count===1?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
  };
  assert.equal(await completeChat({provider:'aipro',credentialReceivedAt:1,modelId:'glm',model:{contextLength:128000},messages:[{role:'user',content:'페이지 확인해줘'}],tools,skill},new AbortController().signal,undefined,undefined,undefined,undefined,async()=>{reads++;return {text:'Actual page'};},undefined,event=>usage.push(event),value=>saved.push(value)),'확인했습니다.');
  assert.equal(count,4);assert.equal(reads,1);assert.equal(saved.at(-1).status,'complete');assert.equal(usage.filter(event=>event.phase==='report').length,4);
});

test('malformed or cancelled review never releases the provisional answer or records completion', async t => {
  const beforeFetch = globalThis.fetch, beforeChrome = globalThis.chrome;
  t.after(() => {globalThis.fetch = beforeFetch; globalThis.chrome = beforeChrome;});
  for (const cancelled of [false, true]) {
    let count = 0; const saved = [], emitted = [], phases = [], steps = [];
    const controller = new AbortController();
    globalThis.chrome = {runtime: {sendMessage: async () => ({ok: true})}, storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 4}})}}};
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body); count++;
      if (count === 3) {
        assert(body.messages[0].content.startsWith(GOAL_REVIEW_PROMPT));
        if (cancelled) {controller.abort(); throw new DOMException('Aborted', 'AbortError');}
      }
      const delta = count === 1 ? {tool_calls: [{index: 0, id: 'read', type: 'function', function: {name: 'read_page', arguments: '{}'}}]} : {content: count === 3 ? 'Not valid review JSON' : 'PROVISIONAL_SUCCESS'};
      return new Response(`data: ${JSON.stringify({choices: [{delta, finish_reason: count === 1 ? 'tool_calls' : 'stop'}]})}\n\ndata: [DONE]\n\n`, {headers: {'content-type': 'text/event-stream'}});
    };
    let questions=0;
    const pending=completeChat({provider: 'aipro', credentialReceivedAt: 4, modelId: 'glm', messages: [{role: 'user', content: '페이지를 확인해줘'}], tools, skill}, controller.signal,
      text => emitted.push(text), () => {}, phase => phases.push(phase), () => {}, async name => name==='ask_user' ? (questions++,{requiresUserInput:true}) : ({text: 'Actual page'}), step => steps.push(step), () => {}, value => saved.push(value));
    if(cancelled)await assert.rejects(pending,error=>error.message==='cancelled'&&error.partial==='');
    else assert.equal(await pending,'');
    assert.equal(questions,cancelled?0:1);assert.equal(count, cancelled ? 3 : 7); assert(phases.includes('validating'));
    assert(!emitted.some(text => text.includes('PROVISIONAL_SUCCESS') || text.includes('Not valid')));
    assert.equal(saved.at(-1).status, 'failed'); assert(!saved.some(value => value.status === 'complete'));
    assert.equal(steps.at(-1).status, cancelled ? 'cancelled' : 'waiting');
  }
});

test('invalid review JSON or citations are repaired once against identical evidence without repeating tools', async t => {
  const previous = {fetch: globalThis.fetch, chrome: globalThis.chrome}; t.after(() => Object.assign(globalThis, previous));
  for (const malformed of ['Not JSON', JSON.stringify(accepted(999))]) {
    let count = 0, reads = 0, proof;
    globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
    globalThis.fetch = async (_, options) => {
      const body = JSON.parse(options.body); count++;
      if (count === 3) proof = body.messages[1];
      if (count === 4) {assert.deepEqual(body.messages[1], proof); assert.match(body.messages[0].content, malformed === 'Not JSON' ? /failed JSON\/evidence validation/ : /Only these IDs are eligible/); assert.deepEqual(body.tools?.map(t=>t.function.name),['report_goal_review']);}
      return Response.json({choices: [{message: count === 1 ? {tool_calls: call('read_page').calls} : {content: count === 3 ? malformed : count === 4 ? JSON.stringify(accepted(1)) : '제목을 확인했습니다.'}, finish_reason: count === 1 ? 'tool_calls' : 'stop'}]});
    };
    const result = await completeChat({provider: 'aipro', credentialReceivedAt: 1, modelId: 'QWEN3.8-27B-FP8-256K', model: {contextLength: 262144}, messages: [{role: 'user', content: '페이지 제목 확인'}], tools, skill},
      new AbortController().signal, undefined, undefined, undefined, undefined, async () => {reads++; return {text: '실제 페이지 제목'};});
    assert.equal(result, '제목을 확인했습니다.'); assert.equal(count, 4); assert.equal(reads, 1);
  }
});

test('document planning metadata cannot certify a completed content review', () => {
  const item=reviewEvidence(1,'read_document',{mode:'plan'},{ok:true,metadata_only:true,coverage:'unread',ranges:[{start:0,end:200}]});
  assert.equal(item.usable,false);assert.throws(()=>parseGoalReview(response(accepted(1)),[item]),/goal_review_failed/);
});


test('OpenWiki exact excerpts can support information answers but empty and oversized reports cannot',()=>{
  const result={dataKind:'openwiki_reference',advisory:true,wikiId:'internal:site',evidence:[{excerpt:'policy'}]};
  assert(reviewEvidence(1,'ask_openwiki',{},result).usable);
  assert(!reviewEvidence(2,'ask_openwiki',{}, {...result,evidence:[]}).usable);
  assert(!reviewEvidence(3,'ask_openwiki',{}, {...result,evidence:[{excerpt:'x'.repeat(320001)}]}).usable);
  assert.match(GOAL_REVIEW_PROMPT,/never a browser action or approval/);
});

test('long Wiki citations survive review within the model budget, never by truncating the user request',()=>{
  const evidence=['internal:site','external:folder'].map((wikiId,i)=>reviewEvidence(i+1,'ask_openwiki',{},
    {dataKind:'openwiki_reference',wikiId,advisory:true,evidence:Array.from({length:5},(_,n)=>({id:`e-${n}`,excerpt:'long policy text. '.repeat(300)}))}));
  assert(evidence.every(item=>item.usable && !item.truncated));
  const review=goalReviewMessages({goal:'Compare both Wikis',history:[],evidence,answer:'A qualified comparison',inputBudget:100000});
  assert.deepEqual(review.evidence,evidence);
  assert(JSON.stringify(review.messages).includes('external:folder'));
  const one=goalReviewMessages({goal:'Compare both Wikis',history:[],evidence:evidence.slice(0,1),answer:'A qualified comparison',inputBudget:100000});
  const budget=Math.floor((contextTokens(one.messages)+contextTokens(review.messages))/2);
  assert.throws(()=>goalReviewMessages({goal:'Compare both Wikis',history:[],evidence,answer:'A qualified comparison',inputBudget:budget}),/goal_review_failed/);
  assert.throws(()=>goalReviewMessages({goal:'Compare both Wikis',history:[],evidence,answer:'comparison',inputBudget:500}),/goal_review_failed/);
});

test('attached research preserves large exact citations and rejects blocked reports without observed evidence', () => {
  const result = {dataKind: 'document_reference', advisory: true, status: 'complete', document_ids: ['one'],
    evidence: Array.from({length: 3}, (_, index) => ({id: `e-${index}`, documentId: 'one', path: 'requirements.pdf', hash: 'a'.repeat(64), start: index * 6000, end: (index + 1) * 6000, unit: 'utf16', excerpt: String(index).repeat(6000)}))};
  const item = reviewEvidence(1, 'ask_documents', {}, result);
  assert(item.usable); assert.equal(item.truncated, false); assert.deepEqual(item.result.evidence, result.evidence);
  const review = goalReviewMessages({goal: '문서 원문에 근거해 설명', history: [], evidence: [item], answer: '근거를 확인했습니다.', inputBudget: 100000});
  assert.deepEqual(review.evidence[0].result.evidence, result.evidence);
  assert.equal(parseGoalReview(response(accepted(1)), review.evidence).status, 'complete');
  for (const invalid of [{...result, status: 'blocked', evidence: []}, {...result, evidence: undefined}, {...result, dataKind: 'document_snapshot'}]) {
    const blocked = reviewEvidence(2, 'ask_documents', {}, invalid);
    assert.equal(blocked.usable, false);
    assert.throws(() => parseGoalReview(response(accepted(2)), [blocked]), /goal_review_failed/);
  }
  const oversized = reviewEvidence(3, 'ask_documents', {}, {...result, evidence: [{excerpt: 'x'.repeat(320001)}]});
  assert(oversized.truncated); assert.equal(oversized.usable, false);
  assert.match(GOAL_REVIEW_PROMPT, /ask_documents document_reference results contain model-generated advisory findings/);
});

test('mixed Wiki and attachment research cannot lose either source to make review fit', () => {
  const results = [
    reviewEvidence(1, 'ask_openwiki', {}, {dataKind: 'openwiki_reference', wikiId: 'internal:policy', evidence: [{excerpt: 'policy rule '.repeat(2000)}]}),
    reviewEvidence(2, 'ask_documents', {}, {dataKind: 'document_reference', document_ids: ['contract'], evidence: [{excerpt: 'contract exception '.repeat(2000)}]}),
  ];
  const request = {goal: 'Compare the policy with all contract exceptions', history: [{role: 'user', content: 'Preserve exceptions.'}], answer: 'A qualified comparison', inputBudget: 100000};
  const both = goalReviewMessages({...request, evidence: results});
  assert.equal(both.evidence.length, 2); assert(both.evidence.every(item => item.usable));
  const one = goalReviewMessages({...request, evidence: results.slice(0, 1)});
  const budget = contextTokens(one.messages) + 100;
  assert.throws(() => goalReviewMessages({...request, evidence: results, inputBudget: budget}), /goal_review_failed/);
  // A directly read page still keeps the original 14k limit.
  assert.equal(reviewEvidence(3, 'read_page', {}, {text: 'x'.repeat(18000)}).usable, false);
});

test('final revision produces a complete replacement without repeating successful reads', async () => {
  let round = 0, reviews = 0, reads = 0;
  const full = '서울 9월 27일 현재 20도, 최저 18도 최고 26도. 출처: https://weather.test/. 관측 시각은 화면에 없습니다.';
  const result = await runAgent({...options(), messages:[{role:'user',content:'서울 날씨의 날짜, 현재 기온, 최저와 최고 기온 및 출처를 알려줘.'}],
    complete: async messages => {
      if (++round === 1) return call('browser_snapshot');
      if (round === 2) return {content:full.replace('화면에 없습니다.', '확인하지 못했습니다.'),calls:null};
      assert.match(messages.at(-1).content, /complete, self-contained replacement/);
      assert.match(messages.at(-1).content, /Earlier provisional answers are withheld/);
      return {content:full,calls:null};
    }, execute: async () => {reads++;return {frames:[{text:'서울 9월 27일 현재 20도 최저 18도 최고 26도'}]};},
    reviewGoal: async ({answer,evidence}) => {
      if (++reviews === 1) return {status:'revise',next_step:'확인 불가 문구를 수정하세요.'};
      assert.equal(answer,full);return accepted(evidence[0].id);
    }});
  assert.equal(result.content,full);assert.equal(reads,1);assert.equal(reviews,2);
  const final = goalReviewMessages({goal:'날짜와 기온',history:[{role:'assistant',content:full}],evidence:[reviewEvidence(1,'browser_snapshot',{}, {frames:[{text:'서울 날씨'}]})],answer:'시각은 보이지 않습니다.',inputBudget:16000});
  assert.match(final.messages[0].content,/ONLY final answer delivered/);
  assert.match(final.messages[0].content,/Mark omitted requested results unmet/);
  assert.equal(JSON.parse(final.messages[1].content).proposed_answer,'시각은 보이지 않습니다.');
});

test('step gate scopes outcomes without demanding the withheld final answer', () => {
  const request = {goal:'문서 A/B/C를 나눠 읽고 마감일을 출처와 함께 정리', history:[{role:'user',content:'외부 전송하지 마세요'}],
    evidence:[reviewEvidence(1,'read_page',{}, {ok:true,frames:[{text:'문서 A / B / C'}]})], answer:'', inputBudget:16000};
  const steps = [{text:'문서 구조 확인',expected_outcome:'문서 A/B/C 범위 식별',status:'in_progress'}];
  const step=goalReviewMessages({...request,phase:'plan_step',stepOutcomes:steps});
  const payload=JSON.parse(step.messages[1].content);
  assert.deepEqual(payload.evaluation_contract.outcomes,[{text:steps[0].text,expected_outcome:steps[0].expected_outcome}]);
  assert.deepEqual(payload.stepOutcomes,payload.evaluation_contract.outcomes);
  assert.equal(steps[0].status,'in_progress', 'The host plan remains unchanged until reviewed');
  assert.equal(payload.evaluation_contract.final_answer_required,false);
  assert.equal(Object.hasOwn(payload,'proposed_answer'),false);
  assert.equal(Object.hasOwn(payload,'proposed_step_result'),false);
  assert.equal(payload.conversation[0].content,'외부 전송하지 마세요');
  assert.match(step.messages[0].content,/identifying sections A\/B\/C can complete/);
  assert.doesNotMatch(step.messages[0].content,/Evaluation scope: FINAL TASK/);
  assert.match(step.messages[0].content,/not independent proof/);
  const final=goalReviewMessages({...request,answer:'최종 답변'});
  assert.equal(JSON.parse(final.messages[1].content).proposed_answer,'최종 답변');
  assert.match(final.messages[0].content,/every material requirement/);
  for (const prompt of [step.messages[0].content,final.messages[0].content]) {
    assert.match(prompt,/observed publisher\/author\/channel/);
    assert.match(prompt,/same observed region, publisher, location and time/);
  }
  assert.throws(()=>goalReviewMessages({...request,phase:'plan_step',stepOutcomes:[]}),error=>error.reviewReason==='step_scope_missing');
});

test('a report step receives the withheld deliverable without promoting it to source evidence', () => {
  const answer = '관람시간 09:30~17:30. https://example.com/hours. 특별전 별도 시간은 미확인.';
  const input = {goal:'관람시간과 출처 및 미확인 범위를 보고하세요',history:[],inputBudget:16000,
    evidence:[reviewEvidence(1,'read_page',{}, {ok:true,frames:[{text:'관람시간 09:30~17:30',url:'https://example.com/hours'}]})],
    answer,phase:'plan_step',stepOutcomes:[{text:'출처와 확인 범위 정리',expected_outcome:'시간과 URL, 미확인 부분을 구분한 요약 작성'}]};
  const {messages} = goalReviewMessages(input);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.proposed_step_result,answer);
  assert.deepEqual(payload.citeable_evidence_ids,[1]);
  assert.equal(payload.evidence.length,1);
  assert.equal(Object.hasOwn(payload,'proposed_answer'),false);
  assert.match(messages[0].content,/never independent proof of a browser action/);
  assert.match(messages[0].content,/separate final task review/);
  const noEvidence = JSON.parse(goalReviewMessages({...input,evidence:[]}).messages[1].content);
  assert.deepEqual(noEvidence.citeable_evidence_ids,[]);
});

 test('source comparison reviewer does not impose a contradictory fresh-only citation requirement', () => {
  const input = goalReviewMessages({goal:'Compare pages',history:[],evidence:[],answer:'',inputBudget:12000});
  assert(!input.messages[0].content.includes('untruncated fresh evidence ID'));
  assert(input.messages[0].content.includes('Preserved source snapshots support'));
});
