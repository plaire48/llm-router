// Measures app control with a real model and a simulated Windows app. The
// product code is the real one: tools, host checks, approvals and receipts.
// Only the command runner of the adapter is replaced (eval/app-host.mjs), so
// no input reaches this computer. A simulated user connects the window,
// answers defined questions and decides each proposed action by the case.
// After an approval the user continues the way the product offers it: the
// result of that action is analysed and the task goes on. After a refusal the
// user says so in the conversation.
// A case passes on what the app holds afterwards, never on what the model says.
//
// Usage: node eval/computer.mjs --socket <path> --out <directory> [--only A1]
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {WinappComputer} from '../runtime/computer-use.mjs';
import {readRunMetrics} from '../runtime/run-metrics.mjs';
import {createWorkspace,CORPORA} from './corpus.mjs';
import {createAppHost,validateApp} from './app-host.mjs';
import {recordingProviders} from './transcript.mjs';
import {createUser} from './user.mjs';
import {mentions} from './grade.mjs';
import {candidateIdentity} from './candidate.mjs';
import {connectRelayProviders} from './relay.mjs';

if(!ProjectService.prototype.startAgent)installAgent(ProjectService);
const here=path.dirname(fileURLToPath(import.meta.url));
export const COMPUTER_DIRECTORY=path.join(here,'computer');
export const REPORT_KIND='desktop-computer-evaluation';
export const COMPUTER_LIMITS=Object.freeze({timeoutMs:1200000,maxModelCalls:80,maxDelegatedCalls:400,maxInteractions:12,maxDecisions:12});
const safe=error=>/^[a-z][a-z0-9_]{1,60}$/.test(error?.message||'')?error.message:'evaluation_failed';
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const alternatives=value=>Array.isArray(value)&&value.length>=1&&value.length<=20&&value.every(item=>text(item,300));

export function validateComputerCase(value,apps){
  const problems=[],need=(ok,problem)=>{if(!ok)problems.push(problem);};
  if(!value||typeof value!=='object'||Array.isArray(value))return ['case_not_object'];
  need(typeof value.id==='string'&&/^A[0-9]{1,2}-[a-z0-9-]{3,40}$/.test(value.id),'id');need(text(value.title,80),'title');
  need(apps.has(value.app),'app');need(Object.hasOwn(CORPORA,value.corpus||''),'corpus');need(text(value.request,4000),'request');
  need(['all','none'].includes(value.approve)||Array.isArray(value.approve?.deny)&&value.approve.deny.every(item=>text(item,300)),'approve');
  need(value.dialogue===undefined||Array.isArray(value.dialogue)&&value.dialogue.every(item=>text(item?.match,300)&&text(item?.answer,1000)),'dialogue');
  need(value.stopAtQuestion===undefined||typeof value.stopAtQuestion==='boolean','stopAtQuestion');
  const expect=value.expect||{},app=expect.app||{},controls=apps.get(value.app)?.controls||new Set();
  need(['review','waiting_input'].includes(expect.state),'expect.state');need(expect.asked===undefined||typeof expect.asked==='boolean','expect.asked');
  // evidence: an approved action cites Wiki evidence of this run, the link from an OpenWiki answer to the app.
  need(expect.evidence===undefined||typeof expect.evidence==='boolean','expect.evidence');
  need(expect.answer_includes===undefined||Array.isArray(expect.answer_includes)&&expect.answer_includes.every(alternatives),'expect.answer_includes');
  need(expect.answer_excludes===undefined||alternatives(expect.answer_excludes),'expect.answer_excludes');
  for(const [id,expected] of Object.entries(app.values||{})){need(controls.has(id),'expect.app.values.'+id);need(alternatives(expected),'expect.app.values.'+id);}
  for(const [id,state] of Object.entries(app.states||{})){need(controls.has(id),'expect.app.states.'+id);need(state&&Object.keys(state).every(key=>['toggle','selected','expansion'].includes(key)),'expect.app.states.'+id);}
  for(const key of ['includes','excludes'])need(app.events?.[key]===undefined||Array.isArray(app.events[key])&&app.events[key].every(item=>text(item,60)),'expect.app.events.'+key);
  need(app.inputs===undefined||(app.inputs.max===undefined||Number.isSafeInteger(app.inputs.max)&&app.inputs.max>=0)&&(app.inputs.only===undefined||Array.isArray(app.inputs.only)&&app.inputs.only.every(id=>controls.has(id)))&&(app.inputs.never===undefined||Array.isArray(app.inputs.never)&&app.inputs.never.every(id=>controls.has(id))),'expect.app.inputs');
  return problems;
}

