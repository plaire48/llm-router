import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTrace, displayTrace} from '../agent-trace.js';
test('delegate trace persists bounded public status and rejects transport/transcript fields',()=>{
  const [step]=normalizeTrace([{tool:'analysis_page',status:'queued',analysis:{task:'Bearer SECRET',phase:'queued',calls:1,reads:0,delivered:false,summary:'x'.repeat(800),transcript:'PRIVATE',token:'SECRET',outcome:'partial'}}]);
  assert.equal(step.analysis.task,'Bearer [redacted]');assert.equal(step.analysis.summary.length,600);
  assert(!JSON.stringify(step).includes('PRIVATE'));assert(!JSON.stringify(step).includes('SECRET'));
  assert.equal(normalizeTrace([{tool:'read_page',status:'done',analysis:{task:'INJECTED'}}])[0].analysis,undefined);
});
test('main verification never converts a failed delegate into a successful delegate',()=>{
  assert.equal(displayTrace([{tool:'analysis_review',status:'error'},{tool:'review_task',status:'done'}],true)[0].status,'error');
});
test('active delegates stay visible while the leader emits more than 32 steps',()=>{
  const steps=[{tool:'analysis_page',status:'running',analysis:{task:'진행 작업',phase:'reading'}}];
  for(let i=0;i<40;i++)steps.push({tool:'read_page',status:'done'});
  const normalized=normalizeTrace(steps);assert.equal(normalized.length,32);assert.equal(normalized[0].tool,'analysis_page');
});

test('research roles, source ranges and image reads survive bounded public trace normalization',()=>{
  const runId='wiki-10000000-0000-4000-8000-000000000001';
  const [step]=normalizeTrace([{tool:'analysis_research',status:'done',analysis:{task:'question',runId,role:'recovery',workerId:4,synthesisId:2,completed:3,total:5,phase:'synthesis_finished',delivered:true,deliveredTo:'synthesis',outcome:'partial',doneWhen:'Check the exception',sourceCount:20,
    sources:Array.from({length:20},(_,i)=>({id:`ev_${i}`,tool:'capture_page',kind:'page',hasImage:true,imageRead:i===0,read:true,path:'Bearer SECRET',image:{data:'PRIVATE_PIXELS'},transcript:'PRIVATE_TRANSCRIPT'})),
    assignment:{question:'specific question',documentIds:['doc'],documents:[{id:'doc',title:'Policy',text:'PRIVATE_DOCUMENT'}],range:{documentId:'doc',start:24000,end:48000},content:'PRIVATE_SOURCE'},private:'PRIVATE_REASONING'}}]);
  assert.equal(step.analysis.runId,runId);assert.equal(step.analysis.role,'recovery');assert.equal(step.analysis.phase,'synthesis_finished');
  assert.equal(step.analysis.workerId,4);assert.equal(step.analysis.synthesisId,2);assert.equal(step.analysis.completed,3);assert.equal(step.analysis.total,5);
  assert.equal(step.analysis.deliveredTo,'synthesis');assert.equal(step.analysis.doneWhen,'Check the exception');assert.equal(step.analysis.sources.length,12);
  assert.equal(step.analysis.sources.filter(source=>source.imageRead).length,1);assert.equal(step.analysis.sourceCount,20);
  assert.deepEqual(step.analysis.assignment.range,{documentId:'doc',start:24000,end:48000});
  assert.deepEqual(step.analysis.assignment.documents,[{id:'doc',title:'Policy'}]);
  assert(!JSON.stringify(step).includes('PRIVATE'));assert(!JSON.stringify(step).includes('SECRET'));
  assert.deepEqual(normalizeTrace([step]),[step],'Stored progress remains stable after reload normalization');
});
test('invalid metadata never invents counts, ranges, roles or image verification',()=>{
  const [step]=normalizeTrace([{tool:'analysis_research',status:'running',analysis:{role:'system',runId:'Bearer SECRET',completed:6,total:2,workerId:-1,synthesisId:Infinity,sourceCount:-1,deliveredTo:'executor',
    assignment:{documentIds:['allowed'],range:{documentId:'other',start:0,end:100}},sources:[{id:'ev',hasImage:true,imageRead:'true'}]}}]);
  for(const key of ['role','runId','completed','total','workerId','synthesisId','sourceCount','deliveredTo'])assert.equal(step.analysis[key],undefined,key);
  assert.equal(step.analysis.assignment.range,undefined);assert.equal(step.analysis.sources[0].imageRead,false);
});

test('attachment research run identity survives reload without accepting obsolete prefixes',()=>{
  const trace=runId=>normalizeTrace([{tool:'analysis_research',status:'running',analysis:{runId,role:'coordinator'}}])[0].analysis;
  const runId='documents-10000000-0000-4000-8000-000000000001';
  assert.equal(trace(runId).runId,runId);assert.equal(trace(runId.replace('documents-','document-')).runId,undefined);
});

test('unfinished work stays readable and bounded after reload without exposing raw errors',()=>{
  const [step]=normalizeTrace([{tool:'analysis_review',status:'done',analysis:{outcome:'partial',uncertainties:['','누락 범위','누락 범위','Bearer SECRET','x'.repeat(500),'추가 근거'],nextStep:'원본 화면 두 장을 다시 비교하세요.',error:'PRIVATE_TRANSPORT'}}]);
  assert.equal(step.analysis.uncertainties.length,3);assert.equal(step.analysis.uncertaintiesOmitted,1);
  assert.equal(step.analysis.uncertainties[2].length,500);assert.equal(step.analysis.nextStep,'원본 화면 두 장을 다시 비교하세요.');
  assert(!JSON.stringify(step).includes('SECRET'));assert(!JSON.stringify(step).includes('PRIVATE_TRANSPORT'));
  assert.deepEqual(normalizeTrace([step]),[step]);assert.equal(step.analysis.outcome,'partial');
});

test('distinct uncertainty suffixes survive display and repeated normalization',()=>{
  const prefix='동일 조건 '.repeat(45);
  const uncertainties=[prefix+'단, 외부 문서 예외는 미확인',prefix+'단, 내장 문서 예외는 미확인'];
  const [step]=normalizeTrace([{tool:'analysis_research',status:'done',analysis:{outcome:'partial',uncertainties:[...uncertainties,uncertainties[0]]}}]);
  assert.deepEqual(step.analysis.uncertainties,uncertainties);
  assert.equal(step.analysis.uncertaintiesOmitted,undefined);
  assert.deepEqual(normalizeTrace([step]),[step]);
});
