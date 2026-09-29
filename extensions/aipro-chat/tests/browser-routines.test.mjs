import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBrowserPolicy,assertBrowserPolicy,refreshBrowserPolicy} from '../browser-policy.js';
import {validateJob,scheduleDecision,nextOccurrence,changeRoutine,fireRoutine,finishRoutine,restoreRoutines,notifyRoutineResult,beginRecording,recordStep,stopRecording,saveWorkflow,restoreRecording,expireRecording} from '../browser-routines.js';
import {downloadStatus,startDownload,uploadMetadata} from '../browser-transfers.js';
const owner={conversationId:'chat',provider:'aipro',modelId:'qwen',credentialReceivedAt:42,skillId:''};
before(async () => {
 const previous=globalThis.chrome;
 globalThis.chrome={storage:{managed:{get:async()=>({})}}};
 try {await refreshBrowserPolicy();} finally {globalThis.chrome=previous;}
});
const job=(now=Date.now())=>validateJob({name:'Check',prompt:'Read visible result',url:'https://example.org/tasks',when:now+60000,repeat:'daily'},owner,now);
function mock(t){
 const prior=globalThis.chrome,data={},session={},alarms=new Map(),notifications=[];
 const area=data=>({get:async key=>key===null?structuredClone(data):Object.fromEntries((Array.isArray(key)?key:[key]).map(k=>[k,structuredClone(data[k])])),set:async value=>Object.assign(data,structuredClone(value)),remove:async key=>{delete data[key];}});
 globalThis.chrome={tabs:{get:async id=>({id,url:'https://example.org'})},scripting:{executeScript:async()=>[]},storage:{managed:area({}),local:area(data),session:area(session)},runtime:{id:'nubi',getURL:s=>'chrome-extension://nubi/'+s},permissions:{contains:async()=>true},alarms:{create:async(id,value)=>alarms.set(id,value),clear:async id=>alarms.delete(id)},notifications:{create:async(id,value)=>notifications.push({id,value})},downloads:{download:async()=>7,search:async()=>[{id:7,state:'complete',finalUrl:'https://example.org/file',bytesReceived:3,totalBytes:3,exists:true,danger:'safe'}]}};
 t.after(()=>{globalThis.chrome=prior;});return {data,session,alarms,notifications};
}
test('managed limits intersect, block wins, malformed configuration fails closed',()=>{
 const p=normalizeBrowserPolicy({AllowedOrigins:['https://example.org'],BlockedOrigins:['https://example.org'],UploadsEnabled:false});
 assert.throws(()=>assertBrowserPolicy('https://example.org/path','AutomationEnabled',p),/policy_blocked/);
 assert.throws(()=>assertBrowserPolicy('https://other.org','AutomationEnabled',p),/policy_blocked/);
 assert.throws(()=>assertBrowserPolicy(null,'UploadsEnabled',p),/policy_blocked/);
 assert.throws(()=>normalizeBrowserPolicy({AutomationEnabled:'yes'}));assert.throws(()=>normalizeBrowserPolicy({AllowedOrigins:['https://example.org/path']}));
 assert.doesNotThrow(()=>assertBrowserPolicy('https://example.org/path','AutomationEnabled',{}));
});
test('schedule validates future time, preserves user URL and requires exact owner, model and skill',()=>{
 const now=Date.now(),j=job(now);assert.equal(scheduleDecision(j,owner,now),'early');assert.equal(scheduleDecision(j,owner,j.when),'run');
 for(const field of Object.keys(owner))assert.equal(scheduleDecision(j,{...owner,[field]:'changed'},j.when),'context_changed');
 assert.equal(scheduleDecision(j,{...owner,busy:true},j.when),'waiting');assert.equal(scheduleDecision(j,{...owner,pendingQuestion:true},j.when),'waiting');
 assert.equal(scheduleDecision(j,owner,j.when+300001),'missed');assert.equal(nextOccurrence(j,j.when+86400000*3),j.when+86400000*4);
 assert.throws(()=>validateJob({...j,when:now},owner,now));assert.throws(()=>validateJob({...j,url:'file:///tmp/a'},owner,now));
 assert.equal(validateJob({...j,url:'https://example.org/tasks?token=private#secret'},owner,now).url,'https://example.org/tasks?token=private#secret');
});
test('monthly and yearly alarms preserve the original calendar day after short months and leap years',()=>{
 const january=new Date(2024,0,31,9,30).getTime();
 const monthly={when:january,anchorWhen:january,repeat:'monthly'};
 const february=nextOccurrence(monthly,january);
 assert.equal(february,new Date(2024,1,29,9,30).getTime());
 monthly.when=february;
 assert.equal(nextOccurrence(monthly,february),new Date(2024,2,31,9,30).getTime());
 const leap=new Date(2024,1,29,9,30).getTime();
 const yearly={when:leap,anchorWhen:leap,repeat:'yearly'};
 const next=nextOccurrence(yearly,leap);
 assert.equal(next,new Date(2025,1,28,9,30).getTime());
 yearly.when=next;
 assert.equal(nextOccurrence(yearly,new Date(2028,1,28,10).getTime()),new Date(2028,1,29,9,30).getTime());
 assert.equal(validateJob({name:'Calendar',prompt:'Read',url:'https://example.org',when:Date.now()+60000,repeat:'monthly'},owner).repeat,'monthly');
});
test('a persisted launch intent is never dispatched twice and restart makes it unknown',async t=>{
 const {data}=mock(t),j=job(Date.now()-60000);data.browserRoutines={jobs:[j]};let calls=0;
 await fireRoutine('nubi-routine:'+j.id,owner,async()=>{calls++;assert.equal(data.browserRoutines.jobs[0].status,'launching');throw Error('lost reply');});
 await fireRoutine('nubi-routine:'+j.id,owner,async()=>{calls++;});assert.equal(calls,1);assert.equal(data.browserRoutines.jobs[0].status,'unknown');
 data.browserRoutines.jobs[0].status='running';await restoreRoutines();assert.equal(data.browserRoutines.jobs[0].status,'unknown');
});
test('worker wakeup restores a recent due alarm, but new browser sessions and stale jobs do not catch up',async t=>{
 const {data,session,alarms}=mock(t),j=job(Date.now()-61000);
 data.browserRoutines={jobs:[j]};session.browserRoutineSession=true;
 await restoreRoutines();assert.equal(data.browserRoutines.jobs[0].status,'scheduled');assert(alarms.has('nubi-routine:'+j.id));
 delete session.browserRoutineSession;alarms.clear();await restoreRoutines();
 assert.equal(data.browserRoutines.jobs[0].status,'missed');assert.equal(alarms.size,0);
 data.browserRoutines.jobs[0]={...j,when:Date.now()-300001,status:'scheduled'};
 await restoreRoutines();assert.equal(data.browserRoutines.jobs[0].status,'missed');assert.equal(alarms.size,0);
});
test('successful recurrence schedules next once; HITL and failure pause future execution',async t=>{
 const {data,alarms}=mock(t),j=job(Date.now()-60000);data.browserRoutines={jobs:[j]};
 await fireRoutine('nubi-routine:'+j.id,owner,async()=>({requestId:'r1'}));await finishRoutine('r1',{awaitingUser:true});assert.equal(data.browserRoutines.jobs[0].status,'awaiting_user');assert.equal(alarms.size,0);
 Object.assign(data.browserRoutines.jobs[0],{status:'running',requestId:'r2'});await finishRoutine('r2',{});assert.equal(data.browserRoutines.jobs[0].status,'scheduled');assert.equal(alarms.size,1);
});
test('a blocked reservation stays stopped until its owner explicitly sets a new time',async t=>{
 const {data,alarms}=mock(t),j=job(Date.now()-60000);data.browserRoutines={jobs:[j]};let calls=0;
 await fireRoutine('nubi-routine:'+j.id,{...owner,busy:true},async()=>{calls++;});
 assert.equal(calls,0);assert.equal(data.browserRoutines.jobs[0].status,'waiting');assert.equal(alarms.size,0);
 await assert.rejects(()=>changeRoutine(j.id,'reschedule',{...j,when:Date.now()+60000},{...owner,credentialReceivedAt:null}),/no_credential/);
 const when=Date.now()+60000;
 await changeRoutine(j.id,'reschedule',{...j,when},owner);
 assert.equal(data.browserRoutines.jobs.length,1);assert.equal(data.browserRoutines.jobs[0].status,'scheduled');assert.equal(data.browserRoutines.jobs[0].when,when);
 assert.equal(alarms.get('nubi-routine:'+j.id).when,when);
 await assert.rejects(()=>changeRoutine(j.id,'reschedule',{...j,when:when+60000},owner),/tool_arguments_invalid/);
 data.browserRoutines.jobs[0].status='unknown';
 await assert.rejects(()=>changeRoutine(j.id,'reschedule',{...j,when:when+60000},owner),/tool_arguments_invalid/);
 const changed=job(Date.now()-60000);data.browserRoutines.jobs.push(changed);
 await fireRoutine('nubi-routine:'+changed.id,{...owner,modelId:'another-model'},async()=>{calls++;});
 assert.equal(data.browserRoutines.jobs[1].status,'context_changed');assert.equal(calls,0);
 await changeRoutine(changed.id,'reschedule',{...changed,when:when+60000},{...owner,modelId:'another-model'});
 assert.equal(data.browserRoutines.jobs[1].modelId,'another-model');assert.equal(data.browserRoutines.jobs[1].status,'scheduled');
});
test('reservation result distinguishes an answer from independently verified completion',async t=>{
 const {data}=mock(t),j=job(Date.now()-60000);j.repeat='once';data.browserRoutines={jobs:[j]};
 await fireRoutine('nubi-routine:'+j.id,owner,async()=>({requestId:'plain'}));
 await finishRoutine('plain',{});assert.equal(data.browserRoutines.jobs[0].status,'done');assert.equal(data.browserRoutines.jobs[0].verified,false);
 Object.assign(data.browserRoutines.jobs[0],{status:'running',requestId:'verified'});
 await finishRoutine('verified',{verified:true});assert.equal(data.browserRoutines.jobs[0].verified,true);
});
test('notifications are opt-in, deduplicated, generic and failures cannot break work',async t=>{
 const {data,notifications}=mock(t);await notifyRoutineResult({...owner,id:'r'},{});assert.equal(notifications.length,0);
 data.browserRoutines={notifications:true};await notifyRoutineResult({...owner,id:'r'},{awaitingUser:true});await notifyRoutineResult({...owner,id:'r'},{});
 assert.equal(notifications.length,1);assert.equal(notifications[0].value.message,'작업에 확인이 필요합니다.');
 chrome.notifications.create=async()=>{throw Error('OS unavailable');};await notifyRoutineResult({...owner,id:'r2'},{});
});
test('notification receipts retain only the newest 100 after success and failure',async t=>{
 const {data,notifications}=mock(t);data.browserRoutines={notifications:true};
 data.browserNotificationReceipts=Object.fromEntries(Array.from({length:100},(_,i)=>['nubi-result:old-'+i,{status:'api_accepted'}]));
 await notifyRoutineResult({...owner,id:'new'},{});
 assert.equal(Object.keys(data.browserNotificationReceipts).length,100);
 assert(!data.browserNotificationReceipts['nubi-result:old-0']);
 assert.equal(data.browserNotificationReceipts['nubi-result:new'].status,'api_accepted');
 await notifyRoutineResult({...owner,id:'new'},{});assert.equal(notifications.length,1);
 chrome.notifications.create=async()=>{throw Error('OS unavailable');};
 await notifyRoutineResult({...owner,id:'failed'},{});
 assert.equal(Object.keys(data.browserNotificationReceipts).length,100);
 assert(!data.browserNotificationReceipts['nubi-result:old-1']);
 assert.equal(data.browserNotificationReceipts['nubi-result:failed'].status,'requested');
});
test('recorder requires isolated nonce, tab, top frame and origin; accepts no values',async t=>{
 const {session}=mock(t);session.browserRecording={nonce:'n',tabId:3,origin:'https://example.org',expiresAt:Date.now()+10000,steps:[]};
 const message={nonce:'n',step:{kind:'input',label:'Title',tag:'input',value:'PRIVATE'}};
 const sender={id:'nubi',tab:{id:3},frameId:0,url:'https://example.org/tasks?token=PRIVATE'};
 await recordStep({...message,nonce:'bad'},sender);await recordStep(message,{...sender,frameId:1});await recordStep(message,{...sender,tab:{id:4}});assert.equal(session.browserRecording.steps.length,0);
 await recordStep(message,sender);assert.equal(session.browserRecording.steps.length,1);assert(!JSON.stringify(session.browserRecording.steps).includes('PRIVATE'));
});
test('download receipts are persisted before issuance, scoped and never imply content verification',async t=>{
 const {data}=mock(t);chrome.downloads.download=async()=>{assert.equal(data.browserTransfers[0].status,'unknown');return 7;};
 const result=await startDownload({...owner,id:'r'},'https://example.org/file');
 await assert.rejects(()=>downloadStatus({...owner,conversationId:'wrong'},result.transfer_id),/download_missing/);
 const status=await downloadStatus(owner,result.transfer_id);assert.equal(status.state,'complete');assert.equal(status.verified,false);
 chrome.downloads.search=async()=>[{state:'interrupted',url:'https://example.org/file',error:'NETWORK_FAILED'}];assert.equal((await downloadStatus(owner,result.transfer_id)).state,'interrupted');
});
test('upload metadata excludes assistant attachments and original bytes',()=>{
 assert.deepEqual(uploadMetadata({messages:[{role:'assistant',attachments:[{id:'x'}]},{role:'user',attachments:[{id:'y',name:'file',hash:'hash',blob:'PRIVATE'}]}]}),[{id:'y',name:'file',bytes:undefined,mimeType:undefined,hash:'hash'}]);
});

