import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisToolDefinitions, createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';
import {projectTools} from '../project-tools.js';

const call = (name, args = {}) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const report = (id, overrides = {}) => ({content: JSON.stringify({status: 'complete', summary: '마감일 확인', findings: [{text: '마감일은 10월 8일입니다.', evidence_ids: [id]}], uncertainties: [], next_step: '', ...overrides})});
const task = (id, extra = {}) => ({role: 'page', task: '안내의 마감일 확인', done_when: '마감일의 근거 확보', evidence_ids: [id], ...extra});
const pair = (id, name, result) => [{role: 'assistant', content: '', tool_calls: [{id, type: 'function', function: {name, arguments: '{}'}}]}, {role: 'tool', tool_call_id: id, content: JSON.stringify(result)}];
function setup(t, options = {}) {
  const value = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'QWEN3.8-27B-FP8-256K', run: runAgent,
    execute: async () => assert.fail('The child has no browser writer'), ...options});
  t.after(() => value.dispose());
  return value;
}

test('partial and blocked reports cannot cite a failed lookup as a factual finding', async t => {
  for (const status of ['partial', 'blocked']) {
    let rounds = 0;
    const value = setup(t, {complete: async () => ++rounds === 1
      ? call('read_analysis_evidence', {evidence_id: 'ev_1'})
      : report('ev_1', {status, summary: 'UNSUPPORTED_DATE'})});
    const id = value.observe('read_page', {}, {error: 'page_permission'});
    await value.execute('delegate_analysis', {tasks: [task(id)]});
    const item = (await value.collect()).results[0];
    assert.deepEqual(item.report.findings, []);
    assert.equal(item.report.status, 'partial');
    assert.equal(item.recovery.reason, 'analysis_format');
    assert.equal(item.evidence[0].source_status, 'error');
    assert(!JSON.stringify(item.report).includes('UNSUPPORTED_DATE'));
  }
});

test('a child budgets advertised tool schemas before sending and hands off without reads when they do not fit', async t => {
  let calls = 0;
  const tools = projectTools({status: 'connected', capabilities: ['wiki']});
  tools[0].function.description += 'SCHEMA_DETAIL '.repeat(1500);
  const value = setup(t, {tools, complete: async (wire, advertised) => {
    calls++; assert.deepEqual(advertised, []);
    assert(!JSON.stringify(wire).includes('SCHEMA_DETAIL'));
    return {content: JSON.stringify({status: 'partial', summary: '자료를 읽지 못했습니다.', findings: [], uncertainties: ['조회 미실행'], next_step: '범위를 줄여 확인하세요.'})};
  }});
  await value.execute('delegate_analysis', {tasks: [task('', {role: 'research', evidence_ids: [], effort: 'quick'})]});
  const item = (await value.collect()).results[0];
  assert.equal(calls, 1); assert.equal(item.report.status, 'partial');
  assert.equal(item.context.read_characters, 0);
  assert(item.context.peak_input_characters <= item.context.allocation.characters);
});

test('child input accounting includes exactly the schemas advertised on each model call', async t => {
  let measured = 0, calls = 0;
  const value = setup(t, {complete: async (wire, tools) => {
    measured += JSON.stringify({messages: wire, tools}, (key, value) => key === 'image_url' ? '[image]' : value).length;
    return ++calls === 1 ? call('read_analysis_evidence', {evidence_id: 'ev_1'}) : report('ev_1');
  }});
  const id = value.observe('read_page', {}, {text: '마감일은 10월 8일입니다.'});
  await value.execute('delegate_analysis', {tasks: [task(id)]});
  const item = (await value.collect()).results[0];
  assert.equal(item.context.input_characters, measured);
  assert.equal(item.report.status, 'complete');
});

