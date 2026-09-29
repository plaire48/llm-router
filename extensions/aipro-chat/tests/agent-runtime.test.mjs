import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent, normalizeTrace} from '../agent-runtime.js';
import {BUILTIN_SKILLS, browserTools} from '../skills.js';

const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}, id = name) => ({content: '', calls: [{id, type: 'function', function: {name, arguments: typeof args === 'string' ? args : JSON.stringify(args)}}]});
const done = {content: '완료', calls: null};
const base = () => ({messages: [{role: 'user', content: '신청서 입력'}], tools, signal: new AbortController().signal});
const livePage = () => ({tabId: 11, topDocumentId: 'document-1', url: 'https://example.test/form', frames: [{frame: 0, documentId: 'document-1', url: 'https://example.test/form', elements: [{ref:'f1',role:'textbox',name:'이름',id:'name'},{ref:'r1',role:'button',name:'저장',id:'save'},{ref:'r2',role:'button',name:'다음',id:'next'}]}]});
test('context preparation sees the exact advertised tools and final round guidance', async () => {
  let prepared;
  await runAgent({...base(), harness: true,
    prepareContext: async (messages, advertised) => {prepared = {messages: structuredClone(messages), advertised}; return messages;},
    complete: async (messages, advertised) => {
      assert.deepEqual(advertised, prepared.advertised);
      assert.deepEqual(messages, prepared.messages);
      assert(messages.some(message => message.role === 'system' && message.content.includes('Work interactively')));
      assert(advertised.some(tool => tool.function.name === 'select_tools'));
      assert(!advertised.some(tool => tool.function.name === 'run_playwright'));
      return done;
    }, execute: async () => assert.fail('no action requested')});
});

test('tool schemas accept booleans, integer pagination and nullable typed values without coercion', async () => {
  const schemaTools=[{type:'function',function:{name:'typed_input',description:'Schema regression',parameters:{type:'object',properties:{offset:{type:'integer',minimum:0,maximum:20},required:{type:'boolean'},value:{type:['string','number','boolean','null']}},required:['offset','required','value'],additionalProperties:false}}}];
  for(const value of [null,false,0,'00123']) {
    let turn=0,executed=0;
    await runAgent({...base(),tools:schemaTools,complete:async()=>++turn===1?call('typed_input',{offset:20,required:false,value}):done,execute:async(_name,args)=>{executed++;assert.deepEqual(args,{offset:20,required:false,value});return{ok:true};}});
    assert.equal(executed,1);
  }
  for(const args of [{offset:0.5,required:true,value:null},{offset:21,required:true,value:null},{offset:0,required:'false',value:null},{offset:0,required:true,value:{}},{offset:0,required:true,value:null,extra:true}]) {
    let turn=0,executed=0;
    await runAgent({...base(),tools:schemaTools,complete:async messages=>{if(++turn===1)return call('typed_input',args);assert.equal(JSON.parse(messages.at(-1).content).error,'tool_arguments_invalid');return done;},execute:async()=>{executed++;return{ok:true};}});
    assert.equal(executed,0);
  }
});

test('agent repairs invalid arguments from tool feedback before continuing with evidence', async () => {
  const options = base(), executed = [], steps = [];
  let round = 0;
  const result = await runAgent({...options, onStep: step => steps.push(step), complete: async messages => {
    if (++round === 1) return call('read_page_storage', {area: 'cookies', keys: ['profile']});
    if (round === 2) {assert.equal(JSON.parse(messages.at(-1).content).error, 'tool_arguments_invalid'); return call('inspect_dom');}
    if (round === 3) {assert.equal(JSON.parse(messages.at(-1).content).fields[0].label, '이름'); return call('fill_form', {fields: [{field_id:'f1',value:'예시'}]});}
    assert.equal(JSON.parse(messages.at(-1).content).verified, true); return done;
  }, execute: async (name, args) => {executed.push(name); return name === 'inspect_dom' ? {fields:[{field_id:'f1',label:'이름'}]} : {applied:1,verified:true};}});
  assert.equal(result, done);
  assert.deepEqual(executed, ['inspect_dom','fill_form']);
  assert.equal(steps.find(step => step.tool === 'read_page_storage').status, 'error');
  assert.equal(steps.at(-1).status, 'done');
});

