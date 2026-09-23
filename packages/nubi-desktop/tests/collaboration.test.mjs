import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {connectA2A,importA2A,deliverA2A} from '../../nubi-a2a/client.mjs';

test('project source and Wiki round trip does not pass acceptance criteria',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'welcome screen app.txt',criteria:['welcome is shown']});
 service.store.set('task:'+task.id,{...task,sources:[{path:'app.txt'}]});
 const sent=await service.invoke('collaboration',{action:'request',taskId:task.id,recipient:'browser',requestId:'project-request-123'});
 const invite=await service.collaboration({action:'invite',recipient:'browser'}),client=await connectA2A(invite.url,'browser');
 const draft=await importA2A(client,sent.id);assert.match(draft.text,/first/);assert.match(draft.text,/home.md/);assert.match(draft.text,/AC-1/);
 await deliverA2A(client,{...draft,messageId:'project-reply-123',text:'AC-1: welcome 확인',localRunId:'browser-run',kind:'scenario_draft'});
 const received=service.state().collaborations.find(r=>r.id===sent.id);assert.equal(received.result.verification,'not_run');assert.equal(service.task(task.id).criteria[0].state,'unknown');
 assert.equal((await service.collaboration({action:'request',taskId:task.id,recipient:'browser',requestId:'project-request-123'})).id,sent.id);
 await service.collaborationServer.close();service.collaborationServer=null;
});
test('changed source rejects returned draft without altering task or running tools',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'welcome screen app.txt'});service.store.set('task:'+task.id,{...task,sources:[{path:'app.txt'}]});
 const sent=await service.collaboration({action:'request',taskId:task.id,recipient:'office',requestId:'project-office-123'}),client=await connectA2A((await service.collaboration({action:'invite',recipient:'office'})).url,'office');
 const draft=await importA2A(client,sent.id);await writeFile(path.join(root,'app.txt'),'changed');
 await assert.rejects(deliverA2A(client,{...draft,messageId:'office-reply-123',text:'검토 초안',localRunId:'office-run',kind:'document_draft'}),/stale/);
 assert.equal(service.state().collaborations[0].result,null);assert.equal(service.processes.active.size,0);
 await service.collaborationServer.close();service.collaborationServer=null;
});
