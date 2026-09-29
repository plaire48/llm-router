import test from 'node:test';
import assert from 'node:assert/strict';
import {browserTasks30} from '../evaluation/browser-30.mjs';
import {assessEasyBrowser} from '../scripts/assess-easy-browser.mjs';
import {browserScore} from '../evaluation/browser-score.mjs';
const tasks = browserTasks30.filter(t => t.difficulty === 'easy');
function fixture() {
  const report = {candidateSha256:'a'.repeat(64), startedAt:'2026-09-27T00:00:00Z',
    plannedTaskIds:tasks.map(t=>t.id), status:'trials_recorded', trials:tasks.map(t=>({id:t.id,
      actualModel:true,modelValidResponses:1,status:'answered',answer:'Observed result',taskReview:'complete',
      plan:[{status:'completed'}],delivery:{taskStatus:'done',busy:false,answerVisible:true,planTotal:1,planCompleted:1,runningPlanIndicators:0}}))};
  const grades = {candidateSha256:report.candidateSha256,reportStartedAt:report.startedAt,
    grades:tasks.map(t=>({id:t.id,checks:t.checks.map(check=>({check,passed:true,evidence:['Independent recorded source']}))}))};
  return {report,grades};
}
test('easy target requires ten independent completions, never inherits the 80 percent target',()=>{
  const {report,grades}=fixture();
  assert.equal(assessEasyBrowser(report,grades).accepted,true);
  for(const t of report.trials.slice(-2)) t.status='timeout';
  const result=assessEasyBrowser(report,grades);
  assert.equal(result.score.total.passed,8);
  assert.equal(result.score.total.target.requiredPasses,10);
  assert.equal(result.accepted,false);
});
test('missing grades, unfinished plans and another candidate cannot satisfy easy acceptance',()=>{
  const {report,grades}=fixture();
  assert.equal(assessEasyBrowser(report).accepted,false);
  report.trials[0].plan[0].status='in_progress';
  assert.equal(assessEasyBrowser(report,grades).score.total.failed,1);
  assert.throws(()=>assessEasyBrowser(report,{...grades,candidateSha256:'b'.repeat(64)}),/identity_mismatch/);
  assert.throws(()=>assessEasyBrowser(report,{...grades,reportStartedAt:'another-run'}),/identity_mismatch/);
  assert.throws(()=>assessEasyBrowser({...report,plannedTaskIds:report.plannedTaskIds.slice(1)},grades),/identity_mismatch/);
  for(const targetRate of [0,1.1,NaN])assert.throws(()=>browserScore([],[],[],{targetRate}),/invalid_target_rate/);
});
