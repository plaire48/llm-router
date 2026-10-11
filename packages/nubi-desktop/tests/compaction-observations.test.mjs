// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1, a window of
// 22,000 tokens). In the turn that changes code, nearly every step compacted
// the run. A compaction forgets which ranges were read, so that an edit never
// rests on text the model no longer sees. Here the reads were still in the
// conversation after each compaction, yet the change plan was refused with
// source_read_required three times: read, compact, refuse, read again.
// A read that stays word for word in the compacted conversation counts again.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const summary={goal:'첫 줄을 바꾼다',constraints:[],decisions:[],completed:['문서를 읽었다'],pending:['변경 계획'],references:['app.txt']};
const plan={summary:'Update the first line',requirements:[{id:'R1',text:'첫 줄을 바꾼다'}],targets:[{path:'app.txt',reason:'요청한 줄',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'첫 줄 확인'}],assumptions:[]};

async function run(t){
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'docs','big.md'),Array.from({length:600},(_,i)=>`line ${i+1} `+'reference text for the measurement of compaction. '.repeat(2)).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','big document']);
  let step=0,next=1,summaries=0,atRead=null,atPlan=null,visible=null;const results=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:22000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify(summary),calls:[]};}
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    if(result?.nextStart)next=result.nextStart;
    step++;
    if(step<=24)return call('read_source',{path:'docs/big.md',start:next,end:next+9});
    if(step===25){atRead=summaries;return call('read_source',{path:'app.txt'});}
    // More reading until one compaction has happened since app.txt was read.
    if(atPlan===null&&summaries===atRead&&step<45)return call('read_source',{path:'docs/big.md',start:next,end:next+4});
    if(atPlan===null){
      atPlan=summaries;
      // What the model sees when it records the plan: the read of app.txt, whole.
      visible=messages.some(message=>message.role==='tool'&&(()=>{try{const value=JSON.parse(message.content);return value.path==='app.txt'&&value.content?.startsWith('first\nsecond');}catch{return false;}})());
      return call('record_change_plan',plan);
    }
    results.push(result);return {content:'변경 계획을 기록했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt의 첫 줄을 바꿀 계획을 세워 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  return {service,task,results,atRead,atPlan,summaries,visible};
}

test('a read that stays in the compacted conversation still counts for the change plan',async t=>{
  const {service,task,results,atRead,atPlan,visible}=await run(t);
  assert.ok(atPlan>atRead,`a compaction happened between the read and the plan: ${atRead} then ${atPlan}`);
  assert.equal(visible,true,'the read of app.txt is still in the conversation the model sees');
  const done=service.task(task.id);
  assert.equal(done.state,'review',done.error);
  assert.equal(results.at(-1).error,undefined,'the plan was recorded: '+JSON.stringify(results.at(-1)).slice(0,200));
  assert.ok(done.changePlan,'the host holds the plan');
});

test('a read that the compaction summarized does not count',async()=>{
  const {observedReads}=await import('../runtime/agent.mjs');
  const read={path:'app.txt',content:'first\nsecond',hash:'sha256:a',start:1,end:2,lines:8,projectRules:{fingerprint:'sha256:r'}};
  const wire=[{role:'assistant',content:'',tool_calls:[{id:'c1',type:'function',function:{name:'read_source',arguments:'{}'}},{id:'c2',type:'function',function:{name:'read_source',arguments:'{}'}},{id:'c3',type:'function',function:{name:'source_search',arguments:'{}'}}]},
    {role:'tool',tool_call_id:'c1',content:JSON.stringify(read)},
    {role:'tool',tool_call_id:'c2',content:JSON.stringify({contextCleared:true,reason:'cached_tool_result',analysis_evidence_id:'ev_1'})},
    {role:'tool',tool_call_id:'c3',content:JSON.stringify({path:'other.txt',content:'x',hash:'sha256:b',start:1,end:1})}];
  assert.deepEqual(observedReads(wire),[{path:'app.txt',hash:'sha256:a',start:1,end:2,projectRules:{fingerprint:'sha256:r'}}],'only a whole read_source result counts');
});
