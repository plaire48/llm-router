import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluate,REPORT_KIND} from '../eval/run.mjs';
import {compareReports,renderComparison} from '../eval/compare.mjs';
import {candidateIdentity} from '../eval/candidate.mjs';
import {pinCorpus} from '../eval/pin-corpus.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';

const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','eval','corpus-src','order-service');
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=(connected=true)=>()=>({connected,provider:'fixture',model:'fixture',models:[{id:'fixture',contextLength:200000,maxOutputTokens:4096}]});
const plan={intent:{goal:'요청 처리',constraints:[],outcomes:['결과를 전달한다'],workflowIds:[],skillPaths:[]},steps:[{text:'자료 확인',expected_outcome:'근거를 확인한다',status:'in_progress'},{text:'결과 전달',expected_outcome:'결과를 전달한다',status:'pending'}]};
const usage={prompt_tokens:1000,completion_tokens:50,prompt_tokens_details:{cached_tokens:400}};
// Answers a question after one wiki search. `answer` maps the request to the final text.
const scripted=(answer,{connected=true,fail}={})=>({status:status(connected),dispose(){},async complete(messages){
  if(messages[0].content.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify(plan),calls:[],usage};
  if(messages[0].content.startsWith(REVIEW_PROMPT))return {content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'fixture'})),nextStep:''}),calls:[],usage};
  const request=messages.find(message=>message.role==='user').content;
  if(fail?.(request))throw Object.assign(new Error('worker_disconnected'),{retryable:false});
  return messages.some(message=>message.role==='tool')?{content:answer(request),calls:[],usage}:{...call('wiki_query',{query:'배송 추가 요금'}),usage};
}});
const cases=[
  {id:'T1-first-case',title:'첫째',suite:'wiki',split:'dev',corpus:'order-service',request:'제주 추가 배송비가 얼마야?',followUps:[],expect:{state:'review',asked:false,answer_includes:[['4,500']],retrieved:{paths:['openwiki/concepts/shipping-policy.md'],min:1}}},
  {id:'T2-second-case',title:'둘째',suite:'wiki',split:'holdout',corpus:'order-service',request:'무료 배송 기준이 얼마야?',followUps:[],expect:{state:'review',asked:false,answer_includes:[['50,000']]}},
];
async function setup(t){
  const base=await mkdtemp(path.join(os.tmpdir(),'nubi-run-test-'));t.after(()=>rm(base,{recursive:true,force:true}));
  const corpusDirectory=path.join(base,'pinned');await pinCorpus('order-service',{directory:corpusDirectory,corpora:{'order-service':{source,include:['.']}}});
  return {parent:base,corpusDirectory,candidate:{hash:'a'.repeat(64),files:1}};
}

// The model windows are 256K to 512K (user decision 2026-09-30): a case under a lowered window is a compaction
// test and is counted apart from the main pass rate.
test('a case under a lowered window is counted apart from the main pass rate',async t=>{
  const options=await setup(t),outputDir=path.join(options.parent,'out');
  const lowered={...cases[0],id:'T3-lowered-window',modelLimits:{contextLength:22000}};
  await assert.rejects(evaluate({...options,outputDir,cases:[lowered],providers:scripted(()=>{throw new Error('must not reach model');})}),/model_limit_override_forbidden/);
  const report=await evaluate({...options,outputDir,allowModelLimitOverrides:true,cases:[cases[1],lowered],providers:scripted(request=>request.includes('제주')?'제주 추가 요금은 4,500원입니다.':'무료 배송 기준은 60,000원입니다.')});
  assert.deepEqual(report.results.map(result=>[result.id,result.outcome,result.reducedWindow??null]),[['T2-second-case','failed',null],['T3-lowered-window','passed',22000]]);
  const {quality}=report.summary;
  assert.deepEqual([quality.executed,quality.passed],[1,0]);assert.deepEqual(quality.reducedWindow,{executed:1,passed:1});
});

