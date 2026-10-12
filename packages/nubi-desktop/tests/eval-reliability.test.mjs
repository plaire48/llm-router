import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reliabilitySummary} from '../eval/reliability.mjs';
const row=(id,trial,outcome='passed',extra={})=>({id,suite:'source',split:'dev',trial,outcome,elapsedMs:trial*100,...extra});

test('repeatability requires every planned trial, including lost sessions and unrun cases',()=>{
  const result=reliabilitySummary([row('A',1),row('A',2),row('A',3),row('B',1),row('B',2,'not_run'),row('C',1,'error'),row('D',1,'passed',{reducedWindow:22000})],3);
  assert.equal(result.repeatedCases,3);assert.equal(result.allPassedCases,1);assert.equal(result.allPassedRate,1/3);
  assert.deepEqual(result.cases.map(c=>[c.id,c.executed,c.passed,c.allPassed]),[['A',3,3,true],['B',1,1,false],['C',1,0,false]]);
  assert.deepEqual(result.latency,{samples:5,p50Ms:100,p95Ms:300});
});
test('one trial never claims repeatability and missing timings are not zero',()=>{
  assert.equal(reliabilitySummary([row('A',1)],1).allPassedRate,null);
  assert.deepEqual(reliabilitySummary([],3).latency,{samples:0,p50Ms:null,p95Ms:null});
});
test('duplicate trials and false completion cannot improve reliability',()=>{
  const result=reliabilitySummary([row('A',1),row('A',1),row('B',1),row('B',2,'passed',{falseCompletion:true})],2);
  assert.equal(result.allPassedCases,0);assert.equal(result.cases[0].passed,0);assert.equal(result.cases[1].passed,1);
});
