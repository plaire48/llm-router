import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from '../runtime/mail.mjs';
import {installDesktopFeatures} from '../runtime/desktop-features.mjs';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');

test('Beta mail organizes the body without attachment parsing and preserves byte-exact downloads',async t=>{
  assert.equal(DESKTOP_FEATURES.mailAttachmentReading,false);
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-beta-'));
  const requests=[],host={storageRoot:path.join(root,'state'),agent:{running:true},providers:{
    status:()=>({connected:true,provider:'fixture',model:'fixture'}),
    catalogs:()=>[{provider:'fixture',models:[{id:'fixture'}]}],
    complete:async messages=>{requests.push(messages);return {content:JSON.stringify({summary:'본문 예산 요청',category:'direct_request',priority:'high',facts:['메일 본문에 예산 요청이 있다.'],actionItems:[]})};}
  }};
  const mail=new PersonalMail(host,{personalRoot:path.join(root,'mail')});
  t.after(async()=>{mail.dispose();await rm(root,{recursive:true,force:true});});
  mail.autoWiki=true;mail.paused=false;mail.account='fixture-account';mail.credentials={};mail.destination={provider:'fixture',model:'fixture'};
  mail.store.set('account:'+mail.account,{seen:[]});
  await mkdir(mail.wikiRoot,{recursive:true});
  const bytes=Buffer.from('ATTACHMENT_PRIVATE_TEXT'),attachment={id:'001-'+sha(bytes).slice(0,16),filename:'Budget.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',sha256:sha(bytes),contentState:'text_read',text:bytes.toString(),size:bytes.length};
  await mail.intake({uidls:['one'],mails:[{uidl:'one',raw:Buffer.from('Original MIME'),attachments:[{...attachment,content:bytes}],normalized:{subject:'예산 확인',from:'sender@example.invalid',text:'본문 예산 요청',attachments:[attachment]}}]},mail.generation);
  let row=mail.rows()[0];
  // Simulate a prior release's failed attachment and extracted cache.
  mail.store.set('mail:'+row.id,{...row,attachmentState:'attention'});
  mail.store.set('attachment:'+row.id+':'+attachment.id,{sourceHash:row.sourceHash,sha256:attachment.sha256,state:'complete',text:'CACHED_PRIVATE_TEXT',segments:[{sheet:'Sheet1',text:'CACHED_PRIVATE_TEXT'}]});
  let extractionCalls=0;mail.extractAttachment=async()=>{extractionCalls++;throw Error('must_not_parse');};
  host.agent.running=false;await mail.readAttachments();await mail.drain();
  assert.equal(extractionCalls,0);assert.equal(mail.rows()[0].state,'saved',JSON.stringify(mail.rows()[0]));assert.equal(requests.length,1);
  assert.doesNotMatch(JSON.stringify(requests),/ATTACHMENT_PRIVATE_TEXT|CACHED_PRIVATE_TEXT/);
  const source=await mail.read(row.id,{includeKnowledge:true});
  assert.equal(source.mail.text,'본문 예산 요청');assert.equal(source.mail.attachments[0].text,'');assert.deepEqual(source.mail.attachments[0].segments,[]);assert.equal(source.knowledge.state,'current');
  assert.equal(mail.status().counts.attachmentAttention,0);assert.equal(mail.progress().attention,0);
  assert.equal((await mail.query('CACHED_PRIVATE_TEXT')).total,0);assert.equal((await mail.query('ATTACHMENT_PRIVATE_TEXT')).total,0);assert.equal((await mail.query('Budget')).total,1);assert.equal((await mail.query('예산 요청')).total,1);
  const downloaded=await mail.download({id:row.id,attachmentId:attachment.id,kind:'attachment',expectedSourceHash:row.sourceHash});
  assert.deepEqual(Buffer.from(downloaded.bytes,'base64'),bytes);
  await assert.rejects(mail.evidence({id:row.id,sourceHash:row.sourceHash,attachmentId:attachment.id}),/mail_attachment_beta_disabled/);
  class Host {} installDesktopFeatures(Host);
  await assert.rejects(new Host().mailDocument({id:row.id,attachmentId:attachment.id}),/mail_attachment_beta_disabled/);
  await assert.rejects(PersonalMail.prototype.extractAttachment.call(mail,bytes,attachment,new AbortController().signal),/mail_attachment_beta_disabled/);
  await assert.rejects(mail.rememberAttachmentDocument(source,attachment.id,{text:'blocked'}),/mail_attachment_beta_disabled/);
  // Preserve prior Wiki files, but do not reuse notes whose attachment scope is unknown.
  row=mail.rows()[0];const oldText='LEGACY_ATTACHMENT_FACT';await writeFile(row.path,oldText);mail.store.set('mail:'+row.id,{...row,contentScope:null,wikiHash:sha(oldText)});
  const legacy=await mail.read(row.id,{includeKnowledge:true});assert.equal(legacy.knowledge.state,'unavailable');assert.equal(legacy.knowledge.reason,'legacy_attachment_scope');assert.equal((await mail.query('LEGACY_ATTACHMENT_FACT')).total,0);assert.equal(await readFile(row.path,'utf8'),oldText);
});