test('applied writes are not repeated and cancellation blocks changed write arguments within the run', async () => {
  for (const cancelled of [false, true]) {
    let round = 0, applied = 0;
    await runAgent({...base(), complete: async messages => {
      if (++round < 3) return call('fill_form', {fields:[{field_id:'f1',value: cancelled ? String(round) : 'same'}]});
      assert.equal(JSON.parse(messages.at(-1).content).error, 'action_already_handled'); return done;
    }, execute: async () => {applied++; return cancelled ? {cancelled:true,applied:0} : {applied:1,verified:true};}});
    assert.equal(applied, 1);
  }
});

test('identical observations stop a stalled agent even with different call IDs', async () => {
  let executed = 0;
  await assert.rejects(runAgent({...base(), complete: async () => call('inspect_dom', {}, crypto.randomUUID()), execute: async () => {executed++; return {html:'same page'};}}), /agent_stalled/);
  assert.equal(executed, 3);
});

test('cancellation stops tools, while progressing work continues beyond the old round and action caps', async () => {
  const controller = new AbortController();
  let rounds = 0;
  await assert.rejects(runAgent({...base(), signal:controller.signal, complete:async()=>{rounds++;return call('inspect_dom');}, execute:async()=>{controller.abort();return {};}}), /cancelled/);
  assert.equal(rounds, 1);
  let calls = 0;
  const result = await runAgent({...base(), complete:async()=>calls < 80 ? call('inspect_dom') : done, execute:async()=>({revision:++calls})});
  assert.equal(result, done); assert.equal(calls, 80);
});

test('large observations are compacted without removing tool call/result pairs or recent evidence', async () => {
  const options = base();
  for (let i=0; i<8; i++) options.messages.push({role:'assistant',content:null,tool_calls:call('inspect_dom',{},String(i)).calls},{role:'tool',tool_call_id:String(i),content:JSON.stringify({html:String(i).repeat(20000)})});
  await runAgent({...options, complete:async messages => {
    assert.equal(messages.length, 17);
    assert.equal(JSON.parse(messages[2].content).omitted.startsWith('Older'), true);
    assert.equal(JSON.parse(messages.at(-1).content).html.length, 20000);
    return done;
  }});
});

test('trace persistence contains only known tool names and execution statuses', () => {
  assert.deepEqual(normalizeTrace([{tool:'inspect_dom',status:'done',args:{secret:'x'},result:'private'},{tool:'unknown',status:'done'}]), [{tool:'inspect_dom',status:'done'}]);
});

test('an unknown tool returns safe feedback, blocks its dependent batch and can be corrected', async () => {
  let round = 0; const executed = [], trace = [];
  const result = await runAgent({...base(), stepwise: true, onStep: step => trace.push(step), complete: async messages => {
    if (++round === 1) return {calls: [...call('invented_tool', {value: 'SECRET'}).calls, ...call('fill_form', {fields: [{field_id: 'fake', value: 'do not apply'}]}).calls]};
    if (round === 2) {
      const results = messages.filter(item => item.role === 'tool').map(item => JSON.parse(item.content));
      assert.equal(results[0].error, 'tool_unavailable'); assert.equal(results[0].actionIssued, false);
      assert.equal(results[1].error, 'tool_replan_required'); assert(!JSON.stringify(results).includes('SECRET'));
      return call('read_page');
    }
    return done;
  }, execute: async name => {executed.push(name); return {text: 'Current page'};}});
  assert.equal(result, done); assert.deepEqual(executed, ['read_page']);
  assert(trace.some(step => step.tool === 'recover_tool' && step.status === 'error'));
  assert(!JSON.stringify(normalizeTrace(trace)).includes('invented_tool'));
});

test('changing invented tool names pauses for technical retry without inventing missing user requirements', async () => {
  let round = 0; const executed = [];
  const result = await runAgent({...base(), stepwise: true, complete: async () => {
    assert(++round <= 3, 'no model-generated requirement question for a protocol failure');
    return call(`unknown_${round}`);
  }, execute: async (name, args) => {
    executed.push(name);
    assert.match(args.question, /도구 호출 형식/);
    assert.deepEqual(args.choices.map(choice => choice.label), ['다시 시도', '중지']);
    return {requiresUserInput: true};
  }});
  assert(result.awaitingUser); assert.equal(round, 3); assert.deepEqual(executed, ['ask_user']);
});

