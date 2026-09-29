import assert from 'node:assert/strict';
import {runAgent} from '../../agent-runtime.js';
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});

export async function actionPressure({tools, execute, operation = 'click_element', args = {ref: 'observed-target'}, steer = false, deadlineMs = 15000}) {
  const controller = new AbortController(), events = [], received = new Set();
  let release, rounds = 0, attempts = 0, children = 0, recoveryCalls = 0, ready = false, changed = false, timer;
  const gate = new Promise(resolve => {release = resolve;});
  const deadline = setTimeout(() => controller.abort(), deadlineMs);
  const tasks = Array.from({length: 6}, (_, i) => ({role: 'page', effort: 'quick', task: `source-${i + 1}`, evidence_ids: ['ev_1'], done_when: 'Cite the observed page'}));
  try {
    const result = await runAgent({messages: [{role: 'user', content: '관찰한 메뉴를 확인하세요. 제출하지 마세요.'}], tools,
      signal: controller.signal, onStep: event => events.push(event),
      takeInput: async () => {if (!steer || !ready || changed) return null; changed = true; return {text: '메뉴를 열지 말고 현재 화면만 설명하세요.'};},
      complete: async wire => {
        const text = JSON.stringify(wire);
        for (const match of text.matchAll(/report-(\d+)/g)) received.add(Number(match[1]));
        if (++rounds === 1) return call('read_page');
        if (rounds === 2) return call('delegate_analysis', {tasks});
        if (rounds === 3) assert.equal(events.filter(event => event.tool === 'analysis_page' && event.status === 'queued').length, 6, text);
        if (rounds <= 4) return call(operation, args);
        if (rounds === 5) {
          if (steer) {assert(changed, 'Correction must be read while waiting for queue capacity'); release();}
          else {assert.equal(events.filter(event => event.tool === 'analysis_recovery' && event.status === 'queued').length, 1); assert(text.includes('Inspect the current overlay'));
            return call('read_page', {query: '메뉴'});}
        }
        assert(rounds < 12); return {content: '현재 화면만 설명합니다.'};
      }, execute: async (name, input) => {
        const result = await execute(name, input);
        if (name === operation && ++attempts === 2) timer = setTimeout(() => {ready = true; if (!steer) release();}, 30);
        return result;
      }, completeAnalysis: async (wire, childTools) => {
        children++; assert.deepEqual(childTools.map(tool => tool.function.name), ['read_analysis_evidence']);
        const brief = JSON.parse(wire[1].content), id = brief.evidence[0].evidence_id;
        if (brief.task.startsWith('source-')) await gate;
        else {assert(!steer); recoveryCalls++;}
        if (!brief.evidence_reads?.length && !wire.some(message => message.role === 'tool')) return call('read_analysis_evidence', {evidence_id: id});
        if (!brief.task.startsWith('source-')) assert.match(JSON.stringify(wire), /script_(obscured|missing)/);
        return {content: JSON.stringify({status: 'complete', summary: brief.task.startsWith('source-') ? `report-${brief.task.match(/\d+/)[0]}` : 'Inspect the current overlay',
          findings: [{text: '현재 관찰을 확인했습니다.', evidence_ids: [id]}], uncertainties: [], next_step: '새 화면을 읽고 대상을 확인하세요.'})};
      }});
    assert.equal(attempts, 2, 'Recovery must not replay a failed action');
    assert.equal(received.size, 6, 'All sibling reports must reach the leader');
    if (steer) assert.equal(recoveryCalls, 0);
    else {assert(recoveryCalls >= 1 && recoveryCalls <= 2); assert.equal(events.filter(event => event.tool === 'analysis_recovery' && event.status === 'queued').length, 1);}
    assert.equal(result.content, '현재 화면만 설명합니다.');
    return {attempts, reports: received.size, recoveryCalls, children, rounds, changed};
  } finally {release(); clearTimeout(timer); clearTimeout(deadline);}
}
