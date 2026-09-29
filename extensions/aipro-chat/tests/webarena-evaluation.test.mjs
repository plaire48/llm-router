import test from 'node:test';
import assert from 'node:assert/strict';
import {UPSTREAM, officialArtifactScore} from '../scripts/evaluate-webarena.mjs';
const result=(id,pass=true)=>({task_id:id,status:pass?'success':'failure',score:pass?1:0,webarena_verified_version:UPSTREAM.version,webarena_verified_evaluator_checksum:UPSTREAM.evaluator,webarena_verified_data_checksum:UPSTREAM.dataset});
test('official artifact results are not a verified Nubi run or certification',()=>{
 const report=officialArtifactScore([1,2],[result(1),result(2,false)]);
 assert.equal(report.artifactSuccessRate,0.5);assert.equal(report.agentRunVerified,false);assert.equal(report.nubiCapabilityScore,null);assert.equal(report.independentCertification,false);
});
test('official evidence rejects missing, duplicate, changed grader/dataset and inconsistent scores',()=>{
 for(const results of [[],[result(1),result(1)],[{...result(1),webarena_verified_version:'other'}],[{...result(1),webarena_verified_data_checksum:'other'}],[{...result(1),webarena_verified_evaluator_checksum:'other'}],[{...result(1),score:0}]])assert.throws(()=>officialArtifactScore([1],results));
 assert.throws(()=>officialArtifactScore([1,1],[result(1),result(1)]));
});