test('a lost write receipt requires fresh observation before another write or final success', async () => {
  let round = 0, writes = 0; const executed = [];
  const result = await runAgent({...base(), stepwise: true, complete: async (messages, _, state) => {
    if (++round === 1) return call('read_page');
    if (round === 2) return call('fill_form', {fields: [{field_id: 'f1', value: 'draft'}]});
    if (round === 3) {
      const result = JSON.parse(messages.at(-1).content);
      assert.equal(result.recovery.execution, 'unknown'); assert(!JSON.stringify(result).includes('PRIVATE'));
      assert.equal(state.verificationPending, true);
      return call('fill_form', {fields: [{field_id: 'f1', value: 'draft'}]});
    }
    if (round === 4) {assert.equal(JSON.parse(messages.at(-1).content).error, 'action_outcome_unknown'); return done;}
    if (round === 5) {assert.match(messages.at(-1).content, /lost its receipt/); return call('inspect_dom');}
    if(round===6){assert.equal(JSON.parse(messages.at(-1).content).fields[0].value, 'draft');assert.equal(state.verificationPending,true);return call('verify_page',{checks:[{kind:'field_value',ref:'f1',expected:'draft'}]});} return done;
  }, execute: async name => {
    executed.push(name);
    if (name === 'fill_form') {writes++; throw new Error('PRIVATE upstream exception with Bearer SECRET');}
    return name==='verify_page' ? {ok:true,verified:true,checks:[{kind:'field_value',passed:true}],observation:livePage()} : name==='read_page' ? livePage() : {fields: [{field_id: 'f1', value: 'draft'}]};
  }});
  assert.equal(result, done); assert.equal(writes, 1); assert.deepEqual(executed, ['read_page','fill_form', 'inspect_dom','verify_page']);
});

test('document excerpts cannot clear an unknown write outcome', async () => {
  let round = 0; const executed = [];
  const result = await runAgent({...base(), stepwise: true, complete: async (messages, _, state) => {
    if (++round === 1) return call('read_page');
    if (round === 2) return call('fill_form', {fields: [{field_id: 'f1', value: 'draft'}]});
    if (round === 3) return call('read_page', {mode: 'content'});
    if (round === 4) {
      assert.equal(state.verificationPending, true);
      return call('fill_form', {fields: [{field_id: 'f1', value: 'another draft'}]});
    }
    if (round === 5) {assert.equal(JSON.parse(messages.at(-1).content).error, 'action_outcome_unknown'); return call('browser_snapshot');}
    if(round===6){assert.equal(state.verificationPending,true);return call('verify_page',{checks:[{kind:'field_value',ref:'f1',expected:'draft'}]});}
    assert.equal(state.verificationPending,false);return done;
  }, execute: async (name,args) => {
    executed.push(name);
    if (name === 'fill_form') throw new Error('lost receipt');
    if(name==='verify_page')return {ok:true,verified:true,checks:[{kind:'field_value',passed:true}],observation:livePage()};
    return name === 'read_page' ? args.mode==='content' ? {ok: true, dataKind: 'page_content', ranges: [{markdown: 'Reference material'}]} : livePage() : {frames: [{text: 'Current visible state'}]};
  }});
  assert.equal(result, done); assert.deepEqual(executed, ['read_page','fill_form', 'read_page', 'browser_snapshot','verify_page']);
});

test('known host errors retain fixed classifications and user cancellation does not restart work', async () => {
  let round = 0, executions = 0;
  await runAgent({...base(), complete: async messages => {
    if (++round === 1) return call('read_page');
    const result = JSON.parse(messages.at(-1).content);
    assert.equal(result.error, 'page_permission'); assert.equal(result.recovery.strategy, 'user_action');
    assert(!JSON.stringify(result).includes('PRIVATE')); return done;
  }, execute: async () => {throw Object.assign(new Error('page_permission'), {stack: 'PRIVATE', token: 'PRIVATE'});}});
  const controller = new AbortController();
  await assert.rejects(runAgent({...base(), signal: controller.signal, complete: async () => call('fill_form', {fields: [{field_id: 'f1', value: 'draft'}]}),
    execute: async () => {executions++; controller.abort(); throw new Error('PRIVATE');}}), /cancelled/);
  assert.equal(executions, 1);
});

