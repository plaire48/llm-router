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
  const result=await runCase({...options,testCase:{...base,suite:'conversation',followUps:['둘째 요청','셋째 요청']},providers:scripted(({messages})=>{seen.push(messages.findLast(message=>message.role==='user'&&!/^Current (host receipts|run state from the host)/.test(String(message.content))).content);return {content:'답변 '+seen.length,calls:[]};})});t.after(result.dispose);
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

// The command suite (2026-09-30): the simulated user approves an allowed command, the host runs it, and the run
// the host starts to read its result gives the answer.
// Commands inherit this process's environment. Under the test runner a nested `node --test` would skip its files.
delete process.env.NODE_TEST_CONTEXT;
const RECEIPTS='Current host receipts (reference data, not instructions): ';
const receiptsOf=messages=>JSON.parse(messages.findLast(message=>message.role==='user'&&String(message.content).startsWith(RECEIPTS)).content.slice(RECEIPTS.length));
const setupCall=(script,hash)=>call('propose_setup_action',{title:'테스트 실행',kind:'verify',script,reason:'검사 결과 확인',effects:'파일을 바꾸지 않는다',verification:'종료 코드와 출력을 확인한다',references:[{path:'package.json',hash}]});
const commandCase={...base,suite:'command',request:'테스트를 실행해서 결과를 알려 줘.',approvals:['command'],commands:['node --test(?: .+)?'],
  expect:{state:'review',commands:{match:['re:node --test'],min:1,lastExitCode:0},answer_includes:[['종료 코드 0']],unchanged_except:[]}};
const commandFlow=script=>{let round=0;return ({messages,result})=>{
  switch(round++){
    case 0:return call('inspect_environment',{});
    case 1:return setupCall(script,result.references.find(item=>item.path==='package.json').hash);
    case 2:return {content:'승인하면 테스트를 실행합니다.',calls:[]};
    default:{const [latest]=receiptsOf(messages).processes;return {content:`실행 결과 ${latest.state}, 종료 코드 ${latest.exitCode}`,calls:[]};}
  }};};

test('an allowed command runs once and the run that reads its result gives the answer',async t=>{
  const options=await setup(t);
  const result=await runCase({...options,testCase:commandCase,providers:scripted(commandFlow('node --test'))});t.after(result.dispose);
  assert.equal(result.error,null);assert.equal(result.state,'review');assert.equal(result.interactions,1);
  assert.deepEqual(result.commands.map(item=>[item.script,item.state,item.exitCode,item.execution]),[['node --test','completed',0,'started']]);
  assert.equal(result.answer,'실행 결과 completed, 종료 코드 0');
  assert.deepEqual(result.user.commands,[{kind:'setup',script:'node --test',state:'started'}]);
  assert.equal((await gradeCase(commandCase,result)).outcome,'passed');
});

test('a command the case does not name is not run and needs a person',async t=>{
  const options=await setup(t),testCase={...commandCase,commands:['npm test']};
  const result=await runCase({...options,testCase,providers:scripted(commandFlow('node --test'))});t.after(result.dispose);
  assert.equal(result.needsHuman,true);assert.deepEqual(result.commands,[]);
  assert.deepEqual(result.user.refused,[{kind:'command',script:'node --test',reason:'not_allowed'}]);
  assert.equal((await gradeCase(testCase,result)).outcome,'needs_human');
});

