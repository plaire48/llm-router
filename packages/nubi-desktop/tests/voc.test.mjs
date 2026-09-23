import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);
const data=extra=>({contract:'nubi-voc-v1',sourceUrl:'https://jira.example/browse/HELP-42',key:'HELP-42',title:'로그인 오류',updatedAt:'2026-09-23T00:00:00Z',body:'로그인 후 오류가 발생했습니다.\n원인은 아직 확인하지 않았습니다.',comments:[{id:'c1',text:'캐시를 지우고 재확인 요청',createdAt:'2026-09-22T12:34:00Z',visibility:'internal'}],...extra});
const put=(s,value=data())=>s.invoke('importVoc',{json:JSON.stringify(value)});

test('VOC import preserves original bytes and current revision; duplicate import and restart are idempotent',async t=>{
  const {service,root}=await fixture(t),first=await put(service);
  assert.equal(first.noChange,false);assert.equal(first.verification,'stored_bytes_only');
  const original=await readFile(path.join(root,path.dirname(first.path),'original.json'),'utf8');assert.equal(original,JSON.stringify(data()));
  assert.equal((await put(service)).noChange,true);assert.equal(service.store.list('voc:').length,1);
  service.store.close();await service.open(root);assert.equal((await put(service)).id,first.id);
  const found=await service.queryVoc({query:'로그인'});assert.equal(found.results[0].id,first.id);assert.equal(found.results[0].sourceTrust,'user_imported');
  const text=await service.readVoc({id:first.id});assert.match(text.content,/캐시/);assert.match(text.content,/2026-09-22T12:34:00Z/);assert.equal(text.coverage,'partial');
});
test('new remote version preserves prior evidence and importing old data does not replace the latest',async t=>{
  const {service,root}=await fixture(t),old=await put(service),newer=await put(service,data({updatedAt:'2026-09-24T00:00:00Z',body:'원인을 확인했습니다.'}));
  await put(service);assert.equal((await service.queryVoc({})).results[0].id,newer.id);
  assert.match((await service.readVoc({id:old.id})).content,/아직 확인하지/);
  assert.equal((await service.queryVoc({})).results[0].revisionCount,2);
  await writeFile(path.join(root,path.dirname(old.path),'notes.md'),'human note');await put(service);assert.equal(await readFile(path.join(root,path.dirname(old.path),'notes.md'),'utf8'),'human note');
});
test('tampered or missing originals cannot be silently repaired or cited',async t=>{
  const {service,root}=await fixture(t),saved=await put(service);
  await writeFile(path.join(root,saved.path),'human edits');
  await assert.rejects(()=>put(service),/voc_changed/);await assert.rejects(()=>service.readVoc({id:saved.id}),/voc_changed/);
  const found=await service.queryVoc({});assert.equal(found.unavailable,1);assert.equal(found.results.length,0);
  assert.equal(await readFile(path.join(root,saved.path),'utf8'),'human edits');
});
test('lost final receipt reconciles stored hashes while absent interrupted import can be retried',async t=>{
  const {service,root}=await fixture(t),saved=await put(service),key='voc:'+saved.id;
  service.store.set(key,{...service.store.get(key),state:'writing'});assert.equal((await put(service)).noChange,true);
  const pending=service.store.get(key);service.store.set(key,{...pending,state:'attention'});await rm(path.join(root,pending.path),{recursive:true});
  assert.equal((await put(service)).noChange,false);assert.match((await service.readVoc({id:saved.id})).content,/로그인/);
});
test('invalid contracts, duplicate evidence IDs, credentials and links outside HTTP fail before writing',async t=>{
  const {service}=await fixture(t);
  for(const value of [data({token:'secret'}),data({updatedAt:'bad'}),data({sourceUrl:'file:///etc/passwd'}),data({sourceUrl:'https://user:password@jira.example/a'}),data({comments:[{id:'x',text:'a'},{id:'x',text:'b'}]})])await assert.rejects(()=>put(service,value),/voc_invalid/);
  await assert.rejects(()=>service.importVoc({json:'x'.repeat(1024*1024+1)}),/voc_invalid/);assert.equal(service.store.list('voc:').length,0);
});
test('symlink storage is rejected; tenant identity and model read ranges stay bounded',async t=>{
  const {service,root,directory}=await fixture(t);const outside=path.join(directory,'outside');await mkdir(outside);await symlink(outside,path.join(root,'voc'),'dir');
  await assert.rejects(()=>put(service),/voc_scope/);await rm(path.join(root,'voc'));
  const a=await put(service,data({body:Array.from({length:200},(_,i)=>'Line '+i).join('\n')})),b=await put(service,data({sourceUrl:'https://other.example/browse/HELP-42'}));
  assert.notEqual(a.ticketId,b.ticketId);const read=await service.readVoc({id:a.id});assert(read.nextStart);assert(read.end-read.start<80);
  await assert.rejects(()=>service.readVoc({id:'../../outside'}),/voc_invalid/);
});
test('Pi finds then reads VOC references without granting source edit authority',async t=>{
  const {service}=await fixture(t),saved=await put(service),task=await service.createTask({request:'로그인 VOC의 조치 내용과 근거를 알려 주세요.'});let calls=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
    calls++;if(calls===1)return call('search_voc',{query:'로그인'});if(calls===2){assert.match(JSON.stringify(messages),new RegExp(saved.id));return call('read_voc',{id:saved.id});}
    assert.match(JSON.stringify(messages),/캐시를 지우고/);return {content:'캐시를 지운 뒤 재확인을 요청한 기록입니다. 해결 여부는 미확인입니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(calls,3);assert.equal(service.store.list('proposal:').length,0);assert.equal(service.task(task.id).sources?.length||0,0);
});

test('bounded VOC reads reconstruct long Unicode paragraphs without gaps or broken characters',async t=>{
  const {service,root}=await fixture(t);
  const saved=await put(service,data({body:'a'.repeat(15999)+'🐦'+'한글🐦'.repeat(12000)+'\n'+Array.from({length:180},(_,i)=>'line '+i).join('\n')}));
  const original=await readFile(path.join(root,saved.path),'utf8');
  let cursor={id:saved.id},reconstructed='',pages=0,partial=false;
  do{
    const page=await service.readVoc(cursor);pages++;assert(pages<30);
    assert(page.content.length<=16000);assert(page.end-page.start<80);assert(page.content.isWellFormed());
    reconstructed+=page.content;
    if(page.nextStart===null)break;
    partial ||= page.nextOffset>0;
    assert(page.nextStart>page.start||page.nextOffset>page.offset);
    if(page.nextOffset===0)reconstructed+='\n';
    cursor={id:saved.id,start:page.nextStart,offset:page.nextOffset};
  }while(true);
  assert(partial);assert.equal(reconstructed,original);
  const bodyLine=original.split('\n').findIndex(v=>v.startsWith('aaaa'))+1;
  for(const offset of [-1,0.5,16000,999999])await assert.rejects(()=>service.readVoc({id:saved.id,start:bodyLine,offset}),/voc_invalid/);
});