test('a failed tool defers the rest of its batch until the model replans from feedback', async () => {
  const events = [];
  let round = 0;
  const result = await runAgent({...base(), complete: async messages => {
    if (++round === 1) return {content: '', calls: [...call('inspect_dom').calls, ...call('list_page_storage').calls]};
    assert.equal(JSON.parse(messages.at(-2).content).error, 'tool_execution_failed');
    assert.equal(JSON.parse(messages.at(-1).content).error, 'tool_replan_required');
    return done;
  }, execute: async name => {
    events.push(name);
    if (name === 'inspect_dom') throw new Error('private runtime exception');
    return {areas: ['local']};
  }});
  assert.equal(result, done);
  assert.deepEqual(events, ['inspect_dom']);
});

test('successful observation is a decision boundary before speculative actions and plan completion', async () => {
  let round = 0;
  const executed = [], trace = [];
  await runAgent({...base(), harness: true, onStep: step => trace.push(step), complete: async messages => {
    if (++round === 1) return {content: '입력 화면을 확인하겠습니다.', calls: [
      ...call('read_page', {}, 'observe').calls,
      ...call('fill_form', {fields: [{field_id: 'guessed', value: 'wrong'}]}, 'premature-write').calls,
      ...call('update_plan', {steps: [{text: '입력 완료', status: 'completed'}]}, 'premature-done').calls,
    ]};
    const results = messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
    assert.equal(results[0].missing, '담당 팀');
    assert(results.slice(1).every(result => result.deferred === true && !result.error));
    return call('ask_user', {question: '어느 팀으로 작성할까요?', choices: [{label: '개발팀'}, {label: '디자인팀'}]});
  }, execute: async name => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : {ok: true, missing: '담당 팀'};}});
  assert.deepEqual(executed, ['read_page', 'ask_user']);
  assert.equal(round, 2);
  assert(!trace.some(step => ['fill_form', 'update_plan'].includes(step.tool)));
  assert.equal(trace.at(-1).status, 'waiting');
});

test('each successful operation returns evidence to the model before another batch operation', async () => {
  const executed = [];
  let round = 0;
  await runAgent({...base(), harness: true, complete: async messages => {
    if (++round === 1) return {calls: [
      ...call('run_playwright', {code: 'await page.getByLabel("제목").fill("초안");'}, 'draft').calls,
      ...call('request_approval', {ref: 'old'}, 'premature-approval').calls,
    ]};
    if (round === 2) {
      assert.equal(JSON.parse(messages.at(-1).content).deferred, true);
      return call('verify_page', {checks: [{kind: 'text_present', expected: '초안'}]});
    }
    assert.equal(JSON.parse(messages.at(-1).content).verified, true);
    return call('request_approval', {ref: 'current'});
  }, execute: async name => {
    executed.push(name);
    return name === 'request_approval' ? {requiresUserInput: true} : name === 'verify_page' ? {ok: true, verified: true} : {ok: true, actionIssued: true};
  }});
  assert.deepEqual(executed, ['run_playwright', 'verify_page', 'request_approval']);
  assert.equal(round, 3);
});

test('read-only skills replan from the first result before executing another proposed read', async () => {
  const executed = [], trace = []; let round = 0;
  const readTools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'source'));
  await runAgent({...base(), tools: readTools, harness: true, onStep: step => trace.push(step), complete: async (messages, active, state) => {
    if (++round === 1) return {calls: [...call('read_page', {}, 'read').calls, ...call('inspect_dom', {}, 'speculative').calls]};
    assert.equal(state.assessing, true);
    assert.match(messages[0].content, /Compare the actual input and output/);
    assert.equal(JSON.parse(messages.find(message => message.tool_call_id === 'read').content).text, '마감일 10월 8일');
    assert.equal(JSON.parse(messages.at(-1).content).deferred, true);
    return {content: '마감일은 10월 8일입니다.'};
  }, execute: async name => {executed.push(name); return {text: '마감일 10월 8일'};}});
  assert.deepEqual(executed, ['read_page']);
  assert(!trace.some(step => step.tool === 'inspect_dom'));
});

test('failed batches do not show a running or failed row for an unexecuted later call', async () => {
  const trace = []; let round = 0;
  await runAgent({...base(), harness: true, onStep: step => trace.push(step), complete: async (messages, active, state) => {
    if (++round === 1) return {calls: [...call('read_page').calls, ...call('inspect_dom').calls]};
    assert.equal(state.assessing, true);
    assert.match(messages[0].content, /Last operation: read_page; outcome: failed/);
    return done;
  }, execute: async () => ({error: 'page_changed'})});
  assert.deepEqual(trace.filter(step => step.tool === 'read_page').map(step => step.status), ['running', 'error']);
  assert(!trace.some(step => step.tool === 'inspect_dom'));
});