test('failed draft storage preserves stopped recording for a retry without collecting new steps',async t=>{
 const {data,session}=mock(t);chrome.scripting={executeScript:async()=>[]};
 session.browserRecording={nonce:'draft-nonce',tabId:3,origin:'https://example.org',expiresAt:Date.now()+10000,steps:[{kind:'navigate',url:'https://example.org'}]};
 const write=chrome.storage.local.set;chrome.storage.local.set=async()=>{throw Error('quota');};
 await assert.rejects(()=>stopRecording(),/quota/);
 assert(session.browserRecording,'Draft must remain recoverable after storage failure');
 await recordStep({nonce:'draft-nonce',step:{kind:'click',label:'Late',tag:'button'}},{id:'nubi',tab:{id:3},frameId:0,url:'https://example.org'});
 assert.equal(session.browserRecording.steps.length,1);
 chrome.storage.local.set=write;await stopRecording();assert.equal(session.browserRecording,undefined);assert.equal(data.browserRecordingDraft.steps.length,1);
});
test('a saved draft survives accidental restart and requires its exact id for replacement',async t=>{
 const {data,session}=mock(t),tab={id:3,url:'https://example.org/tasks'};
 data.browserRecordingDraft={id:'older',steps:[{kind:'navigate',url:tab.url}]};
 await assert.rejects(()=>beginRecording(tab),/recording_draft_pending/);
 await assert.rejects(()=>beginRecording(tab,{replaceDraftId:'stale'}),/recording_draft_changed/);
 assert.equal(session.browserRecording,undefined);
 await beginRecording(tab,{replaceDraftId:'older'});
 assert.equal(data.browserRecordingDraft.id,'older','Original remains available while recording');
 const draft=await stopRecording();assert.equal(data.browserRecordingDraft.id,draft.id);assert.notEqual(draft.id,'older');
 await assert.rejects(()=>beginRecording(tab,{replaceDraftId:'older'}),/recording_draft_changed/);
});
test('concurrent draft change does not let a later recording overwrite the current draft',async t=>{
 const {data,session}=mock(t),tab={id:3,url:'https://example.org/tasks'};
 data.browserRecordingDraft={id:'original',steps:[]};await beginRecording(tab,{replaceDraftId:'original'});
 data.browserRecordingDraft={id:'newer',steps:[]};
 await assert.rejects(()=>stopRecording(),/recording_draft_changed/);
 assert.equal(data.browserRecordingDraft.id,'newer');assert.equal(session.browserRecording.stopped,true);
});
test('workflow save tolerates a lost committed reply without duplicating the workflow',async t=>{
 const {data}=mock(t);data.browserRecordingDraft={id:'reviewed-draft',steps:[{kind:'navigate',url:'https://example.org'}]};
 const write=chrome.storage.local.set;let loseReply=true;
 chrome.storage.local.set=async value=>{await write(value);if(loseReply){loseReply=false;throw Error('reply lost');}};
 const input={draftId:'reviewed-draft',name:'Task',prompt:'Read task status'};
 await assert.rejects(()=>saveWorkflow(input),/reply lost/);
 const saved=await saveWorkflow(input);assert.equal(data.browserRoutines.workflows.length,1);assert.equal(saved.id,data.browserRoutines.workflows[0].id);
});

