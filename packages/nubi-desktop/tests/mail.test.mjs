import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:tls';
import {Worker} from 'node:worker_threads';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pullPop3} from '../../openwiki/src/connectors/sources/pop3.mjs';
import {PersonalMail as BasePersonalMail} from '../runtime/mail.mjs';
// A new install starts with automatic summaries off (user decision 2026-10-04); these scenarios were written for a
// mailbox whose owner turned them on, so a fresh store here starts on. Scenarios that turn it off do so themselves.
class PersonalMail extends BasePersonalMail{constructor(host,options){super(host,options);if(this.store.get('setting:auto-wiki')===null){this.store.set('setting:auto-wiki',true);this.autoWiki=true;}}}
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-pop3-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(root,'key.pem'),'-out',path.join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-days','1'],{stdio:'ignore'});
 const cert=await readFile(path.join(root,'cert.pem')),commands=[],mailbox=[],sockets=new Set();let authFail=false,uidlFail=false;
 const server=createServer({key:await readFile(path.join(root,'key.pem')),cert},socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.write('+OK fixture\r\n');let buffer='';
  async function multi(content){socket.write(Buffer.concat([Buffer.from('+OK\r\n'),Buffer.from(content),Buffer.from('\r\n')]));socket.write('.');await new Promise(r=>setTimeout(r,4));socket.write('\r');await new Promise(r=>setTimeout(r,4));socket.write('\n');}
  socket.on('data',chunk=>{buffer+=chunk.toString();while(buffer.includes('\r\n')){const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);const [cmd,arg]=line.split(' ');commands.push(cmd);
   if(cmd==='USER')socket.write('+OK\r\n');
   else if(cmd==='PASS')socket.write(authFail?'-ERR secret-from-server\r\n':'+OK\r\n');
   else if(cmd==='CAPA')void multi('UIDL\r\nLOGIN-DELAY 65');
   else if(cmd==='UIDL')uidlFail?socket.write('-ERR unsupported\r\n'):void multi(mailbox.map((m,i)=>`${i+1} ${m.uidl}`).join('\r\n'));
   else if(cmd==='RETR')void multi(mailbox[Number(arg)-1].raw);
   else if(cmd==='QUIT')socket.end('+OK bye\r\n');else socket.write('-ERR bad command\r\n');
  }});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
 return {root,commands,mailbox,endpoint:{host:'127.0.0.1',port:server.address().port,servername:'localhost',tlsOptions:{ca:cert}},auth:value=>authFail=value,uidl:value=>uidlFail=value};
}
// The company profile: automatic Wiki summaries stay on by default, and the password is taken as typed. The Gmail test
// profile (the default of a new install, 2026-10-04) starts with summaries off and takes an address and a 16-character
// app password; its rules are covered by mail-credentials.
const credentials={user:'fixture-login-private',password:'fixture-password-private',serverProfile:'company'};
const simple=subject=>Buffer.from(`Subject: ${subject}\r\nFrom: sender@example.test\r\nDate: Tue, 01 Jan 2019 00:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n계약 검토 요청\r\n..dot-stuffed`);
const multipart=Buffer.from('Subject: project-contract\r\nFrom: sender@example.test\r\nContent-Type: multipart/mixed; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/plain; charset=EUC-KR\r\nContent-Transfer-Encoding: base64\r\n\r\nvsiz5w==\r\n--fixture\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Disposition: attachment; filename="../../fixture.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('계약 검토가 필요합니다.').toString('base64')+'\r\n--fixture--');
const destination={provider:'aipro',model:'fixture'};
// A destination must be in the provider catalogs (mail settings of 2026-10-04); the hosts below offer these models.
const CATALOGS=[{provider:'aipro',models:[{id:'fixture'}]},{provider:'chatgpt',models:[{id:'new'},{id:'different'}]}];
const answer={summary:'계약 검토 요청을 받았습니다.',category:'direct_request',priority:'high',facts:['발신자가 검토를 요청했다.'],actionItems:['계약 검토']};
// Settled: no poll, attachment read, synthesis or reconciliation in flight for 50ms, so chained rows (drain after drain, attachments before synthesis) are covered.
async function settled(mail){let idle=0;for(let i=0;i<600;i++){if(mail.synthesis||mail.attachmentRead||mail.checking||mail.reconciling)idle=0;else if(++idle>=5)return;await new Promise(r=>setTimeout(r,10));}throw new Error('summary_not_settled');}
test('TLS, split terminator, Korean MIME, attachment bytes, stable UIDL and no DELE',async t=>{
 const f=await fixture(t);f.mailbox.push({uidl:'old',raw:simple('old')});
 let result=await pullPop3({...credentials,endpoint:f.endpoint});assert.deepEqual(result.uidls,['old']);assert.equal(result.mails.length,0);assert.equal(result.delaySeconds,65);
 f.mailbox.unshift({uidl:'new',raw:multipart});result=await pullPop3({...credentials,endpoint:f.endpoint,known:['old']});assert.equal(result.mails.length,1);assert.match(result.mails[0].normalized.text,/안녕/);assert.match(result.mails[0].attachments[0].text,/계약/);
 result=await pullPop3({...credentials,endpoint:f.endpoint,known:['old','new']});assert.equal(result.mails.length,0);assert(!f.commands.includes('DELE'));
 await assert.rejects(pullPop3({...credentials,endpoint:{...f.endpoint,tlsOptions:{}}}),/mail_tls_error/);
 f.auth(true);await assert.rejects(pullPop3({...credentials,endpoint:f.endpoint}),/mail_auth_failed/);f.auth(false);
 f.uidl(true);await assert.rejects(pullPop3({...credentials,endpoint:f.endpoint}),/mail_connection_failed/);
 await assert.rejects(pullPop3({...credentials,user:'bad\r\nDELE 1',endpoint:f.endpoint}),/mail_input_invalid/);
});
test('durable personal intake, attachments, no secret persistence, restart and user edits',async t=>{
 const f=await fixture(t);f.mailbox.push({uidl:'old',raw:simple('old')});let calls=0;
 const host={storageRoot:path.join(f.root,'state'),providers:{catalogs:()=>CATALOGS,status:()=>({connected:true,...destination}),complete:async()=>{calls++;return {content:JSON.stringify(answer)};}}};
 const options={personalRoot:path.join(f.root,'personal'),pull:input=>pullPop3({...input,endpoint:f.endpoint})};let mail=new PersonalMail(host,options);t.after(()=>mail.dispose());
 // With summaries on, the baseline mail is received and organized as well (user decision 2026-10-04: ON fetches what the server still holds), so two mails are organized once each.
 let status=await mail.call({action:'connect',requestId:'baseline',...credentials,destination});assert.equal(status.baselineCount,1);assert.equal(status.counts.received,1);assert.equal(calls,0);await assert.rejects(mail.call({action:'check'}),/mail_check_wait/);
 f.mailbox.push({uidl:'new',raw:multipart});await mail.cycle();await settled(mail);status=mail.status();assert.equal(status.counts.saved,2);assert.equal(calls,2);
 const id=status.messages.find(message=>message.subject==='project-contract').id,source=await mail.read(id);assert.match(await readFile(path.join(source.attachmentDirectory,source.mail.attachments[0].id+'.bin'),'utf8'),/계약/);assert.ok((await mail.query('계약 검토')).results.some(result=>result.id===id),'the mail with the attachment is found');
 await mail.cycle();await settled(mail);assert.equal(calls,2);
 const saved=status.messages.find(message=>message.id===id).wikiPath;await writeFile(saved,'# 사용자 편집\n계약 직접 확인');assert((await mail.query('계약')).results.find(result=>result.id===id)?.matches.some(match=>match.sourceState==='edited'),'the user-edited Wiki is reported as edited');/* search v2 flags the edited Wiki per match instead of a changed list */await mail.cycle();assert.match(await readFile(saved,'utf8'),/사용자 편집/);
 async function scan(dir){let text='';for(const item of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);text+=item.isDirectory()?await scan(file):(await readFile(file)).toString('latin1');}return text;}
 const disk=await scan(f.root);assert(!disk.includes(credentials.password));assert(!disk.includes(credentials.user));
 mail.dispose();mail=new PersonalMail(host,options);assert.equal(mail.status().connected,false);assert.equal(mail.status().counts.saved,2);mail.nextCheckAt=null;await mail.call({action:'connect',requestId:'restart',...credentials,destination});await settled(mail);assert.equal(calls,2);
 await writeFile(path.join(source.attachmentDirectory,'message.eml'),'tampered');await assert.rejects(mail.read(id),/mail_source_changed/);
});
test('unconnected model leaves the queue intact; a model connected later is used automatically',async t=>{
 // User decision 2026-10-07: automatic organization adopts the model that connects later; no explicit selection is needed.
 const f=await fixture(t);let active={connected:false},calls=0;
 const host={storageRoot:path.join(f.root,'state'),providers:{catalogs:()=>CATALOGS,status:()=>active,complete:async()=>{calls++;return {content:JSON.stringify(answer)};}}};
 const mail=new PersonalMail(host,{personalRoot:path.join(f.root,'personal'),pull:input=>pullPop3({...input,endpoint:f.endpoint})});t.after(()=>mail.dispose());
 await mail.call({action:'connect',requestId:'empty',...credentials});f.mailbox.push({uidl:'later',raw:simple('later')});await mail.cycle();await settled(mail);assert.equal(mail.status().counts.queued,1);assert.equal(calls,0);assert.equal(mail.status().destination,null);
 active={connected:true,provider:'chatgpt',model:'new'};mail.status();await settled(mail);
 assert.equal(calls,1);assert.equal(mail.status().counts.saved,1);assert.deepEqual(mail.status().destination,{provider:'chatgpt',model:'new'});
 // An explicit choice of another available model still wins.
 await mail.call({action:'resume',destination});assert.deepEqual(mail.status().destination,destination);
});
test('cancelled connection cannot activate or persist a late result',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-cancel-'));let release;
 const mail=new PersonalMail({storageRoot:root},{personalRoot:path.join(root,'personal'),pull:()=>new Promise(r=>release=r)});t.after(async()=>{mail.dispose();await rm(root,{recursive:true,force:true});});
 const pending=mail.call({action:'connect',requestId:'slow',...credentials});await mail.call({action:'cancelConnect',requestId:'slow'});release({uidls:[],mails:[],delaySeconds:60});await assert.rejects(pending,/mail_cancelled/);assert.equal(mail.status().connected,false);assert.equal(mail.rows().length,0);
});
test('oversize retrieval is quarantined without starving later mail; invalid UIDLs fail',async t=>{
 const f=await fixture(t);f.mailbox.push({uidl:'huge',raw:Buffer.alloc(10*1024*1024+100,65)},{uidl:'small',raw:simple('small')});
 const result=await pullPop3({...credentials,endpoint:f.endpoint,known:[]});assert.equal(result.failed[0].error,'mail_size_limit');assert.equal(result.failed[0].uidl,'huge');
 const next=await pullPop3({...credentials,endpoint:f.endpoint,known:[],skip:['huge']});assert.equal(next.mails[0].uidl,'small');
 f.mailbox.splice(0,2,{uidl:'duplicate',raw:simple('one')},{uidl:'duplicate',raw:simple('two')});await assert.rejects(pullPop3({...credentials,endpoint:f.endpoint}),/mail_uidl_invalid/);
});
test('prepared Wiki is reconciled without another model call after interrupted final receipt',async t=>{
 const f=await fixture(t);let calls=0;
 const host={storageRoot:path.join(f.root,'state'),providers:{catalogs:()=>CATALOGS,status:()=>({connected:true,...destination}),complete:async()=>{calls++;return {content:JSON.stringify(answer)};}}};
 const options={personalRoot:path.join(f.root,'personal'),pull:input=>pullPop3({...input,endpoint:f.endpoint})};let mail=new PersonalMail(host,options);t.after(()=>mail.dispose());
 await mail.call({action:'connect',requestId:'base',...credentials,destination});f.mailbox.push({uidl:'mail',raw:simple('contract')});
 const original=mail.store.set.bind(mail.store);let fail=true;mail.store.set=(key,row)=>{if(fail&&key.startsWith('mail:')&&row.state==='saved'){fail=false;throw Error('receipt_lost');}return original(key,row);};
 await mail.cycle();await settled(mail);assert.equal(calls,1);assert.equal(mail.status().counts.attention,1);const prepared=mail.rows()[0].prepared;assert(prepared);assert.equal(await readFile(prepared.path,'utf8'),prepared.text);
 mail.dispose();mail=new PersonalMail(host,options);await mail.call({action:'resume',destination});await mail.call({action:'retry'});await settled(mail);assert.equal(calls,1);assert.equal(mail.status().counts.saved,1);
});
test('an automatic inference retry pins the mail model and reports a model failure, not a storage one',async t=>{
 const f=await fixture(t);let active={connected:true,...destination};const models=[];
 const host={storageRoot:path.join(f.root,'state'),recoveryOptions:{model:{minTimeout:1,maxTimeout:1}},providers:{catalogs:()=>CATALOGS,status:()=>active,complete:async(...args)=>{models.push(args.find(arg=>arg&&typeof arg==='object'&&'backgroundModel' in arg)?.backgroundModel);active={connected:true,provider:'chatgpt',model:'different'};throw Error('network_error');}}};
 const mail=new PersonalMail(host,{personalRoot:path.join(f.root,'personal'),pull:input=>pullPop3({...input,endpoint:f.endpoint})});t.after(()=>mail.dispose());await mail.call({action:'connect',requestId:'base',...credentials,destination});f.mailbox.push({uidl:'one',raw:simple('one')});await mail.cycle();await settled(mail);
 // The host's active model changed after the first call; the bounded retries still run with the mail's own model.
 assert.deepEqual(models,[destination,destination,destination]);assert.equal(mail.rows()[0].state,'attention');assert.equal(mail.rows()[0].error,'mail_summary_failed');assert.equal(mail.status().counts.saved,0);
});