test('an unverified step cannot be marked completed, but its planned check can still run', async () => {
  const plan = [{text: '초안 입력과 확인', status: 'in_progress'}, {text: '등록 승인', status: 'pending'}];
  const completed = [{...plan[0], status: 'completed'}, {...plan[1], status: 'in_progress'}];
  const executed = [], trace = []; let round = 0;
  await runAgent({...base(), harness: true, resumePlan: plan, onStep: step => trace.push(step), complete: async (messages, active, state) => {
    if (++round === 1) return call('fill_form', {fields: [{field_id: 'observed', value: '초안'}]});
    if (round === 2) return {calls: [
      ...call('update_plan', {steps: completed}, 'premature').calls,
      ...call('verify_page', {checks: [{kind: 'text_present', expected: '초안'}]}, 'verify').calls,
    ]};
    if (round === 3) {
      assert.equal(JSON.parse(messages.find(message => message.tool_call_id === 'premature').content).reason, 'verification_required');
      assert.equal(JSON.parse(messages.at(-1).content).verified, true);
      assert.equal(state.verificationPending, false);
      return call('update_plan', {steps: completed}, 'checked');
    }
    if (round === 4) return call('ask_user', {question: '어느 팀에 등록할까요?'});
    assert.fail('Question must pause the run');
  }, execute: async (name, args) => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : {ok: true, verified: true, applied: 1, plan: args.steps};}});
  assert.deepEqual(executed, ['fill_form', 'verify_page', 'update_plan', 'ask_user']);
  assert.deepEqual(trace.filter(step => step.tool === 'update_plan').map(step => step.status), ['running', 'done']);
});

test('partial execution feeds its receipts into the next decision instead of replaying the script', async () => {
  const executed = []; let round = 0;
  await runAgent({...base(), harness: true, complete: async (messages, active, state) => {
    if (++round === 1) return call('run_playwright', {code: 'await page.getByRole("button", {name:"작성"}).click();'});
    if (round === 2) {
      assert.equal(state.assessing, true);
      assert.match(messages[0].content, /outcome: partial/);
      assert.equal(JSON.parse(messages.at(-1).content).execution.commands[0].status, 'returned');
      return call('verify_page', {checks: [{kind: 'text_present', expected: '작성 화면'}]});
    }
    return done;
  }, execute: async name => {executed.push(name); return name === 'run_playwright' ? {ok: true, yielded: true, completed: false, actionIssued: true, execution: {commands: [{name: 'click', status: 'returned'}]}, observation: {text: '작성 화면'}} : {ok: true, verified: true};}});
  assert.deepEqual(executed, ['run_playwright', 'verify_page']);
});

test('repeated unverified plan-only proposals ask a question without false progress or repeated writes', async () => {
  const plan = [{text: '입력 내용 확인', status: 'in_progress'}], executed = [], trace = []; let round = 0;
  const result = await runAgent({...base(), harness: true, resumePlan: plan, onStep: step => trace.push(step), complete: async (messages, active) => {
    if (active.length === 1 && active[0].function.name === 'ask_user') return call('ask_user', {question: '화면에 어떤 확인 문구가 표시되어야 하나요?'});
    if (++round === 1) return call('fill_form', {fields: [{field_id: 'observed', value: '초안'}]});
    return call('update_plan', {steps: [{...plan[0], status: 'completed'}]});
  }, execute: async name => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : {ok: true, applied: 1};}});
  assert.equal(result.awaitingUser, true);
  assert.deepEqual(executed, ['fill_form', 'ask_user']);
  assert(!trace.some(step => step.tool === 'update_plan'));
});

test('Pi preserves transport error status and partial text without running tools or retrying', async () => {
  const failure = Object.assign(new Error('network'), {status: 502, partial: '받은 부분'});
  let requests = 0, executed = 0;
  await assert.rejects(runAgent({...base(), complete: async () => {requests++; throw failure;}, execute: async () => {executed++;}}), error => error === failure);
  assert.equal(requests, 1);
  assert.equal(executed, 0);
});

