import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {resolveAgentCommand,commandOptions,commandAllowsTool} from '../runtime/agent-commands.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:32000}]});
for(const scope of ['mail','code'])test(`/${scope} dispatch rejects the opposite source and retains its own search`,async t=>{
 const {service}=await fixture(t);let round=0,mailReads=0;const wires=[];
 service.mail=async()=>{mailReads++;return {items:[],total:0};};
 const forbidden=scope==='mail'?'read_source':'personal_mail_query',allowed=scope==='mail'?'personal_mail_query':'read_source';
 service.providers={status,dispose(){},complete:async(messages,tools)=>{
  wires.push(messages);assert(!tools.some(tool=>tool.function.name===forbidden));
  if(++round===1)return call(forbidden,scope==='mail'?{path:'app.txt'}:{query:'forbidden'});
  if(round===2)return call(allowed,scope==='mail'?{query:'invoice'}:{path:'app.txt'});
  return {content:'지정한 자료 범위의 확인 결과입니다.',calls:[]};
 }};
 const task=await service.createTask({request:`/${scope} 관련 자료 확인`});await service.startAgent({taskId:task.id});await service.agent.promise;
 const wire=JSON.stringify(wires);assert.match(wire,/search_scope/);assert.equal(mailReads,scope==='mail'?1:0);
 if(scope==='code'){const results=wires.flat().filter(message=>message.role==='tool').map(message=>{try{return JSON.parse(message.content);}catch{return {};}});assert(results.some(result=>result.path==='app.txt'&&String(result.content).includes('first')),JSON.stringify(results));}
 assert.equal(service.task(task.id).error,null);assert.equal(service.processes.active.size,0);
});
test('slash scopes reserve code and block writes while ordinary requests remain unchanged',()=>{
 const choices=commandOptions([],'/');assert(choices.some(item=>item.command==='code'));assert(choices.some(item=>item.command==='mail'));
 for(const scope of ['mail','code'])for(const name of ['prepare_setup_action','propose_patch','open_workspace_page','analyze_documents'])assert.equal(commandAllowsTool(resolveAgentCommand('/'+scope+' 요청'),name),false);
 assert(commandAllowsTool(null,'propose_patch'));assert(commandAllowsTool(resolveAgentCommand('/plan 요청'),'read_source'));
});
