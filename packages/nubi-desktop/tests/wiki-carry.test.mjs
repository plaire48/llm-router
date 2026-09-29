// User decision 2026-09-30, from the measurement of 2026-09-29 with gpt-5.6-sol
// (case A13): an approval ends a run, and the next run of the task could not
// cite the Wiki evidence of the first. The model asked the OpenWiki agent the
// same rule again for every action. Evidence of an earlier run of the same task
// is offered again while its page is unchanged, and checked when it is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {keepWikiEvidence} from '../runtime/wiki-carry.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const receiptsOf=messages=>{const text=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Current host receipts'))?.content;return text?JSON.parse(text.slice(text.indexOf('{'))):null;};

async function twoRuns(t,{between=async()=>{},contextLength=200000}={}){
  const {service,root}=await fixture(t);
  let run=1,step=0,evidenceId=null,carried=null;const results=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength}]}),dispose(){},async complete(messages){
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    step++;
    if(run===1){
      if(step===1)return call('wiki_query',{query:'welcome'});
      evidenceId=result.results[0].evidenceId;return {content:'Wiki에서 환영 화면의 기준을 찾았습니다.',calls:[]};
    }
    if(step===1){carried=receiptsOf(messages)?.carriedWikiEvidence||null;return call('read_source',{path:'app.txt'});}
    if(step===2)return call('record_change_plan',{summary:'Update the first line',requirements:[{id:'R1',text:'환영 화면 기준에 맞게 첫 줄을 바꾼다',evidenceIds:[evidenceId]}],targets:[{path:'app.txt',reason:'Wiki가 가리키는 파일',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'첫 줄 확인'}],assumptions:[]});
    results.push(result);return {content:'변경 계획을 기록했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'Wiki를 확인하고 app.txt의 첫 줄을 바꿀 계획을 세워 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  await between(root);
  run=2;step=0;
  await service.startAgent({taskId:task.id,answer:'그 근거로 변경 계획을 세워 줘'});await service.agent.promise;
  return {service,task,evidenceId,carried,results};
}

test('Wiki evidence of an earlier run of the task is offered and can be cited without asking again',async t=>{
  const {service,task,evidenceId,carried,results}=await twoRuns(t);
  assert.match(String(evidenceId),/^wiki:/);
  assert.deepEqual(carried.rows.map(row=>row.evidenceId),[evidenceId],'the receipts name the evidence');
  assert.equal(carried.rows[0].path,'openwiki/home.md');assert.match(carried.rows[0].excerpt,/welcome screen/i,'with a short excerpt of what it says');
  assert.equal(results.at(-1).error,undefined,'the plan was recorded: '+JSON.stringify(results.at(-1)).slice(0,300));
  assert.deepEqual(service.task(task.id).changePlan.wikiEvidence.map(row=>row.evidenceId),[evidenceId]);
  assert.equal(service.task(task.id).changePlan.wikiEvidence[0].excerpt,undefined,'the plan keeps the evidence fields, not the excerpt');
});

test('evidence whose page changed after the earlier run is not offered and cannot be cited',async t=>{
  const {evidenceId,carried,results}=await twoRuns(t,{between:async root=>{
    await writeFile(path.join(root,'openwiki','home.md'),'# Project knowledge\n\nThe welcome screen uses app.txt and the banner.\n');
    await git(root,['add','-A']);await git(root,['commit','-qm','wiki changed']);
  }});
  assert.match(String(evidenceId),/^wiki:/);
  assert.equal(carried,null,'nothing is offered');
  assert.equal(results.at(-1).error,'wiki_evidence_required');
});

// Measured 2026-09-30 with gpt-5.6-sol (case L1, a window of 22,000 tokens): the
// excerpts of six rows added 2,200 characters to every request, and the run ended
// with context_input_too_large. A small window gets the ids and places only.
test('in a small window the offered evidence carries no excerpt',async t=>{
  const {evidenceId,carried,results}=await twoRuns(t,{contextLength:22000});
  assert.deepEqual(carried.rows,[{evidenceId,path:'openwiki/home.md',start:carried.rows[0].start,end:carried.rows[0].end}]);
  assert.equal(results.at(-1).error,undefined,'the plan was recorded: '+JSON.stringify(results.at(-1)).slice(0,300));
});

test('a task keeps its latest twelve evidence rows with short excerpts',()=>{
  const values=new Map(),store={get:key=>values.get(key),set:(key,value)=>values.set(key,value)};
  const row=index=>({evidenceId:'wiki:'+index,path:'openwiki/a.md',hash:'sha256:a',provenance:{start:index,end:index+1},freshness:'source_matched',claimsHash:null,sourceReferences:[],excerpt:'x '.repeat(300)});
  keepWikiEvidence(store,'t1',Array.from({length:15},(_,index)=>row(index)));
  keepWikiEvidence(store,'t1',[row(5)]);
  const kept=values.get('wiki-carry:t1').rows;
  assert.equal(kept.length,12);assert.equal(kept.at(-1).evidenceId,'wiki:5','a row seen again becomes the newest');
  assert.ok(kept.every(item=>item.excerpt.length<=200));assert.equal(kept[0].start,3,'the three oldest of fifteen are dropped');
  keepWikiEvidence(store,'t2',[{...row(1),excerpt:'---\ntype: policy\ntitle: 경비 규정\n---\n\n# 경비 규정\n\n## 제출\n\n제출은 신청자 본인이 직접 누른다.'}]);
  assert.equal(values.get('wiki-carry:t2').rows[0].excerpt,'# 경비 규정 ## 제출 제출은 신청자 본인이 직접 누른다.','the front matter of a whole page is left out');
});
