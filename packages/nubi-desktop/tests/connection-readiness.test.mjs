import test from 'node:test';
import assert from 'node:assert/strict';
import {protectMailDirectory} from '../runtime/mail-directory.mjs';
import {prepareWorkPlan,parseWorkPlan} from '../runtime/work-plan.mjs';

test('company folder ACL uses process SID and never removes inheritance after a failed grant',async()=>{
 const calls=[];const execute=async(command,args)=>{calls.push([command,args]);return {stdout:'"CORP\\user","S-1-5-21-123-456-789-1001"'};};
 await protectMailDirectory('C:\\mail',{platform:'win32',execute});
 assert.equal(calls[1][1][2],'*S-1-5-21-123-456-789-1001:(OI)(CI)F');assert.equal(calls[2][1][1],'/inheritance:r');
 let count=0;await assert.rejects(protectMailDirectory('C:\\mail',{platform:'win32',execute:async(...args)=>{if(++count===2)throw Error('denied');return execute(...args);}}),/mail_storage_permission/);assert.equal(count,2);
});
test('a single JSON fence is accepted as data while surrounding text, tools and invalid constraints remain refused',async()=>{
 assert.deepEqual(parseWorkPlan('```json\n{"steps":[]}\n```'),{steps:[]});
 assert.throws(()=>parseWorkPlan('explanation\n```json\n{}\n```'));
 const plan={intent:{goal:'위키 확인',constraints:[],outcomes:['출처와 결과'],workflowIds:[],skillPaths:[]},steps:[{text:'위키 읽기',expected_outcome:'관련 원문 확인',status:'in_progress'}]};
 const args={task:{request:'위키를 확인해줘'},history:[],model:{contextLength:32000},capabilities:{workflows:[],skills:[]},signal:new AbortController().signal};
 const result=await prepareWorkPlan({...args,invoke:async()=>({content:'```json\n'+JSON.stringify(plan)+'\n```',calls:[]})});assert.equal(result.intent.goal,'위키 확인');
 await assert.rejects(prepareWorkPlan({...args,invoke:async()=>({content:JSON.stringify({...plan,intent:{...plan.intent,workflowIds:'invalid'}})})}),e=>e.message==='work_plan_invalid'&&e.planningDiagnostic.attempts===2);
});
