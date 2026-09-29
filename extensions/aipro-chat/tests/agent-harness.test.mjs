import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness, requiresVerification} from '../agent-harness.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {taskReceipt, resumedVerification} from '../context-state.js';

const tools = browserTools({}, BUILTIN_SKILLS[0]);
const call = (name, args = {}) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const done = {content: '결과 확인 완료', calls: null};
const options = () => ({messages: [{role: 'user', content: '교육 신청서에 제목을 입력하고 저장해줘'}], tools, signal: new AbortController().signal, harness: true});
const names = tools => tools.map(tool => tool.function.name);

test('capability selection exposes only registered groups and preserves model vision restrictions', () => {
  const h = createHarness(tools);
  assert(names(h.advertised()).includes('select_tools'));
  assert(!names(h.advertised()).includes('run_playwright'));
  h.select({groups: ['scripts', 'images']});
  assert(names(h.advertised()).includes('run_playwright'));
  assert(names(h.advertised()).includes('find_images'));
  assert(!names(h.advertised()).includes('capture_page'));
  const restricted = createHarness(browserTools({}, BUILTIN_SKILLS.find(s => s.id === 'source')));
  restricted.select({groups: ['scripts', 'input']});
  assert(!names(restricted.advertised()).includes('fill_form'));
});

test('ordinary chat does not connect or inspect a browser', async () => {
  let rounds = 0;
  assert.equal(await runAgent({...options(), complete: async () => {rounds++; return done;}, execute: () => assert.fail('No page work requested')}), done);
  assert.equal(rounds, 1);
});

test('tool selection runs locally and its schemas reach the next model round', async () => {
  let round = 0;
  await runAgent({...options(), execute: () => assert.fail('Selection must not connect a page'), complete: async (messages, active) => {
    if (++round === 1) {assert(!names(active).includes('run_playwright')); return call('select_tools', {groups: ['scripts']});}
    assert(names(active).includes('run_playwright')); assert.equal(JSON.parse(messages.at(-1).content).ok, true); return done;
  }});
});

test('browser basics are offered from the start unless the input window is small', () => {
  const normal = names(createHarness(tools).advertised()), lean = names(createHarness(tools, {inputBudget: 16000}).advertised());
  for (const name of ['navigate_page', 'list_tabs', 'click_element', 'press_key', 'scroll_page', 'fill_form']) {
    assert(normal.includes(name), name); assert(!lean.includes(name), name);
  }
  for (const name of ['run_playwright', 'find_images', 'read_browser_diagnostics']) assert(!normal.includes(name), name);
  assert(names(createHarness(tools, {inputBudget: 200000}).advertised()).includes('navigate_page'));
  const h = createHarness(tools);
  h.select({groups: ['scripts']}); h.select({groups: ['images'], replace: true});
  assert(names(h.advertised()).includes('navigate_page') && names(h.advertised()).includes('fill_form'), 'replace returns to the initial set, not below it');
  assert(!names(h.advertised()).includes('run_playwright'));
  const source = names(createHarness(browserTools({}, BUILTIN_SKILLS.find(s => s.id === 'source'))).advertised());
  assert(!source.includes('fill_form'), 'a tool that was not granted is never offered');
});

test('task discovery ranks authorized tools in Korean and narrows optional schemas across phases', () => {
  const h=createHarness(tools,{inputBudget:16000});
  h.select({groups:['scripts','navigation']});
  const found=h.select({query:'입력란 채우기',replace:true});
  assert.equal(found.ok,true);assert(found.matches.some(item=>item.name==='fill_form'));
  assert(found.matches.length<=5);assert(!names(h.advertised()).includes('run_playwright'));
  assert(!names(h.advertised()).includes('navigate_page'));
  assert(names(h.advertised()).includes('ask_user'));assert(names(h.advertised()).includes('verify_page'));
  assert.equal(h.needsCheck(),false);
  const before=names(h.advertised());
  assert.deepEqual(h.select({query:'zzzzqzxvnonexistent',replace:true}).matches,[]);
  assert.deepEqual(names(h.advertised()),before);
  const restricted=createHarness(browserTools({},BUILTIN_SKILLS.find(s=>s.id==='source')));
  const result=restricted.select({query:'입력란 채우기'});
  assert(!result.matches.some(item=>item.name==='fill_form'));
  assert(!names(restricted.advertised()).includes('fill_form'));
});

