import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator, parseAnalysisReport} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';
import {projectTools} from '../project-tools.js';
import {BUILTIN_SKILLS, browserTools} from '../skills.js';

const call = (name, args = {}) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const report = (ids = ['ev_1'], extra = {}) => ({content: JSON.stringify({status: ids.length ? 'complete' : 'partial', summary: '확인한 결과', findings: ids.length ? [{text: '화면의 담당 팀은 개발팀입니다.', evidence_ids: ids}] : [], uncertainties: [], next_step: '', ...extra})});
test('unresolved uncertainty downgrades complete while a normal next step does not', () => {
  const seen = new Set(['ev_1']);
  const partial = parseAnalysisReport(report(['ev_1'], {uncertainties:['  원문 확인 필요 ', '원문 확인 필요', '  ']}), seen);
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.uncertainties, ['원문 확인 필요']);
  const complete = parseAnalysisReport(report(['ev_1'], {uncertainties:[' ', '\n'], next_step:'확인한 요약을 메인에게 전달하세요.'}), seen);
  assert.equal(complete.status, 'complete');
  assert.deepEqual(complete.uncertainties, []);
  assert.equal(complete.next_step, '확인한 요약을 메인에게 전달하세요.');
});
const task = (role, evidence_ids = ['ev_1']) => ({role, task: '담당 팀을 확인하세요.', done_when: '실제 근거를 찾음', evidence_ids});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
function coordinator(t, options = {}) {
  const controller = options.controller || new AbortController();
  const value = createAnalysisCoordinator({signal: controller.signal, modelId: 'qwen3.8-27b', run: runAgent, tools: [], execute: async () => assert.fail('Browser writes are not available'), ...options});
  t.after(() => value.dispose());
  value.observe('read_page', {}, {text: '담당 팀 개발팀', documentId: 'document-1'});
  return value;
}

