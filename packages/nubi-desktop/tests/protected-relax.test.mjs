// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1, S14). A
// compacted request did not fit. The host then left one protected message to
// the summary and compacted again, one message per attempt: the same span was
// summarized seven times in a row. On the way the message being answered was
// left to the summary as well; the first request then stood last, and the
// model answered it again.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relaxProtected} from '../runtime/protected-room.mjs';

const message=(content)=>({role:'user',content});
const measure=item=>item.content.length;
const first=message('F'.repeat(50)),answering=message('A'.repeat(40)),notes=message('N'.repeat(900)),turn=message('T'.repeat(300)),anchors=message('E'.repeat(200));
const all=()=>[first,anchors,notes,turn,answering];

test('the first attempt keeps what the room holds, largest left to the summary first',()=>{
  const {kept,removed}=relaxProtected(all(),{keep:[first,answering],room:700,attempt:1,measure});
  assert.deepEqual(removed,[notes],'one removal brings the total to 590');
  assert.deepEqual(kept,[first,anchors,turn,answering],'the order of what stays is kept');
  const tight=relaxProtected(all(),{keep:[first,answering],room:200,attempt:1,measure});
  assert.deepEqual(tight.removed,[notes,turn,anchors],'as many as the room needs, in one attempt');
  assert.deepEqual(tight.kept,[first,answering]);
});

test('an attempt always removes something while something is removable',()=>{
  const {removed}=relaxProtected(all(),{keep:[first,answering],room:100000,attempt:1,measure});
  assert.deepEqual(removed,[notes],'the room holds everything, yet the compaction failed: the largest goes');
});

test('a second attempt leaves every removable message to the summary',()=>{
  const {kept,removed}=relaxProtected(all(),{keep:[first,answering],room:100000,attempt:2,measure});
  assert.deepEqual(removed,[notes,turn,anchors]);assert.deepEqual(kept,[first,answering]);
});

test('the first request and the message being answered are never removed',()=>{
  const {kept,removed}=relaxProtected([first,answering],{keep:[first,answering],room:0,attempt:3,measure});
  assert.deepEqual(removed,[]);assert.deepEqual(kept,[first,answering]);
});

import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const FIRST='이 작업에서는 src/legacy 폴더를 절대 수정하지 마. 먼저 app.txt를 확인해 줘.';
const SECOND='이번에는 docs/big.md에서 KEY-777 항목의 값을 찾아 알려 줘.';
const summary={goal:'문서에서 값을 찾는다',constraints:['src/legacy 수정 금지'],decisions:[],completed:['앞부분을 읽었다'],pending:['남은 부분 확인'],references:['docs/big.md']};
const plain=messages=>messages.filter(item=>item.role==='user').map(item=>String(item.content)).filter(text=>!/^(<|\{|Current host receipts|Independent review)/.test(text));

test('in a later turn a compaction that does not fit keeps the message being answered and does not repeat the same summary',async t=>{
  const {service,root}=await fixture(t,{scriptedReview:true,scriptedPlanning:true});
  await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'docs','big.md'),Array.from({length:900},(_,i)=>`line ${i+1} `+'reference text for the measurement of compaction. '.repeat(2)).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','big document']);
  const long='앞부분까지 확인했습니다. '+'확인한 내용을 자세히 적은 문장입니다. '.repeat(520);
  let turn=1,step=0,next=1,reviews=0;const sources=[],compacted=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:22000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){sources.push(JSON.stringify(messages.slice(1)));return {content:JSON.stringify(summary),calls:[]};}
    // The plan offers many workflows, as in the measured run: in a small window its tools make the fixed part larger.
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify({intent:{goal:'값 찾기',constraints:[],outcomes:['값을 찾는다'],workflowIds:['source-change','environment','recovery','knowledge','document-research','voc'],skillPaths:[]},steps:[{text:'찾기',expected_outcome:'값을 찾는다',status:'in_progress'}]}),calls:[]};
    if(messages[0].content.startsWith(REVIEW_PROMPT)){
      reviews++;const requirements=JSON.parse(messages[1].content).requirements,revise=turn===2&&reviews===2;
      return {content:JSON.stringify({status:revise?'revise':'ready',nextStep:revise?'남은 범위를 읽으세요.':'',checks:requirements.map(item=>({requirementId:item.id,state:'unknown',evidenceIds:[],detail:'확인 중'}))}),calls:[]};
    }
    if(turn===1)return {content:'app.txt를 확인했습니다.',calls:[]};
    if(messages.some(item=>item.role==='user'&&String(item.content).includes('Current task memory')))compacted.push(messages);
    const last=messages.findLast(item=>item.role==='tool');
    if(last){try{const result=JSON.parse(last.content);if(result.nextStart)next=result.nextStart;}catch{/* A cleared result has no position. */}}
    step++;
    if(step<=3||step>=5&&step<=30)return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_source',arguments:JSON.stringify({path:'docs/big.md',start:next,end:next+9})}}]};
    return {content:step===4?long:'KEY-777 항목은 문서에 없습니다.',calls:[]};
  }};
  const task=await service.createTask({request:FIRST});
  // Earlier turns of the conversation, each protected word for word while the room holds them.
  task.messages=Array.from({length:6},(_,index)=>({role:index%2?'assistant':'user',content:index%2?'정리했습니다.':'앞선 요청 '+index+'. '+'조건을 자세히 적은 문장입니다. '.repeat(60)}));service.store.set('task:'+task.id,task);
  await service.startAgent({taskId:task.id});await service.agent.promise;
  turn=2;await service.startAgent({taskId:task.id,answer:SECOND});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.error||null,null);assert.equal(done.state,'review');
  assert.ok(compacted.length>0,'the run was compacted');
  for(const messages of compacted)assert.equal(plain(messages).at(-1),SECOND,'last: '+JSON.stringify(plain(messages).map(text=>text.slice(0,16))));
  const repeats=sources.filter((size,index)=>index>=2&&size===sources[index-1]&&size===sources[index-2]).length;
  assert.equal(repeats,0,'no summary of the same span three times in a row, of '+sources.length+' summaries');
});