test('a run writes a report, per-case records and totals by purpose',async t=>{
  const options=await setup(t),outputDir=path.join(options.parent,'out'),seen=[];
  const report=await evaluate({...options,outputDir,cases,providers:scripted(request=>request.includes('제주')?'제주 추가 요금은 4,500원입니다.':'무료 배송 기준은 60,000원입니다.'),onResult:result=>seen.push(result.id+':'+result.outcome)});
  assert.equal(report.kind,REPORT_KIND);assert.equal(report.model,'fixture');assert.equal(report.candidate.hash,'a'.repeat(64));
  assert.match(report.corpora['order-service'],/^[0-9a-f]{64}$/);assert.ok(report.limitations.length>=4);
  assert.deepEqual(seen,['T1-first-case:passed','T2-second-case:failed']);
  assert.deepEqual(report.results.map(result=>[result.outcome,result.falseCompletion]),[['passed',false],['failed',true]]);
  const {quality,cost,bySuite,bySplit}=report.summary;
  assert.deepEqual([quality.executed,quality.passed,quality.delivered,quality.falseCompletion,quality.retrievalCases,quality.retrievalReached],[2,1,2,1,1,1]);assert.equal(quality.reviewLimit,0);assert.equal(quality.reviewStalled,0);
  assert.equal(bySuite.wiki.total,2);assert.equal(bySplit.dev.passed,1);assert.equal(bySplit.holdout.failed,1);
  assert.equal(cost.modelCalls,8);assert.deepEqual(Object.keys(cost.byPurpose).sort(),['actor','planner','reviewer']);
  assert.equal(cost.byPurpose.actor.calls,4);assert.equal(cost.promptTokens,8000);assert.equal(cost.cacheShare,0.4);assert.ok(cost.fixedShare>0.5);
  assert.equal(cost.byTool.wiki_query.calls,2);
  assert.deepEqual((await readdir(outputDir)).sort(),['T1-first-case-t1','T2-second-case-t1','report.json']);
  assert.deepEqual((await readdir(path.join(outputDir,'T1-first-case-t1'))).sort(),['metrics.json','result.json','transcript.jsonl']);
  const saved=JSON.parse(await readFile(path.join(outputDir,'T1-first-case-t1','result.json'),'utf8'));
  assert.match(saved.answer,/4,500원/);
  const lines=(await readFile(path.join(outputDir,'T1-first-case-t1','transcript.jsonl'),'utf8')).trim().split('\n');assert.equal(lines.length,4);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDir,'report.json'),'utf8')).summary.quality,quality);
  assert.ok(!JSON.stringify(report).includes('4,500원입니다'),'the report holds no answer text; per-case records do');
});

test('a missing model session leaves every case not run',async t=>{
  const options=await setup(t),report=await evaluate({...options,outputDir:path.join(options.parent,'out'),cases,providers:scripted(()=>'',{connected:false})});
  assert.deepEqual(report.results.map(result=>[result.outcome,result.reason]),[['not_run','model_session_not_connected'],['not_run','model_session_not_connected']]);
  assert.equal(report.summary.quality.executed,0);assert.equal(report.summary.bySuite.wiki.not_run,2);assert.equal(report.summary.cost.modelCalls,0);
});

test('a session lost during a case ends it as an error and the rest are not run',async t=>{
  const options=await setup(t),report=await evaluate({...options,outputDir:path.join(options.parent,'out'),cases,providers:scripted(()=>'',{fail:request=>request.includes('제주')})});
  assert.deepEqual(report.results.map(result=>[result.outcome,result.error||result.reason]),[['error','worker_disconnected'],['not_run','model_session_lost']]);
});

test('repeated trials are separate results and invalid arguments are refused',async t=>{
  const options=await setup(t),report=await evaluate({...options,outputDir:path.join(options.parent,'out'),cases:[cases[0]],trials:2,providers:scripted(()=>'제주 추가 요금은 4,500원입니다.')});
  assert.deepEqual(report.results.map(result=>result.trial),[1,2]);
  await assert.rejects(evaluate({...options,outputDir:path.join(options.parent,'out'),cases:[],providers:scripted(()=>'')}),/cases_required/);
  await assert.rejects(evaluate({...options,outputDir:path.join(options.parent,'out'),cases,trials:0,providers:scripted(()=>'')}),/invalid_trials/);
  await assert.rejects(evaluate({...options,cases,providers:scripted(()=>'')}),/output_directory_required/);
});

