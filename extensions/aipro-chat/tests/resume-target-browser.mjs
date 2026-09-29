import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-resume-target-')), extension=resolve(profile,'extension'), checks=[];
let context;
try {
  await cp('dist',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json')));
  manifest.host_permissions.push('https://resume.example.test/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  // Isolated host-capability fixture. Real owner checks and persistence run in
  // the built background; this does not stand in for real model execution.
  await appendFile(resolve(extension,'background.js'),`\nimport {readAnalysisHandoff as fixtureReadHandoff} from './analysis-handoff.js';\nglobalThis.inspectHandoffFixture=fixtureReadHandoff;\nglobalThis.saveHandoffFixture=async(record,kind='analysis_handoff')=>{
    const {chatLease}=await getSession(),previousHas=runner.has;
    await chrome.storage.session.set({chatLease:{...chatLease,owner:'worker'}});
    runner.has=id=>id===chatLease.id;
    try {await serial(()=>handle({type:'SAVE_CONTEXT',kind,requestId:chatLease.id,record},RUNNER));}
    finally {runner.has=previousHas;await chrome.storage.session.set({chatLease});}
  };\n`);
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://resume.example.test/**',r=>r.fulfill({contentType:'text/html',body:'<title>작업 화면</title><label>본문<input id="body"></label>'}));
  await context.route('https://aipro.sdsdev.co.kr/**',r=>r.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K'}]}}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const ui=await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STATE'}));
  const unrelated=await context.newPage(); await unrelated.goto('https://resume.example.test/personal');
  const seed=await worker.evaluate(async()=>{
    const {chat}=await chrome.storage.local.get('chat');
    const task={requestId:'interrupted-task',skillId:'browser-agent',autoConnect:true,goal:'업무 초안을 확인하고 보내지 마세요',status:'paused',steps:[],page:{title:'이전 업무',url:'https://resume.example.test/work'},pendingReconciliation:{version:2,unverifiable:true}};
    await chrome.storage.local.set({browserWorkMode:'current',settings:{modelId:'QWEN3.8-27B-FP8-256K'},chat:{...chat,provider:'aipro',task,messages:[{role:'user',id:'original',content:task.goal},{id:task.requestId,role:'assistant',state:'error',error:'interrupted',content:'',trace:[{id:'00000000-0000-4000-8000-000000000001',tool:'analysis_research',status:'running',analysis:{task:'첨부 부록의 누락 조건 확인',doneWhen:'조건별 근거 확인',uncertainties:['부록을 아직 확인하지 못함'],sources:[{id:'ev_1',tool:'read_document'}]}}]}]}});
    await chrome.storage.session.set({credential:{provider:'aipro',token:'synthetic',receivedAt:1}});
    return {conversationId:chat.sessionId,task};
  });
  const start=()=>ui.evaluate(conversationId=>chrome.runtime.sendMessage({type:'START_CHAT',conversationId,resume:true,clientId:'resume-fixture'}),seed.conversationId);
  await unrelated.bringToFront();
  let result=await start(); assert.equal(result.ok,false); assert.equal(result.error,'resume_page_required');
  const after=await worker.evaluate(async()=>({local:await chrome.storage.local.get('chat'),session:await chrome.storage.session.get(['chatLease','page'])}));
  assert.deepEqual(after.local.chat.task,seed.task); assert.equal(after.local.chat.messages.length,2);
  assert.equal(after.session.chatLease,undefined); assert.equal(after.session.page,undefined);
  checks.push('an unrelated active tab cannot become the target of a paused task; rejection preserves goal, uncertain receipt, history and lease absence');
  const work=await context.newPage(); await work.goto('https://resume.example.test/work'); await work.bringToFront();
  const connected=await ui.evaluate(()=>chrome.runtime.sendMessage({type:'CONNECT_PAGE'})); assert.equal(connected.ok,true);
  result=await start(); assert.equal(result.ok,true); assert.deepEqual({...result.data.resumeTask,analysisCheckpoint:undefined},{...seed.task,analysisCheckpoint:undefined});
  const checkpoint=result.data.resumeTask.analysisCheckpoint;
  assert.equal(checkpoint.entries[0].analysis.task,'첨부 부록의 누락 조건 확인');
  assert.equal(checkpoint.entries[0].status,'running'); assert.equal(checkpoint.coverage,'partial_trace_hints');
  assert(!JSON.stringify(checkpoint).includes('ev_1'));
  const state=await worker.evaluate(async()=>({local:await chrome.storage.local.get('chat'),session:await chrome.storage.session.get(['chatLease','page'])}));
  assert.equal(state.session.chatLease.pageTargetTabId,state.session.page.tabId);
  assert.equal(state.session.page.url,'https://resume.example.test/work');
  assert.deepEqual(state.local.chat.task.analysisCheckpoint,checkpoint);
  assert.equal(state.local.chat.task.goal,seed.task.goal); assert.deepEqual(state.local.chat.task.pendingReconciliation,seed.task.pendingReconciliation);
  assert.equal(await unrelated.locator('#body').inputValue(),''); assert.equal(await work.locator('#body').inputValue(),'');
  checks.push('interrupted analysis hints survive START_CHAT and persist into the next checkpoint without live evidence IDs');
  checks.push('explicit page connection resumes the same goal and pending proof without replaying input; START_CHAT prepares a request but never invokes a model');
  const handoff={version:1,id:'handoff_00000000-0000-4000-8000-000000000002',status:'running',
    brief:{role:'research',task:'첨부 부록 '+ '전체 조건을 보존합니다 '.repeat(30),constraints:'전송과 문서 변경 금지',done_when:'조건별 원문과 미해결 구간 확인',effort:'standard'},
    documents:[{id:'doc1',hash:'a'.repeat(64)}],ranges:[{document_id:'doc1',hash:'a'.repeat(64),start:0,end:6}],
    progress:[{document_id:'doc1',hash:'a'.repeat(64),start:0,end:6,read:[{start:0,end:3}],remaining:[{start:3,end:6}],review_needed:true}],sources:[]};
  const denied=await ui.evaluate(({requestId,record})=>chrome.runtime.sendMessage({type:'SAVE_CONTEXT',kind:'analysis_handoff',requestId,clientId:'resume-fixture',record}),{requestId:result.data.requestId,record:handoff});
  assert.equal(denied.ok,false);assert.equal(denied.error,'interrupted');
  await worker.evaluate(record=>globalThis.saveHandoffFixture(record),handoff);
  const saved=await worker.evaluate(async()=>(await chrome.storage.local.get('chat')).chat.task.analysisHandoffs);
  assert.equal(saved.records[0].brief.task,handoff.brief.task);assert.equal(saved.records[0].brief.constraints,handoff.brief.constraints);
  const research={version:1,key:'b'.repeat(64),kind:'internal',owner:'internal:test',question:'모든 조건과 예외 검토',status:'running',checkpoint:{version:1,fingerprint:'c'.repeat(64),entries:[{key:'d'.repeat(64),reads:[{documentId:'doc1',start:0,end:3}],output:'{"mode":"comprehensive","questions":["all"]}'}],omitted:0}};
  const researchDenied=await ui.evaluate(({requestId,record})=>chrome.runtime.sendMessage({type:'SAVE_CONTEXT',kind:'research_handoff',requestId,clientId:'resume-fixture',record}),{requestId:result.data.requestId,record:research});
  assert.equal(researchDenied.ok,false);
  await worker.evaluate(record=>globalThis.saveHandoffFixture(record,'research_handoff'),research);
  const researchSaved=await worker.evaluate(async()=>(await chrome.storage.local.get('chat')).chat.task.researchHandoffs);
  await context.close();context=null;
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://resume.example.test/**',r=>r.fulfill({contentType:'text/html',body:'<title>다시 연결한 작업 화면</title><label>본문<input id="body"></label>'}));
  const nextWorker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const nextUI=await context.newPage();await nextUI.goto(`chrome-extension://${new URL(nextWorker.url()).hostname}/index.html`);
  await nextUI.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STATE'}));
  const restored=await nextWorker.evaluate(async()=>(await chrome.storage.local.get('chat')).chat.task);
  assert.equal(restored.status,'paused');assert.deepEqual(restored.analysisHandoffs,saved);assert.deepEqual(restored.researchHandoffs,researchSaved);
  await nextWorker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',token:'synthetic',receivedAt:2}}));
  const reconnected=await context.newPage();await reconnected.goto('https://resume.example.test/work');await reconnected.bringToFront();
  assert.equal((await nextUI.evaluate(()=>chrome.runtime.sendMessage({type:'CONNECT_PAGE'}))).ok,true);
  const resumed=await nextUI.evaluate(conversationId=>chrome.runtime.sendMessage({type:'START_CHAT',conversationId,resume:true,clientId:'handoff-fixture'}),seed.conversationId);
  assert.equal(resumed.ok,true);assert.deepEqual(resumed.data.resumeTask.analysisHandoffs,saved);assert.deepEqual(resumed.data.resumeTask.researchHandoffs,researchSaved);
  const inspected=await nextWorker.evaluate(async({saved,id})=>{
    return globalThis.inspectHandoffFixture(saved,id,[]);
  },{saved,id:handoff.id});
  assert.equal(inspected.recovery,'source_changed');assert.equal(inspected.sourceChecks[0].status,'missing');
  assert.equal(await reconnected.locator('#body').inputValue(),'');
  checks.push('only the worker capability can persist full handoffs; real Chrome restart preserves brief/ranges and flags missing current documents without replay');
  checks.push('DeepAgents checkpoints survive actual Chrome restart and explicit resume; UI checkpoint forgery is rejected');
  await mkdir('verification',{recursive:true}); await writeFile('verification/resume-target-browser.json',JSON.stringify({actualChrome:true,syntheticAuth:true,actualModel:false,checks},null,2));
  checks.forEach(x=>console.log('PASS '+x));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
