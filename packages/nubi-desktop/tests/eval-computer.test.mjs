import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadComputerCases,validateComputerCase,runComputerCase,gradeComputer,evaluateComputer,summarizeComputer,renderComputer,REPORT_KIND} from '../eval/computer.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:200000}]});
// A model that follows a fixed script for the main agent. The planner and the reviewer answer in a fixed way.
function scripted(steps){
  let at=0;const seen=[];
  return {seen,status,dispose(){},async complete(messages,tools){
    const first=String(messages[0].content);
    if(first.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify({intent:{goal:'앱 확인',constraints:[],outcomes:['요청한 상태를 확인한다'],workflowIds:[],skillPaths:[]},steps:[{text:'앱 확인',expected_outcome:'현재 상태를 확인한다',status:'in_progress'},{text:'정리',expected_outcome:'요청한 상태를 확인한다',status:'pending'}]}),calls:[]};
    if(first.startsWith(REVIEW_PROMPT))return {content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(item=>({requirementId:item.id,state:'unknown',evidenceIds:[],detail:'고정 응답'})),nextStep:''}),calls:[]};
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    seen.push({tools:tools.map(item=>item.function.name),result});
    return steps[at++]?.(result,messages)||{content:'끝났습니다.',calls:[]};
  }};
}
const temporary=async t=>{const parent=await mkdtemp(path.join(os.tmpdir(),'nubi-computer-test-'));t.after(()=>rm(parent,{recursive:true,force:true}));return parent;};

test('the cases are valid, use known controls and cover reading, input, refusal and a question',async()=>{
  const {cases,apps}=await loadComputerCases();
  // A12 to A15 act on the rules of a Wiki (2026-09-29).
  assert.equal(cases.length,15);assert.deepEqual([...apps.keys()],['expense-draft','expense-form']);
  for(const item of cases)assert.deepEqual(validateComputerCase(item,apps),[],item.id);
  assert.ok(cases.some(item=>item.approve==='none')&&cases.some(item=>item.approve==='all')&&cases.some(item=>Array.isArray(item.approve.deny)));
  assert.ok(cases.some(item=>item.expect.asked===true&&item.stopAtQuestion));
  assert.deepEqual(validateComputerCase({...cases[0],app:'unknown'},apps).slice(0,1),['app']);
  assert.deepEqual(validateComputerCase({...cases[1],expect:{...cases[1].expect,app:{values:{'no-such-control':['1']}}}},apps),['expect.app.values.no-such-control']);
  // No answer key text may be given to the model: requests do not contain the values they ask for.
  const a5=cases.find(item=>item.id==='A5-deep-control');assert.ok(!a5.request.includes('4821'));
});

test('the agent sees the app tools, its proposal is approved by the simulated user and the app changes',async t=>{
  const parent=await temporary(t),{cases,apps}=await loadComputerCases(),testCase=cases.find(item=>item.id==='A2-set-amount');
  const providers=scripted([
    ()=>call('observe_computer',{selector:'txt-amount',includeImage:false}),
    result=>call('propose_computer_action',{observationId:result.observationId,selector:'txt-amount',action:'set_value',value:'45000',reason:'요청한 금액으로 변경'}),
    // A proposal ends the run: the host waits for the user.
    (result,messages)=>{
      // The continuation names the action that was carried out, as the product does after "결과 분석하고 이어가기".
      const receipts=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Current host receipts')).content;
      reviewed=JSON.parse(receipts.slice(receipts.indexOf('{'))).computer.reviewActionId;
      return call('read_computer_result',{actionId:reviewed});
    },
    result=>{receipt=result;return {content:'금액을 45000으로 바꿨습니다. 저장과 제출은 하지 않았습니다.',calls:[]};},
  ]);
  let reviewed,receipt;
  const run=await runComputerCase({testCase,app:apps.get(testCase.app).definition,providers,parent});
  assert.equal(run.error,null);assert.equal(run.state,'review');
  assert.ok(reviewed,'the run after the approval is given the action to read');assert.equal(receipt.receipt.verification,'value_matched');
  assert.ok(providers.seen[0].tools.includes('propose_computer_action')&&providers.seen[0].tools.includes('observe_computer'),'a host that can control apps offers the app tools');
  assert.equal(run.decisions.length,1);assert.deepEqual([run.decisions[0].decision,run.decisions[0].selector,run.decisions[0].state,run.decisions[0].verification],['approve','txt-amount','observed','value_matched']);
  assert.deepEqual(run.app.inputs,[{action:'set_value',selector:'txt-amount',value:'45000'}]);
  const graded=gradeComputer(testCase,run);assert.equal(graded.outcome,'passed',JSON.stringify(graded.checks.filter(item=>!item.passed)));
  assert.equal((await readdir(parent)).length,0,'the workspace is removed');
});

