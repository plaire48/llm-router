import test from 'node:test';
import assert from 'node:assert/strict';
import {QUALITY_AREAS, qualityScorecard} from '../scripts/quality-scorecard.mjs';

test('quality scorecard never promotes partial or duplicate evidence into a passing score', () => {
  const report = {stages: [{name: 'form-workflow-browser-1', status: 'passed', exitCode: 0, timedOut: false}]};
  const card = qualityScorecard(report);
  assert.equal(card.areas[0].passed, 1);
  assert.equal(card.areas[0].missing, 5);
  assert.equal(card.areas[0].score, null);
  assert.equal(card.complete, false);
  assert.equal(card.modelCapabilityScore, null);
  report.stages.push(report.stages[0]);
  assert.equal(qualityScorecard(report).areas[0].passed, 0);
});

test('a failed repeated trial remains failed even if later trials pass', () => {
  const stages = QUALITY_AREAS.flatMap(area => area.suites.flatMap(suite => [1, 2, 3].map(round => ({name: `${suite}-${round}`, status: 'passed', exitCode: 0, timedOut: false}))));
  stages[0].status = 'failed';
  const card = qualityScorecard({status: 'failed', stages});
  assert.equal(card.complete, true);
  assert.equal(card.areas[0].failed, 1);
  assert.equal(card.areas[0].score, 83);
  assert.equal(card.gatesPassed, false);
  assert.equal(card.liveAccountVerified, false);
});

test('synthetic regressions cannot produce a product maturity or official benchmark score',()=>{
 const stages=[...['unit','design','candidate-build'].map(name=>({name,status:'passed',exitCode:0,timedOut:false})),...QUALITY_AREAS.flatMap(area=>area.suites.flatMap(suite=>[1,2,3].map(round=>({name:`${suite}-${round}`,status:'passed',exitCode:0,timedOut:false}))))];
 const report={status:'passed',evidence:{actualBrowser:true,actualModel:false},stages};
 const card=qualityScorecard(report);
 assert.equal(card.verificationMaturityScore,undefined);
 assert.equal(card.modelCapabilityScore,null);
 assert.equal(card.gatesPassed,true);
 assert.equal(qualityScorecard({...report,stages:[...stages,{name:'unit',status:'failed'}]}).gatesPassed,false);
});

test('contradictory process evidence cannot earn passing trial or gate credit',()=>{
 for(const extra of [{exitCode:1,timedOut:false},{exitCode:0,timedOut:true},{exitCode:0,timedOut:false,signal:'SIGTERM'}]){
  const stages=['unit','design','candidate-build','form-workflow-browser-1'].map(name=>({name,status:'passed',...extra}));
  const card=qualityScorecard({status:'passed',stages});
  assert.equal(card.gatesPassed,false,JSON.stringify(extra));assert.equal(card.areas[0].passed,0,JSON.stringify(extra));assert.equal(card.areas[0].failed,1);
 }
});
test('missing process evidence is unverified and a failed source report cannot pass gates',()=>{
 const missing=qualityScorecard({status:'passed',stages:[{name:'form-workflow-browser-1',status:'passed'}]});
 assert.equal(missing.areas[0].passed,0);assert.equal(missing.areas[0].missing,6);
 const stages=['unit','design','candidate-build'].map(name=>({name,status:'passed',exitCode:0,timedOut:false}));
 assert.equal(qualityScorecard({status:'failed',stages}).gatesPassed,false);
});
