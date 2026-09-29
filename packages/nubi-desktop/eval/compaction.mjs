// Measures what a compaction keeps. A scenario replays fixed steps through the
// real Desktop service under a small context window, so the run is compacted
// by the product's own code. The summaries come from the model under test.
// Afterwards the model answers probe questions from the compacted context
// alone, without tools, and fixed checks look for text that must have stayed.
//
// The probe kinds follow published practice: instruction, request, decision,
// artifact, recall and continuation. A recall probe passes on the fact or on
// the path that holds it: what was cleared must stay findable.
//
// Usage: node eval/compaction.mjs --socket <path> --out <directory> [--only P1]
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
import {readRunMetrics} from '../runtime/run-metrics.mjs';
import {createWorkspace,CORPORA} from './corpus.mjs';
import {mentions} from './grade.mjs';
import {candidateIdentity} from './candidate.mjs';
import {connectRelayProviders} from './relay.mjs';

if(!ProjectService.prototype.startAgent)installAgent(ProjectService);
const here=path.dirname(fileURLToPath(import.meta.url));
export const SCENARIO_DIRECTORY=path.join(here,'compaction');
export const REPORT_KIND='desktop-compaction-evaluation';
export const PROBE_KINDS=Object.freeze(['instruction','request','decision','artifact','recall','continuation']);
const LEADER='You are Nubi Desktop',SUMMARY='Summarize conversation';
const PROBE='[평가 질문] 지금까지의 대화에 있는 내용만으로 답하세요. 도구를 쓰지 마세요. 대화에 없으면 "대화에 없음"이라고 답하고, 어느 파일을 다시 읽으면 되는지 알면 그 경로를 말하세요. 세 문장 이내로 답하세요.\n질문: ';

const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function validateScenario(value){
  const problems=[],need=(ok,problem)=>{if(!ok)problems.push(problem);};
  if(!value||typeof value!=='object'||Array.isArray(value))return ['scenario_not_object'];
  need(typeof value.id==='string'&&/^P[0-9]{1,2}-[a-z0-9-]{3,40}$/.test(value.id),'id');
  need(text(value.title,80),'title');need(Object.hasOwn(CORPORA,value.corpus||''),'corpus');
  need(Number.isSafeInteger(value.contextLength)&&value.contextLength>=8192,'contextLength');
  need(Array.isArray(value.turns)&&value.turns.length>=1&&value.turns.length<=8,'turns');
  for(const [index,turn] of (Array.isArray(value.turns)?value.turns:[]).entries()){
    need(text(turn?.user,16000)||text(turn?.user?.file,300)&&!turn.user.file.includes('..'),`turns[${index}].user`);
    need(Array.isArray(turn?.steps)&&turn.steps.length<=40&&turn.steps.every(step=>text(step?.tool,60)&&step.args&&typeof step.args==='object'),`turns[${index}].steps`);
    need(text(turn?.answer,4000),`turns[${index}].answer`);
  }
  need(Array.isArray(value.probes)&&value.probes.length>=1&&value.probes.length<=20,'probes');
  for(const [index,probe] of (Array.isArray(value.probes)?value.probes:[]).entries()){
    need(PROBE_KINDS.includes(probe?.kind),`probes[${index}].kind`);need(text(probe?.question,500),`probes[${index}].question`);
    need(Array.isArray(probe?.expect)&&probe.expect.length>=1&&probe.expect.every(group=>Array.isArray(group)&&group.length>=1&&group.every(item=>text(item,300))),`probes[${index}].expect`);
  }
  need(value.kept===undefined||Array.isArray(value.kept)&&value.kept.every(item=>text(item,2000)),'kept');
  return problems;
}
export async function loadScenarios(directory=SCENARIO_DIRECTORY){
  const scenarios=[];
  for(const name of (await readdir(directory)).filter(file=>file.endsWith('.json')).sort()){
    const value=JSON.parse(await readFile(path.join(directory,name),'utf8')),problems=validateScenario(value);
    if(problems.length)throw Object.assign(new Error('scenario_invalid'),{details:{file:name,problems}});
    for(const turn of value.turns)if(typeof turn.user!=='string')turn.user=(turn.user.before||'')+await readFile(path.join(directory,turn.user.file),'utf8');
    scenarios.push(value);
  }
  return scenarios;
}

const call=(name,args,id)=>({content:'',calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const first=messages=>String(messages[0]?.content||'');
// The planner and the reviewer are not what is measured: they answer in a fixed way.
function fixed(messages){
  if(first(messages).startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify({intent:{goal:'요청한 자료 확인',constraints:[],outcomes:['확인한 내용을 정리한다'],workflowIds:[],skillPaths:[]},steps:[{text:'자료 확인',expected_outcome:'근거를 확인한다',status:'in_progress'},{text:'결과 정리',expected_outcome:'확인한 내용을 정리한다',status:'pending'}]}),calls:[]};
  if(first(messages).startsWith(REVIEW_PROMPT))return {content:JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(item=>({requirementId:item.id,state:'unknown',evidenceIds:[],detail:'평가용 고정 응답'})),nextStep:''}),calls:[]};
  return null;
}