test('a model failure is retried on the next polls, three times in all, and a manual retry starts the count again',async t=>{
 const f=await fixture(t);let failing=true,calls=0;
 const host={storageRoot:path.join(f.root,'state'),recoveryOptions:{model:{minTimeout:1,maxTimeout:1,retries:0}},providers:{catalogs:()=>CATALOGS,status:()=>({connected:true,...destination}),complete:async()=>{calls++;if(failing)throw Error('network_error');return {content:JSON.stringify(answer)};}}};
 const mail=new PersonalMail(host,{personalRoot:path.join(f.root,'personal'),pull:input=>pullPop3({...input,endpoint:f.endpoint})});t.after(()=>mail.dispose());
 await mail.call({action:'connect',requestId:'base',...credentials,destination});f.mailbox.push({uidl:'one',raw:simple('one')});
 await mail.cycle();await settled(mail);assert.equal(mail.rows()[0].error,'mail_summary_failed');assert.equal(mail.rows()[0].summaryAttempts,1);const first=calls;
 await mail.cycle();await settled(mail);assert.equal(mail.rows()[0].summaryAttempts,2);
 await mail.cycle();await settled(mail);assert.equal(mail.rows()[0].summaryAttempts,3);
 await mail.cycle();await settled(mail);assert.equal(mail.rows()[0].summaryAttempts,3,'the fourth poll leaves the mail for a manual retry');assert.equal(mail.rows()[0].state,'attention');
 failing=false;await mail.cycle();await settled(mail);assert.equal(mail.status().counts.saved,0,'no automatic retry after the bound');
 await mail.call({action:'retry'});await settled(mail);assert.equal(mail.status().counts.saved,1);assert.ok(calls>first);
});
test('bundled host worker performs TLS retrieval with sanitized failures and no stdout/stderr',async t=>{
 const f=await fixture(t);f.auth(true);
 const worker=new Worker(new URL('../extension/lib/node/mail-worker.mjs',import.meta.url),{workerData:{...credentials,endpoint:f.endpoint},stdout:true,stderr:true});let output='';worker.stdout.on('data',chunk=>output+=chunk);worker.stderr.on('data',chunk=>output+=chunk);
 t.after(()=>worker.terminate());const message=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});assert.deepEqual(message,{error:'mail_auth_failed'});assert.equal(output,'');
});