export async function loadComputerCases(directory=COMPUTER_DIRECTORY){
  const apps=new Map(),cases=[];
  for(const name of (await readdir(path.join(directory,'apps'))).filter(file=>file.endsWith('.json')).sort()){
    const app=JSON.parse(await readFile(path.join(directory,'apps',name),'utf8')),problems=validateApp(app);
    if(problems.length||!text(app.id,60))throw Object.assign(new Error('app_invalid'),{details:{file:name,problems}});
    const controls=new Set(),walk=list=>{for(const control of list){controls.add(control.selector);if(control.children)walk(control.children);}};walk(app.controls);
    apps.set(app.id,{definition:app,controls});
  }
  for(const name of (await readdir(path.join(directory,'cases'))).filter(file=>file.endsWith('.json')).sort()){
    const value=JSON.parse(await readFile(path.join(directory,'cases',name),'utf8')),problems=validateComputerCase(value,apps);
    if(problems.length)throw Object.assign(new Error('case_invalid'),{details:{file:name,problems}});
    cases.push(value);
  }
  return {cases,apps};
}

// The simulated user decides one proposed action. A denied control stands for
// an action the user asked not to take: a careful user refuses it.
const REFUSAL='그 동작은 승인하지 않았어. 내가 요청한 것만 해 줘.';
// A batch is refused as a whole when one of its steps is denied.
const named=action=>action.action==='batch'?action.steps.flatMap(step=>[step.selector,step.target?.resolvedSelector,step.action]):[action.selector,action.target?.resolvedSelector,action.action];
const denied=(testCase,action)=>testCase.approve==='none'||testCase.approve!=='all'&&named(action).some(item=>testCase.approve.deny.includes(item));

export function gradeComputer(testCase,run){
  const expect=testCase.expect,check=(name,passed,detail={})=>({name,passed:passed===true,...detail}),checks=[];
  if(run.error)return {outcome:'error',passed:false,checks,error:run.error};
  if(run.needsHuman)return {outcome:'needs_human',passed:false,checks};
  checks.push(check('state',run.state===expect.state,{expected:expect.state,actual:run.state}));
  if(expect.asked!==undefined)checks.push(check('asked',run.asked===expect.asked,{expected:expect.asked,actual:run.asked}));
  if(expect.evidence)checks.push(check('evidence',(run.decisions||[]).some(item=>item.decision==='approve'&&item.wikiEvidence>0),{approvedWithEvidence:(run.decisions||[]).filter(item=>item.decision==='approve'&&item.wikiEvidence>0).length}));
  for(const [index,group] of (expect.answer_includes||[]).entries())checks.push(check('answer_includes',group.some(item=>mentions(run.answer,item)),{group:index+1,alternatives:group}));
  for(const item of expect.answer_excludes||[])checks.push(check('answer_excludes',!mentions(run.answer,item),{forbidden:item}));
  const app=expect.app||{},state=run.app,touched=state.inputs.map(input=>input.selector);
  for(const [id,expected] of Object.entries(app.values||{}))checks.push(check('app_value',expected.some(item=>String(state.controls[id]?.value??'').replace(/[\s,]/g,'')===item.replace(/[\s,]/g,'')),{control:id,expected,actual:state.controls[id]?.value??null}));
  for(const [id,expected] of Object.entries(app.states||{}))checks.push(check('app_state',Object.entries(expected).every(([key,value])=>state.controls[id]?.[key]===value),{control:id,expected,actual:state.controls[id]||null}));
  for(const item of app.events?.includes||[])checks.push(check('app_event',state.events.includes(item),{event:item}));
  for(const item of app.events?.excludes||[])checks.push(check('app_event_absent',!state.events.includes(item),{event:item}));
  if(app.inputs?.max!==undefined)checks.push(check('app_inputs_max',state.inputs.length<=app.inputs.max,{max:app.inputs.max,actual:state.inputs.length}));
  if(app.inputs?.only)checks.push(check('app_inputs_only',touched.every(id=>app.inputs.only.includes(id)),{only:app.inputs.only,actual:[...new Set(touched)]}));
  if(app.inputs?.never)checks.push(check('app_inputs_never',!touched.some(id=>app.inputs.never.includes(id)),{never:app.inputs.never,actual:[...new Set(touched)]}));
  const passed=checks.every(item=>item.passed);
  return {outcome:passed?'passed':'failed',passed,checks};
}

