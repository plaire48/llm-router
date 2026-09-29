import test from 'node:test';
import assert from 'node:assert/strict';
import {modelExecutionTiming} from '../evaluation/browser-latency.mjs';
const event = (round, phase, at, scope = 'execution') => ({kind:'model', round, phase, at, scope});

test('overlapping workers count effort separately from wall time and preserve phase', () => {
  const timing = modelExecutionTiming([event(1,'start',0), {...event(2,'start',10,'analysis'), inputCharacters:50},
    event(2,'finish',30),event(1,'finish',40),event(3,'start',60,'review'),event(3,'finish',70)]);
  assert.equal(timing.totalMs,70);
  assert.equal(timing.activeWallMs,50);
  assert.equal(timing.scopes.analysis.totalMs,20);
  assert.equal(timing.scopes.analysis.inputCharacters,50);
  assert.equal(timing.scopes.review.totalMs,10);
});

test('unclosed and malformed pairs stay partial, never become zero-cost successful calls', () => {
  const timing = modelExecutionTiming([event(1,'start',0),event(1,'start',5),event(1,'finish',10),
    event(2,'start',20),event(3,'finish',30),{kind:'tool',at:40}]);
  assert.equal(timing.completed,1);
  assert.equal(timing.totalMs,10);
  assert.equal(timing.pending,1);
  assert.equal(timing.unmatchedFinishes,1);
  assert.equal(timing.duplicateStarts,1);
  assert.equal(timing.coverage,'partial');
});

test('legacy events retain unknown phase without fabricating measurements', () => {
  const timing = modelExecutionTiming([event(1,'finish',20,null),event(1,'start',10,null)]);
  assert.equal(timing.scopes.unknown.completed,1);
  assert.equal(timing.scopes.unknown.measuredInputs,0);
  assert.equal(timing.activeWallMs,10);
  assert.equal(timing.inputSizes.measuredInputs,0);
  assert.equal(timing.inputSizes.missingInputs,1);
  assert.equal(timing.inputSizes.imageInputCharacters,null);
});

test('completed measurements sum versioned text, image and schema separately from duration and legacy counts', () => {
  const split = {inputSizeVersion:1,inputCharacters:100,textInputCharacters:30,imageInputCharacters:60,schemaCharacters:10};
  const timing = modelExecutionTiming([{...event(1,'start',0),...split},event(1,'finish',10),
    {...event(2,'start',1,'analysis'),...split,imageInputCharacters:0,textInputCharacters:90},event(2,'finish',20),
    {...event(3,'start',30),inputCharacters:500},event(3,'finish',40)]);
  assert.equal(timing.scopes.execution.inputCharacters,600);
  assert.equal(timing.inputSizes.measuredInputs,2); assert.equal(timing.inputSizes.missingInputs,1);
  assert.equal(timing.inputSizes.textInputCharacters,120);
  assert.equal(timing.inputSizes.imageInputCharacters,60);
  assert.equal(timing.inputSizes.schemaCharacters,20);
  assert.equal(timing.scopes.analysis.inputSizes.imageInputCharacters,0);
  assert.equal(timing.inputSizes.unit,'json_utf16_code_units');
});

test('invalid size partitions and unknown versions remain unmeasured rather than creating a fake split', () => {
  const valid = {inputSizeVersion:1,inputCharacters:100,textInputCharacters:30,imageInputCharacters:60,schemaCharacters:10};
  const invalid = [{...valid,inputSizeVersion:2}, {...valid,imageInputCharacters:-1}, {...valid,textInputCharacters:31},
    {...valid,schemaCharacters:null}, {...valid,imageInputCharacters:60.5}];
  const timing = modelExecutionTiming(invalid.flatMap((size,i)=>[{...event(i,'start',i*10),...size},event(i,'finish',i*10+5)]));
  assert.equal(timing.inputSizes.measuredInputs,0); assert.equal(timing.inputSizes.missingInputs,invalid.length);
  assert.equal(timing.inputSizes.textInputCharacters,null); assert.equal(timing.inputSizes.imageInputCharacters,null);
});