export async function runScenario({scenario,providers,parent,corpusDirectory}){
  const workspace=await createWorkspace({corpus:scenario.corpus,parent,directory:corpusDirectory});
  const service=new ProjectService({storageRoot:workspace.stateRoot}),status=providers.status(),started=Date.now();
  const summaries=[],failures=[];let turn=0,step=0,sequence=0,last=null,taskId;
  const limited={...status,models:(status.models||[]).map(model=>model.id!==status.model?model:{...model,contextLength:Math.min(model.contextLength||Infinity,scenario.contextLength)})};
  service.providers={status:()=>limited,dispose(){},async complete(messages,tools=[],signal,onText,onPhase){
    const scripted=fixed(messages);if(scripted)return scripted;
    if(first(messages).startsWith(SUMMARY)){
      const began=Date.now(),result=await providers.complete(messages,tools,signal,onText,onPhase);
      summaries.push({elapsedMs:Date.now()-began,sourceCharacters:String(messages.at(-1)?.content||'').length,summaryCharacters:String(result.content||'').length});
      return result;
    }
    if(!first(messages).startsWith(LEADER))throw Object.assign(new Error('evaluation_unexpected_request'),{retryable:false});
    const result=messages.findLast(message=>message.role==='tool');
    if(result){try{const value=JSON.parse(result.content);if(value?.ok===false||value?.error)failures.push({turn,step,error:String(value.error).slice(0,80)});}catch{/* A result that is not JSON is not a refusal. */}}
    last=structuredClone(messages);
    const current=scenario.turns[turn];
    return step<current.steps.length?call(current.steps[step].tool,current.steps[step++].args,`step-${turn}-${step}-${++sequence}`):{content:current.answer,calls:[]};
  }};
  let error=null;
  try{
    await service.open(workspace.root);
    taskId=(await service.createTask({request:scenario.turns[0].user})).id;
    for(turn=0;turn<scenario.turns.length;turn++){
      step=0;await service.startAgent(turn?{taskId,answer:scenario.turns[turn].user}:{taskId});await service.agent.promise;
      const task=service.task(taskId);
      if(task.state!=='review'){error=task.error||'run_'+task.state;break;}
    }
  }catch(cause){error=/^[a-z][a-z0-9_]{1,60}$/.test(cause?.message||'')?cause.message:'evaluation_failed';}
  const metrics=taskId?readRunMetrics(service.store,{taskId}):{events:[],summary:null};
  const compactions=metrics.events.filter(event=>event.kind==='metric_compaction').map(event=>({trigger:event.trigger,beforeTokens:event.beforeTokens,afterTokens:event.afterTokens}));
  try{service.dispose();service.store?.close();}catch{/* Already closed. */}
  const wire=last||[],whole=JSON.stringify(wire.filter(message=>message.role!=='system'));
  const kept=(scenario.kept||scenario.turns.map(item=>item.user)).map(item=>({text:item.slice(0,80),passed:wire.some(message=>message.role==='user'&&message.content===item)}));
  const probes=[];
  if(!error)for(const probe of scenario.probes){
    const began=Date.now();let answer='',failed=null;
    try{answer=String((await providers.complete([...wire,{role:'user',content:PROBE+probe.question}],[])).content||'');}catch(cause){failed=/^[a-z][a-z0-9_]{1,60}$/.test(cause?.message||'')?cause.message:'probe_failed';}
    probes.push({kind:probe.kind,question:probe.question,answer:answer.slice(0,1500),elapsedMs:Date.now()-began,...(failed?{error:failed}:{}),passed:!failed&&probe.expect.every(group=>group.some(item=>mentions(answer,item)))});
  }
  await workspace.dispose();
  return {id:scenario.id,title:scenario.title,corpus:scenario.corpus,contextLength:scenario.contextLength,error,elapsedMs:Date.now()-started,
    compactions,summaries,stepFailures:failures,finalCharacters:whole.length,compacted:whole.includes('<context_summary>'),kept,probes};
}