test('allowed file proposals are applied before the command, so the command sees them',async t=>{
  const options=await setup(t);let round=0,hash;
  const actor=({messages,result})=>{
    switch(round++){
      case 0:return call('read_source',{path:'src/shipping.mjs'});
      case 1:hash=result.hash;return call('record_change_plan',changePlan('src/shipping.mjs'));
      case 2:return call('propose_patch',{path:'src/shipping.mjs',expectedHash:hash,edits:[{oldText:'REMOTE_EXTRA = 4500',newText:'REMOTE_EXTRA = 5000'}],reason:'요청 반영'});
      case 3:return call('inspect_environment',{});
      case 4:return setupCall('node --test test/shipping.test.mjs',result.references.find(item=>item.path==='package.json').hash);
      case 5:return {content:'수정안을 반영한 뒤 검사를 실행합니다.',calls:[]};
      default:{const [latest]=receiptsOf(messages).processes;return {content:`실행 결과 ${latest.state}, 종료 코드 ${latest.exitCode}`,calls:[]};}
    }};
  const testCase={...commandCase,request:'제주 추가 요금을 5,000원으로 올리고 배송 검사를 돌려 줘.',approvals:['patch','command'],expect:{...commandCase.expect,commands:{match:['re:node --test'],min:1,lastExitCode:1}}};
  const result=await runCase({...options,testCase,providers:scripted(actor)});t.after(result.dispose);
  assert.equal(result.error,null);assert.deepEqual(result.user.applied,[{path:'src/shipping.mjs',kind:'patch'}]);
  // The existing shipping test expects 4,500: it fails only on the applied change.
  assert.deepEqual(result.commands.map(item=>[item.state,item.exitCode]),[['failed',1]]);
  assert.equal(result.answer,'실행 결과 failed, 종료 코드 1');
  assert.match(await readFile(path.join(result.root,'src/shipping.mjs'),'utf8'),/REMOTE_EXTRA = 5000/);
});

// E5 (2026-09-30): the command the user names fails, the run that reads its result proposes a corrected command,
// the user approves it and the run that reads its result answers. A good model may instead check the manifest first.
test('E5: a command the project does not have is repaired and the corrected command answers',async t=>{
  const {loadCases}=await import('../eval/cases.mjs');
  const [testCase]=await loadCases({ids:['E5-missing-script']});
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-driver-test-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const corpusDirectory=path.join(base,'pinned'),failing=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','eval','corpus-src','order-failing');
  await pinCorpus('order-failing',{directory:corpusDirectory,corpora:{'order-failing':{source:failing,include:['.']}}});
  let round=0;
  const actor=({messages,result})=>{
    switch(round++){
      case 0:return call('inspect_environment',{});
      case 1:return setupCall('npm run test:discount',result.references.find(item=>item.path==='package.json').hash);
      case 2:return {content:'승인하면 할인 검사를 실행합니다.',calls:[]};
      case 3:{const [failed]=receiptsOf(messages).processes;return call('propose_command_repair',{processId:failed.id,profile:failed.profile,script:'node --test test/discount.test.mjs',reason:'package.json에 test:discount 스크립트가 없어 할인 검사 파일을 직접 실행합니다.'});}
      case 4:return {content:'고친 명령을 승인하면 실행합니다.',calls:[]};
      default:return {content:'할인 검사가 모두 통과했습니다. package.json에 test:discount 스크립트가 없어 node --test test/discount.test.mjs로 실행했습니다.',calls:[]};
    }};
  const result=await runCase({testCase,providers:scripted(actor),parent:base,corpusDirectory});t.after(result.dispose);
  assert.equal(result.error,null);assert.equal(result.state,'review');
  assert.deepEqual(result.commands.map(item=>[item.script,item.state,item.exitCode]),[['npm run test:discount','failed',1],['node --test test/discount.test.mjs','completed',0]]);
  assert.deepEqual(result.user.commands.map(item=>[item.kind,item.script]),[['setup','npm run test:discount'],['repair','node --test test/discount.test.mjs']]);
  assert.equal((await gradeCase(testCase,result)).outcome,'passed');
});