test('workflow loading activates mentioned tools but metadata and failed reads grant nothing', () => {
  const h=createHarness([...tools,{type:'function',function:{name:'run_skill_script',description:'Execute a browser skill',parameters:{type:'object'}}}]);
  for(const result of [{ok:true,dataKind:'skill_catalog',content:'run_playwright'},{error:'skill_changed',dataKind:'skill_reference',content:'run_playwright'}])h.observe('read_skill',result);
  assert(!names(h.advertised()).includes('run_playwright'));
  h.observe('read_skill',{ok:true,dataKind:'skill_reference',path:'SKILL.md',content:'Inspect first, then use fill_form and verify_page. Do not use invented_shell.',resources:[{path:'scripts/draft.browser.js',execution:'browser_sandbox'}]});
  const active=names(h.advertised());assert(active.includes('fill_form'));assert(active.includes('run_skill_script'));
  assert(!active.includes('run_playwright'));assert(!active.includes('invented_shell'));assert(!h.needsCheck());
});

test('query discovery is metadata-only and reaches the next model request without browser access', async () => {
  let round=0;
  await runAgent({...options(),execute:()=>assert.fail('Discovery must not execute a browser action'),complete:async(messages,active)=>{
    if(++round===1)return call('select_tools',{query:'입력란 채우기',replace:true});
    assert(names(active).includes('fill_form'));assert(!names(active).includes('run_playwright'));
    assert(JSON.parse(messages.at(-1).content).matches.some(item=>item.name==='fill_form'));return done;
  }});
  assert.equal(round,2);
});

test('premature completion triggers fresh verification, failed checks feed back for correction', async () => {
  let round = 0, checks = 0; const executed = [], held = [];
  await runAgent({...options(), complete: async (messages, active, state) => {
    held.push(state.verificationPending);
    if (++round === 1) return call('fill_form', {fields: [{field_id: 'f1', value: '교육'}]});
    if (round === 2) return done;
    if (round === 3) {assert.match(messages.at(-1).content, /Harness result check/); return call('verify_page', {checks: [{kind: 'text_present', expected: '저장됨'}]});}
    if (round === 4) {assert.equal(JSON.parse(messages.at(-1).content).error, 'verification_failed'); return call('click_element', {ref: 'save'});}
    if (round === 5) return call('verify_page', {checks: [{kind: 'text_present', expected: '저장됨'}]});
    assert.equal(state.verificationPending, false); return done;
  }, execute: async name => {
    executed.push(name);
    return name === 'verify_page' ? ++checks === 1 ? {ok: false, verified: false, error: 'verification_failed'} : {ok: true, verified: true} : {ok: true, applied: 1, verified: true};
  }});
  assert.deepEqual(executed, ['fill_form', 'verify_page', 'click_element', 'verify_page']);
  assert.deepEqual(held, [false, true, true, true, true, false]);
});

test('verification cannot survive a later action or be satisfied by a plan or script return', async () => {
  const h = createHarness(tools);
  h.observe('click_element', {ok: true}); h.observe('update_plan', {ok: true}); assert(h.needsCheck());
  h.observe('verify_page', {ok: true, verified: true}); assert(!h.needsCheck());
  h.observe('run_playwright', {ok: true, value: {verified: true}}); assert(h.needsCheck());
  h.observe('verify_page', {ok: false, verified: false}); assert(h.needsCheck());
});

test('each actually verified stage permits its own repair without an overall action cap', () => {
  const h = createHarness(tools);
  for (let stage = 0; stage < 8; stage++) {
    h.observe('fill_form', {ok: true, applied: 1});
    assert(h.needsCheck()); assert(h.repairMessage());
    h.observe('verify_page', {ok: true, verified: true}); assert(!h.needsCheck());
  }
});

test('reads, unrelated writes and failed verification cannot reset a stalled repair window', () => {
  const h = createHarness(tools);
  h.observe('fill_form', {ok: true}); assert(h.repairMessage());
  h.observe('browser_snapshot', {ok: true, ref: 'renewed'});
  h.observe('verify_page', {ok: true, verified: false}); assert(h.repairMessage());
  h.observe('fill_form', {ok: true, verified: true});
  h.observe('verify_page', {ok: false, verified: true});
  assert.equal(h.repairMessage(), null); assert(h.needsCheck());
});

