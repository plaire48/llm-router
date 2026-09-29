// Found by the measurement of 2026-09-29 with gpt-5.6-sol (case L1, a window
// of 22,000 tokens). The input limit was 18,700 tokens and a request held
// about 7,200 tokens of tool definitions (34 tools) and 3,400 of system text
// before any conversation. About 3,000 tokens were left for the work.
// User decision 2026-09-29: in a small window offer the core tools only, as
// the shared browser harness does for its own tools.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {LEAN_TOOLS,LEAN_INPUT_TOKENS,createToolSet} from '../runtime/lean-tools.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const calls=list=>({content:'',calls:list.map(([name,args])=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}))});
async function run(t,{contextLength=22000,workflowIds=[],steps=[]}={}){
  const {service}=await fixture(t,{scriptedPlanning:true});const requests=[];let at=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength}]}),dispose(){},async complete(messages,tools){
    if(String(messages[0].content).startsWith(WORK_PLAN_PROMPT))return {content:JSON.stringify({intent:{goal:'요청 확인',constraints:[],outcomes:['요청한 내용을 확인한다'],workflowIds,skillPaths:[]},steps:[{text:'확인',expected_outcome:'요청한 내용을 확인한다',status:'in_progress'}]}),calls:[]};
    const names=new Map();for(const message of messages)for(const call of message.tool_calls||[])names.set(call.id,call.function.name);
    const results=messages.filter(message=>message.role==='tool'&&names.get(message.tool_call_id)!=='update_plan').map(message=>({tool:names.get(message.tool_call_id),result:JSON.parse(message.content)}));
    requests.push({names:tools.map(item=>item.function.name),size:JSON.stringify(tools).length,system:messages.filter(message=>message.role==='system').map(message=>message.content).join('\n'),results});
    return steps[at++]?.(requests.at(-1))||{content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'app.txt를 확인해 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  return {requests,service,task};
}

test('a large window offers every tool; a small one offers the core and a way to the rest',async t=>{
  const large=await run(t,{contextLength:200000}),small=await run(t,{contextLength:22000});
  const [wide,narrow]=[large.requests[0],small.requests[0]];
  assert.ok(wide.names.includes('record_change_plan')&&wide.names.includes('search_voc')&&wide.names.includes('delegate_analysis'));
  assert.ok(!wide.names.includes('select_tools'));assert.ok(!wide.system.includes('select_tools adds'));
  assert.ok(narrow.names.every(name=>LEAN_TOOLS.includes(name)),'only core tools: '+narrow.names.join(', '));
  for(const name of ['update_plan','ask_user','select_tools','discover_capabilities','read_source','source_search','wiki_query','read_analysis_evidence'])assert.ok(narrow.names.includes(name),name);
  for(const name of ['record_change_plan','search_voc','delegate_analysis','propose_setup_action'])assert.ok(!narrow.names.includes(name),name);
  assert.ok(narrow.size<9000&&narrow.size*3<wide.size,`small ${narrow.size}, large ${wide.size}`);
  assert.match(narrow.system,/select_tools adds/);
  assert.equal(LEAN_INPUT_TOKENS,20000);
  // A window of 32,000 tokens (27,200 of input) offers every tool, as before.
  const normal=await run(t,{contextLength:32000});assert.ok(!normal.requests[0].names.includes('select_tools')&&normal.requests[0].names.includes('record_change_plan'));
});

test('the tools of the workflows in the plan are offered once the plan is recorded',async t=>{
  const {requests}=await run(t,{workflowIds:['source-change'],steps:[()=>calls([['read_source',{path:'app.txt'}]])]});
  assert.ok(!requests[0].names.includes('record_change_plan'));
  for(const name of ['record_change_plan','propose_patch','code_outline','inspect_path'])assert.ok(requests[1].names.includes(name),name);
  assert.ok(!requests[1].names.includes('search_voc'));
});

test('select_tools connects a group or what a query names, and the operation beside it runs',async t=>{
  const {requests}=await run(t,{steps:[
    ()=>calls([['select_tools',{groups:['voc']}],['search_voc',{query:'배송'}]]),
    ()=>calls([['select_tools',{query:'설치 빌드 환경'}]]),
    ()=>calls([['select_tools',{groups:['no-such-group']}]]),
  ]});
  const [selected,searched]=requests[1].results;
  assert.equal(selected.tool,'select_tools');assert.equal(selected.result.ok,true);assert.deepEqual(selected.result.connected,['search_voc','read_voc']);
  assert.equal(searched.tool,'search_voc');assert.equal(searched.result.deferred,undefined,'the operation after select_tools ran');
  assert.ok(requests[1].names.includes('search_voc')&&requests[1].names.includes('read_voc'));
  const queried=requests[2].results.at(-1).result;
  assert.ok(queried.matches.includes('inspect_environment'),JSON.stringify(queried.matches));assert.ok(queried.matches.length<=5);
  assert.ok(requests[2].names.includes('inspect_environment'));
  const refused=requests[3].results.at(-1).result;
  assert.equal(refused.ok,false);assert.equal(refused.error,'tool_group_unknown');assert.deepEqual(refused.details.unknownGroups,['no-such-group']);
  assert.ok(refused.details.groups.includes('source-change')&&refused.details.groups.includes('voc'));
  assert.equal(refused.actionIssued,false);
});

test('a tool that is not offered still runs when called and is offered from then on',async t=>{
  const {requests}=await run(t,{steps:[()=>calls([['inspect_environment',{}]])]});
  assert.ok(!requests[0].names.includes('inspect_environment'));
  const result=requests[1].results.at(-1);
  assert.equal(result.tool,'inspect_environment');assert.equal(result.result.error,undefined);
  assert.ok(requests[1].names.includes('inspect_environment'));
});

test('the tool set without a small window changes nothing',()=>{
  const tools=[{type:'function',function:{name:'read_source'}},{type:'function',function:{name:'search_voc'}}];
  const wide=createToolSet({tools,lean:false});
  assert.equal(wide.advertised(tools),tools);assert.deepEqual(wide.select({groups:['voc']}).connected,[]);
});