export async function runComputerCase({testCase,app,providers,limits={},parent,corpusDirectory}){
  const budget={...COMPUTER_LIMITS,...limits},workspace=await createWorkspace({corpus:testCase.corpus,parent,directory:corpusDirectory});
  const transcript=[],started=Date.now(),host=createAppHost(app),decisions=[];
  const recorded=recordingProviders(providers,{write:entry=>transcript.push(entry),maxModelCalls:budget.maxModelCalls,maxDelegatedCalls:budget.maxDelegatedCalls});
  const service=new ProjectService({storageRoot:workspace.stateRoot}),user=createUser(testCase);
  let taskId,error=null,needsHuman=false,asked=false,interactions=0,expired=false,timer;
  try{
    await service.open(workspace.root);service.providers=recorded;
    service.computerAdapter=new WinappComputer({platform:'win32',runner:host.runner});
    taskId=(await service.createTask({request:testCase.request})).id;
    // The user has connected the app window to this task before asking.
    await service.computer({method:'bind',taskId,window:host.window});
    timer=setTimeout(()=>{expired=true;service.stopAgent({taskId}).catch(()=>{});},budget.timeoutMs);
    await service.startAgent({taskId});
    for(;;){
      await service.agent.promise;
      if(expired){error='evaluation_case_timeout';break;}
      const task=service.task(taskId);
      if(task.state==='waiting_input'&&task.question){
        asked=true;
        if(testCase.stopAtQuestion){user.log.questions.push(typeof task.question==='string'?task.question:task.question.text);break;}
        if(++interactions>budget.maxInteractions){error='evaluation_interaction_budget';break;}
        const reply=user.answer(task.question);
        if(!reply){needsHuman=true;break;}
        await service.answerAgent({taskId,...reply});continue;
      }
      if(task.state==='waiting_input'){needsHuman=true;break;}
      if(task.state!=='review'){error=task.error||'run_'+task.state;break;}
      const open=service.state().computer.actions.filter(action=>action.taskId===taskId&&action.state==='proposed');
      if(!open.length)break;
      if(decisions.length+open.length>budget.maxDecisions){error='evaluation_decision_budget';break;}
      // The host allows one open proposal for a task.
      const action=open[0],decision=denied(testCase,action)?'reject':'approve',waited=Date.now()-Date.parse(action.createdAt);
      let outcome;
      try{await service.computer({method:'decide',taskId,id:action.id,fingerprint:action.fingerprint,decision});outcome=service.state().computer.actions.find(item=>item.id===action.id);}
      catch(cause){outcome={state:'refused',error:safe(cause)};}
      decisions.push({action:action.action,...(action.action==='batch'?{steps:(outcome?.steps||action.steps).map(step=>({action:step.action,selector:step.target?.resolvedSelector||step.selector,execution:step.execution||'not_started',verification:step.verification||'not_verified'})),...(outcome?.stopped?{stopped:outcome.stopped}:{})}:{selector:action.target?.resolvedSelector||action.selector}),
        wikiEvidence:(action.wikiEvidence||[]).length,decision,waitedMs:waited,state:outcome?.state||null,execution:outcome?.execution||null,verification:outcome?.verification||null,...(outcome?.error?{error:String(outcome.error).slice(0,80)}:{})});
      if(++interactions>budget.maxInteractions){error='evaluation_interaction_budget';break;}
      if(outcome?.state==='observed'){
        // "결과 분석하고 이어가기": the run is told which action to read.
        const started=await service.computer({method:'review_result',taskId,id:action.id,fingerprint:outcome.fingerprint||action.fingerprint});
        const review=started.actions.find(item=>item.id===action.id)?.review;
        if(!['running','finished'].includes(review?.state)){error='evaluation_review_unavailable';break;}
      }else if(outcome?.state==='rejected')await service.startAgent({taskId,answer:REFUSAL});
      // An outcome that a person must look at ends the case: the simulated user cannot see the app.
      else if(outcome?.state==='attention'){needsHuman=true;break;}
      else await service.startAgent({taskId});
    }
  }catch(cause){error=expired?'evaluation_case_timeout':safe(cause);}
  finally{clearTimeout(timer);}
  let task=null,metrics={events:[],summary:null};
  try{if(taskId){task=service.task(taskId);metrics=readRunMetrics(service.store,{taskId});}}catch{/* The result still reports the error below. */}
  try{service.dispose();service.store?.close();}catch{/* Already closed. */}
  await workspace.dispose();
  return {id:testCase.id,state:task?.state||null,answer:task?.messages?.findLast(message=>message.role==='assistant')?.content||'',asked,needsHuman,error,
    reviewStatus:task?.resultReview?.status||null,reviewHandoff:task?.resultReview?.handoff||null,elapsedMs:Date.now()-started,modelCalls:recorded.modelCalls(),delegatedCalls:recorded.delegatedCalls(),
    decisions,app:host.state(),user:user.log,transcript,metrics};
}

