// Window of 26,000 tokens since 2026-10-05 (22,000 before): the fixed part of a request grew with the guidance and
// core tools of 2026-10-04 (5,670 → 6,942 tokens in the lean window), and the behaviors below are the same ones.
// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1, S16, a
// window of 22,000 tokens). The change plan cited Wiki evidence from a
// wiki_query of this run. The query results filled the window, the run
// compacted, and a compaction forgot the Wiki evidence of the run: the plan was
// refused with wiki_evidence_required, the model queried the Wiki again, and
// the run compacted again. Twenty such rounds ran into the time limit.
// As for reads (user decision 2026-09-29, B8h): Wiki evidence that the
// compacted conversation still shows word for word counts again. It is checked
// against the current pages when it is used, as before.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git,hash} from '../runtime/files.mjs';
import {RepositoryEvidenceResolver} from '../generated/openwiki.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent,wikiInView} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const summary={goal:'첫 줄을 바꾼다',constraints:[],decisions:[],completed:['Wiki와 문서를 읽었다'],pending:['변경 계획'],references:['app.txt']};

async function run(t){
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'docs','big.md'),Array.from({length:600},(_,i)=>`line ${i+1} `+'reference text for the measurement of compaction. '.repeat(2)).join('\n'));
  // The fixture page grounded by a Claim on app.txt, so its evidence is current.
  const content=await readFile(path.join(root,'openwiki','home.md'),'utf8'),resource='repo://app.txt',evidence=await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource);
  await mkdir(path.join(root,'openwiki','.claims'));
  await writeFile(path.join(root,'openwiki','.claims','home.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(content),claims:[{id:'claim-1',statement:'The welcome screen uses app.txt.',evidence:[{resource,version:evidence.evidence.version}]}]}));
  await git(root,['add','-A']);await git(root,['commit','-qm','big document and claims']);
  let step=0,next=1,readSpan=9,summaries=0,atQuery=null,atPlan=null,visible=null,evidenceId=null;const results=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:26000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify(summary),calls:[]};}
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    if(result?.contextCleared&&result.source?.start){next=result.source.start;readSpan=Math.max(0,Math.floor(readSpan/2));}else if(result?.nextStart)next=result.nextStart;
    step++;
    if(step<=24)return call('read_source',{path:'docs/big.md',start:next,end:next+readSpan});
    if(step===25)return call('read_source',{path:'app.txt'});
    if(step===26){atQuery=summaries;return call('wiki_query',{query:'welcome'});}
    if(step===27)evidenceId=result.results?.[0]?.evidenceId;
    // More reading until one compaction has happened since the Wiki was queried.
    if(atPlan===null&&summaries===atQuery&&step<50)return call('read_source',{path:'docs/big.md',start:next,end:next+Math.min(4,readSpan)});
    if(atPlan===null){
      atPlan=summaries;
      visible=messages.some(message=>message.role==='tool'&&message.content.includes(JSON.stringify(evidenceId)));
      return call('record_change_plan',{summary:'Update the first line',requirements:[{id:'R1',text:'첫 줄을 바꾼다',evidenceIds:[evidenceId]}],targets:[{path:'app.txt',reason:'Wiki가 가리키는 파일',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'첫 줄 확인'}],assumptions:[]});
    }
    results.push(result);return {content:'변경 계획을 기록했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'Wiki를 근거로 app.txt의 첫 줄을 바꿀 계획을 세워 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  return {service,task,results,atQuery,atPlan,visible,evidenceId};
}

test('Wiki evidence that stays in the compacted conversation can be cited by the change plan',async t=>{
  const {service,task,results,atQuery,atPlan,visible,evidenceId}=await run(t);
  assert.match(String(evidenceId),/^wiki:/,'the query returned evidence');
  assert.ok(atPlan>atQuery,`a compaction happened between the query and the plan: ${atQuery} then ${atPlan}`);
  assert.equal(visible,true,'the query result is still in the conversation the model sees');
  const done=service.task(task.id);
  assert.equal(done.state,'review',done.error);
  assert.equal(results.at(-1).error,undefined,'the plan was recorded: '+JSON.stringify(results.at(-1)).slice(0,300));
  assert.deepEqual(done.changePlan.wikiEvidence.map(row=>row.evidenceId),[evidenceId]);
});

test('only Wiki results that the conversation holds word for word count again',()=>{
  const rows=new Map([['wiki:aaa',{evidenceId:'wiki:aaa'}],['e_1_0_5',{evidenceId:'wiki:aaa'}],['wiki:bbb',{evidenceId:'wiki:bbb'}],['wiki:ccc',{evidenceId:'wiki:ccc'}]]);
  const wire=[{role:'assistant',content:'',tool_calls:['wiki_query','ask_openwiki','read_source','wiki_query'].map((name,index)=>({id:'c'+index,type:'function',function:{name,arguments:'{}'}}))},
    {role:'tool',tool_call_id:'c0',content:JSON.stringify({results:[{evidenceId:'wiki:aaa',path:'openwiki/home.md'}]})},
    {role:'tool',tool_call_id:'c1',content:JSON.stringify({answer:'...',findings:[{text:'...',citations:['e_1_0_5']}]})},
    {role:'tool',tool_call_id:'c2',content:JSON.stringify({path:'notes.txt',content:'wiki:bbb is mentioned in a file'})},
    {role:'tool',tool_call_id:'c3',content:JSON.stringify({contextCleared:true,reason:'result_larger_than_window',tool:'wiki_query'})},
    {role:'user',content:'<context_summary>wiki:ccc was cited before</context_summary>'}];
  assert.deepEqual(wikiInView(wire,rows).map(([id])=>id),['wiki:aaa','e_1_0_5'],'a read of another tool, a cleared result and a summary do not count');
  assert.deepEqual(wikiInView(wire,new Map()),[]);
});