test('a cancelled first write blocks subsequent writes from the same model response', async () => {
  let round = 0, executed = 0;
  await runAgent({...base(), complete: async messages => {
    if (++round === 1) return {content: '', calls: [
      ...call('fill_form', {fields:[{field_id:'f1', value:'one'}]}, 'first').calls,
      ...call('fill_form', {fields:[{field_id:'f2', value:'two'}]}, 'second').calls,
    ]};
    assert.equal(JSON.parse(messages.at(-1).content).error, 'action_already_handled');
    return done;
  }, execute: async () => {executed++; return {cancelled: true};}});
  assert.equal(executed, 1);
});

test('Qwen receives only the latest screenshot after complete tool-result pairs', async () => {
  let round = 0, shots = 0;
  await runAgent({...base(), tools: browserTools({}, BUILTIN_SKILLS[0], 'QWEN3.8-27B-FP8-256K'), complete: async messages => {
    round++;
    if (round === 1) return {content: '', calls: [...call('capture_page', {}, 'image-1').calls, ...call('browser_snapshot', {}, 'dom-1').calls]};
    const images = messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []);
    assert.equal(images.length, 1);
    assert.equal(images[0].image_url.url, `data:image/png;base64,shot${round - 1}`);
    for (let i = 0; i < messages.length; i++) if (messages[i].tool_calls) {
      assert.deepEqual(messages.slice(i + 1, i + 1 + messages[i].tool_calls.length).map(message => message.role), messages[i].tool_calls.map(() => 'tool'));
    }
    assert(!messages.filter(message => message.role === 'tool').some(message => message.content.includes('base64')));
    return round === 2 ? call('capture_page', {}, 'image-2') : done;
  }, execute: async name => name === 'capture_page' ? {screenshot_id: `s${++shots}`, image: {data: `shot${shots}`, mimeType: 'image/png'}} : {frames: []}});
});

test('screen tools require the confirmed Qwen family and numeric coordinates', async () => {
  assert(!browserTools({}, BUILTIN_SKILLS[0], 'GLM-5.2-NVFP4').some(tool => tool.function.name === 'capture_page'));
  let round = 0, calls = 0;
  await runAgent({...base(), tools: browserTools({}, BUILTIN_SKILLS[0], 'qwen3.8-27b'), complete: async messages => {
    if (++round === 1) return call('click_at', {screenshot_id: 'latest', x: '12', y: 15});
    if (round === 2) {assert.equal(JSON.parse(messages.at(-1).content).error, 'tool_arguments_invalid'); return call('click_at', {screenshot_id: 'latest', x: 12, y: 15});}
    return done;
  }, execute: async () => {calls++; return {ok: true};}});
  assert.equal(calls, 1);
});

test('a native confirmation interruption asks the user immediately and never replays the click', async () => {
 const executed=[],options=base();let calls=0,question;
 const result=await runAgent({...options,stepwise:true,complete:async()=>{calls++;return call('click_element',{ref:'observed'});},execute:async(name,args)=>{
  executed.push(name);
  if(name==='click_element')return {error:'browser_dialog',reason:'browser_dialog',actionIssued:true,nativeDialogs:[{type:'confirm',disposition:'dismissed'}]};
  assert.equal(name,'ask_user');question=args;return {requiresUserInput:true,question:{text:args.question}};
 }});
 assert.deepEqual(executed,['click_element','ask_user']);assert.equal(calls,1);assert.match(question.question,/브라우저 기본 확인창/);assert.equal(question.input_mode,'long_text');assert(result);
});


test('an approved-action native dialog pauses before any new inference or page action', async () => {
  const executed = [];
  await runAgent({...base(), stepwise: true, interruptedAction: {error: 'browser_dialog', actionIssued: true},
    complete: async () => assert.fail('Do not infer another action after a native confirmation'),
    execute: async (name, args) => {executed.push(name);assert.equal(name,'ask_user');assert.equal(args.input_mode,'long_text');return {requiresUserInput:true};},
  });
  assert.deepEqual(executed,['ask_user']);
});

