import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {saveDocumentProgress,saveRoleProgress,finishRoleProgress,roleHandoffs,saveReviewProgress} from '../runtime/analysis-history.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const role=(id,status='running',analysis={})=>({id,tool:'analysis_page',status,analysis:{task:'화면에서 목표 값 확인',phase:'reading',reads:1,calls:1,delivered:false,...analysis}});

test('all document groups remain paged and scoped without returning full research/source bodies',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'여러 문서 비교'}),other=await service.createTask({request:'다른 업무'});
  for(let i=0;i<12;i++)saveDocumentProgress(service.store,{id:'doc-'+i,taskId:task.id,runId:'run',state:'complete',workers:[],sources:[{id:'doc',path:'docs/spec.md',hash:'sha256:x'}],result:{answer:'PRIVATE_FULL_REPORT',evidence:[{excerpt:'PRIVATE_ORIGINAL'}]},raw:'PRIVATE_RAW'});
  saveDocumentProgress(service.store,{id:'other',taskId:other.id,state:'complete',workers:[],sources:[]});
  const first=await service.invoke('analysisHistory',{taskId:task.id,limit:5});assert.equal(first.records.length,5);assert.equal(first.records[0].id,'doc-11');assert.ok(first.next);
  assert.doesNotMatch(JSON.stringify(first),/PRIVATE_|"id":"other"/);
  saveDocumentProgress(service.store,{id:'doc-12',taskId:task.id,state:'running',workers:[],sources:[]});
  saveDocumentProgress(service.store,{id:'doc-11',taskId:task.id,state:'partial',workers:[],sources:[]});
  const second=await service.analysisHistory({taskId:task.id,before:first.next,limit:5});
  const last=await service.analysisHistory({taskId:task.id,before:second.next,limit:5});
  assert.deepEqual([...first.records,...second.records,...last.records].map(r=>r.id),Array.from({length:12},(_,i)=>'doc-'+(11-i)),'Concurrent new runs and progress updates do not shift prior pages');
  assert.equal(last.next,null);assert.equal(service.agent?.running,undefined);
  await assert.rejects(service.invoke('analysisHistory',{taskId:'missing'}));
  for(const args of [{limit:0},{limit:21},{before:'not-a-cursor'},{before:'0'}])assert.throws(()=>service.analysisHistory({taskId:task.id,...args}),/analysis_history_range/);
});

test('role records survive trace eviction, preserve assignment metadata and distinguish delivery from findings',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'분담 검토'});
  saveRoleProgress(service.store,task.id,'run',role('worker','running',{doneWhen:'현재 값과 목표 값의 차이를 설명',sources:[{id:'ev_1',hasImage:true,imageRead:true,historical:true}]}));
  saveRoleProgress(service.store,task.id,'run',role('worker','done',{phase:'finished',outcome:'partial',summary:'값 일부를 읽지 못했습니다.'}));
  for(let i=0;i<90;i++)saveRoleProgress(service.store,task.id,'run',role('extra-'+i,'done',{outcome:'complete',delivered:true}));
  const result=service.analysisHistory({taskId:task.id});assert.equal(result.records[0].workers.length,91);
  const saved=result.records[0].workers[0];assert.equal(saved.analysis.doneWhen,'현재 값과 목표 값의 차이를 설명');assert.equal(saved.analysis.sources[0].imageRead,true);assert.equal(saved.analysis.delivered,false);assert.equal(result.records[0].state,'partial');
  saveRoleProgress(service.store,task.id,'run',role('worker','done',{phase:'finished',outcome:'partial',delivered:true}));
  assert.equal(service.analysisHistory({taskId:task.id}).records[0].workers[0].analysis.delivered,true);
  assert.equal(service.analysisHistory({taskId:task.id}).records[0].workers[0].analysis.summary,'값 일부를 읽지 못했습니다.');
});

test('restart marks pending role work interrupted, retains responses and indexes earlier document receipts',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'중단된 조사'});
  saveRoleProgress(service.store,task.id,'run',role('done','done',{outcome:'complete',delivered:true,summary:'수신된 결과'}));
  saveRoleProgress(service.store,task.id,'run',role('pending'));
  service.store.set('document-analysis:legacy',{id:'legacy',taskId:task.id,state:'complete',workers:[],sources:[],result:{answer:'PRIVATE_REPORT'}});
  service.store.close();await service.open(root);
  const records=service.analysisHistory({taskId:task.id}).records;
  assert.equal(records.length,2);assert.doesNotMatch(JSON.stringify(records),/PRIVATE_REPORT/);
  const roles=records.find(r=>r.kind==='roles');assert.equal(roles.state,'interrupted');assert.equal(roles.workers[0].analysis.summary,'수신된 결과');assert.equal(roles.workers[1].status,'interrupted');assert.equal(roles.workers[1].analysis.delivered,false);
  const timestamp=records.find(r=>r.kind==='document').updatedAt;service.store.close();await service.open(root);
  assert.equal(service.analysisHistory({taskId:task.id}).records.find(r=>r.kind==='document').updatedAt,timestamp);
});

