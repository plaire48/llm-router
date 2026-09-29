import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentQualityReport,qualityWorkStatus,qualityWorkMarkdown} from '../scripts/quality-status.mjs';
import {QUALITY_BASELINE, QUALITY_ONCE} from '../scripts/browser-verification-plan.mjs';
const once=new Set(QUALITY_ONCE);
const workOf=items=>({schemaVersion:2,items:items.map(item=>({title:item.id,nextAction:'검증 재실행',checks:['implemented','pending'].includes(item.state)?['unit']:[],...item}))});
const inputs={source:'now',tests:'new'};
test('implementation percentage includes pending and external work and excludes rejected alternatives',()=>{
 const work=workOf(['implemented','implemented','pending','external','not_selected'].map((state,i)=>({id:String(i),order:i+1,state,acceptance:'check'})));
 const status=qualityWorkStatus(work,[],inputs);
 assert.deepEqual(status.progress,{basis:'tracked_items_not_product_readiness',total:5,selected:4,implemented:2,pending:1,external:1,not_selected:1,implementationPercent:50,currentCoreVerified:null});
 assert.equal(status.actualModelQuality,null);assert.match(qualityWorkMarkdown(status),/50% \(2\/4\)/);
 assert.equal(qualityWorkStatus(work,[valid()],inputs).progress.currentCoreVerified,2);
 const excluded=qualityWorkStatus(workOf([{id:'x',order:1,state:'not_selected',acceptance:'rejected'}]),[],inputs);
 assert.equal(excluded.progress.implementationPercent,null);
});
const valid=()=>({path:'verification/current/report.json',report:{status:'passed',profile:'quality-baseline-v8',repeats:3,finishedAt:'2026-09-25T00:00:00Z',evidence:{actualBrowser:true},inputSha256:{...inputs},stages:['unit','design','candidate-build',...QUALITY_BASELINE.flatMap(x=>once.has(x)?[x]:[1,2,3].map(n=>`${x}-${n}`))].map(name=>({name,status:'passed',exitCode:0,timedOut:false}))}});
const full=()=>{const item=valid();Object.assign(item.report,{profile:'full',fullMatrix:true,selection:[...QUALITY_BASELINE,'extra-browser','more-browser']});
 item.report.stages.push(...['extra-browser','more-browser-1','more-browser-2','more-browser-3'].map(name=>({name,status:'passed',exitCode:0,timedOut:false})));return item;};
test('work status uses one current complete report and keeps external work unverified',()=>{
 const item=valid();const result=qualityWorkStatus(workOf([{id:'A',order:1,state:'implemented',acceptance:'source match'},{id:'B',order:2,state:'external',acceptance:'live account'}]),[item],inputs);
 assert.equal(result.currentCoreReport,item.path);assert.equal(result.items[0].verification,'current_core_passed');assert.equal(result.items[1].verification,'not_claimed');assert.equal(result.actualModelQuality,null);assert.equal(result.releaseApproved,false);
});
test('stale, partial, duplicate, interrupted and nonzero stages cannot certify the current source',()=>{
 for(const mutate of [r=>r.inputSha256.source='old',r=>r.stages.pop(),r=>r.stages[0]=r.stages[1],r=>r.status='running',r=>r.stages[0].exitCode=1,r=>r.repeats=1,r=>r.profile='selected']){
  const item=valid();mutate(item.report);assert.equal(currentQualityReport([item],inputs),null);
 }
 const a=valid(),b=valid();a.report.stages.splice(20);b.report.stages.splice(0,20);assert.equal(currentQualityReport([a,b],inputs),null);
});
test('pending work stays ordered and stale completed work asks for a fresh gate',()=>{
 const work=workOf([{id:'B',order:2,state:'pending',acceptance:'test'},{id:'A',order:1,state:'implemented',acceptance:'test'}]);
 assert.equal(qualityWorkStatus(work,[],inputs).next,'B');work.items.shift();assert.equal(qualityWorkStatus(work,[],inputs).next,'verify:quality');
 assert.throws(()=>qualityWorkStatus(workOf([work.items[0],work.items[0]]),[],inputs),/quality_work_invalid/);
});
test('the project work list has unique IDs and explicit acceptance conditions',async()=>{
 const work=JSON.parse(await readFile(new URL('../quality-work.json',import.meta.url),'utf8'));
 const result=qualityWorkStatus(work,[],inputs);assert(result.items.length>=15);assert(result.items.some(item=>item.id==='NQ-14'));
});