test('a generic observation cannot unlock a lost write; explicit successful verification is required',async()=>{
 for(const readTool of ['read_page','browser_snapshot','inspect_dom','capture_page']) {
  let round=0,writes=0;
  const available=[...tools];if(!available.some(t=>t.function.name===readTool))available.push({type:'function',function:{name:readTool,parameters:{type:'object',properties:{}}}});
  await runAgent({...base(),tools:available,stepwise:true,complete:async(messages,_,state)=>{
   if(++round===1)return call('read_page');
   if(round===2)return call('fill_form',{fields:[{field_id:'f1',value:'first'}]});
   if(round===3)return call(readTool);
   if(round===4){assert.equal(state.verificationPending,true,readTool+' must not resolve uncertainty');return call('fill_form',{fields:[{field_id:'f2',value:'next'}]});}
   if(round===5){assert.equal(JSON.parse(messages.at(-1).content).error,'action_outcome_unknown');return call('verify_page',{checks:[{kind:'field_value',ref:'f1',expected:'first'}]});}
   if(round===6){assert.equal(state.verificationPending,false);return call('fill_form',{fields:[{field_id:'f2',value:'next'}]});}
   return done;
  },execute:async name=>{
   if(name==='fill_form'){if(++writes===1)throw new Error('lost receipt');return {ok:true,applied:1};}
   if(name==='verify_page')return {ok:true,verified:true,checks:[{kind:'field_value',passed:true}],observation:livePage()};
   if(name==='read_page'&&round===1)return livePage();
   return {ok:true,frames:[{text:'first saved'}]};
  }});
  assert.equal(writes,2);
 }
});

test('returned unknown outcomes and automatic recovery screenshots keep the same execution fence',async()=>{
 for(const returned of [true,false]) {
  let round=0,captures=0;
  const available=[...tools];if(!available.some(t=>t.function.name==='capture_page'))available.push({type:'function',function:{name:'capture_page',parameters:{type:'object',properties:{full_page:{type:'boolean'}}}}});
  await runAgent({...base(),tools:available,harness:true,complete:async(messages,_,state)=>{
   if(++round===1)return call('read_page');
   if(round===2)return call('click_element',{ref:'r1'});
   if(round===3){assert.equal(state.verificationPending,true);return call('click_element',{ref:'r2'});}
   if(round===4){assert.equal(JSON.parse(messages.at(-1).content).error,'action_outcome_unknown');return call('verify_page',{checks:[{kind:'text_present',expected:'saved'}]});}
   return done;
  },execute:async name=>{
   if(name==='read_page')return livePage();
   if(name==='click_element'){
    if(returned)return {ok:false,error:'script_timeout',recovery:{execution:'unknown'}};
    throw new Error('script_timeout');
   }
   if(name==='capture_page'){captures++;return {image:{mimeType:'image/png',data:'AAAA'},observation:{frames:[]}};}
   return {ok:true,verified:true,checks:[{kind:'text_present',passed:true}],observation:livePage()};
  }});assert.equal(captures,1);
 }
});

test('a successful page check cannot clear an unknown click after the original document changes', async () => {
  const iframePage = documentId => ({tabId:11,topDocumentId:'top-document',url:'https://example.test/form',frames:[
    {frame:0,documentId:'top-document',url:'https://example.test/form',elements:[]},
    {frame:1,documentId,url:'https://example.test/child',owner:{tag:'iframe',id:'work'},elements:[{ref:'r1',role:'button',name:'저장',id:'save'}]},
  ]});
  for (const [original,replacement] of [[livePage(),{...livePage(),topDocumentId:'document-2',frames:[{...livePage().frames[0],documentId:'document-2'}]}],[iframePage('child-1'),iframePage('child-2')]]) {
    let round=0, writes=0;
    const result=await runAgent({...base(),stepwise:true,complete:async(messages,_,state)=>{
      if(++round===1)return call('read_page');
      if(round===2)return call('click_element',{ref:'r1'});
      if(round===3)return call('browser_snapshot');
      if(round===4)return call('verify_page',{checks:[{kind:'text_present',expected:'saved'}]});
      assert.equal(state.verificationPending,true);
      assert.equal(JSON.parse(messages.at(-1).content).unresolvedAction,true);
      return call('ask_user',{question:'원래 문서가 바뀌었습니다. 현재 상태를 확인해 주시겠습니까?',input_mode:'long_text'});
    },execute:async name=>{
      if(name==='read_page')return original;
      if(name==='click_element'){writes++;throw new Error('lost receipt');}
      if(name==='browser_snapshot')return replacement;
      if(name==='verify_page')return {ok:true,verified:true,checks:[{kind:'text_present',passed:true}],observation:replacement};
      return {requiresUserInput:true};
    }});
    assert.equal(result.awaitingUser,true);assert.equal(writes,1);
  }
});