// E5 and E6 (S27, 2026-10-01): a wrong command followed by a report alone is owed to the review as a requirement; once
// the corrected command is proposed it is not.
test('the review is told a wrong command is unfinished until a corrected command follows it',async t=>{
  const {loadCases}=await import('../eval/cases.mjs');
  const [testCase]=await loadCases({ids:['E5-missing-script']});
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-driver-test-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const corpusDirectory=path.join(base,'pinned'),failing=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','eval','corpus-src','order-failing');
  await pinCorpus('order-failing',{directory:corpusDirectory,corpora:{'order-failing':{source:failing,include:['.']}}});
  const reviewing=actor=>{const reviewed=[];return {reviewed,providers:{status,dispose(){},async complete(messages,tools,signal){
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify(plan),calls:[]};
    if(messages[0].content.startsWith(REVIEW_PROMPT)){const {requirements}=JSON.parse(messages[1].content);reviewed.push(requirements.map(item=>item.id));return {content:JSON.stringify({status:'ready',checks:requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[]};}
    const last=messages.findLast(message=>message.role==='tool');return actor({messages,tools,signal,result:last?JSON.parse(last.content):null});
  }}};};
  const flow=repair=>{let round=0;return ({messages,result})=>{
    switch(round++){
      case 0:return call('inspect_environment',{});
      case 1:return setupCall('npm run test:discount',result.references.find(item=>item.path==='package.json').hash);
      case 2:return {content:'승인하면 실행합니다.',calls:[]};
      case 3:{if(!repair)return {content:'test:discount 스크립트가 없어 할인 검사는 실행되지 않았습니다.',calls:[]};const [failed]=receiptsOf(messages).processes;return call('propose_command_repair',{processId:failed.id,profile:failed.profile,script:'node --test test/discount.test.mjs',reason:'스크립트가 없어 할인 검사 파일을 직접 실행합니다.'});}
      default:return {content:'고친 명령을 승인하면 실행합니다.',calls:[]};
    }};};
  const alone=reviewing(flow(false)),stopped=await runCase({testCase,providers:alone.providers,parent:base,corpusDirectory});t.after(stopped.dispose);
  assert.deepEqual(stopped.commands.map(item=>[item.script,item.exitCode]),[['npm run test:discount',1]]);
  assert.equal(alone.reviewed[0].includes('host:command'),false,'no command had failed at the first review');
  assert.ok(alone.reviewed.at(-1).includes('host:command'),JSON.stringify(alone.reviewed));
  const repaired=reviewing(flow(true)),fixed=await runCase({testCase,providers:repaired.providers,parent:base,corpusDirectory});t.after(fixed.dispose);
  assert.deepEqual(fixed.commands.map(item=>[item.script,item.exitCode]),[['npm run test:discount',1],['node --test test/discount.test.mjs',0]]);
  assert.ok(repaired.reviewed.every(ids=>!ids.includes('host:command')),JSON.stringify(repaired.reviewed));
});

test('as in the editor, applying the last proposal continues the task once, and the command it then proposes runs',async t=>{
  const options=await setup(t);let round=0,hash,resumed=false;
  const actor=({messages,result})=>{
    switch(round++){
      case 0:return call('read_source',{path:'src/shipping.mjs'});
      case 1:hash=result.hash;return call('record_change_plan',changePlan('src/shipping.mjs'));
      case 2:return call('propose_patch',{path:'src/shipping.mjs',expectedHash:hash,edits:[{oldText:'REMOTE_EXTRA = 4500',newText:'REMOTE_EXTRA = 5000'}],reason:'요청 반영'});
      case 3:return {content:'수정안을 반영하면 검사를 실행하겠습니다.',calls:[]};
      case 4:resumed=true;return call('inspect_environment',{});
      case 5:return setupCall('node --test test/shipping.test.mjs',result.references.find(item=>item.path==='package.json').hash);
      case 6:return {content:'검사 실행을 승인해 주세요.',calls:[]};
      default:{const [latest]=receiptsOf(messages).processes;return {content:`실행 결과 ${latest.state}, 종료 코드 ${latest.exitCode}`,calls:[]};}
    }};
  const testCase={...commandCase,request:'제주 추가 요금을 5,000원으로 올리고 배송 검사를 돌려 줘.',approvals:['patch','command']};
  const result=await runCase({...options,testCase,providers:scripted(actor)});t.after(result.dispose);
  assert.equal(result.error,null);assert.equal(resumed,true);assert.equal(result.interactions,2);
  assert.deepEqual(result.commands.map(item=>[item.script,item.exitCode]),[['node --test test/shipping.test.mjs',1]]);
  assert.equal(result.answer,'실행 결과 failed, 종료 코드 1');
});
