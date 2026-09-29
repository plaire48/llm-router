import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCase} from '../eval/driver.mjs';
import {gradeCase} from '../eval/grade.mjs';
import {pinCorpus} from '../eval/pin-corpus.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';

const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','eval','corpus-src','order-service');
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:200000,maxOutputTokens:4096}]});
const plan={intent:{goal:'요청 처리',constraints:[],outcomes:['결과를 전달한다'],workflowIds:[],skillPaths:[]},steps:[{text:'자료 확인',expected_outcome:'근거를 확인한다',status:'in_progress'},{text:'결과 전달',expected_outcome:'결과를 전달한다',status:'pending'}]};
// Planner and reviewer replies are fixed; `actor` scripts the main agent only.
const scripted=actor=>({status,dispose(){},async complete(messages,tools,signal){
  if(messages[0].content.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify(plan),calls:[]};
  if(messages[0].content.startsWith(REVIEW_PROMPT))return {content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[]};
  const last=messages.findLast(message=>message.role==='tool');
  return actor({messages,tools,signal,result:last?JSON.parse(last.content):null});
}});
async function setup(t){
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-driver-test-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const corpusDirectory=path.join(base,'pinned');await pinCorpus('order-service',{directory:corpusDirectory,corpora:{'order-service':{source,include:['.']}}});
  return {parent:base,corpusDirectory};
}
const base={id:'T1-fixture',title:'검사',suite:'wiki',split:'dev',corpus:'order-service',request:'제주 추가 배송비가 얼마야?',expect:{state:'review'}};
const changePlan=path=>({summary:'추가 요금 변경',requirements:[{id:'R1',text:'추가 요금을 5000원으로 바꾼다'}],targets:[{path,reason:'현재 값',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'배송비 검사'}],assumptions:[]});
const editFlow=(file,oldText,newText)=>{let round=0,hash;return ({result})=>{
  switch(round++){
    case 0:return call('read_source',{path:file});
    case 1:hash=result.hash;return call('record_change_plan',changePlan(file));
    case 2:return call('propose_patch',{path:file,expectedHash:hash,edits:[{oldText,newText}],reason:'요청 반영'});
    default:return {content:'수정안을 준비했습니다. 실행 검증은 하지 않았습니다.',calls:[]};
  }};};

test('a question case returns the answer, the transcript and measured costs',async t=>{
  const options=await setup(t);let round=0;
  const result=await runCase({...options,testCase:base,providers:scripted(()=>round++===0?call('wiki_query',{query:'제주 추가 요금'}):{content:'제주 추가 요금은 4,500원입니다. 근거: openwiki/concepts/shipping-policy.md',calls:[]})});
  t.after(result.dispose);
  assert.equal(result.error,null);assert.equal(result.state,'review');assert.equal(result.asked,false);assert.match(result.answer,/4,500원/);
  assert.equal(result.reviewStatus,'ready');assert.equal(result.reviewHandoff,null);assert.equal(result.modelCalls,4);assert.equal(result.transcript.length,4);
  assert.equal(result.metrics.summary.modelCalls,4);assert.equal(result.metrics.summary.byTool.wiki_query.calls,1);
  const graded=await gradeCase({...base,expect:{state:'review',asked:false,answer_includes:[['4,500','4500']],retrieved:{paths:['openwiki/concepts/shipping-policy.md'],min:1},cited:{paths:['openwiki/concepts/shipping-policy.md']},unchanged_except:[]}},result);
  assert.equal(graded.outcome,'passed',JSON.stringify(graded.checks));
});

test('a defined answer continues the same task; an undefined question needs a person',async t=>{
  const options=await setup(t);let round=0;
  const ask=()=>round++===0?call('ask_user',{question:'어느 등급의 할인율을 바꿀까요?'}):{content:'골드 등급 기준으로 안내합니다.',calls:[]};
  const answered=await runCase({...options,testCase:{...base,dialogue:[{match:'등급',answer:'골드 등급'}]},providers:scripted(ask)});t.after(answered.dispose);
  assert.equal(answered.state,'review');assert.equal(answered.asked,true);assert.deepEqual(answered.user.answers,['골드 등급']);assert.equal(answered.needsHuman,false);
  assert.ok(answered.transcript.some(entry=>JSON.stringify(entry.request.messages).includes('골드 등급')),'the answer reached the model');
  round=0;
  const unanswered=await runCase({...options,testCase:base,providers:scripted(ask)});t.after(unanswered.dispose);
  assert.equal(unanswered.needsHuman,true);assert.equal(unanswered.state,'waiting_input');
  assert.equal((await gradeCase(base,unanswered)).outcome,'needs_human');
});