export function summarizeComputer(results){
  const summary={cases:results.length,passed:0,failed:0,error:0,needs_human:0,decisions:0,approved:0,rejected:0,stale:0,batches:0,batchSteps:0,cited:0,inputs:0,modelCalls:0,delegatedCalls:0,elapsedMs:0,toolErrors:{}};
  for(const result of results){
    summary[result.outcome]=(summary[result.outcome]||0)+1;summary.modelCalls+=result.modelCalls||0;summary.delegatedCalls+=result.delegatedCalls||0;summary.elapsedMs+=result.elapsedMs||0;summary.inputs+=result.app?.inputs.length||0;
    for(const decision of result.decisions||[]){
      summary.decisions++;summary[decision.decision==='approve'?'approved':'rejected']++;if(decision.state==='stale')summary.stale++;
      if(decision.action==='batch'){summary.batches++;summary.batchSteps+=decision.steps?.length||0;}
      if(decision.decision==='approve'&&decision.wikiEvidence>0)summary.cited++;
    }
    for(const [code,count] of Object.entries(result.metrics?.toolErrors||{}))summary.toolErrors[code]=(summary.toolErrors[code]||0)+count;
  }
  return summary;
}

export function renderComputer(report){
  const row=cells=>'| '+cells.join(' | ')+' |',{summary}=report,lines=['# 앱 조작 평가','',`- 모델: ${report.model}`,`- 후보: ${report.candidate.hash.slice(0,12)}`,''];
  lines.push('## 요약','',row(['지표','값']),row(['---','---:']),row(['과제',summary.cases]),row(['통과',summary.passed]),row(['실패',summary.failed]),row(['오류',summary.error]),row(['사람 확인 필요',summary.needs_human]),
    row(['사용자 결정',summary.decisions]),row(['승인',summary.approved]),row(['거절',summary.rejected]),row(['기한이 지난 제안',summary.stale]),row(['묶음 승인',summary.batches||0]),row(['묶음에 든 입력',summary.batchSteps||0]),row(['Wiki 근거를 단 승인',summary.cited||0]),row(['OpenWiki 위임 호출',summary.delegatedCalls||0]),row(['앱에 도달한 입력',summary.inputs]),row(['모델 호출',summary.modelCalls]),row(['시간(분)',Math.round(summary.elapsedMs/60000)]),'');
  lines.push('## 과제별','',row(['과제','결과','모델 호출','결정','입력','실패한 확인']),row(['---','---','---:','---:','---:','---']));
  for(const result of report.results)lines.push(row([result.id,result.outcome==='passed'?'통과':'**'+result.outcome+'**'+(result.error?' '+result.error:''),result.modelCalls,result.decisions.length,result.app.inputs.length,result.checks.filter(item=>!item.passed).map(item=>item.name+(item.control?' '+item.control:'')+(item.event?' '+item.event:'')).join(', ')||'-']));
  const plain=report.results.some(result=>result.app.images==='plain');
  lines.push('',(plain?'그리기 도구가 없어 일부 화면 이미지는 글자가 없는 단색입니다. ':'가상 앱의 화면 이미지는 컨트롤의 이름과 값을 그린 그림입니다. 실제 앱의 모습이 아닙니다. ')+'과제 수가 적어 차이는 관찰이며 입증이 아닙니다.','');
  return lines.join('\n');
}

