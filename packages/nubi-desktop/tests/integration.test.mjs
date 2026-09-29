import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {git} from '../runtime/files.mjs';
import {fixtureReview,fixturePlan} from './fixtures.mjs';
installAgent(ProjectService);
const plan=(criterionId)=>({summary:'Improve welcome while preserving existing content',requirements:[{id:'R1',text:'Improve the requested welcome',...(criterionId?{criterionId}:{})}],targets:[{path:'app.txt',reason:'Observed welcome implementation',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'test',description:'Read saved content and verify welcome text'}],assumptions:[]});
async function setup(t){
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-integration-'))),root=path.join(directory,'repo');await mkdir(path.join(root,'openwiki'),{recursive:true});
  await writeFile(path.join(root,'app.txt'),'Welcome old');await writeFile(path.join(root,'openwiki','home.md'),'# Welcome\n\nWelcome screen belongs to app.txt.');
  await git(root,['init','-q']);await git(root,['add','.']);await git(root,['-c','user.name=Fixture','-c','user.email=test@example.invalid','commit','-qm','Initial fixture']);
  const service=new ProjectService({storageRoot:path.join(directory,'state')});await service.open(root);
  t.after(async()=>{service.dispose();await service.agent?.promise;service.store.close();await rm(directory,{recursive:true,force:true});});return {service,root};
}
test('shared Pi loop reads actual source before proposing, then pauses and resumes a requirement question',async t=>{
  const {service}=await setup(t);let step=0,seenHash;
  const calls=(name,args)=>({content:'',calls:[{id:'call-'+(++step),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
    const review=fixturePlan(messages)||fixtureReview(messages);if(review)return review;
    if(step===0)return calls('read_source',{path:'app.txt'});
    if(step===1){const result=messages.findLast(m=>m.role==='tool');assert.ok(result);assert.match(result.content,/Welcome old/);seenHash=/sha256:[a-f0-9]{64}/.exec(result.content)[0];return calls('record_change_plan',plan('AC-1'));}
    if(step===2)return calls('propose_edit',{path:'app.txt',expectedHash:seenHash,content:'Welcome new',reason:'요청한 문구 개선'});
    if(step===3)return calls('ask_user',{question:'표시 언어는 한국어인가요?'});
    return {content:'변경안을 준비했습니다. 적용과 실행은 아직 확인하지 않았습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'Improve welcome',criteria:['새 문구 표시']});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'waiting_input');assert.equal(service.state().proposals.length,1);assert.equal((await service.read({path:'app.txt'})).content,'Welcome old');
  await service.answerAgent({taskId:task.id,answer:'한국어'});await service.agent.promise;assert.equal(service.task(task.id).state,'review');assert.equal(service.task(task.id).criteria[0].state,'unknown');
});
test('OpenWiki existing pairing API is read-only, one-use, bounded and refreshed from disk',async t=>{
  const {service,root}=await setup(t),{url}=await service.connectKnowledge();
  assert.equal((await fetch(url+'api/nubi/v1/wiki/page?id=home')).status,401);
  const html=await(await fetch(url)).text(),code=/name="nubi-pairing-code" content="([^"]+)"/.exec(html)[1];
  const pair=()=>fetch(url+'api/nubi/v1/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
  const session=await(await pair()).json();assert.equal((await pair()).status,401);
  const query=()=>fetch(url+'api/nubi/v1/wiki/query',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.token},body:JSON.stringify({question:'Welcome'})});
  assert.match(JSON.stringify(await(await query()).json()),/Welcome screen/);
  await writeFile(path.join(root,'openwiki','home.md'),'# Welcome\nWelcome was updated by a human.');
  assert.match(JSON.stringify(await(await query()).json()),/updated by a human/);
  assert.equal((await fetch(url,{headers:{origin:'https://example.invalid'}})).status,403);
});
test('the real Pi tool boundary rejects a partial-read rewrite and lets the model prepare a narrow patch',async t=>{
  const {service,root}=await setup(t),content=Array.from({length:420},(_,i)=>`unique row ${i}`).join('\n');
  await writeFile(path.join(root,'app.txt'),content);let step=0,hash;
  const call=(name,args)=>({content:'',calls:[{id:'guard-'+(++step),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
    const review=fixturePlan(messages)||fixtureReview(messages);if(review)return review;
    if(step===0)return call('read_source',{path:'app.txt',start:1,end:10});
    if(step===1){hash=/sha256:[a-f0-9]{64}/.exec(messages.findLast(m=>m.role==='tool').content)[0];return call('propose_edit',{path:'app.txt',expectedHash:hash,content:'truncated rewrite',reason:'unsafe fixture'});}
    if(step===2){assert.match(messages.findLast(m=>m.role==='tool').content,/source_read_required/);return call('record_change_plan',plan());}
    if(step===3)return call('propose_patch',{path:'app.txt',expectedHash:hash,edits:[{oldText:'unique row 2\n',newText:'improved row 2\n'}],reason:'preserve unread content'});
    return {content:'읽은 부분의 수정안을 준비했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'Improve row 2'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(service.state().proposals.length,1);
  assert.equal(service.state().proposals[0].content,content.replace('unique row 2\n','improved row 2\n'));
  assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),content);
});
test('actual browser before/after screenshots and text observations remain separate from completion',async t=>{
  const {service}=await setup(t),task=await service.createTask({request:'Welcome',criteria:['새 환영 문구']});
  const server=createServer((req,res)=>res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(`<html><head><title>Fixture</title></head><body style="background:${req.url==='/after'?'#e8f1fe':'white'}"><h1>${req.url==='/after'?'Welcome new':'Welcome old'}</h1></body></html>`));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
  const result=await service.compare({taskId:task.id,beforeUrl:base+'/before',afterUrl:base+'/after',checks:[{criterionId:'AC-1',text:'Welcome new'}]});
  assert.ok(result.changedPixels>0);assert.equal(result.checks[0].observed,true);assert.equal(result.sourceAssociation,'unverified');assert.equal(service.task(task.id).criteria[0].state,'unknown');assert.match(result.beforeImage,/^data:image\/png/);
  await assert.rejects(service.compare({taskId:task.id,beforeUrl:'https://example.com',afterUrl:base}),/preview_scope/);
});
