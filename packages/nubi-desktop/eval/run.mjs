// Runs evaluation cases against the real Desktop service with a real model and
// grades observable results. Nothing measured here is company-repository,
// enterprise-model or Windows evidence: see LIMITATIONS.
import {disableHostedTracing} from '../runtime/worker-environment.mjs';
disableHostedTracing(process.env);
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const {runCase,EVALUATION_LIMITS}=await import('./driver.mjs');
const {gradeCase}=await import('./grade.mjs');
const {loadCases}=await import('./cases.mjs');
const {corpusManifest}=await import('./corpus.mjs');
const {candidateIdentity}=await import('./candidate.mjs');

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const REPORT_KIND='desktop-live-model-evaluation';
export const LIMITATIONS=Object.freeze([
  'The model is the one named in this report. It is not the enterprise Qwen 3.8 27B baseline and says nothing about its accuracy.',
  'The corpora are a public open-source project and a synthetic project. They do not establish accuracy on company repositories or company wikis.',
  'Windows app control is not measured.',
  'The case set is small. Differences between two reports are observations, not statistically established improvements.',
  'Substring grading can miss a correct answer in unexpected wording. needs_review and invalid outcomes are never counted as passed.',
]);
const OUTCOMES=['passed','failed','needs_review','needs_human','invalid','error','not_run'];
const add=(target,key,value)=>{target[key]=(target[key]||0)+(value||0);};

function summarize(results){
  const tally=()=>Object.fromEntries([['total',0],...OUTCOMES.map(name=>[name,0])]),bySuite={},bySplit={};
  const quality={total:results.length,executed:0,passed:0,delivered:0,falseCompletion:0,reviewLimit:0,reviewStalled:0,unnecessaryQuestion:0,missedQuestion:0,retrievalCases:0,retrievalReached:0,citationCases:0,citationFound:0};
  const cost={modelCalls:0,retries:0,toolCalls:0,compactions:0,elapsedMs:0,promptTokens:0,completionTokens:0,cachedTokens:0,estimatedTokens:0,measuredEstimatedTokens:0,requestCharacters:0,fixedCharacters:0,peakRequestCharacters:0,byPurpose:{},byTool:{}};
  for(const result of results){
    for(const group of [bySuite[result.suite]??=tally(),bySplit[result.split]??=tally()]){group.total++;group[result.outcome]++;}
    if(result.outcome==='not_run')continue;
    quality.executed++;if(result.outcome==='passed')quality.passed++;
    if(result.state==='review'&&result.answerCharacters>0)quality.delivered++;
    if(result.falseCompletion)quality.falseCompletion++;
    if(result.reviewHandoff==='review_limit')quality.reviewLimit++;
    if(result.reviewHandoff==='review_stalled')quality.reviewStalled++;
    if(result.expectedAsked===false&&result.asked)quality.unnecessaryQuestion++;
    if(result.expectedAsked===true&&!result.asked)quality.missedQuestion++;
    const retrieved=result.checks.find(item=>item.name==='retrieved'),cited=result.checks.find(item=>item.name==='cited');
    if(retrieved){quality.retrievalCases++;if(retrieved.passed)quality.retrievalReached++;}
    if(cited){quality.citationCases++;if(cited.passed)quality.citationFound++;}
    const metrics=result.metrics;if(!metrics)continue;
    for(const key of ['modelCalls','retries','toolCalls','compactions','elapsedMs','promptTokens','completionTokens','cachedTokens','estimatedTokens','measuredEstimatedTokens','requestCharacters','fixedCharacters'])add(cost,key,metrics[key]);
    cost.peakRequestCharacters=Math.max(cost.peakRequestCharacters,metrics.peakRequestCharacters||0);
    for(const [kind,groups] of [['byPurpose',metrics.byPurpose],['byTool',metrics.byTool]])for(const [name,row] of Object.entries(groups||{})){const target=cost[kind][name]??={};for(const [key,value] of Object.entries(row))add(target,key,value);}
  }
  cost.fixedShare=cost.requestCharacters?cost.fixedCharacters/cost.requestCharacters:null;
  cost.cacheShare=cost.promptTokens?cost.cachedTokens/cost.promptTokens:null;
  cost.estimateRatio=cost.measuredEstimatedTokens?cost.promptTokens/cost.measuredEstimatedTokens:null;
  return {bySuite,bySplit,quality,cost};
}