test('explicit finalization never marks unfinished children as successfully returned',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'중지'});
  saveRoleProgress(service.store,task.id,'run',role('pending'));finishRoleProgress(service.store,task.id,'run','cancelled');
  const record=service.analysisHistory({taskId:task.id}).records[0];assert.equal(record.state,'cancelled');assert.equal(record.workers[0].analysis.delivered,false);assert.equal(record.workers[0].analysis.outcome,undefined);
});

test('known progress outside the newest page refreshes without changing the cursor or task scope',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'긴 작업'}),other=await service.createTask({request:'별도 작업'});
  saveRoleProgress(service.store,task.id,'old-run',role('old-worker'));
  for(let i=0;i<15;i++)saveDocumentProgress(service.store,{taskId:task.id,id:'later-'+i,state:'complete'});
  saveRoleProgress(service.store,task.id,'old-run',role('old-worker','done',{outcome:'partial',uncertainties:['확인이 남음'],delivered:true}));
  const page=service.analysisHistory({taskId:task.id,refresh:[{kind:'roles',id:'old-run'}]});
  assert.ok(!page.records.some(item=>item.kind==='roles'));assert.equal(page.updates[0].state,'partial');
  assert.deepEqual(page.updates[0].workers[0].analysis.uncertainties,['확인이 남음']);
  assert.equal(service.analysisHistory({taskId:other.id,refresh:[{kind:'roles',id:'old-run'}]}).updates.length,0);
  assert.throws(()=>service.analysisHistory({taskId:task.id,refresh:Array(21).fill({kind:'roles',id:'old-run'})}),/analysis_history_range/);
});
test('review progress survives restart and preserves failed assignments as advisory handoffs',async t=>{
  const {service,root}=await fixture(t),task=await service.createTask({request:'결과 대조'});
  saveRoleProgress(service.store,task.id,'run',role('failed','error',{error:'analysis_format',delivered:true}));
  saveRoleProgress(service.store,task.id,'run',role('partial','done',{outcome:'partial',summary:'일부 확인',uncertainties:['값 확인 필요'],nextStep:'원본 대조',delivered:true}));
  const handoffs=roleHandoffs(service.store,task.id,'run');assert.equal(handoffs.items.length,2);assert.equal(handoffs.items[0].state,'error');assert.equal(handoffs.items[0].error,'analysis_format');assert.deepEqual(handoffs.items[1].uncertainties,['값 확인 필요']);
  assert.equal(roleHandoffs(service.store,task.id,'other').items.length,0);
  saveReviewProgress(service.store,task.id,{id:'review',runId:'run',round:1,state:'running'});
  service.store.close();await service.open(root);
  const saved=service.analysisHistory({taskId:task.id}).records.find(record=>record.kind==='review');assert.equal(saved.state,'interrupted');assert.equal(saved.checks,undefined);
});

test('early unresolved assignments survive many later reports and overflow stays explicit',async t=>{
  const {service}=await fixture(t),task=await service.createTask({request:'분담 누락 없이 검토'});
  saveRoleProgress(service.store,task.id,'run',role('early-failure','error',{error:'analysis_format',delivered:true}));
  saveRoleProgress(service.store,task.id,'run',role('early-uncertain','done',{outcome:'complete',uncertainties:['원본 대조 필요'],delivered:true}));
  for(let i=0;i<20;i++)saveRoleProgress(service.store,task.id,'run',role('success-'+i,'done',{outcome:'complete',delivered:true}));
  const first=roleHandoffs(service.store,task.id,'run');
  assert.equal(first.items.length,12);assert.deepEqual(first.items.slice(0,2).map(item=>item.id),['early-failure','early-uncertain']);
  assert.equal(first.items.at(-1).id,'success-19');assert.equal(first.omitted,10);assert.equal(first.omittedUnresolved,0);
  for(let i=0;i<12;i++)saveRoleProgress(service.store,task.id,'run',role('pending-'+i));
  const overflow=roleHandoffs(service.store,task.id,'run');assert.equal(overflow.omittedUnresolved,2);
  assert.ok(overflow.items.every(item=>!item.id.startsWith('success-')));
  assert.equal(service.analysisHistory({taskId:task.id}).records[0].workers.length,34,'Selection does not discard stored work');
});

test('review lifecycle receipts contain host status but never child conclusions',async()=>{
 const {roleExecutionReceipts}=await import('../runtime/analysis-history.mjs');
 const record={workers:[{id:'a',tool:'analysis_research',status:'done',analysis:{delivered:true,reads:2,calls:3,summary:'UNVERIFIED_CHILD_CLAIM',outcome:'complete'}},{id:'b',tool:'analysis_research',status:'error',analysis:{delivered:false,reads:0,calls:1}}]};
 const store={get:key=>key==='analysis-history:t:roles:run'?record:null};
 const receipt=roleExecutionReceipts(store,'t','run');assert.equal(receipt.items[0].delivered,true);assert.equal(receipt.items[0].reads,2);assert.equal(receipt.items[1].state,'error');assert.doesNotMatch(JSON.stringify(receipt),/UNVERIFIED_CHILD_CLAIM|outcome/);assert.equal(roleExecutionReceipts(store,'t','other').items.length,0);
});