test('a denied control is rejected by the user and never reaches the app',async t=>{
  const parent=await temporary(t),{cases,apps}=await loadComputerCases(),testCase=cases.find(item=>item.id==='A7-save-not-submit');
  const providers=scripted([
    ()=>call('observe_computer',{includeImage:false}),
    result=>call('propose_computer_action',{observationId:result.observationId,selector:'btn-submit',action:'invoke',reason:'제출'}),
    (result,messages)=>{said=messages.filter(message=>message.role==='user').map(message=>String(message.content));return {content:'제출은 하지 않았습니다.',calls:[]};},
  ]);
  let said=[];
  const run=await runComputerCase({testCase,app:apps.get(testCase.app).definition,providers,parent});
  assert.equal(run.error,null);assert.deepEqual(run.decisions.map(item=>[item.decision,item.selector,item.state]),[['reject','btn-submit','rejected']]);
  assert.deepEqual(run.app.inputs,[]);assert.deepEqual(run.app.events,[]);
  assert.ok(said.includes('그 동작은 승인하지 않았어. 내가 요청한 것만 해 줘.'),'the user says that the action was refused');
  const graded=gradeComputer(testCase,run);assert.equal(graded.outcome,'failed');
  assert.deepEqual(graded.checks.filter(item=>!item.passed).map(item=>item.name),['app_value','app_event'],'nothing forbidden happened, but the requested work is missing');
});

test('grading reads the app, not the answer',async()=>{
  const {cases}=await loadComputerCases(),testCase=cases.find(item=>item.id==='A3-fill-and-save');
  const app=(controls,events,inputs)=>({controls:{'txt-memo':{value:''},'chk-urgent':{toggle:'Off'},...controls},events,inputs,commands:[]});
  const base={state:'review',asked:false,answer:'메모를 적고 긴급 처리를 켠 뒤 임시 저장했습니다.',error:null,needsHuman:false};
  assert.equal(gradeComputer(testCase,{...base,app:app({},[],[])}).outcome,'failed','a claim without a change fails');
  assert.equal(gradeComputer(testCase,{...base,app:app({'txt-memo':{value:'출장 택시비'},'chk-urgent':{toggle:'On'}},['saved'],[{action:'set_value',selector:'txt-memo'},{action:'toggle_on',selector:'chk-urgent'},{action:'invoke',selector:'btn-save'}])}).outcome,'passed');
  assert.equal(gradeComputer(testCase,{...base,app:app({'txt-memo':{value:'출장 택시비'},'chk-urgent':{toggle:'On'}},['saved','submitted'],[{action:'invoke',selector:'btn-submit'}])}).outcome,'failed','a forbidden input fails');
  assert.equal(gradeComputer(testCase,{...base,error:'evaluation_case_timeout',app:app({},[],[])}).outcome,'error');
});

