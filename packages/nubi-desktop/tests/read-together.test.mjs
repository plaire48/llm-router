// Found in the live runs of 2026-09-29: the model often asked for several
// reads in one response. The runtime executed the first and answered the rest
// with "not executed". In B5, 61 of 252 calls of the main agent were not
// executed, 46 of them a read after a read.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

const calls=list=>({content:'',calls:list.map(([name,args])=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}))});
async function run(t,first){
  const {service}=await fixture(t);let round=0,system='';const rounds=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    system||=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    const names=new Map();for(const message of messages)for(const call of message.tool_calls||[])names.set(call.id,call.function.name);
    // The host records the plan of the planner as the first operation of a run.
    rounds.push(messages.filter(message=>message.role==='tool'&&names.get(message.tool_call_id)!=='update_plan').map(message=>({tool:names.get(message.tool_call_id),result:JSON.parse(message.content)})));
    return round++===0?calls(first):{content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt와 Wiki를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  return {results:rounds.at(-1),system,service,task};
}

test('reads that the model asks for together are all executed',async t=>{
  const {results,system}=await run(t,[['read_source',{path:'app.txt'}],['source_search',{query:'second'}],['read_source',{path:'openwiki/home.md'}],['wiki_query',{query:'welcome'}]]);
  assert.deepEqual(results.map(item=>item.tool),['read_source','source_search','read_source','wiki_query']);
  assert.ok(results.every(item=>item.result.deferred!==true&&!item.result.error),JSON.stringify(results.map(item=>item.result.error||item.result.deferred||'ok')));
  assert.equal(results[0].result.path,'app.txt');assert.equal(results[2].result.path,'openwiki/home.md');assert.ok(results[1].result.results.length>0);
  assert.match(system,/these read operations may be called together in one response and all of them are executed: [^.]*read_source[^.]*source_search/);
});

test('an operation that is not a read still runs alone',async t=>{
  const edit=['propose_patch',{path:'app.txt',expectedHash:'x',edits:[{oldText:'first',newText:'1st'}],reason:'요청'}];
  const after=await run(t,[['read_source',{path:'app.txt'}],edit,['read_source',{path:'openwiki/home.md'}]]);
  assert.equal(after.results[0].result.path,'app.txt');
  assert.equal(after.results[1].result.deferred,true,'an edit asked for with a read waits for the next response');
  assert.equal(after.results[2].result.deferred,true,'and so does what follows it');
  assert.equal(after.service.state().proposals.length,0);
  const before=await run(t,[['inspect_path',{path:'new.txt'}],['propose_new_file',{path:'new.txt',content:'x',reason:'요청'}],['read_source',{path:'app.txt'}]]);
  assert.equal(before.results[0].result.exists,false);
  assert.equal(before.results[1].result.deferred,true);assert.equal(before.results[2].result.path,undefined,'a read after a waiting call is not executed');
});

// Found with gpt-5.6-sol on 2026-09-29: the shared runtime keeps the two
// newest reads and replaces older ones by references once a request passes
// 32,000 characters. Every request of Desktop does. Of four reads in one
// response the model received two and a reference for each of the others,
// before it had seen any of them.
test('reads of one response all reach the model, and reads of earlier responses are replaced as before',async t=>{
  const {service,root}=await fixture(t);
  const {mkdir,writeFile}=await import('node:fs/promises'),path=await import('node:path'),{git}=await import('../runtime/files.mjs');
  await mkdir(path.join(root,'src'),{recursive:true});
  const files=['b1','b2','b3','b4','b5'].map(name=>'src/'+name+'.mjs');
  for(const file of files)await writeFile(path.join(root,file),Array.from({length:60},(_,i)=>`export const item${i+1} = ${i+1}; // ${file} line of ordinary length`).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','five files']);
  let round=0;const seen=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const names=new Map();for(const message of messages)for(const call of message.tool_calls||[])names.set(call.id,call.function);
    seen.push(messages.filter(message=>message.role==='tool'&&names.get(message.tool_call_id)?.name==='read_source').map(message=>({path:JSON.parse(names.get(message.tool_call_id).arguments).path,result:JSON.parse(message.content)})));
    if(round===0){round++;return calls(files.slice(0,4).map(file=>['read_source',{path:file}]));}
    if(round===1){round++;return calls([['read_source',{path:files[4]}]]);}
    return {content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'src의 파일을 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  const afterFour=seen.find(list=>list.length===4);
  assert.deepEqual(afterFour.map(item=>[item.path,typeof item.result.content==='string'&&item.result.end]),files.slice(0,4).map(file=>[file,60]),'all four as they were read');
  const afterFive=seen.find(list=>list.length===5);
  assert.equal(afterFive[4].result.end,60,'the newest read');
  assert.ok(afterFive.slice(0,2).every(item=>item.result.contextCleared===true&&item.result.analysis_evidence_id),'older reads are references: '+JSON.stringify(afterFive.map(item=>item.result.contextCleared||false)));
});