test('native observations are opt-in frozen evidence with stale history, never extra child executors',async t=>{
  const tools=['observe_computer','read_computer_result'].map(name=>({type:'function',function:{name,parameters:{type:'object',properties:{}}}}));
  assert.equal(setup(t,{tools}).observe('observe_computer',{}, {observationId:'first'}),null);
  const value=setup(t,{tools,observationSources:{observe_computer:'live',read_computer_result:'historical',unregistered:'live'}});
  const first=value.observe('observe_computer',{}, {observationId:'first',elements:[]});
  assert.equal((await value.execute('read_analysis_evidence',{evidence_id:first})).stale,false);
  value.observe('observe_computer',{}, {observationId:'second',elements:[]});
  assert.equal((await value.execute('read_analysis_evidence',{evidence_id:first})).stale,true);
  const saved=value.observe('read_computer_result',{}, {receipt:{state:'observed'}});
  const packet=await value.execute('read_analysis_evidence',{evidence_id:saved});assert.equal(packet.kind,'computer');assert.equal(packet.historical,true);assert.equal(packet.requires_fresh_check,true);
  assert.equal(value.observe('unregistered',{}, {}),null);
});

test('quick analysis reserves a partial handoff after two investigative decisions', async t => {
  let calls = 0;
  const value = setup(t, {complete: async (wire, tools) => {
    calls++;
    if (tools.length) return call('read_analysis_evidence', {evidence_id: 'ev_1', offset: calls - 1});
    assert.match(wire.at(-1).content, /partial/);
    return report('ev_1');
  }});
  const id = value.observe('read_page', {}, {text: '마감일은 10월 8일입니다.'});
  await value.execute('delegate_analysis', {tasks: [task(id, {effort: 'quick'})]});
  const result = (await value.collect()).results[0];
  assert.equal(calls, 3); assert.equal(result.report.status, 'partial');
  assert.equal(result.effort, 'quick');
});

test('large old reads become retrievable references while current evidence, receipts and original history remain intact', async t => {
  const value = setup(t);
  const wire = [{role: 'system', content: 'One system prompt'}, {role: 'user', content: '초안만 작성하고 등록하지 마세요.'}];
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const result = {frames: [{text: `Observation ${i}: ` + '분석에 필요한 상세 자료 '.repeat(1200)}]};
    const id = value.observe('read_page', {}, result); ids.push(id);
    wire.push(...pair(`read-${i}`, 'read_page', {...result, analysis_evidence_id: id}));
  }
  wire.push(...pair('write', 'fill_form', {applied: 1, actionIssued: true, verified: false}), ...pair('failure', 'read_page', {error: 'page_permission'}));
  const original = structuredClone(wire);
  const packed = value.prepareContext?.(wire) || wire;
  const cleared = packed.filter(m => m.role === 'tool' && JSON.parse(m.content).contextCleared);
  assert.equal(cleared.length, 3);
  assert(JSON.stringify(packed).length < JSON.stringify(wire).length * .55);
  assert.deepEqual(packed.slice(-6), wire.slice(-6));
  assert.deepEqual(wire, original);
  assert.equal(packed[1].content, '초안만 작성하고 등록하지 마세요.');
  const source = await value.execute('read_analysis_evidence', {evidence_id: ids[0]});
  assert.match(source.text, /Observation 0/);
  assert.equal(packed.length, wire.length, 'Call/result pairing must not change');
});

test('failed project reads cannot establish a complete research report', async t => {
  let rounds = 0, reads = 0;
  const value = setup(t, {tools: projectTools({status: 'connected', capabilities: ['wiki']}),
    execute: async () => {reads++; return {error: 'project_not_found'};},
    complete: async wire => {
      if (++rounds === 1) return call('wiki_read', {id: 'missing.md'});
      const result = JSON.parse(wire.findLast(message => message.role === 'tool').content);
      return report(result.evidence_id);
    }});
  await value.execute('delegate_analysis', {tasks: [task('', {role: 'research', evidence_ids: []})]});
  const result = (await value.collect()).results[0];
  assert.equal(reads, 1);
  assert.equal(result.report.status, 'partial');
  assert.deepEqual(result.report.findings, []);
  assert.equal(result.recovery.reason, 'analysis_format');
  assert.equal(result.evidence[0].source_status, 'error');
});