test('Pi continues after three separate premature completions when each stage is genuinely verified', async () => {
  let round = 0, writes = 0, checks = 0, stage = 0;
  const result = await runAgent({...options(), complete: async (messages, _, state) => {
    const turn = round++;
    if (turn === 9) {assert.equal(state.verificationPending, false); return done;}
    if (turn % 3 === 0) {stage++; return call('fill_form', {fields: [{field_id: `f${stage}`, value: `draft-${stage}`}]});}
    if (turn % 3 === 1) return done;
    assert.match(messages.at(-1).content, /Harness result check/);
    return call('verify_page', {checks: [{kind: 'field_value', ref: `f${stage}`, expected: `draft-${stage}`}]});
  }, execute: async name => {
    assert.notEqual(name, 'ask_user');
    if (name === 'fill_form') {writes++; return {ok: true, applied: 1};}
    checks++; return {ok: true, verified: true};
  }});
  assert.equal(result, done); assert.equal(writes, 3); assert.equal(checks, 3);
});

test('repeated unverified completion offers technical retry without reasking intent or replaying actions', async () => {
  let round = 0, writes = 0, question;
  const result = await runAgent({...options(), complete: async () => ++round === 1 ? call('click_element', {ref: 'save'}) : done,
    execute: async (name,args) => {if (name === 'ask_user') {question=args; return {requiresUserInput: true};} writes++; return {ok: true};}});
  assert.equal(result.awaitingUser, true); assert.equal(result.content, '');
  assert.equal(writes, 1); assert.equal(round, 4);
  assert.deepEqual(question.choices.map(choice=>choice.label), ['다시 확인', '중지']);
  assert(!question.question.includes('원하는 결과'));
});

test('worker checkpoints retain proven writes across navigation and keep only verification status/counts', () => {
  let task = taskReceipt({steps: []}, 'click_element', 'start');
  assert.equal(task.verification.status, 'pending');
  task = taskReceipt(task, 'verify_page', 'end', {ok: true, verified: true, checks: [{expected: 'private input'}]});
  assert.equal(task.verification.status, 'passed'); assert.equal(task.verification.checks, 1);
  assert(!JSON.stringify(task).includes('private input'));
  task = taskReceipt(task, 'navigate_page', 'start'); assert.equal(task.verification.status, 'passed');
});

test('read-only navigation uses the fresh observation without clearing a pending write', () => {
  const h = createHarness(tools);
  for (const name of ['navigate_page', 'switch_tab', 'go_back']) {
    h.observe(name, {ok: true, observation: {url: 'https://example.test/source'}});
    assert.equal(h.needsCheck(), false);
  }
  h.observe('click_element', {ok: true, actionIssued: true, navigationOnly: true});
  assert.equal(h.needsCheck(), false);
  let task = taskReceipt({steps: []}, 'click_element', 'start');
  task = taskReceipt(task, 'click_element', 'end', {ok: true, actionIssued: true, navigationOnly: true});
  assert.equal(task.verification.status, 'not_required');
  h.observe('fill_form', {ok: true, actionIssued: true});
  h.observe('switch_tab', {ok: true});
  h.observe('click_element', {ok: true, actionIssued: true, navigationOnly: true});
  assert.equal(h.needsCheck(), true);
  h.observe('verify_page', {ok: true, verified: true});
  assert.equal(h.needsCheck(), false);
  task = taskReceipt(task, 'fill_form', 'start');
  task = taskReceipt(task, 'click_element', 'start');
  task = taskReceipt(task, 'click_element', 'end', {ok: true, actionIssued: true, navigationOnly: true});
  assert.equal(task.verification.status, 'pending');
});

