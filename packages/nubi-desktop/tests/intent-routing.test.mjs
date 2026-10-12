import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {taskCapabilities,skillCatalog} from '../runtime/agent-capabilities.mjs';
import {workIntent,WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {reviewRequirements} from '../runtime/result-review.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const reply=content=>({content,calls:[]});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const steps=[{text:'요청한 자료 확인',expected_outcome:'현재 파일에서 근거 확인',status:'in_progress'}];
const intent={goal:'현재 자료를 읽고 원인을 설명',constraints:['파일은 변경하지 않는다'],outcomes:['관찰한 근거와 미확인 결과를 구분'],workflowIds:['source-change','knowledge'],skillPaths:[]};
const tools=['read_source','wiki_query','source_search'];
async function skill(root,name,description,body='Use current project evidence.'){
  const folder=path.join(root,'.nubi/skill',name);await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,'SKILL.md'),`---\nname: ${name}\ndescription: ${description}\n---\n${body}`);
  return `.nubi/skill/${name}/SKILL.md`;
}

test('intent-aware metadata retrieves a late catalog skill and never injects its instructions',async t=>{
  const {root}=await fixture(t);
  for(let i=0;i<24;i++)await skill(root,'a-'+String(i).padStart(2,'0'),'Generic reference');
  const target=await skill(root,'z-accessibility','접근성 화면 검토 accessibility','INSTRUCTION_BODY_NOT_METADATA');
  const catalog=await skillCatalog(root),context=taskCapabilities(catalog,{request:'접근성 화면 검토'},tools);
  assert.equal(context.skills[0].path,target);assert.equal(context.skills.length,8);assert.equal(context.hasMore,true);
  assert.equal(JSON.stringify(context).includes('INSTRUCTION_BODY_NOT_METADATA'),false);
  assert.deepEqual(context.workflows.flatMap(w=>w.tools).filter(t=>!tools.includes(t)),[]);
  const changed=taskCapabilities(catalog,{request:'Generic',messages:[{role:'user',content:'접근성 화면 검토'}]},tools);
  assert.equal(changed.skills[0].path,target);
});

test('work intent supports multiple domains but refuses invented workflows, skills and blank goals',()=>{
  const capabilities=taskCapabilities({skills:[],issues:[],truncated:false},{request:'코드와 업무 규칙 확인'},tools);
  assert.deepEqual(workIntent(intent,capabilities),intent);
  for(const input of [{...intent,goal:' '},{...intent,workflowIds:['a2a']},{...intent,skillPaths:['/outside/SKILL.md']},{...intent,outcomes:[]}])assert.throws(()=>workIntent(input,capabilities),/work_plan_invalid/);
  const checks=reviewRequirements({request:'원래 요청',criteria:[],workPlan:{intent}});
  assert.equal(checks[0].text,'원래 요청');assert.ok(checks.some(c=>c.id==='intent:constraint:0'));assert.ok(checks.some(c=>c.id==='intent:outcome:0'));
});

