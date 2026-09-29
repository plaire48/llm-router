import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {DEFAULT_SETTINGS,ORIGIN} from '../core.js';
import {UPSTREAM,evaluateArtifacts} from './evaluate-webarena.mjs';
import {benchmarkPlan,validateDatasetExport,benchmarkHarFilter,benchmarkOrigins,validateAgentInputs,freshBenchmarkSites,parseBenchmarkAnswer,validateBenchmarkHar,RESPONSE_INSTRUCTION,digest,command} from './webarena-runner.mjs';
import {trackModelEvidence} from './evaluation-model-evidence.mjs';
import {digestTree} from './verification-inputs.mjs';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const output=resolve('verification',`webarena-run-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(output,{recursive:true});
const report={upstream:UPSTREAM,status:'not_configured',actualBrowser:false,actualModel:false,nubiCapabilityScore:null,trials:[]};
const persist=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
try{
 const {values}=parseArgs({options:{config:{type:'string'},tasks:{type:'string'},repeats:{type:'string',default:'3'},headed:{type:'boolean',default:false}}});
 if(!values.config||!values.tasks||!process.env.NUBI_EVAL_TOKEN){report.reason='Set an isolated benchmark config, task IDs and NUBI_EVAL_TOKEN. No environment reset or model call was performed.';process.exitCode=2;}
 else {
  if(!/^\d+(,\d+)*$/.test(values.tasks))throw Error('Invalid task IDs');const ids=values.tasks.split(',').map(Number),repeats=Number(values.repeats);
  if(new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id))||!Number.isInteger(repeats)||repeats<1||repeats>5)throw Error('Invalid benchmark plan');
  const plan=benchmarkPlan(JSON.parse(await readFile(values.config,'utf8'))),binary=process.env.NUBI_WEBARENA_BIN||'webarena-verified';
  if(await command(binary,['--version'])!==`webarena-verified ${UPSTREAM.version}`)throw Error('Official evaluator version mismatch');
  const cfgPath=join(output,'config.json');await writeFile(cfgPath,JSON.stringify({environments:plan.environments}));
  const datasetPath=join(output,'official-dataset.json');await command(binary,['dataset-get','--output',datasetPath]);
  report.datasetExportSha256=validateDatasetExport(await readFile(datasetPath));
  const inputPath=join(output,'agent-input.json');await command(binary,['agent-input-get','--task-ids',values.tasks,'--config',cfgPath,'--output',inputPath]);
  const tasks=validateAgentInputs(JSON.parse(await readFile(inputPath,'utf8')),ids,plan);
  const model=process.env.NUBI_EVAL_MODEL||DEFAULT_SETTINGS.modelId;report.model=model;report.repeats=repeats;report.plannedTaskIds=ids;report.candidate=await digestTree(resolve('dist'));report.status='running';await persist();
  for(let trial=1;trial<=repeats;trial++)for(const task of tasks){
   const started=Date.now(),record={taskId:task.task_id,trial,status:'running',actualModel:false};report.trials.push(record);
   const folder=join(output,`trial-${trial}`,String(task.task_id));await mkdir(folder,{recursive:true});
   const sites=Object.fromEntries(task.sites.map(site=>[site,plan.sites[site]])),origins=benchmarkOrigins(sites);
   let environment,context,profile,evidence;
   try{
    environment=await freshBenchmarkSites(sites);record.reset=environment.receipts;await persist();
    profile=await mkdtemp(join(tmpdir(),'nubi-webarena-'));const extension=join(profile,'extension');await cp('dist',extension,{recursive:true});
    const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));manifest.host_permissions.push(...[...origins].map(origin=>origin+'/*'));await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
    record.harnessManifestHash=digest(JSON.stringify(manifest));
    context=await chromium.launchPersistentContext(profile,{headless:!values.headed,executablePath:process.env.CHROME_BINARY||chromium.executablePath(),recordHar:{path:join(folder,'network.har'),content:'embed',mode:'full',urlFilter:benchmarkHarFilter(sites)},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});report.actualBrowser=true;
    await context.route('**/*',async route=>{
     const origin=new URL(route.request().url()).origin;
     if(origins.has(origin)){const site=Object.values(sites).find(site=>site.origin===origin);return route.continue({headers:{...route.request().headers(),...site.headers}});}
     if(origin===ORIGIN||route.request().url().startsWith('chrome-extension://'))return route.continue();
     return route.abort();
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async({token,model})=>{await chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:Date.now()}});await chrome.storage.local.set({settings:{modelId:model},browserWorkMode:'current'});},{token:process.env.NUBI_EVAL_TOKEN,model});
    const source=await context.newPage();await source.goto(task.start_urls[0]);
    const sourceTabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url)?.id,source.url());if(!Number.isInteger(sourceTabId))throw Error('Benchmark source tab missing');
    const ui=await context.newPage();await ui.goto(worker.url().replace(/background\.js$/,'index.html'));
    const state=async()=>(await ui.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STATE'}))).data;
    for(let i=0;i<200&&!(await state()).catalog?.models?.length;i++)await new Promise(r=>setTimeout(r,100));
    const ready=await state();if(ready.settings.modelId!==model||!ready.catalog?.models?.some(item=>item.name===model))throw Error('Evaluation model unavailable');
    const uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);await worker.evaluate(({uiId,sourceTabId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:sourceTabId}}),{uiId,sourceTabId});
    evidence=trackModelEvidence(context,model);
    await ui.getByRole('textbox',{name:'메시지',exact:true}).fill(task.intent+'\nStart URLs: '+task.start_urls.join(', ')+'\n'+RESPONSE_INSTRUCTION);await ui.getByRole('button',{name:'전송',exact:true}).click();
    let current,message;const until=Date.now()+180000;
    while(Date.now()<until&&evidence.requests<=80){current=await state();message=current.chat.messages.at(-1);if(current.nativeDialog||current.chat.task?.status==='awaiting_user'||message?.role==='assistant'&&['done','error'].includes(message.state))break;await new Promise(r=>setTimeout(r,200));}
    record.status=current?.nativeDialog||current?.chat.task?.status==='awaiting_user'?'awaiting_user':message?.state==='done'?'answered':message?.state==='error'?'agent_error':'budget_exhausted';
    if(record.status==='answered')await writeFile(join(folder,'agent_response.json'),JSON.stringify(parseBenchmarkAnswer(message.content),null,2));
    // Retain failed attempts, but never fabricate an official agent answer.
    await writeFile(join(folder,'run-result.json'),JSON.stringify({status:record.status,answer:message?.content||'',error:message?.error||null,review:current?.chat.task?.goalReview?.status||null},null,2));
    Object.assign(record,await evidence.finish());evidence=null;record.actualModel=record.modelResponses>0;report.actualModel ||=record.actualModel;
    await context.close();context=null;record.capture=validateBenchmarkHar(JSON.parse(await readFile(join(folder,'network.har'),'utf8')),sites);
    record.artifactHashes={har:digest(await readFile(join(folder,'network.har')))};
    if(record.status==='answered'){
     record.artifactHashes.answer=digest(await readFile(join(folder,'agent_response.json')));
     const result=await evaluateArtifacts({logs:join(output,`trial-${trial}`),config:cfgPath,tasks:String(task.task_id),binary,outputRoot:output});record.official=result.report.tasks[0];record.officialOutput=result.output;
     record.status=record.official.status;
    }
   }catch{record.status='error';record.reason='Environment, browser, answer format or official evaluation failed. Inspect retained artifacts; no automatic retry.';}
   finally{
    if(evidence)Object.assign(record,await evidence.finish());record.actualModel=record.modelResponses>0;report.actualModel ||=record.actualModel;
    await context?.close().catch(()=>{});if(profile)await rm(profile,{recursive:true,force:true});
    try{await environment?.close();}catch{record.status='cleanup_error';record.reason='Owned benchmark container cleanup requires inspection.';}
    record.durationMs=Date.now()-started;await persist();
   }
   if(['error','cleanup_error'].includes(record.status))throw Error('Stopped after environment or artifact error; unfinished trials remain unmeasured');
  }
  report.completedTrials=report.trials.length;
  report.observedSuccessRate=report.trials.filter(item=>item.official?.status==='success').length/(ids.length*repeats);
  report.status=report.trials.every(item=>item.official?.status==='success')?'passed':'failed';process.exitCode=report.status==='passed'?0:1;
 }
}catch(error){report.status='failed';report.reason=error.message.includes('Stopped after')?error.message:'Benchmark preflight or setup failed. No capability score is available.';process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await persist();console.log(output);}