test('failed, empty, and mismatched verification evidence cannot unlock an uncertain action', async () => {
  for (const invalid of [
    {ok: false, verified: false, checks: [{kind: 'text_present', passed: false}]},
    {ok: true, verified: true, checks: []},
    {ok: true, verified: true, checks: [{kind: 'url', passed: true}]},
    {ok: true, verified: true, checks: [{kind: 'text_present', passed: false}]},
  ]) {
    let round = 0, checks = 0, writes = 0;
    await runAgent({...base(), stepwise: true, complete: async messages => {
      if (++round === 1) return call('read_page');
      if (round === 2) return call('click_element', {ref: 'r1'});
      if (round === 3 || round === 5) return call('verify_page', {checks: [{kind: 'text_present', expected: 'saved'}]});
      if (round === 4) return call('click_element', {ref: 'r2'});
      assert.equal(writes, 1);
      return done;
    }, execute: async name => {
      if(name==='read_page')return livePage();
      if (name === 'click_element') {writes++; throw new Error('lost receipt');}
      if (++checks === 1) return {...invalid,observation:livePage()};
      return {ok: true, verified: true, checks: [{kind: 'text_present', passed: true}],observation:livePage()};
    }});
    assert.equal(writes, 1);
    assert.equal(checks, 2);
  }
});

test('unrelated reads do not reset repeated malformed verification calls', async () => {
  const schemaTools=[
    {type:'function',function:{name:'verify_page',description:'Verify an observed result',parameters:{type:'object',properties:{checks:{type:'array',items:{type:'string'}}},required:['checks'],additionalProperties:false}}},
    {type:'function',function:{name:'read_page',description:'Read page',parameters:{type:'object',properties:{},additionalProperties:false}}},
  ];
  let round=0, reads=0, verifies=0;
  await assert.rejects(runAgent({...base(),tools:schemaTools,
    complete:async()=>{round++;assert(round<=6,'schema repair must terminate despite unrelated reads');return round%2 ? call('verify_page',{checks:[String(round)],unsupported:String(round)}) : call('read_page');},
    execute:async name=>{if(name==='verify_page')verifies++;else reads++;return{text:`fresh page ${reads}`};},
  }),/agent_stalled/);
  assert.equal(round,5);
  assert.equal(reads,2);
  assert.equal(verifies,0,'malformed checks must never execute');
});

test('valid arguments resolve only that tool protocol failure history', async () => {
  const schemaTools=[{type:'function',function:{name:'typed_check',description:'Read-only check',parameters:{type:'object',properties:{expected:{type:'string'}},required:['expected'],additionalProperties:false}}}];
  let round=0, executed=0;
  const result=await runAgent({...base(),tools:schemaTools,
    complete:async()=>{round++;if(round===7)return done;return call('typed_check',round%3===0?{expected:String(round)}:{expected:String(round),unsupported:true});},
    execute:async()=>{executed++;return{ok:false,error:'verification_failed',observation:{text:`different current evidence ${executed}`}};},
  });
  assert.equal(result,done);
  assert.equal(executed,2,'valid schema repairs are separate from page outcome failures');
});

test('PDF recovery diagnostics expose bounded status and attempt counts without private response data', async()=>{
  for(const details of [{http_status:503,request_attempts:3},{http_status:700,request_attempts:99}]) {
    let turn=0;const diagnostics=[];
    await runAgent({...base(),onDiagnostic:event=>diagnostics.push(event),complete:async()=>++turn===1?call('read_page'):{content:'원문을 읽지 못했습니다.',calls:null},
      execute:async()=>({error:'page_content_pdf_unavailable',reason:'pdf_http_error',...details,privateBody:'PRIVATE_SERVER_RESPONSE'})});
    const event=diagnostics.find(event=>event.phase==='tool_result');assert(event);
    if(details.http_status===503){assert.equal(event.pdfHttpStatus,503);assert.equal(event.pdfRequestAttempts,3);}
    else{assert.equal(event.pdfHttpStatus,undefined);assert.equal(event.pdfRequestAttempts,undefined);}
    assert(!JSON.stringify(diagnostics).includes('PRIVATE'));
  }
});
