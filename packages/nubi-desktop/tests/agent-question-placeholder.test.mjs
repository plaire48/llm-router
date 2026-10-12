import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
test('recovery question accepts its format hint and waits for user instead of failing schema validation',async t=>{const {service}=await fixture(t);service.providers={dispose(){},status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),complete:async()=>({content:'',calls:[{id:'q',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'어느 범위를 확인할까요?',input_placeholder:'예: 이번 달 변경 사항'})}}]})};const task=await service.createTask({request:'필요한 범위를 물어봐 줘.'});await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(service.task(task.id).state,'waiting_input');assert.equal(service.task(task.id).error,null);assert.equal(service.task(task.id).question.inputPlaceholder,'예: 이번 달 변경 사항');});