export function summarize(results){
  const byKind=Object.fromEntries(PROBE_KINDS.map(kind=>[kind,{total:0,passed:0}]));let probes=0,passed=0,kept=0,keptPassed=0,summaries=0,summaryMs=0,compactions=0,grew=0;
  for(const result of results){
    for(const probe of result.probes){probes++;byKind[probe.kind].total++;if(probe.passed){passed++;byKind[probe.kind].passed++;}}
    for(const item of result.kept){kept++;if(item.passed)keptPassed++;}
    summaries+=result.summaries.length;summaryMs+=result.summaries.reduce((sum,item)=>sum+item.elapsedMs,0);
    // A compaction that leaves more than it found cost a model call and freed nothing.
    for(const item of result.compactions){compactions++;if(item.afterTokens>=item.beforeTokens)grew++;}
  }
  return {scenarios:results.length,errors:results.filter(result=>result.error).length,notCompacted:results.filter(result=>!result.error&&!result.compacted).length,
    probes,passed,byKind,kept,keptPassed,summaries,summaryMs,compactions,grew};
}

export function render(report){
  const row=cells=>'| '+cells.join(' | ')+' |',{summary}=report,lines=['# 압축 품질 평가','',`- 모델: ${report.model}`,`- 후보: ${report.candidate.hash.slice(0,12)}`,''];
  lines.push('## 요약','',row(['지표','값']),row(['---','---:']),row(['시나리오',summary.scenarios]),row(['오류',summary.errors]),row(['압축이 일어나지 않음',summary.notCompacted]),
    row(['질문 통과',`${summary.passed}/${summary.probes}`]),row(['원문 유지',`${summary.keptPassed}/${summary.kept}`]),row(['요약 호출',summary.summaries]),row(['요약 시간(초)',Math.round(summary.summaryMs/1000)]),row(['압축 횟수',summary.compactions]),row(['줄지 않은 압축',summary.grew]),'');
  lines.push('## 질문 종류별','',row(['종류','통과','전체']),row(['---','---:','---:']),...PROBE_KINDS.map(kind=>row([kind,summary.byKind[kind].passed,summary.byKind[kind].total])),'');
  for(const result of report.results){
    lines.push(`## ${result.id} ${result.title}`,'',`- 문맥 한도: ${result.contextLength} 토큰, 마지막 요청 ${result.finalCharacters}자, 압축 ${result.compactions.length}회, 요약 호출 ${result.summaries.length}회`+(result.error?`, 오류 ${result.error}`:''),'',row(['종류','결과','질문','답']),row(['---','---','---','---']));
    for(const probe of result.probes)lines.push(row([probe.kind,probe.passed?'통과':'**실패**',probe.question.replace(/\|/g,'/'),probe.answer.replace(/\s+/g,' ').replace(/\|/g,'/').slice(0,160)]));
    lines.push('',...result.kept.filter(item=>!item.passed).map(item=>`- 원문이 남지 않음: ${item.text.replace(/\s+/g,' ')}`),'');
  }
  lines.push('시나리오 수가 적습니다. 이 표는 차이를 보여줄 뿐 우열을 입증하지 않습니다. 공개 자료와 합성 자료로 측정했습니다.','');
  return lines.join('\n');
}

export async function evaluateCompaction({providers,scenarios,outputDir,candidate,parent,corpusDirectory,onResult=()=>{}}){
  const results=[];
  for(const scenario of scenarios){const result=await runScenario({scenario,providers,parent,corpusDirectory});results.push(result);onResult(result);}
  const report={kind:REPORT_KIND,createdAt:new Date().toISOString(),model:providers.status().model,candidate,summary:summarize(results),results};
  if(outputDir){await mkdir(outputDir,{recursive:true});await writeFile(path.join(outputDir,'report.json'),JSON.stringify(report,null,2));await writeFile(path.join(outputDir,'report.md'),render(report));}
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
  const socketPath=option('socket'),outputDir=option('out'),only=option('only');
  if(!socketPath||!outputDir){console.error('사용법: node eval/compaction.mjs --socket <경로> --out <폴더> [--only P1]');process.exit(2);}
  const providers=await connectRelayProviders({socketPath});
  try{
    const scenarios=(await loadScenarios()).filter(item=>!only||item.id.startsWith(only));
    const report=await evaluateCompaction({providers,scenarios,outputDir:path.resolve(outputDir),candidate:await candidateIdentity(),
      onResult:result=>console.log((result.error?'error':'done').padEnd(6),result.id.padEnd(28),`질문 ${result.probes.filter(probe=>probe.passed).length}/${result.probes.length}`,`원문 ${result.kept.filter(item=>item.passed).length}/${result.kept.length}`,`요약 ${result.summaries.length}회`,result.error||'')});
    console.log(JSON.stringify({model:report.model,probes:`${report.summary.passed}/${report.summary.probes}`,kept:`${report.summary.keptPassed}/${report.summary.kept}`,summaries:report.summary.summaries,grew:report.summary.grew,report:path.join(path.resolve(outputDir),'report.md')},null,2));
  }finally{providers.dispose?.();}
}
