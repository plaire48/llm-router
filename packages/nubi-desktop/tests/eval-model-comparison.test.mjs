import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareModels} from '../eval/compare-models.mjs';
function run(model){
  const candidate={hash:'same',files:1},row={id:'case',trial:1,outcome:'passed',state:'review',answerCharacters:4,answer:'done',modelCalls:2,delegatedCalls:1};
  return {manifest:{model,candidate,caseHash:'cases',computerHash:'computer',appsHash:'apps',corpora:{fixture:'hash'},limits:{calls:80},computerLimits:{calls:80},platform:'darwin',node:'v24',tools:'auto',trials:1,cases:['case'],computer:['app']},completion:{stable:true,finishedAt:'now'},
    agent:{kind:'desktop-live-model-evaluation',model,candidate,tools:'auto',results:[row]},computer:{kind:'desktop-computer-evaluation',model,candidate,tools:'auto',results:[{...row,id:'app'}]}};
}
test('different models compare only with identical candidates, cases and limits',()=>{
  const report=compareModels(run('luna'),run('sol'));
  assert.equal(report.models[0].agent.passed,1);assert.equal(report.rows.length,2);
  for(const field of ['caseHash','computerHash','appsHash','limits','computerLimits','corpora','tools']){
    const changed=run('sol');changed.manifest[field]='different';assert.throws(()=>compareModels(run('luna'),changed),/comparison_/);
  }
});
test('partial trials, duplicate results, source drift and wrong model labels refuse comparison',()=>{
  for(const mutate of [r=>r.agent.results.pop(),r=>r.agent.results.push(r.agent.results[0]),r=>r.completion.stable=false,r=>r.agent.model='other',r=>r.computer.results[0].outcome='not_run',r=>delete r.manifest.caseHash]){
    const changed=run('sol');mutate(changed);assert.throws(()=>compareModels(run('luna'),changed),/comparison_/);
  }
});
test('ready is not a pass and reduced-window tasks remain separate',()=>{
  const a=run('luna'),b=run('sol');
  a.agent.results[0].reducedWindow=22000;b.agent.results[0].reducedWindow=22000;
  a.computer.results[0]={...a.computer.results[0],outcome:'failed',reviewStatus:'ready'};
  const report=compareModels(a,b);
  assert.equal(report.models[0].agent.total,0);assert.equal(report.models[0].stress.passed,1);
  assert.equal(report.models[0].computer.passed,0);assert.equal(report.models[0].computer.falseCompletion,1);
});
