import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {evaluationAnswerOutput} from './evaluation-answer-output.mjs';
import {observeEvaluationDialogs} from './evaluation-dialogs.mjs';
// Experimental: the 2026-09-28 live attempt captured no responses. Do not run
// alongside an evaluation until the transport is separately verified.
if (process.env.NUBI_EVAL_EXPERIMENTAL_OUTPUT_OBSERVER !== '1') throw Error('unverified_observer_requires_explicit_opt_in');
const [reportPath,endpoint]=process.argv.slice(2);
if(!reportPath || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint||''))throw Error('evaluation_arguments_required');
const readReport=async()=>JSON.parse(await fs.readFile(resolve(reportPath),'utf8'));
const initial=await readReport();
if(initial.suite!=='browser-30-v1'||initial.provider!=='chatgpt'||initial.trials.some(t=>t.environment!=='public-live'))throw Error('public_evaluation_required');
const browser=await chromium.connectOverCDP(endpoint,{noDefaults:true});
const context=browser.contexts()[0],starts=new Map(),pending=new Set();
observeEvaluationDialogs(context);
const output=resolve(initial.evidenceDirectory,'candidate-output.jsonl');
let control,sessionId,sequence=0;const replies=new Map();
try {
 const expected=`evaluation-${initial.candidateSha256.slice(0,16)}-${initial.evaluatorSha256.slice(0,12)}`;
 const workers=await Promise.all(context.serviceWorkers().map(async w=>({worker:w,version:await w.evaluate(()=>chrome.runtime.getManifest().version_name).catch(()=>null)})));
 const worker=workers.find(w=>w.version===expected)?.worker;if(!worker)throw Error('candidate_identity_mismatch');
 control=await browser.newBrowserCDPSession();
 const targets=await control.send('Target.getTargets');const target=targets.targetInfos.find(t=>t.type==='page'&&t.url===new URL('index.html',worker.url()).href);
 if(!target)throw Error('candidate_worker_missing');
 ({sessionId}=await control.send('Target.attachToTarget',{targetId:target.targetId,flatten:false}));
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{replies.delete(id);reject(Error('observer_timeout'));},5000);replies.set(id,{resolve,reject,timer});control.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});
 control.on('Target.receivedMessageFromTarget',event=>{
  if(event.sessionId!==sessionId)return;
  const m=JSON.parse(event.message);if(m.id){const reply=replies.get(m.id);if(reply){replies.delete(m.id);clearTimeout(reply.timer);m.error?reply.reject(Error('observer_cdp_failed')):reply.resolve(m.result);}return;}
  const p=m.params;
  if(m.method==='Network.requestWillBeSent'){const u=new URL(p.request.url);if(p.request.method==='POST'&&u.origin==='https://chatgpt.com'&&u.pathname.endsWith('/codex/responses'))starts.set(p.requestId,{startedAt:Date.now()});}
  if(m.method==='Network.responseReceived'&&starts.has(p.requestId))starts.get(p.requestId).status=p.response.status;
  if(m.method==='Network.loadingFailed')starts.delete(p.requestId);
  if(m.method!=='Network.loadingFinished'||!starts.has(p.requestId))return;
  const item=starts.get(p.requestId);starts.delete(p.requestId);if(item.status!==200)return;
  const work=(async()=>{try {
   const {body,base64Encoded}=await send('Network.getResponseBody',{requestId:p.requestId});
   const decoded=base64Encoded?Buffer.from(body,'base64').toString('utf8'):body;
   const answer=evaluationAnswerOutput(decoded);if(!answer?.text){console.log('NO_TERMINAL_ASSISTANT_TEXT');return;}
   const report=await readReport();const trial=report.trials.findLast(t=>Date.parse(t.startedAt)<=item.startedAt&&(!t.finishedAt||item.startedAt<=Date.parse(t.finishedAt)));
   if(!trial||trial.environment!=='public-live')return;
   await fs.appendFile(output,JSON.stringify({runId:report.runId,trialId:trial.trialId,taskId:trial.id,startedAt:item.startedAt,finishedAt:Date.now(),scope:'Public assistant output only; may be withheld candidate or structured review, not delivered answer or private reasoning',...answer})+'\n');
   console.log(`PUBLIC_OUTPUT_CAPTURED ${trial.id} ${answer.characters}`);
  }catch{console.log('OUTPUT_CAPTURE_UNAVAILABLE');}})();pending.add(work);work.finally(()=>pending.delete(work));
 });
 await send('Network.enable');
 await fs.writeFile(resolve(initial.evidenceDirectory,'candidate-output-observer.json'),JSON.stringify({startedAt:new Date().toISOString(),candidateSha256:initial.candidateSha256,transport:'read-only CDP observer on verified candidate UI',scope:'Attached after evaluation began. Earlier/incomplete responses not reconstructed. Only terminal assistant output_text retained; no request bodies, headers, tool arguments or private reasoning.'},null,2));
 console.log('PUBLIC_OUTPUT_OBSERVER_ATTACHED');
 for(;;){const r=await readReport();if(r.finishedAt&&r.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,3000));}
 await Promise.allSettled([...pending]);
}finally{if(sessionId)await control.send('Target.detachFromTarget',{sessionId}).catch(()=>{});await control?.detach();await browser.close();}
