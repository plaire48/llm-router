import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationModel} from '../runtime/conversation-context.mjs';
import {outputTokens} from '../../nubi-office/worker/providers.mjs';
import {contextBudget} from '../../../extensions/aipro-chat/context-manager.js';

for (const model of [
  {id:'large',contextLength:262144,maxOutputTokens:32768},
  {id:'bounded-input',contextLength:524288,maxInputTokens:120000,maxOutputTokens:8192},
  {id:'small',contextLength:22000},
]) test(`a near-full ${model.id} request still has room for the provider's entire reply`,()=>{
  const requested=outputTokens({models:[model],model:model.id});
  const budget=contextBudget(conversationModel(model));
  assert.ok(budget.input+requested<=model.contextLength);
  if(model.maxInputTokens)assert.ok(budget.input<=model.maxInputTokens);
  assert.ok(requested>0);
});
