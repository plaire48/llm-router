import {featureTest} from './beta-feature.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {PersonalMail} from '../runtime/mail.mjs';
const sha=text=>createHash('sha256').update(text).digest('hex');
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-knowledge-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const mail=Object.create(PersonalMail.prototype),id='a'.repeat(64),text='# Selected mail\n\nOpenWiki summary for this source';
 const row={id,state:'saved',sourceHash:'original-hash',path:path.join(root,'selected.md'),wikiHash:sha(text)};
 await writeFile(row.path,text);await writeFile(path.join(root,'unrelated.md'),'Unrelated private mail');
 mail.root=root;mail.wikiRoot=root;mail.store={get:key=>key==='mail:'+id?row:null};mail.source=async()=>({subject:'Selected mail',text:'Original message',attachments:[]});
 return {mail,id,row,text,root};
}
test('selected mail read includes only its OpenWiki notes and exact original when requested',async t=>{
 const {mail,id,row,text}=await fixture(t);
 assert.equal((await mail.read(id)).knowledge,undefined);
 const source=await mail.call({action:'read',id,includeKnowledge:true});
 assert.equal(source.knowledge.kind,'openwiki');assert.equal(source.knowledge.state,'current');assert.equal(source.knowledge.text,text);assert.equal(source.knowledge.hash,sha(text));assert.equal(source.knowledge.sourceHash,row.sourceHash);assert.equal(source.mail.text,'Original message');assert(!JSON.stringify(source.knowledge).includes('Unrelated'));assert(!JSON.stringify(source.knowledge).includes(row.path));
});
test('edited, missing, pending and unreadable notes never become current or block the original',async t=>{
 const {mail,id,row,root}=await fixture(t);
 await writeFile(row.path,'# User edited notes');assert.equal((await mail.read(id,{includeKnowledge:true})).knowledge.state,'edited');
 await rm(row.path);let source=await mail.read(id,{includeKnowledge:true});assert.equal(source.knowledge.state,'missing');assert.equal(source.mail.text,'Original message');
 row.state='queued';assert.equal((await mail.read(id,{includeKnowledge:true})).knowledge.state,'pending');
 row.state='saved';await symlink(path.join(root,'unrelated.md'),row.path);source=await mail.read(id,{includeKnowledge:true});assert.equal(source.knowledge.state,'unavailable');assert.equal(source.knowledge.text,'');assert.equal(source.mail.text,'Original message');
});
test('large note coverage is bounded and explicitly truncated with a full-content hash',async t=>{
 const {mail,id,row}=await fixture(t);const text='Long note '.repeat(2000);await writeFile(row.path,text);row.wikiHash=sha(text);
 const {knowledge}=await mail.read(id,{includeKnowledge:true});assert.equal(knowledge.text.length,12000);assert.equal(knowledge.truncated,true);assert.equal(knowledge.hash,sha(text));
});

test('the agent mail tool delivers OpenWiki context with original citations to the model',async t=>{
 const {fixture:agentFixture}=await import('./fixtures.mjs');
 const {ProjectService}=await import('../runtime/project-service.mjs');
 const {installAgent}=await import('../runtime/agent.mjs');installAgent(ProjectService);
 const {service}=await agentFixture(t);const {mail,id,row}=await fixture(t);let calls=0,delivered;
 service.mail=async args=>args.action==='evidence'?{id,sourceHash:row.sourceHash,title:'Selected mail'}:mail.call(args);
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
  if(calls++===0)return {content:'선택한 메일과 정리 내용을 확인하겠습니다.',calls:[{id:'mail-read',type:'function',function:{name:'read_personal_mail',arguments:JSON.stringify({id})}}]};
  const result=messages.find(m=>m.role==='tool'&&m.tool_call_id==='mail-read');if(result)delivered=JSON.parse(result.content);
  return {content:'원문과 정리 내용을 확인했습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'선택한 메일만 요약해 줘',mailReferences:[{id,sourceHash:row.sourceHash}]});
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(delivered.knowledge.state,'current');assert.match(delivered.knowledge.text,/OpenWiki summary/);assert.equal(delivered.mail.text,'Original message');assert.equal(delivered.citations[0].id,id);
});

featureTest('mailAttachmentReading')('direct attachment questions consult the same mail notes without replacing the document',async t=>{
 const {installDesktopFeatures}=await import('../runtime/desktop-features.mjs');
 const {mail,id,row,root}=await fixture(t);const text='Exact attachment text';await writeFile(path.join(root,'attachment.bin'),text);
 mail.source=async()=>({subject:'Selected mail',text:'Original message',attachments:[{id:'attachment',filename:'attachment.txt',text,sha256:sha(text),contentState:'document_read'}]});
 const originalRead=mail.read.bind(mail);mail.read=async(id,options)=>({...await originalRead(id,options),attachmentDirectory:root});
 class Host{}installDesktopFeatures(Host);const host=new Host();host.personalMail=mail;let payload;
 host.providers={status:()=>({connected:true,provider:'fixture',model:'fixture'}),complete:async messages=>{payload=JSON.parse(messages.at(-1).content);return {content:'Verified fixture answer'};}};
 const result=await host.mailDocument({id,attachmentId:'attachment',action:'ask',question:'Summarize this attachment',expectedSourceHash:row.sourceHash,expectedAttachmentHash:sha(text)});
 assert.equal(payload.document,text);assert.equal(payload.knowledge.state,'current');assert.match(payload.knowledge.text,/OpenWiki summary/);assert.equal(result.answer,'Verified fixture answer');
});
