// User decision 2026-09-30 (case A14), measured with gpt-5.6-sol. After each
// approval a new run starts. The agent writes the intent of that run itself
// with update_plan, and so the planner, which sees the previous intent, is not
// asked. The previous run had recorded "submission is left to the applicant, as
// the rules require"; the new run did not see it, set the goal back to
// submitting and proposed pressing Submit. A new run now shows the agent the
// constraints of the previous run's intent, without its goal.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const receiptsOf=messages=>{const text=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Current host receipts'))?.content;return text?JSON.parse(text.slice(text.indexOf('{'))):null;};
const KEEP='제출은 규정상 신청자 본인만 한다. 자동화 도구는 임시 저장까지만 한다.';
const intent=(goal,constraints)=>({goal,constraints,outcomes:['신청서가 규정에 맞게 저장됨'],workflowIds:[],skillPaths:[]});
const steps=[{text:'규정 확인',expected_outcome:'제출 제한을 안다',status:'in_progress'},{text:'임시 저장',expected_outcome:'저장된다',status:'pending'}];

test('a new run shows the agent the constraints of the previous intent, all through the run',async t=>{
  const {service}=await fixture(t);let run=1,step=0;const seen=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    seen.push({run,previous:receiptsOf(messages)?.previousIntent??null});
    step++;
    if(step===1)return call('update_plan',{intent:intent('신청서를 마무리한다',[KEEP]),steps});
    if(step===2)return call('read_source',{path:'app.txt'});
    if(run===1)return {content:'규정상 자동 제출은 할 수 없어 임시 저장까지만 합니다.',calls:[]};
    // The new run writes its own intent without the constraint, as the model did.
    if(step===4)return call('update_plan',{intent:intent('신청서를 마무리하고 제출한다',[]),steps});
    if(step===5)return call('read_source',{path:'app.txt'});
    return {content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'신청서를 규정대로 마무리해서 제출까지 해 줘'});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  run=2;step=3;
  await service.startAgent({taskId:task.id,answer:'승인했어. 이어서 해 줘'});await service.agent.promise;
  assert.ok(seen.filter(item=>item.run===1).every(item=>item.previous===null),'a first run has no previous intent');
  const later=seen.filter(item=>item.run===2);
  assert.ok(later.length>=3);
  for(const item of later){
    assert.deepEqual(item.previous?.constraints,[KEEP],'shown in every request of the new run, also after its own update_plan');
    assert.equal('goal' in item.previous,false,'the goal of the previous run is not repeated');
    assert.match(item.previous.instruction,/Keep its constraints/);
  }
});