test('reports include small excerpts from actually read ranges, not unread matching text', async t => {
  let rounds = 0;
  const value = setup(t, {complete: async () => ++rounds === 1 ? call('read_analysis_evidence', {evidence_id: 'ev_1', query: '마감일'}) : report('ev_1')});
  value.observe('read_page', {}, {text: '별도 내용 '.repeat(6000) + '\n마감일은 10월 8일입니다.\n' + '기타 내용 '.repeat(6000)});
  await value.execute('delegate_analysis', {tasks: [task('ev_1')]});
  const result = (await value.collect()).results[0];
  assert.match(result.evidence[0].read_excerpt || '', /마감일은 10월 8일/);
  assert(result.evidence[0].read_excerpt.length <= 320);
  assert(result.evidence[0].read_ranges[0].start > 10000);
  assert.equal(result.evidence[0].source_status, 'observed');
});

test('missing, truncated, visual and failed sources plus action receipts keep their original payload', async t => {
  const value = setup(t), wire = [];
  const variants = [
    ['missing', 'read_page', {text: 'not cached '.repeat(5000)}],
    ['truncated', 'read_page', {text: 'too large '.repeat(23000)}],
    ['image', 'read_page', {text: 'visual '.repeat(5000), image: {mimeType: 'image/png', data: 'AA=='}}],
    ['failed', 'read_page', {text: 'failed read '.repeat(5000), error: 'page_permission'}],
    ['write', 'fill_form', {text: 'write receipt '.repeat(5000), applied: 1, actionIssued: true}],
  ];
  for (const [label, name, result] of variants) {
    const id = label === 'missing' ? 'ev_missing' : value.observe(name, {}, result);
    wire.push(...pair(label, name, {...result, analysis_evidence_id: id}));
  }
  for (let i = 0; i < 3; i++) {
    const result = {text: `current ${i}: ` + 'detail '.repeat(1000)};
    wire.push(...pair(`current-${i}`, 'read_page', {...result, analysis_evidence_id: value.observe('read_page', {}, result)}));
  }
  const packed = value.prepareContext(wire);
  assert.deepEqual(packed.slice(0, variants.length * 2), wire.slice(0, variants.length * 2));
  assert.equal(packed.filter(message => message.role === 'tool' && JSON.parse(message.content).contextCleared).length, 1);
  value.dispose();
  assert.deepEqual(value.prepareContext(wire), wire, 'Unavailable run-local originals cannot be cleared');
});

test('a research child changes a failed lookup before returning successfully observed facts', async t => {
  const paths = []; let rounds = 0;
  const value = setup(t, {tools: projectTools({status: 'connected', capabilities: ['wiki']}),
    execute: async (_, args) => {paths.push(args.id); return args.id === 'missing.md' ? {error: 'project_not_found'} : {content: '마감일은 10월 8일입니다.'};},
    complete: async wire => {
      if (++rounds === 1) return call('wiki_read', {id: 'missing.md'});
      const result = JSON.parse(wire.findLast(message => message.role === 'tool').content);
      if (rounds === 2) {
        assert.equal(result.error, 'project_not_found'); assert.equal(result.source_status, 'error');
        return call('wiki_read', {id: 'observed-guide.md'});
      }
      assert.equal(result.source_status, 'observed'); return report(result.evidence_id);
    }});
  await value.execute('delegate_analysis', {tasks: [task('', {role: 'research', evidence_ids: []})]});
  const result = (await value.collect()).results[0];
  assert.equal(result.status, 'done'); assert.equal(result.report.status, 'complete');
  assert.deepEqual(paths, ['missing.md', 'observed-guide.md']);
  assert(result.evidence.every(source => source.source_status === 'observed'));
});

