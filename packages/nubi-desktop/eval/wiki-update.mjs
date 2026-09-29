// Live measurement of the OpenWiki update that Desktop proposes and runs on
// approval (user decision 2026-09-29).
//
// Setup: OpenWiki generates a Wiki for the order-service corpus with the same
// runner and model (init). The generated pages are committed without the
// AGENTS.md managed section, so the Wiki starts current. Then one source change
// is committed, and Desktop's flow runs: status, propose, run, apply.
//
// Usage: node eval/wiki-update.mjs --socket <path> --out <directory>
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createWorkspace} from './corpus.mjs';
import {connectRelayProviders} from './relay.mjs';
import {candidateIdentity} from './candidate.mjs';

const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
const socketPath=option('socket'),outputDir=option('out');
if(!socketPath||!outputDir){console.error('사용법: node eval/wiki-update.mjs --socket <경로> --out <폴더>');process.exit(2);}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const RUN_LIMIT_MS=40*60*1000;

const workspace=await createWorkspace({corpus:'order-service'});
// OpenWiki installs its bundled skills in its home. The evaluation keeps that home in its own folder.
process.env.OPENWIKI_CONFIG_DIR=path.join(workspace.directory,'openwiki-home');
const {ProjectService}=await import('../runtime/project-service.mjs');
const {git}=await import('../runtime/files.mjs');
const {defaultWikiUpdater}=await import('../runtime/wiki-update.mjs');
const {readRunMetrics}=await import('../runtime/run-metrics.mjs');
const relay=await connectRelayProviders({socketPath});
// Every model request of the runner, counted by outcome: the model connections reject some responses (response_invalid).
const requests={ok:0,rejected:0};
const providers={status:()=>relay.status(),dispose:()=>relay.dispose?.(),async complete(...args){try{const result=await relay.complete(...args);requests.ok++;return result;}catch(error){if(error.message==='response_invalid')requests.rejected++;throw error;}}};
const counted=()=>{const value={...requests};requests.ok=0;requests.rejected=0;return value;};
const root=workspace.root,service=new ProjectService({storageRoot:workspace.stateRoot});
const report={corpus:workspace.corpus,corpusHash:workspace.corpusHash,candidate:await candidateIdentity(),model:providers.status().model,steps:{}};
const summary=metrics=>({modelCalls:metrics.summary.modelCalls,retries:metrics.summary.retries,promptTokens:metrics.summary.promptTokens,completionTokens:metrics.summary.completionTokens,elapsedMs:metrics.summary.elapsedMs});
const commit=async message=>{await git(root,['add','-A']);await git(root,['commit','-qm',message]);return (await git(root,['rev-parse','HEAD'])).trim();};
try{
  await service.open(root);service.providers=providers;

  // 1. OpenWiki generates the Wiki (setup, not a Desktop feature).
  await rm(path.join(root,'openwiki'),{recursive:true,force:true});await commit('Without a Wiki');
  // The same runner and model connection as the update, in init mode.
  let started=Date.now();const initEvents=[];
  const init=await defaultWikiUpdater(service)({root,mode:'init',language:'ko',signal:new AbortController().signal,updateId:'init',onEvent:event=>{if(event.type==='progress')initEvents.push(event);}});
  const managed=(await git(root,['status','--porcelain','--untracked-files=all'])).split('\n').filter(Boolean).map(line=>line.slice(3)).filter(rel=>!rel.startsWith('openwiki/'));
  for(const rel of managed){try{await git(root,['checkout','--',rel]);}catch{await rm(path.join(root,rel),{force:true});}}
  await commit('OpenWiki init');
  const pages=(await git(root,['ls-files','openwiki'])).split('\n').filter(rel=>rel.endsWith('.md'));
  report.steps.init={result:init,elapsedMs:Date.now()-started,requests:counted(),pages,notCommitted:managed,progress:initEvents.filter(event=>event.stage!=='generating'||event.page),...summary(readRunMetrics(service.store,{taskId:'wiki-update:init'}))};
  report.steps.initialStatus=(await service.invoke('wikiUpdate',{method:'status'})).status;

  // 2. One source change: the Jeju and island surcharge goes from 4,500 to 5,500 won.
  const replace=async(rel,pairs)=>{let text=await readFile(path.join(root,rel),'utf8');for(const [from,to] of pairs){if(!text.includes(from))throw Error('change_missing:'+rel);text=text.replaceAll(from,to);}await writeFile(path.join(root,rel),text);};
  await replace('src/shipping.mjs',[['REMOTE_EXTRA = 4500','REMOTE_EXTRA = 5500']]);
  await replace('test/shipping.test.mjs',[["'jeju'), 7500","'jeju'), 8500"],["'island'), 4500","'island'), 5500"]]);
  await commit('Remote surcharge 5,500 won');

  // 3. Desktop's flow.
  const stale=(await service.invoke('wikiUpdate',{method:'status'})).status;
  report.steps.staleStatus=stale;
  const proposed=await service.invoke('wikiUpdate',{method:'propose'});
  started=Date.now();
  await service.invoke('wikiUpdate',{method:'run',id:proposed.id,fingerprint:proposed.fingerprint});
  let current;
  for(;;){
    current=(await service.invoke('wikiUpdate',{method:'status'})).updates.find(item=>item.id===proposed.id);
    if(!['running','proposed'].includes(current.state))break;
    if(Date.now()-started>RUN_LIMIT_MS){await service.invoke('wikiUpdate',{method:'cancel',id:proposed.id});}
    await pause(2000);
  }
  report.steps.run={state:current.state,error:current.error||null,elapsedMs:Date.now()-started,requests:counted(),changes:current.changes||[],outside:current.outside||[],result:current.result||null,progress:(current.events||[]).filter(event=>event.stage!=='generating'||event.page).map(({at,...event})=>event),...summary(readRunMetrics(service.store,{taskId:'wiki-update:'+proposed.id}))};
  if(current.state==='ready'){
    await service.invoke('wikiUpdate',{method:'apply',id:proposed.id,fingerprint:current.fingerprint});
    report.steps.afterApply=(await service.invoke('wikiUpdate',{method:'status'})).status;
    // Whether the pages now state the new amount, and still the old one.
    const texts=await Promise.all(pages.map(async rel=>[rel,await readFile(path.join(root,rel),'utf8').catch(()=>'')]));
    report.steps.content={mentionsNew:texts.filter(([,text])=>/5,?500/.test(text)).map(([rel])=>rel),mentionsOld:texts.filter(([,text])=>/4,?500/.test(text)).map(([rel])=>rel)};
    report.steps.workspace=(await git(root,['status','--porcelain','--untracked-files=all'])).split('\n').filter(Boolean);
  }
}catch(error){report.error=String(error?.message||error).slice(0,300);}
finally{
  await mkdir(path.resolve(outputDir),{recursive:true});
  await writeFile(path.join(path.resolve(outputDir),'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({init:report.steps.init&&{pages:report.steps.init.pages.length,modelCalls:report.steps.init.modelCalls,rejected:report.steps.init.requests.rejected,seconds:Math.round(report.steps.init.elapsedMs/1000)},initial:report.steps.initialStatus?.state,stale:report.steps.staleStatus&&{changed:report.steps.staleStatus.changedFiles,pages:report.steps.staleStatus.stalePages?.length},run:report.steps.run&&{state:report.steps.run.state,modelCalls:report.steps.run.modelCalls,rejected:report.steps.run.requests.rejected,seconds:Math.round(report.steps.run.elapsedMs/1000),changes:report.steps.run.changes.length},after:report.steps.afterApply?.state,content:report.steps.content,error:report.error||null},null,1));
  try{service.dispose();service.store?.close();}catch{/* Already closed. */}
  relay.dispose?.();
  if(!report.error)await workspace.dispose();
}