const readAndReport = async wire => wire.some(message => message.role === 'tool') ? report() : call('read_analysis_evidence', {evidence_id:'ev_1'});
test('recovery analysts receive frozen diagnostic evidence without live browser access', async t => {
  const value=coordinator(t,{complete:async (wire,tools)=>{
    assert.deepEqual(tools.map(t=>t.function.name),['read_analysis_evidence']);
    if(!wire.some(m=>m.role==='tool'))return call('read_analysis_evidence',{evidence_id:'ev_2'});
    assert.match(wire.at(-1).content,/503/);
    return report(['ev_2'],{findings:[{text:'Observed service failure requires fresh state verification, not write replay.',evidence_ids:['ev_2']}]});
  }});
  const payload={ok:true,events:[{kind:'network',status:503}]};
  assert.equal(value.observe('read_browser_diagnostics',{},payload),'ev_2');
  payload.events[0].status=200;
  await value.execute('delegate_analysis',{tasks:[task('recovery',['ev_2'])]});
  const result=(await value.collect()).results[0];
  assert.equal(result.report.status,'complete');assert.match(result.evidence[0].read_excerpt,/503/);
});
async function settled(value) {
  for(let i=0;i<200;i++) {
    if(value.status().every(job=>!['queued','running'].includes(job.status)))return;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('Analysts did not settle');
}

test('completed undelivered analysis keeps its evidence across observation eviction',async t=>{
  const value=coordinator(t,{complete:readAndReport});
  await value.execute('delegate_analysis',{tasks:[task('page')]});await settled(value);
  for(let i=0;i<60;i++)value.observe('read_page',{}, {text:`Later observation ${i}`});
  const result=(await value.collect()).results[0];
  assert.equal(result.report.status,'complete');assert.deepEqual(result.missing_evidence,[]);
  assert.equal(result.evidence[0].evidence_id,'ev_1');assert.match(result.evidence[0].read_excerpt,/개발팀/);
  assert.equal(result.evidence[0].stale,true,'Retention does not refresh browser evidence');
});

test('recollecting delivered analysis after evidence eviction cannot report complete',async t=>{
  const trace=[],value=coordinator(t,{complete:readAndReport,onStep:event=>trace.push(event)});
  const launched=await value.execute('delegate_analysis',{tasks:[task('page')]});
  const original=(await value.collect()).results[0];assert.equal(original.report.status,'complete');
  for(let i=0;i<60;i++)value.observe('read_page',{}, {text:`Later observation ${i}`});
  assert.equal((await value.execute('read_analysis_evidence',{evidence_id:'ev_1'})).error,'analysis_evidence_missing');
  const recalled=(await value.collect({task_ids:[launched.tasks[0].task_id]})).results[0];
  assert.equal(recalled.report.status,'partial');assert.deepEqual(recalled.report.findings,[]);
  assert.deepEqual(recalled.missing_evidence,['ev_1']);assert(recalled.report.uncertainties.length);
  assert.equal(trace.at(-1).analysis.outcome,'partial');
  assert.deepEqual(trace.at(-1).analysis.uncertainties,recalled.report.uncertainties);assert.equal(trace.at(-1).analysis.nextStep,recalled.report.next_step);
  trace.at(-1).analysis.uncertainties.push('UI mutation');assert.ok(!recalled.report.uncertainties.includes('UI mutation'));
  assert.equal(original.report.status,'complete','Earlier delivered snapshot remains immutable');
});

test('undelivered results occupy bounded slots until collection without restarting analysts',async t=>{
  let calls=0;const value=coordinator(t,{complete:async wire=>{calls++;return readAndReport(wire);}});
  const tasks=Array.from({length:6},(_,i)=>({...task('page'),task:`Analysis ${i}`}));
  const launched=await value.execute('delegate_analysis',{tasks});await settled(value);
  assert.equal(value.status().filter(job=>job.status==='done').length,6);
  assert.equal((await value.execute('delegate_analysis',{tasks:[{...task('page'),task:'New assignment'}]})).error,'analysis_busy');
  const reused=await value.execute('delegate_analysis',{tasks:[tasks[0]]});assert.equal(reused.tasks[0].task_id,launched.tasks[0].task_id);
  assert.equal(calls,12);
  assert.equal((await value.collect({wait:false})).results.length,6);
  assert.equal((await value.execute('delegate_analysis',{tasks:[{...task('page'),task:'New assignment'}]})).ok,true);
  await settled(value);assert.equal(calls,14);
});

test('partial recollection keeps surviving findings and every prior uncertainty',async t=>{
  const uncertainties=['예외 조건 확인 필요','원본 버전 확인 필요','추가 승인 기준 확인 필요'];
  const value=coordinator(t,{complete:async wire=>wire.some(m=>m.role==='tool')
    ? report(['ev_1'],{findings:[{text:'Old finding',evidence_ids:['ev_1']},{text:'Remaining finding',evidence_ids:['ev_2']}],uncertainties})
    : {calls:['ev_1','ev_2'].map(id=>({id,function:{name:'read_analysis_evidence',arguments:JSON.stringify({evidence_id:id})}}))}});
  value.observe('read_page',{}, {text:'Second source'});
  const launched=await value.execute('delegate_analysis',{tasks:[task('page',['ev_1','ev_2'])]});
  assert.equal((await value.collect()).results[0].report.status,'partial');
  for(let i=0;i<47;i++)value.observe('read_page',{}, {text:`Later ${i}`});
  const recalled=(await value.collect({task_ids:[launched.tasks[0].task_id]})).results[0];
  assert.equal(recalled.report.status,'partial');assert.deepEqual(recalled.missing_evidence,['ev_1']);
  assert.deepEqual(recalled.report.findings,[{text:'Remaining finding',evidence_ids:['ev_2']}]);
  assert.deepEqual(recalled.report.uncertainties,uncertainties);
});

test('isolated Pi analysts overlap and the first result returns before the second, with stale-page provenance', async t => {
  const gates = {page: deferred(), review: deferred()}, started = new Set(), counts = {}, trace = [], bothStarted = deferred();
  const value = coordinator(t, {onStep: event => trace.push(event), complete: async (wire, tools, scope) => {
    started.add(scope.role); counts[scope.role] = (counts[scope.role] || 0) + 1;
    if (started.size === 2) bothStarted.resolve();
    assert.deepEqual(tools.map(item => item.function.name), ['read_analysis_evidence']);
    assert.equal(wire.filter(message => message.role === 'system').length, 1);
    if (counts[scope.role] === 1) return call('read_analysis_evidence', {evidence_id: 'ev_1'});
    assert.match(wire.at(-1).content, /개발팀/);
    await gates[scope.role].promise;
    return report();
  }});
  const launched = await value.execute('delegate_analysis', {tasks: [task('page'), task('review')]});
  assert.equal(launched.tasks.length, 2);
  await bothStarted.promise;
  assert.deepEqual([...started].sort(), ['page', 'review']);
  const queued = await value.execute('delegate_analysis', {tasks: [task('recovery')]});
  assert.equal(queued.tasks[0].status, 'queued');
  await value.execute('cancel_analysis', {task_id: queued.tasks[0].task_id});
  assert.equal((await value.execute('delegate_analysis', {tasks: [task('page')]})).tasks[0].reused, true);
  value.observe('fill_form', {}, {applied: 1});
  gates.page.resolve();
  const first = await value.collect();
  assert.equal(first.results.length, 1); assert.equal(first.results[0].role, 'page');
  assert.equal(first.pending[0].role, 'review'); assert.equal(first.results[0].evidence[0].stale, true);
  assert.equal(first.results[0].advisory, true);
  assert(first.results[0].context.returned_characters < 1000);
  gates.review.resolve();
  assert.equal((await value.collect()).results[0].role, 'review');
  assert.equal((await value.collect()).results.length, 0);
  assert.equal((await value.execute('collect_analysis', {task_ids: [launched.tasks[0].task_id]})).results[0].role, 'page');
  assert.deepEqual(counts, {page: 2, review: 2});
  assert.equal(new Set(trace.filter(event => event.status === 'done').map(event => event.index)).size, 2);
  assert(trace.some(event => event.analysis?.delivered && event.analysis.summary));
});

test('a child cannot read unassigned evidence or acquire browser tools', async t => {
  let round = 0;
  const value = coordinator(t, {complete: async (wire, tools) => {
    assert(!JSON.stringify(wire).includes('UNRELATED_SECRET'));
    if (!tools.length) {round++; return report([], {uncertainties: ['The requested additional source was not read.']});}
    if (++round === 1) return call('read_analysis_evidence', {evidence_id: 'ev_2'});
    assert.match(wire.at(-1).content, round === 2 ? /analysis_evidence_missing/ : /tool_unavailable/);
    return call('click_element', {ref: 'guessed'});
  }});
  value.observe('read_page', {}, {text: 'UNRELATED_SECRET'});
  await value.execute('delegate_analysis', {tasks: [task('page')]});
  const result = await value.collect();
  assert.equal(result.ok, true);
  const item = result.results[0];
  assert.equal(item.report.status, 'partial'); assert.deepEqual(item.report.findings, []);
  assert.deepEqual(item.recovery, {reason: 'agent_stalled', method: 'model_handoff'});
  assert.deepEqual(item.evidence.map(source => source.evidence_id), ['ev_1']);
  assert(!JSON.stringify(item).includes('UNRELATED_SECRET')); assert.equal(round, 5);
});

test('a research child corrects a failed query and only returns the summary and evidence references', async t => {
  const reads = [], evidence = []; let round = 0;
  const value = coordinator(t, {tools: projectTools({status: 'connected', capabilities: ['wiki']}),
    onEvidence: (name, args, result) => evidence.push(result),
    execute: async (name, args) => {reads.push([name, args]); return args.query === 'missing' ? {error: 'project_not_found'} : {dataKind: 'project_reference', content: '개발팀'.repeat(2000), provenance: {path: 'guide.md', hash: 'a'.repeat(64)}};},
    complete: async (wire, tools) => {
      assert.deepEqual(tools.map(item => item.function.name), ['read_analysis_evidence', 'wiki_search', 'wiki_read']);
      if (++round === 1) return call('wiki_search', {query: 'missing'});
      if (round === 2) {assert.match(wire.at(-1).content, /project_not_found/); return call('wiki_search', {query: '담당 팀'});}
      const source = JSON.parse(wire.at(-1).content);
      assert.equal(source.provenance.path, 'guide.md');
      return report([source.evidence_id]);
    }});
  await value.execute('delegate_analysis', {tasks: [task('research', [])]});
  const item = (await value.collect()).results[0];
  assert.equal(item.status, 'done'); assert.equal(reads.length, 2);
  assert.equal(evidence.length, 2); assert.equal(item.evidence[0].provenance.path, 'guide.md');
  const {assignment, ...advice} = item;
  assert(JSON.stringify(advice).length < 1500);
  assert.equal(assignment.task, task('research', []).task);
  assert(JSON.stringify(assignment).length < 6000); assert(item.context.read_characters > 6000);
  assert(item.evidence[0].read_excerpt.length <= 320);
  assert(!JSON.stringify(item).includes('개발팀'.repeat(200)), 'Only a bounded original excerpt accompanies the summary');
});

test('invalid child citations trigger model correction without re-reading or replaying a tool', async t => {
  let round = 0;
  const value = coordinator(t, {complete: async wire => {
    if (++round === 1) return call('read_analysis_evidence', {evidence_id: 'ev_1'});
    if (round === 2) return report(['invented']);
    assert.match(wire.at(-1).content, /report was invalid/);
    assert.equal(wire.filter(message => message.role === 'tool').length, 1);
    return report();
  }});
  await value.execute('delegate_analysis', {tasks: [task('review')]});
  assert.equal((await value.collect()).results[0].status, 'done');
  assert.equal(round, 3);
  assert.throws(() => parseAnalysisReport(report(['invented']), new Set(['ev_1'])), /analysis_format/);
});

test('one failed analyst does not cancel another analyst or stop collection', async t => {
  const counts = {};
  const value = coordinator(t, {complete: async (wire, tools, scope) => {
    if (scope.role === 'review') throw new Error('unauthorized');
    counts.page = (counts.page || 0) + 1;
    return counts.page === 1 ? call('read_analysis_evidence', {evidence_id: 'ev_1'}) : report();
  }});
  await value.execute('delegate_analysis', {tasks: [task('page'), task('review')]});
  const results = [];
  while (value.hasUnreported()) results.push(...(await value.collect()).results);
  assert.equal(results.find(item => item.role === 'review').status, 'failed');
  assert.equal(results.find(item => item.role === 'page').status, 'done');
});

test('parent cancellation interrupts collection and ignores late child results', async t => {
  const controller = new AbortController(), gate = deferred(), trace = [];
  const value = coordinator(t, {controller, onStep: event => trace.push(event), complete: async () => {await gate.promise; return report([]);}});
  await value.execute('delegate_analysis', {tasks: [task('page')]});
  const collecting = value.collect(); controller.abort();
  await assert.rejects(collecting, /cancelled/);
  value.dispose(); gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert(!trace.some(event => event.status === 'done'));
  assert.equal(trace.at(-1).status, 'cancelled');
});

test('parent waits for outstanding advice and retains its own independent verification', async () => {
  const tool = name => ({type: 'function', function: {name, description: name, parameters: {type: 'object', properties: {}}}});
  let parentRound = 0, childRound = 0;
  const calls = [];
  const result = await runAgent({messages: [{role: 'user', content: 'PARENT_ONLY_HISTORY'}], tools: [tool('read_page')], signal: new AbortController().signal,
    execute: async name => {calls.push(name); return {text: '담당 팀 개발팀'};},
    completeAnalysis: async wire => {
      assert(!JSON.stringify(wire).includes('PARENT_ONLY_HISTORY'));
      return ++childRound === 1 ? call('read_analysis_evidence', {evidence_id: 'ev_1'}) : report();
    },
    complete: async wire => {
      if (++parentRound === 1) return call('read_page');
      if (parentRound === 2) {assert.match(wire.at(-1).content, /analysis_evidence_id/); return call('delegate_analysis', {tasks: [task('page')]});}
      if (parentRound === 3) return {content: 'Premature result'};
      assert.match(wire.at(-1).content, /Delegated analysis returned/);
      assert.match(wire.at(-1).content, /확인한 결과/);
      return {content: '검토 결과를 반영한 답변'};
    }});
  assert.equal(result.content, '검토 결과를 반영한 답변');
  assert.deepEqual(calls, ['read_page']); assert.equal(childRound, 2);
});

test('new child IDs do not disguise repeated failed analysis as progress', async () => {
  let parentRound = 0, childCalls = 0, questions = 0;
  const result = await runAgent({messages: [{role: 'user', content: '담당 팀을 확인해줘'}], tools: browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')),
    harness: true, signal: new AbortController().signal,
    completeAnalysis: async () => {childCalls++; throw new Error('analysis_format');},
    complete: async (wire, tools) => {
      if (tools.length === 1 && tools[0].function.name === 'ask_user') return call('ask_user', {question: '어느 안내의 담당 팀을 확인할까요?'});
      if (++parentRound === 1) return call('read_page');
      return parentRound % 2 === 0 ? call('delegate_analysis', {tasks: [task('page')]}) : call('collect_analysis');
    },
    execute: async name => {if (name === 'ask_user') {questions++; return {requiresUserInput: true};} assert.equal(name, 'read_page'); return {text: '담당 팀 개발팀'};},
  });
  assert.equal(childCalls, 1); assert.equal(questions, 1); assert.equal(result.awaitingUser, true);
});

test('six scoped assignments drain through two slots without redelegation and retain partial status', async t => {
  let active = 0, peak = 0;
  const events = [], firstTwo = deferred(), release = deferred(); let starts = 0;
  const value = coordinator(t, {onStep: event => events.push(event), complete: async (wire, tools, scope) => {
    if (wire.some(message => message.role === 'tool')) return report(['ev_1'], {status: 'partial'});
    active++; peak = Math.max(peak, active); if (++starts === 2) firstTwo.resolve();
    await release.promise; active--;
    return call('read_analysis_evidence', {evidence_id:'ev_1'});
  }});
  const assignments = Array.from({length:6}, (_, index) => ({...task('page'), task:`확인 항목 ${index}`}));
  await value.execute('delegate_analysis', {tasks:assignments}); await firstTwo.promise;
  assert.equal(value.status().filter(job => job.status === 'running').length,2);
  assert.equal(value.status().filter(job => job.status === 'queued').length,4);
  assert.equal((await value.execute('delegate_analysis',{tasks:[task('review')]})).error,'analysis_busy');
  release.resolve();
  const results=[]; while(value.hasUnreported()) results.push(...(await value.collect()).results);
  assert.equal(results.length,6); assert.equal(peak,2);
  assert(results.every(item=>item.report.status==='partial'));
  assert.equal(events.filter(event=>event.status==='queued').length,6);
  assert(events.some(event=>event.analysis?.phase==='reading'));
});

test('stop discards queued work without invoking its model or swallowing pending collection', async t => {
  const controller=new AbortController(), started=deferred(); let calls=0;
  const value=coordinator(t,{controller,complete:async(wire,tools,{signal})=>{
    if(++calls===2)started.resolve();
    await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
  }});
  await value.execute('delegate_analysis',{tasks:Array.from({length:6},(_,index)=>({...task('page'),task:`담당 ${index}`}))});
  await started.promise; const collecting=value.collect(); controller.abort();
  await assert.rejects(collecting,/cancelled/); await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls,2); assert(value.status().every(job=>job.status==='cancelled'));
});

