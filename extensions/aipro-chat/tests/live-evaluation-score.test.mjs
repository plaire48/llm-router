import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationRepeats,liveEvaluationScore} from '../scripts/live-evaluation-score.mjs';
test('live evaluation requires every planned trial and preserves failures and duplicates',()=>{
 const report={actualModel:true,repeats:3,plannedTasks:['a','b'],cases:[{id:'a',trial:1,modelResponses:1,modelRequests:1,passed:true}]};
 assert.equal(liveEvaluationScore(report).score,null);
 report.cases=report.plannedTasks.flatMap(id=>[1,2,3].map(trial=>({id,trial,modelResponses:1,modelRequests:1,passed:true})));
 report.cases[0].passed=false;assert.equal(liveEvaluationScore(report).score,83);
 assert.equal(liveEvaluationScore({...report,actualModel:false}).score,null);
 report.cases.push(report.cases[1]);assert.equal(liveEvaluationScore(report).score,null);
 assert.equal(liveEvaluationScore({repeats:3}).score,null);
});
test('repeated trials have an explicit bounded evaluation budget',()=>{
 assert.equal(evaluationRepeats(),3);for(const input of ['0','6','NaN','2.1'])assert.throws(()=>evaluationRepeats(input));
});
test('reliability separates one success from all repeated attempts succeeding',()=>{
 const report={actualModel:true,repeats:3,plannedTasks:['a','b'],cases:['a','b'].flatMap(id=>[1,2,3].map(trial=>({id,trial,modelResponses:1,modelRequests:1,passed:id==='a'||trial===1})))};
 const {metrics}=liveEvaluationScore(report);
 assert.equal(metrics.passAt1,4/6);assert.equal(metrics.passAtK,1);assert.equal(metrics.passPowerK,0.5);
 assert.equal(liveEvaluationScore({...report,cases:report.cases.slice(0,-1)}).metrics.passPowerK,null);
 assert.equal(liveEvaluationScore(report).officialBenchmarkScore,null);
});
test('unexpected failed trials and duplicate planned tasks invalidate rather than inflate the score',()=>{
 const report={actualModel:true,repeats:1,plannedTasks:['a'],cases:[{id:'a',trial:1,modelResponses:1,modelRequests:1,passed:true}]};
 for(const invalid of [{...report,cases:[...report.cases,{id:'a',trial:2,passed:false}]},{...report,cases:[...report.cases,{id:'unknown',trial:1,passed:false}]},{...report,plannedTasks:['a','a']}])assert.equal(liveEvaluationScore(invalid).score,null);
 assert.throws(()=>liveEvaluationScore({...report,repeats:0}));
});

test('live scores require a validated model response for every trial, including failures',()=>{
 const report={actualModel:true,repeats:1,plannedTasks:['a'],cases:[{id:'a',trial:1,passed:false,modelRequests:1,modelResponses:0}]};
 assert.equal(liveEvaluationScore(report).score,null);assert.equal(liveEvaluationScore(report).unverifiedTrials,1);
 report.cases[0].modelResponses=1;assert.equal(liveEvaluationScore(report).score,0);
 report.cases[0].modelResponses=2;assert.equal(liveEvaluationScore(report).score,null);
 delete report.cases[0].modelResponses;assert.equal(liveEvaluationScore(report).score,null);
});