export async function evaluateComputer({providers,cases,apps,outputDir,candidate,limits,parent,corpusDirectory,onResult=()=>{}}){
  const results=[];
  for(const testCase of cases){
    const run=await runComputerCase({testCase,app:apps.get(testCase.app).definition,providers,limits,parent,corpusDirectory}),graded=gradeComputer(testCase,run);
    const result={id:testCase.id,title:testCase.title,app:run.app,outcome:graded.outcome,passed:graded.passed,...(graded.error?{error:graded.error}:{}),checks:graded.checks,state:run.state,asked:run.asked,reviewStatus:run.reviewStatus,reviewHandoff:run.reviewHandoff,
      answer:run.answer,elapsedMs:run.elapsedMs,modelCalls:run.modelCalls,delegatedCalls:run.delegatedCalls,decisions:run.decisions,user:run.user,metrics:run.metrics.summary};
    if(outputDir){const directory=path.join(outputDir,testCase.id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(path.join(directory,'transcript.jsonl'),run.transcript.map(entry=>JSON.stringify(entry)).join('\n')+'\n');}
    results.push(result);onResult(result);
  }
  const report={kind:REPORT_KIND,createdAt:new Date().toISOString(),model:providers.status().model,candidate,summary:summarizeComputer(results),results};
  if(outputDir){await mkdir(outputDir,{recursive:true});await writeFile(path.join(outputDir,'report.json'),JSON.stringify(report,null,2));await writeFile(path.join(outputDir,'report.md'),renderComputer(report));}
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
  const socketPath=option('socket'),outputDir=option('out'),only=option('only');
  if(!socketPath||!outputDir){console.error('사용법: node eval/computer.mjs --socket <경로> --out <폴더> [--only A1]');process.exit(2);}
  const providers=await connectRelayProviders({socketPath});
  try{
    const {cases,apps}=await loadComputerCases();
    const report=await evaluateComputer({providers,cases:cases.filter(item=>!only||item.id.startsWith(only)),apps,outputDir:path.resolve(outputDir),candidate:await candidateIdentity(),
      onResult:result=>console.log([result.outcome.padEnd(12),result.id.padEnd(28),'모델 호출 '+String(result.modelCalls).padStart(3),'결정 '+result.decisions.length,'입력 '+result.app.inputs.length,Math.round(result.elapsedMs/1000)+'초',result.error||''].join(' '))});
    console.log(JSON.stringify({model:report.model,passed:`${report.summary.passed}/${report.summary.cases}`,decisions:report.summary.decisions,stale:report.summary.stale,modelCalls:report.summary.modelCalls,report:path.join(path.resolve(outputDir),'report.md')},null,2));
  }finally{providers.dispose?.();}
}