test('cancelling a queued analyst wakes existing collectors before busy analysts finish', async t => {
  const busy = deferred(), started = deferred(), events = []; let calls = 0;
  const value = coordinator(t, {onStep: event => events.push(event), complete: async () => {
    if (++calls === 2) started.resolve();
    await busy.promise;
    return report([], {uncertainties: ['Still unverified.']});
  }});
  const {tasks} = await value.execute('delegate_analysis', {tasks: [task('page'), task('review'), task('recovery')]});
  await started.promise;
  const id = tasks[2].task_id;
  const collecting = value.collect({task_ids: [id]});
  // Also exercise the normal next-completed-result wait, not just ID lookup.
  const any = value.collect();
  await value.execute('cancel_analysis', {task_id: id});
  let timer;
  try {
    const result = await Promise.race([collecting, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('queued cancellation did not wake collection')), 150);
    })]);
    assert.equal(result.results[0].status, 'cancelled');
    assert.equal(result.ok, false);
    await any;
    assert.equal(calls, 2, 'cancelling queued work must not start a model');
    const count = events.filter(event => event.index === id).length;
    busy.resolve();
    await value.collect({task_ids: tasks.slice(0, 2).map(item => item.task_id)});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.equal(events.filter(event => event.index === id).length, count, 'draining the queue must not revive cancelled traces');
  } finally {clearTimeout(timer); busy.resolve(); await Promise.allSettled([collecting, any]);}
});