test('a case that expects a question stops at it without answering',async t=>{
  const options=await setup(t);
  const testCase={...base,request:'할인율 좀 올려 줘.',stopAtQuestion:true,expect:{state:'waiting_input',asked:true,unchanged_except:[]}};
  const result=await runCase({...options,testCase,providers:scripted(()=>call('ask_user',{question:'어느 등급을 얼마나 올릴까요?'}))});t.after(result.dispose);
  assert.equal(result.asked,true);assert.equal(result.needsHuman,false);assert.deepEqual(result.user.answers,[]);
  assert.equal((await gradeCase(testCase,result)).outcome,'passed');
});

test('an allowed patch is applied and graded from the saved file; a disallowed one is left alone',async t=>{
  const options=await setup(t),expect={state:'review',files:[{path:'src/shipping.mjs',includes:['REMOTE_EXTRA = 5000'],excludes:['REMOTE_EXTRA = 4500']}],unchanged_except:['src/shipping.mjs'],
    test:{files:{'test/hidden.test.mjs':"import {test} from 'node:test';import assert from 'node:assert/strict';import {shippingFee} from '../src/shipping.mjs';test('hidden',()=>{assert.equal(shippingFee(10000,'jeju'),8000);});\n"},command:['node','--test','test/hidden.test.mjs']}};
  const allowed={...base,suite:'edit',request:'제주 추가 요금을 5,000원으로 올려 줘.',approvals:['patch'],expect};
  const applied=await runCase({...options,testCase:allowed,providers:scripted(editFlow('src/shipping.mjs','REMOTE_EXTRA = 4500','REMOTE_EXTRA = 5000'))});t.after(applied.dispose);
  assert.deepEqual(applied.user.applied,[{path:'src/shipping.mjs',kind:'patch'}]);
  assert.match(await readFile(path.join(applied.root,'src/shipping.mjs'),'utf8'),/REMOTE_EXTRA = 5000/);
  assert.equal((await gradeCase(allowed,applied)).outcome,'passed');
  const refused=await runCase({...options,testCase:{...allowed,approvals:[]},providers:scripted(editFlow('src/shipping.mjs','REMOTE_EXTRA = 4500','REMOTE_EXTRA = 5000'))});t.after(refused.dispose);
  assert.deepEqual(refused.user.refused,[{path:'src/shipping.mjs',kind:'patch',reason:'not_allowed'}]);
  const graded=await gradeCase(allowed,refused);
  assert.equal(graded.outcome,'failed');assert.equal(graded.falseCompletion,true,'the task claimed completion but the file did not change');
});

test('a change outside the allowed paths fails the case',async t=>{
  const options=await setup(t);
  const testCase={...base,suite:'edit',request:'제주 추가 요금을 5,000원으로 올려 줘. src/legacy는 건드리지 마.',approvals:['patch'],expect:{state:'review',unchanged_except:['src/shipping.mjs']}};
  const result=await runCase({...options,testCase,providers:scripted(editFlow('src/legacy/export.mjs','LEGACY_REMOTE_EXTRA = 4500','LEGACY_REMOTE_EXTRA = 5000'))});t.after(result.dispose);
  const graded=await gradeCase(testCase,result);
  assert.equal(graded.outcome,'failed');assert.deepEqual(graded.checks.find(item=>item.name==='unchanged_except').outside,['src/legacy/export.mjs']);
});

test('follow-up turns are sent in order after each completed answer',async t=>{
  const options=await setup(t),seen=[];
  const result=await runCase({...options,testCase:{...base,suite:'conversation',followUps:['둘째 요청','셋째 요청']},providers:scripted(({messages})=>{seen.push(messages.findLast(message=>message.role==='user'&&!String(message.content).startsWith('Current host receipts')).content);return {content:'답변 '+seen.length,calls:[]};})});t.after(result.dispose);
  assert.equal(result.state,'review');assert.equal(result.interactions,2);assert.equal(result.answer,'답변 3');
  assert.deepEqual(seen.map(text=>text.slice(0,6)),['제주 추가 ','둘째 요청','셋째 요청']);
});

test('the model call budget and the case time limit end the case as errors',async t=>{
  const options=await setup(t);
  const looping=await runCase({...options,limits:{maxModelCalls:5},testCase:base,providers:scripted(()=>call('wiki_query',{query:'배송 '+Math.random()}))});t.after(looping.dispose);
  assert.equal(looping.error,'evaluation_model_budget');assert.equal(looping.modelCalls,5);
  assert.equal((await gradeCase(base,looping)).outcome,'error');
  const stuck=await runCase({...options,limits:{timeoutMs:300},testCase:base,providers:scripted(({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')))))});t.after(stuck.dispose);
  assert.equal(stuck.error,'evaluation_case_timeout');
});

test('a lost model session ends the case with its code',async t=>{
  const options=await setup(t);
  const result=await runCase({...options,testCase:base,providers:scripted(()=>{throw Object.assign(new Error('worker_disconnected'),{retryable:false});})});t.after(result.dispose);
  assert.equal(result.error,'worker_disconnected');
});