test('a newer failed or unfinished same-source gate invalidates the old pass',()=>{
 const older=valid();older.report.startedAt='2026-09-25T00:00:00Z';older.report.finishedAt='2026-09-25T00:05:00Z';
 for(const state of ['failed','running','partial']){
  const newer=valid();newer.report.startedAt='2026-09-25T01:00:00Z';newer.report.finishedAt='2026-09-25T01:05:00Z';
  if(state==='partial')newer.report.stages.pop();else newer.report.status=state;
  if(state==='running')delete newer.report.finishedAt;
  assert.equal(currentQualityReport([older,newer],inputs),null,state);
 }
 const unrelated=valid();unrelated.report.status='failed';unrelated.report.inputSha256.source='other';
 assert.equal(currentQualityReport([older,unrelated],inputs),older);
});

test('work evidence links the exact current repeated stages and keeps blocked actions explicit',()=>{
 const item=valid();
 const work=workOf([{id:'A',order:1,state:'implemented',acceptance:'readback',checks:['analysis-retention-browser','role-agents-browser']},{id:'B',order:2,state:'external',acceptance:'live account',nextAction:'회사망 평가 인증 연결'}]);
 const status=qualityWorkStatus(work,[item],inputs);
 assert.deepEqual(status.items[0].evidenceStages.map(s=>s.name),['analysis-retention-browser','role-agents-browser-1','role-agents-browser-2','role-agents-browser-3']);
 assert(status.items[0].evidenceStages.every(s=>s.status==='passed'&&s.log.startsWith('verification/current/')));
 assert.deepEqual(status.blocked,[{id:'B',nextAction:'회사망 평가 인증 연결'}]);assert.deepEqual(status.items[1].evidenceStages,[]);
 const stale=qualityWorkStatus(work,[item],{source:'different'});assert(stale.items[0].evidenceStages.every(s=>s.status==='unverified'&&s.log===null));
 assert.match(qualityWorkMarkdown(status),/회사망 평가 인증 연결/);assert.match(qualityWorkMarkdown(stale),/현재 후보 미검증/);
});
test('invalid ordering, unknown coverage and missing next actions cannot masquerade as a work plan',()=>{
 const validWork=()=>workOf([{id:'A',order:1,state:'implemented',acceptance:'test'},{id:'B',order:2,state:'external',acceptance:'test'}]);
 for(const mutate of [w=>w.items[1].order=1,w=>w.items[0].order=0,w=>w.items[0].checks=[],w=>w.items[0].checks=['nonexistent'],w=>w.items[0].checks=['unit','unit'],w=>w.items[1].checks=['unit'],w=>w.items[1].nextAction=' ',w=>w.schemaVersion=1]){
  const work=validWork();mutate(work);assert.throws(()=>qualityWorkStatus(work,[],inputs),/quality_work_invalid/);
 }
});
test('termination signals or missing timeout evidence cannot certify the current candidate',()=>{
 for(const mutate of [r=>r.stages[0].signal='SIGTERM',r=>delete r.stages[0].timedOut]){const item=valid();mutate(item.report);assert.equal(currentQualityReport([item],inputs),null);}
});

test('one full matrix can certify the core only when its complete selection and every stage pass',()=>{
 const item=full();assert.equal(currentQualityReport([item],inputs),item);
 const status=qualityWorkStatus(workOf([{id:'A',order:1,state:'implemented',acceptance:'full core',checks:['large-document-browser','trace-journal-browser','subagent-progress-browser']}]),[item],inputs);
 assert.equal(status.items[0].verification,'current_core_passed');
 assert.deepEqual(status.items[0].evidenceStages.map(stage=>stage.name),['large-document-browser','trace-journal-browser','subagent-progress-browser-1','subagent-progress-browser-2','subagent-progress-browser-3']);
 assert.equal(status.actualModelQuality,null);assert.equal(status.releaseApproved,false);
});