test('abandoning a non-consuming result wait preserves jobs and reports for later collection', async t => {
  const gate = deferred(), local = new AbortController();
  const value = coordinator(t, {complete: async wire => {await gate.promise; return readAndReport(wire);}});
  await value.execute('delegate_analysis', {tasks: [task('page')]});
  const waiting = value.waitForResults({signal: local.signal});
  local.abort(); await assert.rejects(waiting, /cancelled/);
  assert(value.status().every(job => !job.delivered && ['running', 'queued'].includes(job.status)));
  gate.resolve(); await value.waitForResults();
  assert(value.status().every(job => !job.delivered));
  const result = await value.collect({wait: false});
  assert.equal(result.results.length, 1); assert.equal(result.results[0].report.status, 'complete');
  assert.equal(value.hasUnreported(), false);
});
test('result waits reject both already-aborted waits and parent cancellation without consuming results', async t => {
  const controller = new AbortController(), value = coordinator(t, {controller, complete: async (_wire, _tools, {signal}) => {
    await new Promise((_, reject) => {if (signal.aborted) reject(Error('cancelled')); else signal.addEventListener('abort', () => reject(Error('cancelled')), {once: true});});
  }});
  await assert.rejects(value.waitForResults({signal: AbortSignal.abort()}), /cancelled/);
  await value.execute('delegate_analysis', {tasks: [task('page')]});
  const waiting = value.waitForResults(); controller.abort();
  await assert.rejects(waiting, /cancelled/);
  assert(value.status().every(job => !job.delivered));
});

test('analyst delivery emits one host receipt without treating findings as verification', async t => {
  const receipts=[];
  const value=coordinator(t,{complete:readAndReport,onDelivery:receipt=>receipts.push(receipt)});
  const launched=await value.execute('delegate_analysis',{tasks:[task('page')]});
  await value.collect();
  assert.equal(receipts.length,1);
  assert.equal(receipts[0].task_id,launched.tasks[0].task_id);
  assert.equal(receipts[0].status,'done');
  assert.equal(receipts[0].delivered,true);
  assert(receipts[0].calls>0 && receipts[0].reads>0);
  assert.equal(receipts[0].dataKind,'analysis_execution');
  assert.equal(Object.hasOwn(receipts[0],'findings'),false);
  await value.collect({task_ids:[launched.tasks[0].task_id]});
  assert.equal(receipts.length,1,'Recollection must not manufacture another executed assignment');
});
