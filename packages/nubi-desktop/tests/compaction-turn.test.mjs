// Found in the live runs of case L1 (2026-09-29): in the third turn of one
// task the run was compacted while it worked. After that the request of the
// turn existed only as a paraphrase inside the summary, and the first request
// of the task stood in its place word for word.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

const FIRST='이 작업에서는 src/legacy 폴더를 절대 수정하지 마. 먼저 app.txt를 확인해 줘.';
const SECOND='이번에는 docs/big.md에서 KEY-777 항목의 값을 찾아 알려 줘. 표로 정리하지 말고 한 줄로 답해 줘.';
const summary={goal:'문서에서 값을 찾는다',constraints:['src/legacy 수정 금지'],decisions:[],completed:['앞부분을 읽었다'],pending:['남은 부분 확인'],references:['docs/big.md']};
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});

// Short reads stay in the conversation as they are: old long reads are cleared without a summary,
// so many short ones are what fills a window and brings a compaction.
async function twoTurns(t,{reads=40,history=[],second=SECOND}={}){
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'docs','big.md'),Array.from({length:900},(_,i)=>`line ${i+1} `+'reference text for the measurement of compaction. '.repeat(2)).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','big document']);
  let turn=1,step=0,summaries=0,next=1;const compacted=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:22000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify(summary),calls:[]};}
    if(turn===1)return {content:'app.txt를 확인했습니다.',calls:[]};
    if(messages.some(message=>message.role==='user'&&String(message.content).includes('Current task memory')))compacted.push(messages);
    const last=messages.findLast(message=>message.role==='tool');
    if(last){const result=JSON.parse(last.content);if(result.nextStart)next=result.nextStart;}
    return step++<reads?call('read_source',{path:'docs/big.md',start:next,end:next+9}):{content:'KEY-777 항목은 문서에 없습니다.',calls:[]};
  }};
  const task=await service.createTask({request:FIRST});
  if(history.length){task.messages=history;service.store.set('task:'+task.id,task);}
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  turn=2;await service.startAgent({taskId:task.id,answer:second});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  return {compacted,summaries,service,task};
}

test('after a compaction during the run the request of the turn is still there word for word',async t=>{
  const {compacted,summaries}=await twoTurns(t);
  assert.ok(summaries>0&&compacted.length>0,`summaries ${summaries}, compacted requests ${compacted.length}`);
  for(const messages of compacted){
    const users=messages.filter(message=>message.role==='user').map(message=>String(message.content));
    assert.ok(users.includes(SECOND),'the request being answered');
    assert.ok(users.includes(FIRST),'the first request with its restriction');
    assert.ok(users.indexOf(FIRST)<users.lastIndexOf(SECOND),'in the order they were written');
    assert.equal(users.filter(text=>text===SECOND).length,1,'once');
  }
});

test('a first request that an earlier compaction of the history left out still stands word for word',async t=>{
  // Four long earlier turns: the history is compacted before the run and the first request is no longer among its messages.
  const history=Array.from({length:8},(_,index)=>({role:index%2?'user':'assistant',content:(index%2?'이전 요청 ':'이전 답변 ')+index+' '+'자세한 설명입니다. '.repeat(260)}));
  const {compacted,summaries}=await twoTurns(t,{history});
  assert.ok(summaries>0&&compacted.length>0,`summaries ${summaries}, compacted requests ${compacted.length}`);
  for(const messages of compacted){
    const users=messages.filter(message=>message.role==='user').map(message=>String(message.content));
    assert.ok(users.includes(FIRST),'the first request with its restriction');
    assert.ok(users.includes(SECOND),'the request being answered');
  }
});