test('selected long skill must be read completely before project work, then plan updates retain intent',async t=>{
  const {service,root}=await fixture(t,{scriptedPlanning:true});
  const selected=await skill(root,'source-review','현재 소스 검토','Read current evidence.\n'.repeat(450));
  let entry,round=0,reads=0;const read=service.read.bind(service);service.read=async args=>{reads++;return read(args);};
  service.providers={status,dispose(){},complete:async messages=>{
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){
      const data=JSON.parse(messages[1].content);entry=data.capabilities.skills.find(s=>s.path===selected);assert.ok(entry);
      return reply(JSON.stringify({intent:{...intent,skillPaths:[selected]},steps}));
    }
    const last=messages.findLast(m=>m.role==='tool');round++;
    if(round===1)return call('read_source',{path:'app.txt'});
    if(round===2){assert.match(last.content,/selected_skill_required/);assert.equal(reads,0);return call('use_skill',{path:selected,expectedHash:entry.hash});}
    if(round===3){assert.ok(JSON.parse(last.content).nextOffset);return call('read_source',{path:'app.txt'});}
    if(round===4){assert.match(last.content,/selected_skill_required/);return call('read_skill',{path:selected,expectedHash:entry.hash,offset:8000});}
    if(round===5){assert.equal(JSON.parse(last.content).nextOffset,null);return call('update_plan',{steps});}
    if(round===6)return call('read_source',{path:'app.txt'});
    assert.equal(reads,1);return reply('현재 파일을 확인했습니다. 파일은 변경하지 않았습니다.');
  }};
  const task=await service.createTask({request:'현재 소스 검토. 파일은 변경하지 마.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.deepEqual(service.task(task.id).workPlan.intent.skillPaths,[selected]);assert.equal(reads,1);
  assert.equal(service.state().proposals.length,0);assert.equal(service.state().processes.length,0);
});

test('a loaded selected skill changed on disk is rejected before the next project operation',async t=>{
  const {service,root}=await fixture(t,{scriptedPlanning:true});const selected=await skill(root,'source-review','소스 검토');
  let entry,round=0,reads=0;service.read=async()=>{reads++;throw Error('must not run');};
  service.providers={status,dispose(){},complete:async messages=>{
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){entry=JSON.parse(messages[1].content).capabilities.skills[0];return reply(JSON.stringify({intent:{...intent,skillPaths:[selected]},steps}));}
    round++;
    if(round===1)return call('use_skill',{path:selected,expectedHash:(await skillCatalog(root)).skills[0].hash});
    if(round===2){await writeFile(path.join(root,selected),'changed');return call('read_source',{path:'app.txt'});}
    assert.match(messages.findLast(m=>m.role==='tool').content,/skill_invalid|skill_changed/);return reply('스킬이 변경되어 다시 확인해야 합니다.');
  }};
  const task=await service.createTask({request:'소스 검토'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(reads,0);assert.equal(service.task(task.id).state,'review');
});

test('an explicit initial plan without user intent cannot unlock project tools',async t=>{
  const {service}=await fixture(t);let round=0,reads=0;service.read=async()=>{reads++;};
  service.providers={status,dispose(){},complete:async messages=>{
    round++;if(round===1)return call('update_plan',{steps});
    assert.match(messages.findLast(m=>m.role==='tool').content,/work_plan_invalid/);return reply('요청의 목표를 포함해 계획을 보완해야 합니다.');
  }};
  const task=await service.createTask({request:'파일 확인'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).workPlan,undefined);assert.equal(reads,0);
});

test('context compaction preserves intent but requires selected skill reload before new observations',async t=>{
  const {service,root}=await fixture(t,{scriptedPlanning:true});const selected=await skill(root,'source-review','소스 검토');
  let entry,round=0,reads=0,summaries=0;const read=service.read.bind(service);service.read=async args=>{reads++;return read(args);};
  service.providers={status,dispose(){},complete:async messages=>{
    if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){entry=JSON.parse(messages[1].content).capabilities.skills[0];return reply(JSON.stringify({intent:{...intent,skillPaths:[selected]},steps}));}
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return reply(JSON.stringify({goal:intent.goal,constraints:intent.constraints,decisions:[],completed:[],pending:['현재 근거 다시 확인'],references:[selected]}));}
    round++;
    if(round===1)return call('use_skill',{path:selected,expectedHash:(await skillCatalog(root)).skills[0].hash});
    if(round===2)return call('read_source',{path:'app.txt'});
    if(round===3)throw Error('context_overflow');
    if(round===4){assert.match(JSON.stringify(messages),/파일은 변경하지 않는다/);return call('read_source',{path:'app.txt'});}
    if(round===5){assert.match(messages.findLast(m=>m.role==='tool').content,/selected_skill_required/);assert.equal(reads,1);return call('use_skill',{path:selected,expectedHash:entry.hash});}
    if(round===6)return call('read_source',{path:'app.txt'});
    return reply('문맥 정리 후 지침과 현재 파일을 다시 확인했습니다.');
  }};
  const task=await service.createTask({request:'소스 검토'});
  task.messages=Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',content:'Previous notes '+('details '.repeat(300))}));service.store.set('task:'+task.id,task);
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',JSON.stringify({error:service.task(task.id).error,round,reads,summaries}));assert.ok(summaries>0);assert.equal(reads,2);assert.deepEqual(service.task(task.id).workPlan.intent.constraints,intent.constraints);
});