test('expiry alarms are bound to the current recording and preserve a final draft',async t=>{
 const {data,session}=mock(t);session.browserRecording={nonce:'current',tabId:3,expiresAt:Date.now()+10000,steps:[{kind:'navigate',url:'https://example.org'}]};
 await expireRecording('nubi-recording:old');assert(session.browserRecording);
 await expireRecording('nubi-recording:current');assert(session.browserRecording);
 session.browserRecording.expiresAt=Date.now()-1;await expireRecording('nubi-recording:current');
 assert.equal(session.browserRecording,undefined);assert.equal(data.browserRecordingDraft.stopReason,'expired');
 const first=structuredClone(data.browserRecordingDraft);await expireRecording('nubi-recording:current');assert.deepEqual(data.browserRecordingDraft,first);
});
test('worker restore finalizes expired or closed-tab recordings and rearms active ones',async t=>{
 const {data,session,alarms}=mock(t);const active={nonce:'restore',tabId:3,expiresAt:Date.now()+10000,steps:[{kind:'navigate',url:'https://example.org'}]};
 session.browserRecording=structuredClone(active);await restoreRecording();assert.equal(alarms.get('nubi-recording:restore').when,active.expiresAt);
 session.browserRecording.expiresAt=Date.now()-1;await restoreRecording();assert.equal(data.browserRecordingDraft.stopReason,'expired');assert.equal(session.browserRecording,undefined);
 session.browserRecording={...structuredClone(active),replaceDraftId:data.browserRecordingDraft.id};chrome.tabs.get=async()=>{throw Error('closed');};await restoreRecording();assert.equal(data.browserRecordingDraft.stopReason,'tab_closed');assert.equal(session.browserRecording,undefined);
});
test('the hundredth recorded step finalizes once and ignores late events',async t=>{
 const {data,session}=mock(t);session.browserRecording={nonce:'limit',tabId:3,origin:'https://example.org',expiresAt:Date.now()+10000,steps:Array.from({length:99},()=>({kind:'click',label:'Step',tag:'button'}))};
 const message={nonce:'limit',step:{kind:'click',label:'Last',tag:'button'}},sender={id:'nubi',tab:{id:3},frameId:0,url:'https://example.org'};
 await recordStep(message,sender);assert.equal(session.browserRecording,undefined);assert.equal(data.browserRecordingDraft.steps.length,100);assert.equal(data.browserRecordingDraft.stopReason,'step_limit');
 await recordStep(message,sender);assert.equal(data.browserRecordingDraft.steps.length,100);
});