// Found by the third measurement with gpt-5.6-sol (case L1, 2026-09-29). The
// run was compacted in the fourth turn. The first request was not among the
// protected turns and went to the shared context as the goal, which it places
// after the protected messages. The request being answered had moved into
// the protected messages, so the first request stood last, where a model reads
// the latest request. The model answered the first request again.
const plain=messages=>messages.filter(message=>message.role==='user').map(message=>String(message.content)).filter(text=>!/^(<|\{|Current host receipts|Independent review)/.test(text));
test('after a compaction the request being answered is the last thing the user said',async t=>{
  const history=Array.from({length:8},(_,index)=>({role:index%2?'user':'assistant',content:(index%2?'이전 요청 ':'이전 답변 ')+index+' '+'자세한 설명입니다. '.repeat(260)}));
  const {compacted}=await twoTurns(t,{history});
  assert.ok(compacted.length>0);
  for(const messages of compacted){
    const said=plain(messages);
    assert.equal(said.at(-1),SECOND,'last: '+JSON.stringify(said.map(text=>text.slice(0,20))));
    assert.equal(messages.filter(message=>message.role==='user'&&String(message.content)===FIRST).length<=1,true,'the first request once');
    assert.ok(messages.some(message=>message.role==='user'&&String(message.content).includes(FIRST)),'the first request is still there word for word');
  }
});

test('the newest messages of the user are kept first when all do not fit',async()=>{
  const {spokenTurns}=await import('../runtime/agent.mjs');
  const long='가'.repeat(3000),task={request:'첫 요청',messages:[{role:'user',content:long+'1'},{role:'assistant',content:'답'},{role:'user',content:long+'2'},{role:'user',content:'지금 요청'}]};
  const messages=[{role:'user',content:'첫 요청'},...task.messages,{role:'user',content:'Current host receipts: {}'}];
  const kept=spokenTurns(task,messages,5000);
  assert.deepEqual(kept.map(message=>message.content.slice(-6)),[(long+'2').slice(-6),'지금 요청'],'5,000 tokens hold the newest two');
  assert.ok(kept.every(message=>message.role==='user'));
  assert.deepEqual(spokenTurns(task,messages,400).map(message=>message.content),['지금 요청'],'a small window keeps the short newest message only');
  assert.deepEqual(spokenTurns(task,messages,-500).map(message=>message.content),['지금 요청'],'the message being answered stays when no room is left');
  assert.equal(spokenTurns(task,messages,1e9).length,4,'a large window keeps all');
  assert.deepEqual(spokenTurns({request:'첫 요청',messages:[]},[{role:'user',content:long.repeat(10)}],5000),[],'text the user did not write is not protected');
  assert.equal(spokenTurns({request:long.repeat(10),messages:[]},[{role:'user',content:long.repeat(10)}],5000).length,1,'the message being answered stays even when it is long');
});

// Found by the compaction evaluation of 2026-09-29: with a window of 22,000
// tokens the fixed part of a request took more than half. Protecting a pasted
// document of 2,500 characters left no room, and the run stopped with
// context_compaction_failed.
test('a long pasted message does not stop a run in a small window',async t=>{
  // Longer than the room for protected messages. A small window counts only the tools it sends since B8,
  // so the room is larger and the document is longer than the 2,500 characters it was.
  const pasted='아래 회의록을 정리해 줘.\n\n'+'회의에서 정한 내용을 적은 문장입니다. '.repeat(300);
  const history=[{role:'assistant',content:'확인했습니다.'},{role:'user',content:pasted},{role:'assistant',content:'정리했습니다.'}];
  const {compacted,summaries,service,task}=await twoTurns(t,{history});
  assert.equal(service.task(task.id).error||null,null);
  assert.ok(summaries>0&&compacted.length>0);
  for(const messages of compacted){
    const users=messages.filter(message=>message.role==='user').map(message=>String(message.content));
    assert.ok(users.includes(SECOND),'the request being answered');assert.ok(users.includes(FIRST),'the first request');
    assert.ok(!users.includes(pasted),'the pasted document is left to the summary');
  }
});

// Found in B3 case L1: the run was compacted, the review asked for a revision,
// and the next round ended with response_invalid. The round continued from the
// compacted request while the run context still counted positions of the
// request before compaction.
test('a revision after a compaction continues without losing or breaking messages',async t=>{
  const {fixture:make}=await import('./fixtures.mjs'),{REVIEW_PROMPT}=await import('../runtime/result-review.mjs');
  const {service,root}=await make(t,{scriptedReview:true});
  await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'docs','big.md'),Array.from({length:900},(_,i)=>`line ${i+1} `+'reference text for the measurement of compaction. '.repeat(2)).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','big document']);
  let step=0,next=1,reviews=0,summaries=0;const rounds=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:22000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify(summary),calls:[]};}
    if(messages[0].content.startsWith(REVIEW_PROMPT)){
      reviews++;const requirements=JSON.parse(messages[1].content).requirements;
      return {content:JSON.stringify({status:reviews===1?'revise':'ready',nextStep:reviews===1?'남은 범위를 읽으세요.':'',checks:requirements.map(item=>({requirementId:item.id,state:'unknown',evidenceIds:[],detail:'확인 중'}))}),calls:[]};
    }
    rounds.push({reviews,messages:structuredClone(messages)});
    const last=messages.findLast(message=>message.role==='tool');
    if(last){const result=JSON.parse(last.content);if(result.nextStart)next=result.nextStart;}
    // Thirty short reads, an answer, then after the revision two more reads and the final answer.
    step++;
    if(step<=30||step===32||step===33)return call('read_source',{path:'docs/big.md',start:next,end:next+9});
    return {content:step===31?'앞부분까지 확인했습니다.':'KEY-777 항목은 문서에 없습니다.',calls:[]};
  }};
  const task=await service.createTask({request:SECOND});await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.error||null,null);assert.equal(done.state,'review');
  assert.ok(summaries>0,'the run was compacted');assert.equal(reviews,2);
  assert.equal(done.messages.at(-1).content,'KEY-777 항목은 문서에 없습니다.');
  const after=rounds.filter(round=>round.reviews===1);
  assert.ok(after.length>=3,'the revision ran its steps: '+after.length);
  for(const {messages} of after){
    const users=messages.filter(message=>message.role==='user').map(message=>String(message.content));
    assert.ok(users.includes(SECOND),'the request is still there');
    assert.ok(users.some(text=>text.startsWith('Independent review found unfinished work')),'the review feedback reached the round');
    assert.ok(messages.some(message=>message.role==='assistant'&&message.content==='앞부분까지 확인했습니다.'),'the answer under revision is in view');
    for(const [index,message] of messages.entries())if(message.role==='tool')assert.ok(messages.slice(0,index).some(item=>item.tool_calls?.some(entry=>entry.id===message.tool_call_id)),'every result follows its call');
  }
});

