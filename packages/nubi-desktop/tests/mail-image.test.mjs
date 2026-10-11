import {featureTest} from './beta-feature.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {installDesktopFeatures} from '../runtime/desktop-features.mjs';
import {mailImagePreview} from '../runtime/mail-image.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64');
test('local raster previews exclude SVG/HTML and preserve exact bytes',()=>{
 assert.equal(mailImagePreview(png),'data:image/png;base64,'+png.toString('base64'));
 assert.equal(mailImagePreview(Buffer.from('<svg onload="alert(1)"/>')),null);
 assert.equal(mailImagePreview(Buffer.from('<html>not a jpeg</html>')),null);
 assert.throws(()=>mailImagePreview(Buffer.alloc(10*1024*1024+1)),/document_limit/);
});
featureTest('mailAttachmentReading')('image preview preserves unread evidence and rejects stale source, altered bytes and text-only AI requests',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'mail-image-'));
 try{
 const sha256=createHash('sha256').update(png).digest('hex');
 await writeFile(path.join(directory,'image.bin'),png);
 const source={sourceHash:'mail-hash',attachmentDirectory:directory,mail:{attachments:[{id:'image',filename:'image.png',sha256,contentState:'document_attention'}]}};
 class Host{} installDesktopFeatures(Host);const host=new Host();host.personalMail={generation:1,read:async()=>source,extractAttachment:()=>{throw Error('must_not_extract');},rememberAttachmentDocument:()=>{throw Error('must_not_mark_read');}};
 const args={id:'mail',attachmentId:'image',expectedSourceHash:'mail-hash',expectedAttachmentHash:sha256};
 const result=await host.mailDocument(args);assert.equal(result.text,'');assert.ok(result.image.startsWith('data:image/png;'));assert.equal(source.mail.attachments[0].contentState,'document_attention');
 await assert.rejects(host.mailDocument({...args,expectedSourceHash:'stale'}),/mail_source_changed/);
 await assert.rejects(host.mailDocument({...args,action:'ask',question:'read image'}),/document_image_unread/);
 let reads=0;host.personalMail.read=async()=>++reads===1?source:{...source,sourceHash:'changed'};
 await assert.rejects(host.mailDocument(args),/mail_source_changed/);
 host.personalMail.read=async()=>source;await writeFile(path.join(directory,'image.bin'),'changed');
 await assert.rejects(host.mailDocument(args),/mail_source_changed/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