test('recovery may diagnose a failed operation without certifying the requested browser outcome', async t => {
  let rounds = 0;
  const value = setup(t, {complete: async () => ++rounds === 1 ? call('read_analysis_evidence', {evidence_id: 'ev_1'}) : report('ev_1', {
    summary: '읽기 권한 확인 필요', findings: [{text: '페이지 읽기에 필요한 권한이 없습니다.', evidence_ids: ['ev_1']}], next_step: '주 실행기가 페이지 권한 상태를 확인합니다.',
  })});
  const id = value.observe('read_page', {}, {error: 'page_permission'});
  await value.execute('delegate_analysis', {tasks: [task(id, {role: 'recovery', effort: 'quick'})]});
  const result = (await value.collect()).results[0];
  assert.equal(result.report.status, 'complete'); assert.equal(result.advisory, true);
  assert.equal(result.evidence[0].source_status, 'error');
  assert.equal(result.evidence[0].source_error, 'page_permission');
});

test('one successful finding cannot hide another finding supported only by a failed lookup', async t => {
  let rounds = 0;
  const value = setup(t, {complete: async () => {
    rounds++;
    if (rounds <= 2) return call('read_analysis_evidence', {evidence_id: `ev_${rounds}`});
    return report('ev_1', {findings: [
      {text: '마감일은 10월 8일입니다.', evidence_ids: ['ev_1']},
      {text: '장소는 서울입니다.', evidence_ids: ['ev_2']},
    ]});
  }});
  const first = value.observe('read_page', {}, {text: '마감일은 10월 8일입니다.'});
  const failed = value.observe('read_page', {}, {error: 'page_permission'});
  await value.execute('delegate_analysis', {tasks: [task(first, {evidence_ids: [first, failed]})]});
  const result = (await value.collect()).results[0];
  assert.equal(result.report.status, 'partial'); assert.deepEqual(result.report.findings, []);
  assert.equal(result.recovery.reason, 'analysis_format');
  assert.deepEqual(result.evidence.map(item => item.source_status), ['observed', 'error']);
});

test('one observed citation cannot conceal a failed citation in the same finding', async t => {
  let rounds = 0;
  const value = setup(t, {complete: async () => {
    rounds++;
    if (rounds <= 2) return call('read_analysis_evidence', {evidence_id: `ev_${rounds}`});
    return report('ev_1', {findings: [{text: '두 출처가 모두 마감일을 확인합니다.', evidence_ids: ['ev_1', 'ev_2']}]});
  }});
  const observed = value.observe('read_page', {}, {text: '마감일은 10월 8일입니다.'});
  const failed = value.observe('read_page', {}, {error: 'page_permission'});
  await value.execute('delegate_analysis', {tasks: [task(observed, {evidence_ids: [observed, failed]})]});
  const result = (await value.collect()).results[0];
  assert.equal(result.report.status, 'partial');
  assert.deepEqual(result.report.findings, []);
  assert.equal(result.recovery.reason, 'analysis_format');
  assert.deepEqual(result.evidence.map(item => item.source_status), ['observed', 'error']);
});

test('two captured browser sources run as isolated concurrent reads without browser access', async t => {
  const description = analysisToolDefinitions().find(tool => tool.function.name === 'delegate_analysis').function.description;
  assert.match(description, /first capture each source/);
  assert.match(description, /Children cannot open a new page/);
  let entered = 0, concurrent = 0, peak = 0, release;
  const both = new Promise(resolve => {release = resolve;});
  const value = setup(t, {tools: [{type: 'function', function: {name: 'read_page'}}],
    complete: async (wire, childTools) => {
      assert.deepEqual(childTools.map(item => item.function.name), ['read_analysis_evidence']);
      const assignment = JSON.parse(wire[1].content);
      const id = assignment.evidence[0].evidence_id;
      if (!wire.some(message => message.role === 'tool')) return call('read_analysis_evidence', {evidence_id: id});
      concurrent++; peak = Math.max(peak, concurrent);
      if (++entered === 2) release();
      let timeout;
      try {await Promise.race([both, new Promise((_, reject) => {timeout = setTimeout(() => reject(Error('parallel_read_timeout')), 1000);})]);}
      finally {clearTimeout(timeout);}
      concurrent--;
      const packet = JSON.parse(wire.findLast(message => message.role === 'tool').content);
      assert.equal(packet.evidence_id, id);
      return report(id, {summary: `동결 근거 ${id} 확인`});
    }});
  const first = value.observe('read_page', {source: 'A'}, {text: '첫 출처의 관찰 내용'});
  const second = value.observe('read_page', {source: 'B'}, {text: '둘째 출처의 관찰 내용'});
  const launched = await value.execute('delegate_analysis', {tasks: [task(first), task(second)]});
  assert.equal(launched.tasks.length, 2);
  const results = await Promise.all(launched.tasks.map(async item => (await value.collect({task_ids: [item.task_id]})).results[0]));
  assert.equal(peak, 2);
  assert.deepEqual(results.map(item => item.report.status), ['complete', 'complete']);
  assert.deepEqual(results.map(item => item.evidence.map(source => source.evidence_id)), [[first], [second]]);
});

