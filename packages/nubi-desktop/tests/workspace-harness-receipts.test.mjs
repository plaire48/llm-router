import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

test('review and wrong-command recovery see owned records hidden by unrelated UI history',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});
  const task=await service.createTask({request:'실패한 할인 검사 결과를 확인해 줘'});
  service.store.set('proposal:owned',{id:'owned',taskId:task.id,path:'app.txt',state:'proposed',createdAt:'2026-10-01T00:00:00Z'});
  service.store.set('setup-action:owned',{id:'owned-setup',taskId:task.id,state:'proposed',createdAt:'2026-10-01T00:00:00Z'});
  service.store.set('process:owned',{id:'owned-process',taskId:task.id,script:'npm run test:discount',state:'failed',execution:'command_returned',exitCode:1,output:'npm error Missing script: "test:discount"',startedAt:'2026-10-01T00:01:00Z'});
  for(let i=0;i<60;i++){
    service.store.set('proposal:other-'+i,{id:'other-'+i,taskId:'unrelated',state:'proposed'});
    service.store.set('setup-action:other-'+i,{id:'other-'+i,taskId:'unrelated',state:'proposed'});
    service.store.set('process:other-'+i,{id:'other-'+i,taskId:'unrelated',state:'completed',startedAt:'2026-10-01T00:02:00Z'});
  }
  assert.equal(service.state().proposals.some(p=>p.id==='owned'),false,'UI list is intentionally bounded');
  let host;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:64000}]}),dispose(){},complete:async messages=>{
    if(messages[0].content.startsWith(REVIEW_PROMPT)){
      const input=JSON.parse(messages[1].content);host=input.evidence.find(e=>e.id==='host').result;
      assert.equal(host.wrongCommand.processId,'owned-process');
      return {content:JSON.stringify({status:'ready',checks:input.requirements.map(r=>({requirementId:r.id,state:'pending',evidenceIds:['host'],detail:'호스트 승인 대기'})),nextStep:''}),calls:[]};
    }
    return {content:'수정안을 확인한 뒤 승인해 주세요.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.deepEqual(host.proposals.map(p=>p.id),['owned']);
  assert.deepEqual(host.setupActions.map(p=>p.id),['owned-setup']);
  assert.deepEqual(host.processes.map(p=>p.id),['owned-process']);
  assert.equal(service.store.list('process:').length,61,'the review must never issue a process');
});