export async function evaluate({providers,cases,trials=1,outputDir,limits=EVALUATION_LIMITS,parent,corpusDirectory,candidate,onResult=()=>{}}){
  if(!Array.isArray(cases)||!cases.length)throw new Error('cases_required');
  if(!Number.isInteger(trials)||trials<1||trials>10)throw new Error('invalid_trials');
  if(typeof outputDir!=='string'||!outputDir)throw new Error('output_directory_required');
  await mkdir(outputDir,{recursive:true});
  const status=providers.status(),corpora={};
  for(const name of new Set(cases.map(item=>item.corpus)))corpora[name]=(await corpusManifest(name,corpusDirectory)).hash;
  const report={kind:REPORT_KIND,schema:1,runId:randomUUID(),provider:status.provider,model:status.model,candidate:candidate||await candidateIdentity(),corpora,limits:{...EVALUATION_LIMITS,...limits},trials,startedAt:new Date().toISOString(),results:[],limitations:LIMITATIONS};
  // A missing or lost model session is "not run": it must not look like a model failure.
  let stopped=status.connected===true?null:'model_session_not_connected';
  for(const testCase of cases)for(let trial=1;trial<=trials;trial++){
    const name=`${testCase.id}-t${trial}`,common={id:testCase.id,title:testCase.title,suite:testCase.suite,split:testCase.split,corpus:testCase.corpus,trial,expectedAsked:testCase.expect.asked??null};
    if(stopped){const skipped={...common,outcome:'not_run',passed:false,reason:stopped,checks:[],falseCompletion:false};report.results.push(skipped);onResult(skipped);continue;}
    const run=await runCase({testCase,providers,limits,parent,corpusDirectory});
    let graded;
    try{graded=await gradeCase(testCase,run);}catch{graded={outcome:'error',passed:false,checks:[],error:'grading_failed',falseCompletion:false};}
    finally{await run.dispose().catch(()=>{});}
    const result={...common,outcome:graded.outcome,passed:graded.passed,...(graded.error?{error:graded.error}:{}),...(graded.flagged?{flagged:graded.flagged}:{}),falseCompletion:graded.falseCompletion,checks:graded.checks,
      state:run.state,asked:run.asked,reviewStatus:run.reviewStatus,reviewHandoff:run.reviewHandoff,answerCharacters:run.answer.length,elapsedMs:run.elapsedMs,modelCalls:run.modelCalls,delegatedCalls:run.delegatedCalls,interactions:run.interactions,metrics:run.metrics.summary};
    const directory=path.join(outputDir,name);await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'transcript.jsonl'),run.transcript.map(entry=>JSON.stringify(entry)).join('\n')+(run.transcript.length?'\n':''));
    await writeFile(path.join(directory,'metrics.json'),JSON.stringify(run.metrics,null,2)+'\n');
    await writeFile(path.join(directory,'result.json'),JSON.stringify({...result,request:testCase.request,followUps:testCase.followUps,answer:run.answer,user:run.user},null,2)+'\n');
    report.results.push(result);onResult(result);
    if(run.error==='worker_disconnected')stopped='model_session_lost';
  }
  report.summary=summarize(report.results);report.finishedAt=new Date().toISOString();
  await writeFile(path.join(outputDir,'report.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const option=name=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:undefined;};
  const {connectRelayProviders,defaultSocketPath}=await import('./relay.mjs');
  const split=option('split'),cases=await loadCases({ids:option('cases')?.split(','),suites:option('suites')?.split(','),...(split&&split!=='all'?{split}:{})});
  if(!cases.length){console.error('조건에 맞는 과제가 없습니다.');process.exit(2);}
  const outputDir=path.resolve(option('out')||path.join(root,'verification','eval-live',new Date().toISOString().replace(/[:.]/g,'-')));
  let providers;
  try{providers=await connectRelayProviders({socketPath:option('socket')||defaultSocketPath()});}
  catch{console.error('모델 세션에 연결하지 못했습니다. 먼저 다른 터미널에서 node eval/model-session.mjs 를 실행하고 로그인해 주세요.');process.exit(2);}
  try{
    const report=await evaluate({providers,cases,trials:Number(option('trials')||1),outputDir,
      onResult:result=>console.log([result.outcome.padEnd(12),result.id.padEnd(30),'모델 호출 '+String(result.modelCalls??0).padStart(3),'위임 '+String(result.delegatedCalls??0).padStart(3),Math.round((result.elapsedMs||0)/1000)+'초',result.error||result.reason||''].join(' '))});
    const {quality,cost}=report.summary;
    console.log(JSON.stringify({model:report.model,candidate:report.candidate.hash.slice(0,12),passed:`${quality.passed}/${quality.executed}`,falseCompletion:quality.falseCompletion,modelCalls:cost.modelCalls,promptTokens:cost.promptTokens,fixedShare:cost.fixedShare,report:path.join(outputDir,'report.json')},null,2));
    console.log('공개 자료와 합성 자료로 측정한 결과입니다. 사내 모델이나 회사 저장소의 성능이 아닙니다.');
  }finally{providers.dispose();}
}
