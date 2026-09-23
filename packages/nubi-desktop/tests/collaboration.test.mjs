import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';

test('deferred A2A rejects stale UI requests without starting a server or recording transfers',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'welcome screen app.txt'});
 for(const action of ['status','invite','request','cancel']) {
  await assert.rejects(service.invoke('collaboration',{action,taskId:task.id,recipient:'browser',requestId:'deferred-request'}),/a2a_not_enabled/);
 }
 assert.equal(service.collaborationServer,null);
 assert.deepEqual(service.store.list('a2a-task:'),[]);
 assert.deepEqual(service.store.list('a2a-dispatch:'),[]);
 assert.equal(service.processes.active.size,0);
});
test('existing A2A records remain preserved but are not exposed to the desktop agent',async t=>{
 const {service}=await fixture(t),row={id:'old-result',sourceTaskId:'old-task',result:{text:'previous draft'}};
 service.store.set('a2a-task:old-result',row);
 assert.deepEqual(service.state().collaborations,[]);
 assert.deepEqual((await service.overview()).collaborations,[]);
 assert.deepEqual(service.store.get('a2a-task:old-result'),row);
});
