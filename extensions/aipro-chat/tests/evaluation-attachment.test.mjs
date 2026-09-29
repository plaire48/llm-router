import test from 'node:test';
import assert from 'node:assert/strict';
import {validEvaluationAttachment} from '../scripts/evaluation-attachment.mjs';
const task={id:'E-08',environment:'public-live',readOnly:true};
const input=()=>({attachment:{status:'harness_interrupted',candidateSha256:'candidate-A',evaluatorSha256:'a'.repeat(64),publicReadCapture:{allowedPages:['https://search.naver.com/search.naver']},trials:[{id:'E-08',status:'harness_interrupted'},{id:'E-07',status:'answered'}]},reuseProfile:true,candidateSha256:'candidate-A',plannedTaskIds:['E-08'],publicReadPages:['https://search.naver.com/search.naver'],suite30:true,fixtureApprovals:false,selectedTasks:[task],freshAfterInterruption:true});
test('fresh attachment allows only interrupted public read-only tasks on the exact saved candidate',()=>{
  assert(validEvaluationAttachment(input()));
  for(const patch of [{candidateSha256:'candidate-B'},{freshAfterInterruption:false},{plannedTaskIds:['E-07']},{publicReadPages:['https://other.test/']},{fixtureApprovals:true},{selectedTasks:[{...task,readOnly:false}]},{reuseProfile:false}]) assert(!validEvaluationAttachment({...input(),...patch}));
});
test('the original login-only attachment does not accept executed or interrupted trials',()=>{
  const value=input();value.freshAfterInterruption=false;value.attachment={...value.attachment,status:'login_not_completed',trials:[],plannedTaskIds:['E-08']};
  assert(validEvaluationAttachment(value));
  value.attachment.trials=[{id:'E-08',status:'answered'}];assert(!validEvaluationAttachment(value));
});
test('repeat uses a separate trial only for an entirely recorded read-only suite on the same candidate',()=>{
  const v=input();v.freshAfterInterruption=false;v.repeatRecorded=true;
  v.attachment={...v.attachment,status:'trials_recorded',plannedTaskIds:['E-08'],trials:[{id:'E-08',status:'answered'}]};
  assert(validEvaluationAttachment(v));
  for(const patch of [{candidateSha256:'different'},{freshAfterInterruption:true},{plannedTaskIds:['E-07']},
    {selectedTasks:[{...task,readOnly:false}]},{attachment:{...v.attachment,status:'interrupted'}},
    {attachment:{...v.attachment,trials:[{id:'E-08',status:'awaiting_user'}]}},
    {attachment:{...v.attachment,trials:[{id:'E-08',status:'timeout',stopConfirmed:false}]}}])
    assert(!validEvaluationAttachment({...v,...patch}));
  v.attachment.trials=[{id:'E-08',status:'timeout',stopConfirmed:true}];
  assert(validEvaluationAttachment(v));
});
