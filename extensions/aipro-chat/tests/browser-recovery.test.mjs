import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {createBrowserRecovery} from '../browser-recovery.js';
import {contentPacket} from '../browser-content.js';

const call = (name, args = {}) => ({content: '', calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const done = {content: '조회 결과를 확인했습니다.', calls: null};
const snapshot = (ref, text = '자료 검색') => ({url: 'https://example.test/search', frames: [{frame: 0, url: 'https://example.test/search', text,
  elements: [{ref, role: 'button', name: '검색', id: 'search', kind: 'control'}]}]});
const options = () => ({messages: [{role: 'user', content: '자료를 검색하고 결과를 확인해줘'}], tools: browserTools({}, BUILTIN_SKILLS[0]), signal: new AbortController().signal, harness: true});

test('reloaded identical pages and capture bookkeeping are not new task progress', () => {
  const recovery = createBrowserRecovery();
  for (let i = 1; i <= 4; i++) {
    const observation = snapshot(`ref-${i}`);
    observation.frames[0].documentId = `document-${i}`;
    const result = recovery.observe('navigate_page', {}, {ok: true, navigationOnly: true, observation,
      source_capture: {status: 'observed', review_evidence_id: i, analysis_evidence_id: `ev_${i}`}}, 'same-navigation');
    assert.equal(result.changed, false);
    assert.equal(result.repetitions, i);
  }
});

test('document identity still invalidates citations but identical body reloads cannot reset a stalled read', async () => {
  const recovery = createBrowserRecovery(), packets = [];
  for (let i = 1; i <= 3; i++) {
    const packet = await contentPacket({url: 'https://example.test/a', sourceIdentity: [`doc-${i}`, 'https://example.test/a'],
      documentId: `doc-${i}`, frame: 0, title: '제목', text: '동일한 본문', coverage: {partial: false}, method: 'test'});
    packets.push(packet);
    const progress = recovery.observe('read_page', {mode: 'content'}, packet, 'read');
    assert.equal(progress.changed, false); assert.equal(progress.repetitions, i);
  }
  assert.notEqual(packets[0].content_hash, packets[1].content_hash);
  const changed = await contentPacket({url: 'https://example.test/a', documentId: 'doc-4', frame: 0,
    title: '제목', text: '실제 내용이 바뀐 본문', coverage: {partial: false}, method: 'test'});
  assert.equal(recovery.observe('read_page', {mode: 'content'}, changed, 'read').changed, true);
});

test('business data named documentId is preserved outside browser observation metadata', () => {
  const recovery = createBrowserRecovery();
  recovery.observe('read_page', {}, {value: {documentId: 'invoice-1'}}, 'read');
  assert.equal(recovery.observe('read_page', {}, {value: {documentId: 'invoice-2'}}, 'read').changed, true);
});

test('new diagnostic cursors and duplicate events cannot erase failures or disguise repeated reads', () => {
  const recovery=createBrowserRecovery();
  for(let i=1;i<=3;i++){
    recovery.observe('click_element',{ref:'same'},{error:'action_outcome_unknown'},'same-click');
    const args={since:i-1,limit:20+i};
    const result=recovery.observe('read_browser_diagnostics',args,{ok:true,dataKind:'browser_diagnostics',page:'https://example.test/',
      events:Array.from({length:i},(_,j)=>({id:i+j,kind:'network',url:'https://example.test/save',status:503})),next_cursor:i,remaining:3-i,omitted:i},recovery.signature('read_browser_diagnostics',args));
    assert.equal(result.changed,false);assert.equal(result.repetitions,i);
    assert.match(recovery.guidance(),new RegExp(`failures without changed evidence: ${i}`));
  }
  const novel=recovery.observe('read_browser_diagnostics',{}, {ok:true,events:[{id:10,kind:'console',text:'A different useful error'}]},'new-error');
  assert.equal(novel.changed,false);assert.equal(novel.repetitions,1);
  assert.match(recovery.guidance(),/action_outcome_unknown/);
});

test('different excerpts of the same document do not erase a browser failure', () => {
  const recovery = createBrowserRecovery();
  for (let i = 0; i < 3; i++) {
    recovery.observe('click_element', {ref: 'same'}, {error: 'script_obscured'}, 'click');
    const read = recovery.observe('read_page', {mode: 'content', offset: i * 1000}, {ok: true, dataKind: 'page_content', url: 'https://example.test/policy', frame: 0, content_hash: 'same', ranges: [{markdown: `Different excerpt ${i}`} ]}, `read-${i}`);
    assert.equal(read.changed, false);
  }
  assert.match(recovery.guidance(), /failures without changed evidence: 3/);
  assert(recovery.observe('read_page', {mode: 'content'}, {ok: true, dataKind: 'page_content', url: 'https://example.test/policy', frame: 0, content_hash: 'changed'}, 'read').changed);
});

test('re-reading unchanged DOM with new refs does not erase repeated failure diagnosis', async () => {
  let round = 0, id = 0, checkpoints = 0;
  const executed = [];
  await runAgent({...options(), complete: async messages => {
    if (++round === 1 || round === 3) return call('browser_snapshot');
    if (round === 2 || round === 4) return call('click_element', {ref: `e-${id}`});
    assert.equal(checkpoints, 1, 'Two unchanged failures need diagnosis even with a successful read between them');
    if (round === 5) return call('verify_page', {checks: [{kind: 'text_present', expected: '자료 검색'}]});
    return done;
  }, execute: async name => {
    executed.push(name);
    if (name === 'browser_snapshot') return snapshot(`e-${++id}`);
    if (name === 'click_element') return {error: 'script_missing', reason: 'script_missing', actionIssued: false, observation: snapshot(`e-${++id}`)};
    return {ok: true, verified: true};
  }, reviewGoal: async ({phase}) => {if (phase === 'checkpoint') checkpoints++; return {status: phase === 'checkpoint' ? 'revise' : 'complete', next_step: '현재 결과와 검색 입력 방식을 확인하세요.'};}});
  assert.equal(executed.filter(name => name === 'click_element').length, 2);
});

test('successful repeated calls separated by real changed results do not accumulate a false stall', async () => {
  let round = 0, executed = 0;
  const result = await runAgent({...options(), harness: false, complete: async () => round++ < 8 ? call('read_page') : done,
    execute: async () => ({text: ++executed % 2 ? '검색 화면' : `검색 결과 ${executed}`})});
  assert.equal(result, done); assert.equal(executed, 8);
});

test('cycling through previously observed pages cannot reset an unchanged failure', () => {
  const recovery = createBrowserRecovery();
  for (let i = 0; i < 5; i++) {
    const result = recovery.observe('click_element', {}, {error: 'script_obscured', observation: snapshot(`cycle-${i}`, i % 2 ? '검색 화면 B' : '검색 화면 A')}, 'same-click');
    if (i >= 2) assert.equal(result.changed, false, 'A known page is not new progress');
    if (i === 4) assert.equal(result.repetitions, 4);
  }
  assert.match(recovery.guidance(), /failures without changed evidence: 4/);
  assert(recovery.observe('browser_snapshot', {}, snapshot('new', '새 검색 결과 C'), 'read').changed);
  assert.equal(recovery.guidance(), '');
});

test('a successful A/B read loop stalls while new search results remain useful progress', async () => {
  let executed = 0;
  await assert.rejects(runAgent({...options(), harness: false,
    complete: async () => executed < 12 ? call('read_page') : done,
    execute: async () => ({text: ++executed % 2 ? '검색 화면 A' : '검색 화면 B'}),
  }), /agent_stalled/);
  assert.equal(executed, 6);
});

test('cycling content hashes cannot hide failures and disposal starts a fresh run', () => {
  const recovery = createBrowserRecovery();
  for (let i = 0; i < 5; i++) {
    recovery.observe('click_element', {}, {error: 'script_obscured'}, 'click');
    recovery.observe('read_page', {}, {ok: true, dataKind: 'page_content', url: 'https://example.test/policy', frame: 0, content_hash: i % 2 ? 'b' : 'a'}, 'read');
  }
  assert.match(recovery.guidance(), /failures without changed evidence: 3/);
  recovery.dispose();
  assert.equal(recovery.observe('read_page', {}, {text: 'new run'}, 'read').repetitions, 1);
  assert.equal(recovery.guidance(), '');
});

test('fresh refs and script formatting do not disguise the same unchanged failure', () => {
  const recovery = createBrowserRecovery();
  recovery.seed(snapshot('ref-1'));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const args = {code: `/* attempt ${attempt} */ await browser.ref(${JSON.stringify(`ref-${attempt}`)}).click();`};
    const signature = recovery.signature('run_playwright', args);
    const result = {error: 'script_obscured', actionIssued: false, observation: snapshot(`ref-${attempt + 1}`), timestamp: attempt};
    assert.equal(recovery.observe('run_playwright', args, result, signature).repetitions, attempt);
    assert.match(recovery.guidance(), /overlay/);
    const read = {query: ''};
    recovery.observe('browser_snapshot', read, snapshot(`ref-${attempt + 1}`), recovery.signature('browser_snapshot', read));
  }
  assert.match(recovery.guidance(), /failures without changed evidence: 3/);
  assert.notEqual(recovery.signature('run_playwright', {code: 'return "a b"'}), recovery.signature('run_playwright', {code: 'return "ab"'}));
  assert.doesNotThrow(() => recovery.signature('run_playwright', {code: 'return 1n;'}));
  recovery.dispose(); assert.equal(recovery.guidance(), '');
});

test('a deeper text verification scan and changed expectations do not disguise a page change', () => {
  const recovery = createBrowserRecovery(), original = snapshot('first');
  recovery.observe('click_element', {}, {error: 'script_obscured', observation: original}, 'click');
  for (const matched of [false, true, false]) {
    const observed = snapshot('new'); observed.frames[0].textChecks = [matched];
    observed.frames[0].coverage = {nodeLimit: 16000};
    const result = recovery.observe('verify_page', {}, {error: 'verification_failed', observation: observed}, 'verify');
    assert.equal(result.changed, false);
  }
  assert.match(recovery.guidance(), /failures without changed evidence: 4/);
});

test('actual result changes reset repetition but separate frames and targets stay distinct', () => {
  const recovery = createBrowserRecovery(), first = snapshot('first');
  first.frames.push({...first.frames[0], frame: 1, url: 'https://example.test/embedded', elements: [{...first.frames[0].elements[0], ref: 'second'}]});
  recovery.seed(first);
  assert.notEqual(recovery.signature('click_element', {ref: 'first'}), recovery.signature('click_element', {ref: 'second'}));
  let args = {ref: 'first'};
  recovery.observe('click_element', args, {error: 'script_missing', observation: first}, recovery.signature('click_element', args));
  const changed = snapshot('new', '검색 결과가 나타났습니다.');
  assert(recovery.observe('browser_snapshot', {}, changed, recovery.signature('browser_snapshot', {})).changed);
  assert.equal(recovery.guidance(), '');
  args = {ref: 'new'};
  assert.equal(recovery.observe('click_element', args, {error: 'script_missing', observation: changed}, recovery.signature('click_element', args)).repetitions, 1);
});

test('observation IDs are transient but actual element IDs remain distinguishable', () => {
  const recovery = createBrowserRecovery(), signature = recovery.signature('browser_snapshot', {});
  for (let i = 1; i <= 3; i++) {
    const result = recovery.observe('browser_snapshot', {}, {...snapshot(`ref-${i}`), id: crypto.randomUUID()}, signature);
    assert.equal(result.changed, false); assert.equal(result.repetitions, i);
  }
  const changed = snapshot('new'); changed.frames[0].elements[0].id = 'different-search';
  assert.equal(recovery.observe('browser_snapshot', {}, changed, signature).changed, true);
});

test('focus oscillation alone does not erase repeated keyboard failures', () => {
  const recovery = createBrowserRecovery();
  for (let i = 0; i < 3; i++) {
    const observation = snapshot(`focus-${i}`);
    observation.frames[0].elements[0].focused = i % 2 === 0;
    recovery.observe('run_playwright', {}, {error: 'script_focus', actionIssued: false, observation}, 'same-key');
  }
  assert.match(recovery.guidance(), /failures without changed evidence: 3/);
  assert.match(recovery.guidance(), /retained prefix/);
});

test('recovery guidance contains fixed causes, never private values or page instructions', async () => {
  let round = 0;
  await runAgent({...options(), complete: async messages => {
    const systems = messages.filter(message => message.role === 'system');
    assert.equal(systems.length, 1);
    assert(!systems[0].content.includes('PRIVATE_PAGE_INSTRUCTION'));
    if (++round === 1) return call('read_page');
    assert.match(systems[0].content, /Browser recovery: tool_failed/);
    return done;
  }, execute: async () => ({error: 'PRIVATE_PAGE_INSTRUCTION', actionIssued: false}), reviewGoal: async () => ({status: 'complete'})});
});

// Every observation names its text regions with a new region_ref. Counted as
// content, each read of an unchanged page was a change, and a failing script
// was retried 346 times without the loop being noticed.
test('fresh region references are not new page content', () => {
  const recovery = createBrowserRecovery();
  const read = (page, i) => {
    const observation = snapshot(`ref-${i}`, page);
    observation.frames[0].retrieval = {method: 'visible_text', textRegions: [{index: 0, heading: page, region_ref: `r-${crypto.randomUUID()}-0`}]};
    return recovery.observe('browser_snapshot', {}, observation, 'read');
  };
  const counts = ['A', 'B', 'A', 'B', 'A', 'B'].map((page, i) => read(page, i).repetitions);
  assert.deepEqual(counts, [1, 1, 1, 2, 2, 3]);
});