test('two reports of one model and corpus are compared case by case and by purpose',async t=>{
  const options=await setup(t);
  const before=await evaluate({...options,outputDir:path.join(options.parent,'before'),cases,providers:scripted(()=>'무료 배송 기준은 50,000원입니다.')});
  const after=await evaluate({...options,candidate:{hash:'b'.repeat(64),files:1},outputDir:path.join(options.parent,'after'),cases,providers:scripted(request=>request.includes('제주')?'제주 추가 요금은 4,500원입니다.':'무료 배송 기준은 50,000원입니다.')});
  const comparison=compareReports(before,after);
  assert.equal(comparison.sameCandidate,false);
  assert.deepEqual(comparison.cases.map(item=>[item.id,item.before,item.after,item.changed]),[['T1-first-case','failed','passed',true],['T2-second-case','passed','passed',false]]);
  assert.deepEqual(comparison.purposes.map(item=>item.purpose),['actor','planner','reviewer']);
  const text=renderComparison(comparison);
  assert.match(text,/\| 독립 통과 \| 1 \| 2 \| \+1 \|/);assert.match(text,/\| 검토 상한 전달 \| 0 \| 0 \|/);assert.match(text,/\| 검토 반복 전달 \| 0 \| 0 \|/);
  // A report written before the measure existed is compared as zero.
  const older={...before,summary:{...before.summary,quality:Object.fromEntries(Object.entries(before.summary.quality).filter(([name])=>name!=='reviewLimit'))}};
  assert.match(renderComparison(compareReports(older,after)),/\| 검토 상한 전달 \| 0 \| 0 \|/);assert.match(text,/\*\*passed\*\*/);assert.match(text,/우열을 입증하지 않습니다/);assert.ok(!text.includes('·'));
  assert.equal(compareReports(before,before).sameCandidate,true);
  assert.throws(()=>compareReports(before,{...after,model:'other'}),/report_model_differs/);
  assert.throws(()=>compareReports(before,{...after,corpora:{'order-service':'0'.repeat(64)}}),/report_corpus_differs/);
  assert.throws(()=>compareReports({kind:'other'},after),/report_invalid/);
});

test('the candidate identity changes with a runtime file and refuses a stale build record',async t=>{
  const packageRoot=await mkdtemp(path.join(os.tmpdir(),'nubi-candidate-'));t.after(()=>rm(packageRoot,{recursive:true,force:true}));
  await mkdir(path.join(packageRoot,'runtime'));await mkdir(path.join(packageRoot,'generated'));await mkdir(path.join(packageRoot,'shared'));
  await writeFile(path.join(packageRoot,'runtime','agent.mjs'),'one');await writeFile(path.join(packageRoot,'runtime','notes.txt'),'ignored');await writeFile(path.join(packageRoot,'shared','core.js'),'core');
  await assert.rejects(candidateIdentity({packageRoot}),/candidate_inputs_missing/);
  await writeFile(path.join(packageRoot,'generated','source-inputs.json'),JSON.stringify(['shared/core.js','runtime/agent.mjs']));
  const first=await candidateIdentity({packageRoot});assert.equal(first.files,2);assert.match(first.hash,/^[0-9a-f]{64}$/);
  assert.deepEqual(await candidateIdentity({packageRoot}),first);
  await writeFile(path.join(packageRoot,'runtime','new-module.mjs'),'new');
  const second=await candidateIdentity({packageRoot});assert.equal(second.files,3,'a runtime module missing from the build record is still included');assert.notEqual(second.hash,first.hash);
  await writeFile(path.join(packageRoot,'shared','core.js'),'changed');assert.notEqual((await candidateIdentity({packageRoot})).hash,second.hash);
  await writeFile(path.join(packageRoot,'generated','source-inputs.json'),JSON.stringify(['shared/removed.js']));
  await assert.rejects(candidateIdentity({packageRoot}),/candidate_inputs_stale/);
});