// Found in B5 case L1: protected messages left no room in a window of 22,000
// tokens, the compacted request did not fit, and the run stopped with
// context_compaction_failed. A run that cannot keep a message word for word
// leaves it to the summary, the largest first.
test('protected messages that the window cannot hold are left to the summary instead of stopping the run',async t=>{
  const {fixture:make}=await import('./fixtures.mjs'),{REVIEW_PROMPT}=await import('../runtime/result-review.mjs');
  const {service,root}=await make(t,{scriptedReview:true});
  await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'docs','big.md'),Array.from({length:900},(_,i)=>`line ${i+1} `+'reference text for the measurement of compaction. '.repeat(2)).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','big document']);
  // Longer than what the window leaves beside the fixed part. A small window offers fewer tools
  // since B8, so the fixed part is smaller and the answer is longer than it was.
  const long='앞부분까지 확인했습니다. '+'확인한 내용을 자세히 적은 문장입니다. '.repeat(520);
  let step=0,next=1,reviews=0,summaries=0;const rounds=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:22000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify(summary),calls:[]};}
    if(messages[0].content.startsWith(REVIEW_PROMPT)){
      reviews++;const requirements=JSON.parse(messages[1].content).requirements;
      return {content:JSON.stringify({status:reviews===1?'revise':'ready',nextStep:reviews===1?'남은 범위를 읽으세요.':'',checks:requirements.map(item=>({requirementId:item.id,state:'unknown',evidenceIds:[],detail:'확인 중'}))}),calls:[]};
    }
    rounds.push({reviews,messages:structuredClone(messages)});
    const last=messages.findLast(message=>message.role==='tool');
    if(last){const result=JSON.parse(last.content);if(result.nextStart)next=result.nextStart;}
    step++;
    if(step<=3||step>=5&&step<=34)return call('read_source',{path:'docs/big.md',start:next,end:next+9});
    return {content:step===4?long:'KEY-777 항목은 문서에 없습니다.',calls:[]};
  }};
  const task=await service.createTask({request:SECOND});await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.error||null,null);assert.equal(done.state,'review');
  assert.ok(summaries>0,'the run was compacted');assert.equal(reviews,2);
  const last=rounds.at(-1).messages,users=last.filter(message=>message.role==='user').map(message=>String(message.content));
  assert.ok(users.includes(SECOND),'the short request still stands word for word');
  assert.ok(users.some(text=>text.startsWith('Independent review found unfinished work')),'the feedback of the review too');
  assert.ok(!last.some(message=>message.role==='assistant'&&message.content===long),'the long answer under revision is in the summary');
});