test('read-only script evidence does not add or erase verification debt', () => {
  const h = createHarness(tools);
  h.observe('run_playwright', {ok: true, actionIssued: false}); assert(!h.needsCheck());
  h.observe('click_element', {ok: true}); h.observe('run_playwright', {ok: true, actionIssued: false}); assert(h.needsCheck());
  let task = taskReceipt({steps: []}, 'run_playwright', 'start');
  task = taskReceipt(task, 'run_playwright', 'end', {ok: true, actionIssued: false}); assert.equal(task.verification.status, 'not_required');
  task = taskReceipt(task, 'click_element', 'start');
  task = taskReceipt(task, 'run_playwright', 'start');
  task = taskReceipt(task, 'run_playwright', 'end', {ok: true, actionIssued: false}); assert.equal(task.verification.status, 'pending');
  assert(!('verificationPrior' in task));
});

test('explicit unissued semantic actions add no verification debt and never erase earlier debt', () => {
  for (const name of ['click_element', 'press_key', 'drag_element', 'fill_form', 'select_option']) {
    const predispatch = {error: 'browser_stale', actionIssued: false};
    assert.equal(requiresVerification(name, predispatch), false, name);
    const h = createHarness(tools);
    h.observe(name, predispatch); assert.equal(h.needsCheck(), false, name);
    h.observe('fill_form', {ok: true, actionIssued: true, applied: 1});
    h.observe(name, predispatch); assert.equal(h.needsCheck(), true, name);
    h.observe('verify_page', {ok: true, verified: true});
    h.observe(name, predispatch); assert.equal(h.needsCheck(), false, name);
    const resumed = createHarness(tools, {resumeVerification: true});
    resumed.observe(name, predispatch); assert.equal(resumed.needsCheck(), true, name);
    for (const actionIssued of [true, undefined, null, 0, 'false']) {
      const uncertain = createHarness(tools);
      uncertain.observe(name, {error: 'browser_stale', actionIssued});
      assert.equal(uncertain.needsCheck(), true, `${name}: ${String(actionIssued)}`);
    }
  }
  // Coordinate-click catch receipts can still report false after dispatch;
  // extending the audited semantic allowlist must not relax this boundary.
  assert.equal(requiresVerification('click_at', {error: 'browser_stale', actionIssued: false}), true);
  assert.equal(requiresVerification('apply_approved_action', {error: 'browser_stale', actionIssued: false}), true);
});

test('persisted semantic pre-dispatch receipts restore prior verification without certifying old work', () => {
  for (const name of ['click_element', 'press_key', 'drag_element', 'fill_form', 'select_option']) {
    for (const prior of [undefined, {status: 'pending'}, {status: 'failed'}, {status: 'passed', checks: 1}]) {
      let task = {steps: [], ...(prior ? {verification: prior} : {})};
      task = taskReceipt(task, name, 'start');
      assert.equal(task.verification.status, 'pending');
      task = taskReceipt(JSON.parse(JSON.stringify(task)), name, 'end', {error: 'browser_stale', actionIssued: false});
      assert.deepEqual(task.verification, prior || {status: 'not_required'}, name);
      assert.equal(task.steps[0].status, 'error');
      assert.equal('verificationPrior' in task, false);
      assert.deepEqual(resumedVerification(task), prior ? {status: 'pending'} : null);
    }
    for (const actionIssued of [true, undefined, null, 0, 'false']) {
      let task = taskReceipt({steps: []}, name, 'start');
      task = taskReceipt(task, name, 'end', {error: 'browser_stale', actionIssued});
      assert.equal(task.verification.status, 'pending');
      assert.deepEqual(resumedVerification(task), {status: 'pending'});
    }
  }
  let coordinate = taskReceipt({steps: []}, 'click_at', 'start');
  coordinate = taskReceipt(coordinate, 'click_at', 'end', {error: 'browser_stale', actionIssued: false});
  assert.equal(coordinate.verification.status, 'pending');
});

