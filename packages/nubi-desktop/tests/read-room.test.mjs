// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1, a window
// of 22,000 tokens). The room for a read was what the last request had left
// free. After a few results that was 219 tokens, then less than nothing, and
// every read returned one line in a result of 1,000 characters. Six reads in
// one response each took the same room. The model read six files line by line,
// gave up, and the run ended with context_input_too_large.
// What is free at the moment is for the compaction to settle: old results are
// cleared and earlier turns summarized. A read takes what the window holds
// after that, and the reads of one response share it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {resultRoom,READ_FLOOR} from '../runtime/read-room.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const small={input:18700,summaryOutput:2048};

test('a result takes what the window holds after a compaction',()=>{
  // The numbers of the measured run: 12,000 tokens fixed, the last request 219 tokens below the limit.
  assert.deepEqual(resultRoom({window:small,fixed:12000,last:18481,spent:0}),{room:2697,defer:false});
  // A window with free space gives that space.
  assert.deepEqual(resultRoom({window:small,fixed:12000,last:12500,spent:0}),{room:3936,defer:false});
  const large=resultRoom({window:{input:180000,summaryOutput:2048},fixed:12000,last:20000,spent:0});
  assert.ok(large.room>100000&&!large.defer);
});

test('the results of one response share the room, and what no longer fits waits',()=>{
  assert.deepEqual(resultRoom({window:small,fixed:12000,last:18481,spent:1500}),{room:1197,defer:false});
  assert.deepEqual(resultRoom({window:small,fixed:12000,last:18481,spent:2500}),{room:197,defer:true});
  assert.deepEqual(resultRoom({window:small,fixed:12000,last:18481,spent:9000}),{room:-6303,defer:true});
});

test('the first result of a response is never less than the floor',()=>{
  assert.equal(READ_FLOOR,600);
  assert.deepEqual(resultRoom({window:small,fixed:17000,last:18600,spent:0}),{room:600,defer:false});
});

const calls=list=>({content:'',calls:list.map(([name,args])=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}))});
const summary={goal:'여섯 파일을 확인한다',constraints:[],decisions:[],completed:['앞의 파일을 읽었다'],pending:['남은 파일 확인'],references:['src/a1.mjs']};
const FILES=['a1','a2','a3','a4','a5','a6'].map(name=>'src/'+name+'.mjs');

test('six reads in one response under a small window return whole ranges, and the rest waits for the next response',async t=>{
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'src'),{recursive:true});
  for(const file of FILES)await writeFile(path.join(root,file),Array.from({length:90},(_,i)=>`export const value${i+1} = ${i+1}; // ${file} holds a line of ordinary length here`).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','six files']);
  const rounds=[];let round=0,summaries=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:22000}]}),dispose(){},async complete(messages){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify(summary),calls:[]};}
    const names=new Map();for(const message of messages)for(const call of message.tool_calls||[])names.set(call.id,call.function);
    const results=messages.filter(message=>message.role==='tool'&&names.get(message.tool_call_id)?.name==='read_source').map(message=>({path:JSON.parse(names.get(message.tool_call_id).arguments).path,result:JSON.parse(message.content)}));
    rounds.push(results);
    const read=new Set(rounds.flat().filter(item=>item.result.content&&!item.result.contextCleared).map(item=>item.path)),left=FILES.filter(file=>!read.has(file));
    if(round++===0)return calls(FILES.map(file=>['read_source',{path:file}]));
    return left.length?calls(left.map(file=>['read_source',{path:file}])):{content:'여섯 파일을 모두 확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'src의 여섯 파일을 확인해 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const done=service.task(task.id);
  assert.equal(done.state,'review',done.error);assert.equal(done.messages.at(-1).content,'여섯 파일을 모두 확인했습니다.');
  const all=rounds.flat().map(item=>item.result),given=all.filter(result=>typeof result.content==='string');
  assert.ok(given.length>=6);
  for(const result of given)assert.ok(result.end-result.start+1>=20,`a read returned ${result.end-result.start+1} lines`);
  const first=rounds[1];
  assert.equal(first.length,6);assert.ok(first[0].result.end>=20);
  assert.ok(first.some(item=>item.result.deferred===true),'what did not fit this response was not executed');
  const waited=first.find(item=>item.result.deferred===true).result;
  assert.equal(waited.actionIssued,false);assert.match(waited.instruction,/next response/);assert.equal(waited.error,undefined,'a wait is not an error');
});