// User decision 2026-10-04: OFF stops collection as well as summaries; ON or a reconnect fetches what the server still holds.
test('Wiki OFF survives restart and reconnect, collects nothing, and ON fetches and drains once',async t=>{
 const f=await fixture(t);let calls=0;
 const host={storageRoot:path.join(f.root,'state'),providers:{catalogs:()=>CATALOGS,status:()=>({connected:true,...destination}),complete:async()=>{calls++;return {content:JSON.stringify(answer)};}}};
 const options={personalRoot:path.join(f.root,'personal'),pull:input=>pullPop3({...input,endpoint:f.endpoint})};let mail=new PersonalMail(host,options);t.after(()=>mail.dispose());
 await mail.call({action:'setAutoWiki',enabled:false});await mail.call({action:'connect',requestId:'baseline',...credentials,destination});f.mailbox.push({uidl:'one',raw:multipart});await mail.cycle();await settled(mail);assert.equal(calls,0);assert.equal(mail.status().counts.queued,0,'off collects nothing');assert.equal(mail.rows().length,0);
 await mail.call({action:'retry'});await settled(mail);assert.equal(calls,0);assert.equal(mail.status().autoWiki,false);
 await mail.call({action:'pauseWatch'});mail.dispose();mail=new PersonalMail(host,options);assert.equal(mail.status().autoWiki,false);assert.equal(mail.status().watchPaused,true);mail.nextCheckAt=null;await mail.call({action:'connect',requestId:'restart',...credentials,destination});await settled(mail);assert.equal(calls,0);assert.equal(mail.status().watchPaused,true);
 await assert.rejects(mail.call({action:'setAutoWiki',enabled:'yes'}),/mail_input_invalid/);await assert.rejects(mail.call({action:'setAutoWiki',enabled:true,destination:{provider:'chatgpt',model:'wrong'}}),/mail_model_missing/);assert.equal(mail.status().autoWiki,false);
 await mail.call({action:'setAutoWiki',enabled:true,destination});await mail.cycle();/* ON resumes collection at the server-advised time; the scenario polls now */await settled(mail);assert.equal(calls,1);assert.equal(mail.status().counts.saved,1);await mail.call({action:'setAutoWiki',enabled:false});await mail.call({action:'setAutoWiki',enabled:true,destination});await settled(mail);assert.equal(calls,1);
});

test('Wiki OFF during synthesis keeps the original and queue without saving a late answer',async t=>{
 const f=await fixture(t);let release,calls=0;
 const host={storageRoot:path.join(f.root,'state'),providers:{catalogs:()=>CATALOGS,status:()=>({connected:true,...destination}),complete:async()=>{calls++;return new Promise(r=>release=r);}}};
 const mail=new PersonalMail(host,{personalRoot:path.join(f.root,'personal'),pull:input=>pullPop3({...input,endpoint:f.endpoint})});t.after(()=>mail.dispose());await mail.call({action:'connect',requestId:'base',...credentials,destination});f.mailbox.push({uidl:'one',raw:simple('one')});await mail.cycle();for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert(release);
 await mail.call({action:'setAutoWiki',enabled:false});release({content:JSON.stringify(answer)});await settled(mail);assert.equal(calls,1);assert.equal(mail.status().counts.saved,0);assert.equal(mail.status().counts.queued,1);assert.equal(mail.status().counts.attention,0);assert.match((await mail.read(mail.rows()[0].id)).mail.text,/계약/);
});
