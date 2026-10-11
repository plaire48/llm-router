import test from 'node:test';
import {featureTest} from './beta-feature.mjs';
const a2aTest=featureTest('a2a');
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {connectA2A,taskApi} from '../../nubi-a2a/client.mjs';
import {checkTaskResult} from '../../nubi-a2a/tasks.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readSource} from '../runtime/files.mjs';
import {checkReportedFacts,deliveredFacts,readFiles} from '../runtime/peer-facts.mjs';
installAgent(ProjectService);

// Suggested by the browser session after its real-extension round trip (2026-10-01): a Workspace answer carries
// structured facts. As in the browser, the model reports them and the host checks each quote against this run's reads.
const HASH='sha256:'+'a'.repeat(64);
const read=(content,{file='app.txt',hash=HASH}={})=>({tool:'read_source',result:{path:file,content,hash}});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function received(service,request){
 const web=await taskApi(await connectA2A((await service.invoke('collaboration',{action:'invite',recipient:'browser'})).url,'browser'));
 const incoming=await web.request({recipient:'desktop',skill:'source-search',request});
 return {web,incoming,...await service.collaboration({action:'task_accept',id:incoming.id})};
}
// Reads app.txt, reports facts, answers; the script follows the tool results by content.
function model(service,facts){
 const offered=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:272000}]}),dispose(){},complete:async(messages,tools)=>{
  offered.push(tools.map(item=>item.function.name));const outputs=messages.filter(message=>message.role==='tool').map(message=>String(message.content));
  if(!outputs.some(output=>/"content":"first/.test(output)))return call('read_source',{path:'app.txt',start:1,end:2});
  if(facts&&!outputs.some(output=>/"checked":\d/.test(output)))return call('report_source_facts',{facts});
  return {content:'app.txt의 첫 줄은 first입니다.',calls:[]};
 }};
 return offered;
}

test('a reported fact is checked only against a read of this run that holds its quote',()=>{
 const {facts}=checkReportedFacts({facts:[
  {name:'첫 줄',value:'first',path:'./app.txt',quote:'first'},
  {name:'없는 인용',value:'x',path:'app.txt',quote:'nowhere in the file'},
  {name:'안 읽은 파일',value:'y',path:'other.txt',quote:'first'},
  {name:'서식 차이',value:'z',path:'app.txt',quote:'**Second**  line'}]},[read('first\nsecond line\n')]);
 assert.deepEqual(facts.map(fact=>[fact.path,fact.checked,fact.hash||null]),[['app.txt',true,HASH],['app.txt',false,null],['other.txt',false,null],['app.txt',true,HASH]]);
 assert.equal(checkReportedFacts({facts:[{name:'a',value:'b',path:'app.txt',quote:'**'}]},[read('**')]).facts[0].checked,false,'A quote of marks alone matches nothing');
 assert.equal(checkReportedFacts({facts:[]},[]).error,'tool_arguments_invalid');
 assert.deepEqual(readFiles([{tool:'wiki_query',result:{results:[{path:'openwiki/home.md',hash:HASH,excerpt:'The welcome screen'}]}}]).map(file=>file.path),['openwiki/home.md'],'Wiki excerpts count as reads');
 assert.equal(deliveredFacts(facts).verification,'not_run','One unchecked fact leaves the result unchecked');
 assert.equal(deliveredFacts([facts[0]]).verification,'host_checked');assert.equal(deliveredFacts([]).verification,'not_run');
 assert.equal(checkTaskResult({summary:'s',...deliveredFacts(facts),evidence:[],localRunId:'r'}).facts.length,4,'The delivered facts meet the shared contract');
});

a2aTest('a Workspace answer carries the facts it reported with their file versions, host_checked when all match',async t=>{
 const {service,root}=await fixture(t),{web,incoming,localTaskId}=await received(service,'app.txt 첫 줄을 알려 주세요.');
 const offered=model(service,[{name:'첫 줄',value:'first',path:'app.txt',quote:'first'}]);
 await service.startAgent({taskId:localTaskId});await service.agent.promise;
 assert(offered.length&&offered.every(names=>names.includes('report_source_facts')));
 await service.collaboration({action:'task_deliver',id:incoming.id,taskId:localTaskId});
 const {result}=await web.get(incoming.id);
 assert.deepEqual([result.verification,result.facts],['host_checked',[{name:'첫 줄',value:'first',path:'app.txt',quote:'first',hash:(await readSource(root,'app.txt')).hash}]]);
});

a2aTest('an unmatched quote is sent unchecked, and a file changed after the run is not sent',async t=>{
 const {service,root}=await fixture(t),first=await received(service,'app.txt 첫 줄을 알려 주세요.');
 model(service,[{name:'첫 줄',value:'first',path:'app.txt',quote:'이 파일에 없는 문장'}]);
 await service.startAgent({taskId:first.localTaskId});await service.agent.promise;
 await service.collaboration({action:'task_deliver',id:first.incoming.id,taskId:first.localTaskId});
 const {result}=await first.web.get(first.incoming.id);
 assert.deepEqual([result.verification,result.facts[0].hash],['not_run',undefined]);
 const second=await received(service,'app.txt 첫 줄을 다시 알려 주세요.');model(service,[{name:'첫 줄',value:'first',path:'app.txt',quote:'first'}]);
 await service.startAgent({taskId:second.localTaskId});await service.agent.promise;
 await writeFile(path.join(root,'app.txt'),'changed\n');
 await assert.rejects(service.collaboration({action:'task_deliver',id:second.incoming.id,taskId:second.localTaskId}),/a2a_stale/);
});

test('report_source_facts is offered only to a run of a request another Nubi sent',async t=>{
 const {service}=await fixture(t),offered=model(service,null),task=await service.createTask({request:'app.txt 첫 줄을 알려 주세요.'});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert(offered.length&&offered.every(names=>!names.includes('report_source_facts')));
});