test('a deep allocation can continue across several distinct source ranges and returns a bounded handoff', async t => {
  let rounds = 0;
  const value = setup(t, {complete: async (wire, tools) => {
    rounds++;
    if (tools.length) return call('read_analysis_evidence', {evidence_id: 'ev_1', offset: (rounds - 1) * 4000});
    assert(JSON.stringify(wire).length <= 48000);
    return report('ev_1');
  }});
  const id = value.observe('read_page', {}, {text: '서로 다른 범위의 안내 '.repeat(10000)});
  const bad = await value.execute('delegate_analysis', {tasks: [task(id, {effort: 'unbounded'})]});
  assert.equal(bad.error, 'analysis_scope'); assert.equal(rounds, 0);
  await value.execute('delegate_analysis', {tasks: [task(id, {effort: 'deep'})]});
  const result = (await value.collect()).results[0];
  assert(rounds > 6 && rounds <= 10); assert.equal(result.report.status, 'partial');
  assert(result.context.peak_input_characters <= 48000); assert.equal(result.context.usage.total_tokens, null);
});

test('the Pi parent really sends compact reads and can retrieve an old source without rerunning a page read', async () => {
  let round = 0, reads = 0, childCalls = 0; const wires = [], full = [];
  const readPage = {type: 'function', function: {name: 'read_page', description: 'Read', parameters: {type: 'object', properties: {section: {type: 'number'}}}}};
  const answer = await runAgent({modelId: 'QWEN3.8-27B-FP8-256K', signal: new AbortController().signal,
    messages: [{role: 'system', content: 'Rules'}, {role: 'user', content: '자료만 비교하고 등록하지 마세요.'}], tools: [readPage],
    completeAnalysis: async () => {childCalls++; assert.fail('Simple evidence retrieval needs no child model');},
    // The production context manager receives the compact wire at this seam.
    prepareContext: wire => {wires.push(structuredClone(wire)); return wire;},
    execute: async (_, args) => {
      reads++; const result = {text: `section ${args.section} MARIGOLD-${args.section} ` + '서로 다른 안내 자료 '.repeat(1200)};
      full.push(result); return result;
    },
    complete: async wire => {
      if (++round <= 5) return call('read_page', {section: round});
      assert.equal(wire.filter(message => message.role === 'system').length, 1);
      assert(wire.some(message => message.content === '자료만 비교하고 등록하지 마세요.'));
      if (round === 6) {
        const cleared = wire.filter(message => message.role === 'tool' && JSON.parse(message.content).contextCleared);
        assert.equal(cleared.length, 3);
        return call('read_analysis_evidence', {evidence_id: 'ev_1', query: 'MARIGOLD-1'});
      }
      const source = JSON.parse(wire.findLast(message => message.role === 'tool').content);
      assert.equal(source.evidence_id, 'ev_1'); assert.match(source.text, /MARIGOLD-1/);
      return {content: '자료를 비교했습니다.'};
    }});
  assert.equal(answer.content, '자료를 비교했습니다.'); assert.equal(reads, 5); assert.equal(childCalls, 0);
  assert.equal(wires.length, 7); assert(full[0].text.length > 10000);
});
