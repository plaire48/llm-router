import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRoleHistory} from '../ui/analysis-history-state.mjs';
import {saveRoleProgress,restoreAnalysisHistory} from '../runtime/analysis-history.mjs';
const worker=(status='running',at='2026-09-25T01:00:00.000Z')=>({id:'old:0:worker',tool:'analysis_research',status,at,analysis:{calls:1,phase:'reading'}});
const group=entry=>({kind:'roles',id:'old',runId:'old',state:entry.status==='running'?'running':'interrupted',workers:[entry]});
const task=(trace,runId='old')=>({state:'running',checkpoint:{runId},trace});

test('persisted restart interruption cannot be revived by previous-run trace on resume',()=>{
  const map=new Map(),store={get:key=>map.has(key)?structuredClone(map.get(key)):undefined,set:(key,value)=>map.set(key,structuredClone(value)),list:prefix=>[...map].filter(([key])=>key.startsWith(prefix)).map(([,value])=>structuredClone(value))};
  saveRoleProgress(store,'task','old',worker());restoreAnalysisHistory(store);
  const records=store.list('analysis-history:');
  assert.equal(records[0].state,'interrupted');
  const merged=mergeRoleHistory(records,task([worker()],'new'));
  assert.equal(merged[0].state,'interrupted');assert.equal(merged[0].workers[0].status,'interrupted');
});

test('current-run timestamps advance live progress but stale or pending trace cannot regress retained terminal facts',()=>{
  const old=worker(),fresh={...worker('running','2026-09-25T02:00:00.000Z'),analysis:{calls:2,phase:'reading'}};
  assert.equal(mergeRoleHistory([group(old)],task([fresh]))[0].workers[0].analysis.calls,2);
  assert.equal(mergeRoleHistory([group(fresh)],task([old]))[0].workers[0].analysis.calls,2);
  assert.equal(mergeRoleHistory([group(worker('interrupted'))],task([fresh]))[0].workers[0].status,'interrupted');
  const untimed={...fresh};delete untimed.at;
  assert.equal(mergeRoleHistory([group(old)],task([untimed]))[0].workers[0].analysis.calls,1);
});

test('trace fallback preserves older responses without marking old pending work or a finished current worker active',()=>{
  assert.equal(mergeRoleHistory([],task([worker()],'new'))[0].state,'interrupted');
  assert.equal(mergeRoleHistory([],task([worker('done')]))[0].state,'complete');
  const noRun={state:'running',trace:[worker()]};
  assert.equal(mergeRoleHistory([],noRun)[0].state,'interrupted');
  assert.equal(mergeRoleHistory([],task([worker()]))[0].state,'running');
});
