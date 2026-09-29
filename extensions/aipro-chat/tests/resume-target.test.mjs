import test from 'node:test';
import assert from 'node:assert/strict';
import {needsBrowserResume, assertResumeTarget, pauseTask, resumeMessage} from '../context-state.js';

test('browser continuation requires a bound or explicitly connected tab, not an active-tab fallback', () => {
  for (const task of [{page:{url:'https://work.test'}}, {steps:[{tool:'read_page',status:'done'}]}, {steps:[],pendingReconciliation:{version:2,unverifiable:true}}]) {
    assert(needsBrowserResume(task));
    for (const id of [undefined,null,-1,'12',NaN]) assert.throws(()=>assertResumeTarget(task,id),/resume_page_required/);
    assert.doesNotThrow(()=>assertResumeTarget(task,12));
    assert.doesNotThrow(()=>assertResumeTarget(task,undefined,24));
  }
});
test('document, Wiki and MCP-only continuation does not inspect an unrelated browser page', () => {
  for (const tool of ['ask_documents','ask_openwiki','read_document','source_search','read_source','wiki_read','update_plan','call_mcp_tool','apply_approved_mcp','delegate_analysis']) {
    const task={steps:[{tool,status:'done'}]};
    assert.equal(needsBrowserResume(task),false,tool); assert.doesNotThrow(()=>assertResumeTarget(task));
  }
});
test('target rejection leaves the original goal, plan and uncertain receipt intact', () => {
  const task=pauseTask({goal:'초안을 작성하고 보내지 마세요',steps:[{tool:'fill_form',status:'running'}],plan:[{text:'입력 확인',status:'in_progress'}],pendingReconciliation:{version:2,unverifiable:true}});
  const before=structuredClone(task);
  assert.throws(()=>assertResumeTarget(task),/resume_page_required/);
  assert.deepEqual(task,before); assert(resumeMessage(task).content.includes(before.goal));
});
