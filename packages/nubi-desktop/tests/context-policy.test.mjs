// The automatic summary trigger (user decision 2026-10-04): 75% of the whole model window for the models in use, and
// the shared conservative trigger below the compactor's large-window line, where the 75% left no room for one more
// tool result (found 2026-10-05: six compaction scenarios with 22,000-token windows paused with context_input_too_large).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationModel,CONTEXT_SUMMARY_RATIO,LARGE_WINDOW_INPUT_TOKENS} from '../context-policy.mjs';
import {contextBudget} from '../../../extensions/aipro-chat/context-manager.js';
import {contextMeterInfo} from '../ui/context-gauge.mjs';

test('a 262K model summarizes at 75% of its whole window, with the reply reserve kept apart',()=>{
  const model=conversationModel({id:'qwen3.8-27b',contextLength:262144});
  assert.equal(model.contextCompactionRatio,CONTEXT_SUMMARY_RATIO);assert.equal(model.maxInputTokens,262144-24576);
  const budget=contextBudget(model);assert.equal(budget.trigger,196608);assert.equal(budget.input,237568);
  assert.equal(contextMeterInfo({kind:'measured',used:1000,window:262144},model).compactLabel,'자동 요약 (75%)');
});
test('a small window keeps the conservative trigger, with room for one more tool result before the input limit',()=>{
  const model=conversationModel({id:'fixture',contextLength:22000});
  assert.equal(model.contextCompactionRatio,undefined);assert.equal(model.maxInputTokens,17904);
  const budget=contextBudget(model);assert.equal(budget.trigger,13428);assert.ok(budget.input-budget.trigger>=4000,'room between the trigger and the limit');
  const gauge=contextMeterInfo({kind:'measured',used:1000,window:22000},model);
  assert.equal(gauge.compactLabel,'자동 요약');assert.match(gauge.compactNote,/입력 제한을 먼저 보호/);
});
test('the line between the two policies is the compactor\'s own large-window line',()=>{
  assert.equal(LARGE_WINDOW_INPUT_TOKENS,128000);
  // The reserve of these windows is 15% (below the 24,576 default): 150,000 leaves 127,500 of input, 151,000 leaves 128,350.
  const below=conversationModel({contextLength:150000}),above=conversationModel({contextLength:151000});
  assert.equal(below.maxInputTokens,127500);assert.equal(below.contextCompactionRatio,undefined);
  assert.equal(above.maxInputTokens,128350);assert.equal(above.contextCompactionRatio,CONTEXT_SUMMARY_RATIO);
  assert.equal(conversationModel({}).contextCompactionRatio,CONTEXT_SUMMARY_RATIO,'an unknown window keeps the explicit ratio for the shared default');
  assert.throws(()=>conversationModel({contextLength:4096}),/context_input_too_large/);
});