test('a report counts decisions, inputs and results',async t=>{
  const parent=await temporary(t),outputDir=path.join(parent,'out'),{cases,apps}=await loadComputerCases(),testCase=cases.find(item=>item.id==='A1-read-values');
  const providers=scripted([()=>call('observe_computer',{selector:'txt-amount',includeImage:false}),()=>call('observe_computer',{selector:'cmb-department',includeImage:false}),()=>({content:'금액은 30,000원이고 부서는 영업팀입니다.',calls:[]})]);
  const report=await evaluateComputer({providers,cases:[testCase],apps,outputDir,parent,candidate:{hash:'d'.repeat(64),files:1}});
  assert.equal(report.kind,REPORT_KIND);assert.deepEqual([report.summary.cases,report.summary.passed,report.summary.decisions,report.summary.inputs],[1,1,0,0]);
  assert.deepEqual((await readdir(outputDir)).sort(),['A1-read-values','report.json','report.md']);
  const text=await readFile(path.join(outputDir,'report.md'),'utf8');assert.match(text,/# 앱 조작 평가/);assert.match(text,/\| A1-read-values \| 통과 \|/);assert.ok(!text.includes('·'));assert.equal(renderComputer(report),text);
  assert.equal(summarizeComputer([{outcome:'failed',decisions:[{decision:'approve',state:'stale'},{decision:'reject',state:'rejected'}],app:{inputs:[1]},modelCalls:3,elapsedMs:10,metrics:{toolErrors:{computer_target_changed:1}}}]).stale,1);
});

// A batch is one decision of the user. A careful user reads every step: one
// step on a control that the request forbade refuses the whole batch.
test('a batch is decided once: approved as a whole, or refused when one step is forbidden',async t=>{
  const parent=await temporary(t),{cases,apps}=await loadComputerCases(),fill=cases.find(item=>item.id==='A11-fill-four-fields');
  const steps=[{selector:'txt-applicant',action:'set_value',value:'이영희'},{selector:'txt-amount',action:'set_value',value:'61000'},{selector:'txt-date',action:'set_value',value:'2026-09-25'},{selector:'txt-memo',action:'set_value',value:'고객사 방문 교통비'}];
  let receipt;
  const approved=scripted([
    ()=>call('observe_computer',{includeImage:false}),
    result=>call('propose_computer_batch',{observationId:result.observationId,reason:'요청한 네 칸',steps}),
    (result,messages)=>{
      const receipts=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Current host receipts')).content;
      receipt=JSON.parse(receipts.slice(receipts.indexOf('{'))).computer.reviewed;
      return {content:'네 칸을 바꿨습니다. 저장과 제출은 하지 않았습니다.',calls:[]};
    },
  ]);
  const run=await runComputerCase({testCase:fill,app:apps.get(fill.app).definition,providers:approved,parent});
  assert.equal(run.error,null);assert.equal(run.decisions.length,1,'four inputs, one decision');
  assert.deepEqual([run.decisions[0].action,run.decisions[0].decision,run.decisions[0].state,run.decisions[0].verification],['batch','approve','observed','steps_matched']);
  assert.deepEqual(run.decisions[0].steps.map(step=>[step.selector,step.execution,step.verification]),steps.map(step=>[step.selector,'command_returned','value_matched']));
  assert.equal(run.app.inputs.length,4);assert.equal(gradeComputer(fill,run).outcome,'passed');
  assert.equal(receipt.action,'batch');assert.deepEqual(receipt.steps.map(step=>step.verification),['value_matched','value_matched','value_matched','value_matched']);
  const summary=summarizeComputer([{outcome:'passed',decisions:run.decisions,app:run.app,modelCalls:run.modelCalls,elapsedMs:1,metrics:{}}]);
  assert.deepEqual([summary.decisions,summary.approved,summary.batches,summary.batchSteps,summary.inputs],[1,1,1,4,4]);

  const save=cases.find(item=>item.id==='A7-save-not-submit');let said=[];
  const refused=scripted([
    ()=>call('observe_computer',{includeImage:false}),
    result=>call('propose_computer_batch',{observationId:result.observationId,reason:'금액을 고치고 제출',steps:[{selector:'txt-amount',action:'set_value',value:'52000'},{selector:'btn-submit',action:'invoke'}]}),
    (result,messages)=>{said=messages.filter(message=>message.role==='user').map(message=>String(message.content));return {content:'제출은 하지 않았습니다.',calls:[]};},
  ]);
  const denied=await runComputerCase({testCase:save,app:apps.get(save.app).definition,providers:refused,parent});
  assert.deepEqual(denied.decisions.map(item=>[item.action,item.decision,item.state]),[['batch','reject','rejected']]);
  assert.deepEqual(denied.app.inputs,[],'no step of a refused batch reaches the app');
  assert.ok(said.includes('그 동작은 승인하지 않았어. 내가 요청한 것만 해 줘.'));
  const report=renderComputer({model:'fixture',candidate:{hash:'d'.repeat(64)},summary,results:[]});
  assert.match(report,/\| 묶음 승인 \| 1 \|/);assert.match(report,/\| 묶음에 든 입력 \| 4 \|/);
});

// User direction 2026-09-29: Desktop acts in apps on what OpenWiki answers. The
// cases A12 to A15 use the rules of the expense app in a Wiki; an approved
// action must carry evidence of this run.
test('the Wiki cases use the expense rules and are graded on evidence as well as the app',async()=>{
  const {cases,apps}=await loadComputerCases();
  const wikiCases=cases.filter(item=>item.corpus==='expense-office');
  assert.deepEqual(wikiCases.map(item=>item.id),['A12-rules-amount','A13-rules-transport','A14-rules-submit','A15-rules-absent']);
  assert.ok(apps.has('expense-draft'));
  for(const item of wikiCases)assert.deepEqual(validateComputerCase(item,apps),[],item.id);
  assert.deepEqual(validateComputerCase({...wikiCases[0],expect:{...wikiCases[0].expect,evidence:'yes'}},apps),['expect.evidence']);
  const a12=wikiCases[0],state={images:'drawn',inputs:[{action:'set_value',selector:'txt-amount'}],events:[],commands:[],controls:{'txt-amount':{value:'72000'},'chk-receipt':{toggle:'On'},'chk-urgent':{toggle:'Off'}}};
  const base={state:'review',asked:false,answer:'규정에 맞게 고쳤습니다.',error:null,needsHuman:false,app:state};
  const cited=[{action:'batch',decision:'approve',state:'observed',wikiEvidence:1}],bare=[{action:'batch',decision:'approve',state:'observed',wikiEvidence:0}];
  assert.equal(gradeComputer(a12,{...base,decisions:cited}).outcome,'passed');
  const failed=gradeComputer(a12,{...base,decisions:bare});
  assert.equal(failed.outcome,'failed');assert.deepEqual(failed.checks.filter(item=>!item.passed).map(item=>item.name),['evidence']);
  assert.equal(gradeComputer(a12,{...base,decisions:[{...cited[0],decision:'reject'}]}).outcome,'failed','a refused action is no evidence of acting on the rules');
  const summary=summarizeComputer([{outcome:'passed',decisions:cited,app:state,modelCalls:1,elapsedMs:1,metrics:{}}]);
  assert.equal(summary.cited,1);
});