// User decision 2026-09-29. Found in the first compaction measurement: the
// newest result is never summarized, so one result that filled the window
// stopped the run with context_compaction_failed. Such a result is cleared
// and says how to read it again in smaller parts.
test('a newest result that the window cannot hold is cleared with a way to read it again',async t=>{
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'docs','many.md'),Array.from({length:60},(_,index)=>`NEEDLE ${index+1} `+'long line of text about the needle in this document. '.repeat(9)).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','many matches']);
  let step=0,summaries=0;const seen=[];
  // A window that the result exceeds. A small window offers fewer tools since B8, so the window is smaller than it was.
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:16000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify(summary),calls:[]};}
    const names=new Map();for(const message of messages)for(const item of message.tool_calls||[])names.set(item.id,item.function.name);
    seen.push(messages.filter(message=>message.role==='tool').map(message=>({tool:names.get(message.tool_call_id),text:message.content})));
    return step++===0?call('source_search',{query:'NEEDLE',within:'docs/many.md'}):{content:'일치하는 줄이 많아 범위를 좁혀야 합니다.',calls:[]};
  }};
  const task=await service.createTask({request:SECOND});await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.error||null,null);assert.equal(done.state,'review');
  const result=seen.at(-1).find(item=>item.tool==='source_search'),cleared=JSON.parse(result.text);
  assert.equal(cleared.contextCleared,true);assert.equal(cleared.reason,'result_larger_than_window');assert.equal(cleared.tool,'source_search');
  assert.ok(cleared.characters>15000,'the size of what was cleared: '+cleared.characters);
  assert.match(cleared.instruction,/smaller/);assert.ok(result.text.length<1500);
  assert.ok(!result.text.includes('long line of text about the needle'),'the text itself is gone');
});

test('a cleared read keeps where it was read from',async()=>{
  const {clearedResult}=await import('../runtime/agent.mjs');
  const read=JSON.stringify({path:'docs/a.md',content:'x'.repeat(30000),hash:'sha256:abc',lines:900,start:201,end:400,nextStart:401,analysis_evidence_id:'ev_7'});
  const cleared=JSON.parse(clearedResult('read_source',read));
  assert.deepEqual(cleared.source,{path:'docs/a.md',hash:'sha256:abc',lines:900,start:201,end:400,nextStart:401});
  assert.equal(cleared.analysis_evidence_id,'ev_7');assert.equal(cleared.characters,read.length);
  assert.match(cleared.instruction,/read_source/);
  const plain=JSON.parse(clearedResult('read_process_output','not json '.repeat(3000)));
  assert.equal(plain.contextCleared,true);assert.equal(plain.source,undefined);
});