test('full reports reject extra failures, unfinished work, duplicate stages and misleading selection',()=>{
 for(const mutate of [
  r=>r.fullMatrix=false,r=>delete r.fullMatrix,r=>r.repeats=2,r=>r.evidence.actualBrowser=false,
  r=>r.stages.at(-1).status='running',r=>r.stages.at(-1).exitCode=1,r=>r.stages.at(-1).timedOut=true,
  r=>r.stages.at(-1).signal='SIGTERM',r=>delete r.stages.at(-1).timedOut,r=>r.stages.push({...r.stages.at(-1)}),
  r=>r.stages.splice(r.stages.findIndex(stage=>stage.name==='large-document-browser'),1),
  r=>r.stages.splice(r.stages.findIndex(stage=>stage.name==='subagent-progress-browser-3'),1),
  r=>r.selection.pop(),r=>r.selection.push(r.selection[0]),r=>delete r.selection,
  r=>r.selection=r.selection.filter(name=>name!=='trace-journal-browser'),r=>r.selection.push('unit'),
  r=>r.stages.push({name:'more-browser',status:'passed',exitCode:0,timedOut:false}),
  r=>r.releaseBlockers=['native_popup_focus_not_restored'],r=>r.startedAt='2026-09-26T00:00:00Z'
 ]){const item=full();mutate(item.report);assert.equal(currentQualityReport([item],inputs),null);}
});

test('v4 and separate partial reports never replace current v8 evidence',()=>{
 for (const profile of ['quality-baseline-v4','quality-baseline-v5','quality-baseline-v6','quality-baseline-v7']) {const old=valid();old.report.profile=profile;assert.equal(currentQualityReport([old],inputs),null);}
 const partial=full();partial.report.stages.splice(20);
 const remainder=full();remainder.report.stages.splice(0,20);
 assert.equal(currentQualityReport([partial,remainder],inputs),null);
});

test('newer selected failures or malformed stages block both baseline and full passes',()=>{
 for(const base of [valid,full])for(const mutate of [
  r=>r.status='failed',r=>r.status='running',r=>r.stages[0].exitCode=1,
  r=>delete r.stages[0].timedOut,r=>r.stages.push({...r.stages[0]}),r=>r.startedAt='invalid'
 ]){
  const passed=base(),newer=valid();newer.report.profile='selected';newer.report.startedAt='2026-09-25T01:00:00Z';newer.report.finishedAt='2026-09-25T01:05:00Z';mutate(newer.report);
  assert.equal(currentQualityReport([passed,newer],inputs),null);
 }
 const passed=full(),newer=valid();newer.report.profile='selected';newer.report.startedAt='2026-09-25T01:00:00Z';newer.report.finishedAt='2026-09-25T01:05:00Z';
 assert.equal(currentQualityReport([passed,newer],inputs),passed);
});

test('new large-document and journal work is implemented but unverified without a current gate',async()=>{
 const work=JSON.parse(await readFile(new URL('../quality-work.json',import.meta.url),'utf8'));
 const result=qualityWorkStatus(work,[],inputs);
 for(const id of ['NQ-18','NQ-19']){const item=result.items.find(item=>item.id===id);assert.equal(item.state,'implemented');assert.equal(item.verification,'needs_current_core');assert(item.evidenceStages.every(stage=>stage.status==='unverified'));}
});


test('policy initialization coverage is required once and linked to current unverified work', async()=>{
 const work=JSON.parse(await readFile(new URL('../quality-work.json',import.meta.url),'utf8'));
 const item=work.items.find(item=>item.id==='C01-C08');
 assert(item.checks.includes('browser-policy-browser'));
 assert.equal(item.state,'implemented');
 const pending=qualityWorkStatus(work,[],inputs).items.find(item=>item.id==='C01-C08');
 assert.equal(pending.verification,'needs_current_core');
 for(const make of [valid,full]) {
  const report=make();
  assert.equal(report.report.stages.filter(stage=>stage.name==='browser-policy-browser').length,1);
  report.report.stages=report.report.stages.filter(stage=>stage.name!=='browser-policy-browser');
  assert.equal(currentQualityReport([report],inputs),null);
 }
});