test('repeated failures get an independent checkpoint before a corrected read and final review', async () => {
  let round = 0; const phases = [], executed = [];
  await runAgent({...options(), complete: async messages => {
    if (++round <= 2) return call('run_playwright', {code: 'return await page.evaluate(() => 1);'});
    if (round === 3) {assert.match(messages.at(-1).content, /Intermediate requirement review/); return call('read_page');}
    return done;
  }, execute: async name => {
    executed.push(name);
    return name === 'run_playwright' ? {error: 'script_api', actionIssued: false, observation: {text: '업무 안내'}} : {text: '업무 안내'};
  }, reviewGoal: async ({phase = 'final', evidence}) => {
    phases.push(phase);
    if (phase === 'checkpoint') {assert.equal(evidence.filter(item => !item.usable).length, 2); return {status: 'revise', next_step: '코드 실행 대신 read_page로 업무 안내를 읽으세요.'};}
    assert.equal(evidence.at(-1).tool, 'read_page'); return {status: 'complete'};
  }});
  assert.deepEqual(executed, ['run_playwright', 'run_playwright', 'read_page']);
  assert.deepEqual(phases, ['checkpoint', 'final']);
});

test('an intermediate blocked review asks a focused question before any further action', async () => {
  let round = 0; const executed = [];
  const result = await runAgent({...options(), complete: async () => {round++; return call('run_playwright', {code: 'return await page.title();'});},
    execute: async (name, args) => {executed.push(name); if (name === 'ask_user') {assert.equal(args.question, '두 신청서 중 어느 것을 확인할까요?'); return {requiresUserInput: true};} return {error: 'script_locator', actionIssued: false};},
    reviewGoal: async ({phase}) => {assert.equal(phase, 'checkpoint'); return {status: 'blocked', next_step: '두 신청서 중 어느 것을 확인할까요?'};}});
  assert(result.awaitingUser); assert.equal(round, 2); assert.deepEqual(executed, ['run_playwright', 'run_playwright', 'ask_user']);
});

test('an unavailable intermediate reviewer does not replay work or skip final review', async () => {
  let round = 0; const phases = [];
  await runAgent({...options(), complete: async () => ++round <= 2 ? call('read_page') : round === 3 ? call('browser_snapshot') : done,
    execute: async name => name === 'read_page' ? {error: 'page_changed'} : {text: '현재 페이지'},
    reviewGoal: async ({phase = 'final'}) => {phases.push(phase); if (phase === 'checkpoint') throw new Error('goal_review_failed'); return {status: 'complete'};}});
  assert.deepEqual(phases, ['checkpoint', 'final']);
});

test('optional source schemas stay discoverable without occupying every initial browser turn', () => {
  const optional = ['ask_openwiki', 'read_document', 'read_analysis_evidence', 'cancel_analysis'];
  const catalog = [...tools, ...[...optional, 'read_skill'].map(name => ({type: 'function', function: {name, description: name,
    parameters: {type: 'object', properties: {}}}}))];
  const h = createHarness(catalog);
  assert(optional.every(name => !names(h.advertised()).includes(name)));
  // A registered skill is how a request reaches its procedure: it is offered from the start.
  assert(names(h.advertised()).includes('read_skill'));
  assert(!names(createHarness(catalog, {inputBudget: 16000}).advertised()).includes('read_skill'));
  assert(names(h.advertised()).includes('verify_page'));
  assert.equal(h.select({groups: ['knowledge', 'documents', 'workflows', 'analysis']}).ok, true);
  assert(optional.every(name => names(h.advertised()).includes(name)));
  assert(!names(h.advertised()).includes('call_mcp_tool'), 'selection cannot grant an unavailable integration');
  h.select({groups: ['input'], replace: true});
  assert(optional.every(name => !names(h.advertised()).includes(name)));
  h.observe('read_document', {ok: true});
  assert(names(h.advertised()).includes('read_document'), 'permitted recalled source tools reactivate their group');
});

test('the selector names connected basics and lists only groups that still need selecting', () => {
  const normal = createHarness(tools).selector.function, lean = createHarness(tools, {inputBudget: 16000}).selector.function;
  assert.match(normal.description, /Already connected, do not select: navigation \(navigate_page/);
  const available = text => JSON.parse(/Available groups: (\{.*?\})\. No software/.exec(text)[1]);
  assert(!Object.keys(available(normal.description)).some(group => ['navigation', 'interaction', 'input'].includes(group)));
  assert(Object.keys(available(normal.description)).includes('scripts'));
  assert.doesNotMatch(lean.description, /Already connected/);
  assert(Object.keys(available(lean.description)).includes('navigation'));
  assert(normal.parameters.properties.groups.items.enum.includes('navigation'), 'a recalled selection of a connected group still validates');
});
