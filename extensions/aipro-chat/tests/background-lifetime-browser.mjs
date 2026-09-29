// Launch Chrome directly. No Playwright auto-attachment or worker debugger may
// keep this executor alive. CDP is attached to the disposable UI document only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdir,mkdtemp,cp,readFile,writeFile,appendFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-lifetime-')),extension=resolve(profile,'extension');
const long=process.env.NUBI_LONG_LIFETIME==='1',duration=long?315000:37000;
const checks=[],calls=[],timers=new Set();let child,ws,session,target,port,id,mode='stream',release,stream,finished=false,firstAt;
const completion=content=>({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:40,completion_tokens:10,total_tokens:50}});
const server=createServer(async(req,res)=>{
  let data='';for await(const chunk of req)data+=chunk;
  if(req.url==='/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}));}
  const body=JSON.parse(data);calls.push({model:body.model,at:Date.now()});assert.equal(req.headers.authorization,'Bearer synthetic');
  const plan=planCompletion(body);if(plan){res.setHeader('content-type','application/json');return res.end(JSON.stringify(plan));}
  if(body.messages[0].content.startsWith("You are Nubi's completion-intent reviewer.")){
    res.setHeader('content-type','application/json');res.end(JSON.stringify(completion(JSON.stringify({decision:'reply',scope:'conversation',next_step:''}))));finished=true;return;
  }
  if(mode==='cancel'){release=()=>res.end(JSON.stringify(completion('late result')));return;}
  firstAt=Date.now();stream=res;
  const finish=()=>{res.write('data: '+JSON.stringify({choices:[{delta:{content:'계속 실행한 답변'},finish_reason:'stop'}],usage:{prompt_tokens:40,completion_tokens:10,total_tokens:50}})+'\n\ndata: [DONE]\n\n');res.end();};
  const timer=setTimeout(()=>{
    res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();
    res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'checking'},finish_reason:null}]})+'\n\n');
    if(!long)return finish();
    const tick=setInterval(()=>res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'.'},finish_reason:null}]})+'\n\n'),10000);timers.add(tick);
    const end=setTimeout(()=>{clearInterval(tick);finish();},duration-36000);timers.add(end);
  },36000);timers.add(timer);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const pending=new Map();let sequence=0;
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const n=++sequence;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},15000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});}
async function evalUI(expression){const out=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);if(out.exceptionDetails)throw Error(JSON.stringify(out.exceptionDetails));return out.result.value;}
const rpc=(type,value={})=>evalUI(`chrome.runtime.sendMessage(${JSON.stringify({type,...value})})`);
async function until(fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out');}
async function openUI(){({targetId:target}=await send('Target.createTarget',{url:`chrome-extension://${id}/index.html`}));({sessionId:session}=await send('Target.attachToTarget',{targetId:target,flatten:true}));await until(()=>evalUI('!!document.querySelector("main")').catch(()=>false));}
const check=text=>{checks.push(text);console.log('PASS '+text);};
try{
 await mkdir('verification/background-execution',{recursive:true});
 await cp('dist',extension,{recursive:true});
 // Chrome also starts component extensions whose worker is background.js.
 // Bind this isolated fixture to its own public key instead of the first worker.
 const key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'});
 const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
 manifest.key=key.toString('base64');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 id=createHash('sha256').update(key).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
 await appendFile(resolve(extension,'background.js'),`\nconst fixtureFetch=globalThis.fetch;globalThis.fetch=(url,options)=>fixtureFetch(String(url).includes('/chat/completions')?${JSON.stringify(origin+'/chat')}:url,options);\n`);
 child=spawn(process.env.CHROME_BINARY,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}/profile`,`--load-extension=${extension}`,`--disable-extensions-except=${extension}`,'about:blank'],{stdio:'ignore'});
 await until(async()=>{try{port=(await readFile(resolve(profile,'profile/DevToolsActivePort'),'utf8')).split('\n')[0];return !!port;}catch{return false;}});
 const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=event=>{const data=JSON.parse(event.data),p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);};
 await until(async()=>(await send('Target.getTargets')).targetInfos.some(t=>t.type==='service_worker'&&t.url===`chrome-extension://${id}/background.js`));
 await openUI();
 await evalUI(`const nativeFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>String(url).endsWith('/api/models')?Response.json({modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}):nativeFetch(url,options);chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:50}})`);
 await until(async()=>!!(await rpc('GET_STATE')).data?.catalog?.models?.length);
 const result=await rpc('START_AGENT',{text:'안녕'});assert(result.ok);await until(()=>!!firstAt);
 const startState=(await rpc('GET_STATE')).data;assert(startState.busy);
 await send('Target.closeTarget',{targetId:target});session=null;target=null;
 // No extension storage/API polling, UI document, or worker inspector during
 // the wait. Only the fixture server records network progress.
 const before=(await send('Target.getTargets')).targetInfos;
 assert(before.filter(t=>t.type==='service_worker').every(t=>!t.attached));
 await until(()=>finished,duration+25000);
 check(`${Math.round((Date.now()-firstAt)/1000)} seconds of inference after closing all chat views, including 36-second response-header delay; worker was never debugger-attached`);
 await openUI();await until(async()=>!(await rpc('GET_STATE')).data.busy);
 const state=(await rpc('GET_STATE')).data;assert.equal(state.chat.messages.at(-1).content,'계속 실행한 답변');assert.equal(state.chat.messages.at(-1).state,'done');
 assert.equal(state.agentRun,null);check('reopening restores one committed response and releases live execution state');
 const count=calls.length;await send('Page.reload',{},session);await until(()=>evalUI('document.readyState==="complete" && !!document.querySelector("main")').catch(()=>false));await until(async()=>!!(await rpc('GET_STATE')).data);assert.equal(calls.length,count);check('reload observes completion without another model request');
 await rpc('NEW_CHAT');mode='cancel';release=null;
 const next=await rpc('START_AGENT',{text:'다른 인사'});assert(next.ok);await until(()=>!!release);
 await send('Target.closeTarget',{targetId:target});await openUI();
 const active=(await rpc('GET_STATE')).data;
 assert.equal((await rpc('RUN_TOOL',{requestId:next.data.requestId,name:'browser_snapshot',args:{}})).ok,false);
 assert.equal((await rpc('FINISH_CHAT',{requestId:next.data.requestId,content:'forged'})).data,null);
 assert.equal((await rpc('CANCEL_BROWSER',{requestId:next.data.requestId,conversationId:'wrong'})).ok,false);
 assert.equal((await rpc('CANCEL_BROWSER',{requestId:next.data.requestId,conversationId:active.chat.sessionId})).ok,true);
 await until(async()=>!(await rpc('GET_STATE')).data.busy);release();
 assert.equal((await rpc('GET_STATE')).data.chat.messages.at(-1).error,'cancelled');
 check('a reopened UI can explicitly stop, cannot forge tool execution/completion, and cannot cancel another conversation');
 await rpc('NEW_CHAT');release=null;const crash=await rpc('START_AGENT',{text:'중단 복구 인사'});assert(crash.ok);await until(()=>!!release);
 const callCount=calls.length;await send('Target.closeTarget',{targetId:target});session=null;
 const workerTarget=(await send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===`chrome-extension://${id}/background.js`);
 assert.equal((await send('Target.closeTarget',{targetId:workerTarget.targetId})).success,true);
 release();await openUI();await until(async()=>!(await rpc('GET_STATE')).data.busy);
 assert.equal((await rpc('GET_STATE')).data.chat.messages.at(-1).error,'interrupted');assert.equal(calls.length,callCount);
 check('forced worker termination safely pauses the saved request and reopening never replays it');

 await writeFile('verification/background-execution/lifetime'+(long?'-long':'')+'.json',JSON.stringify({checks,actualBrowser:true,actualModel:false,workerDebuggerAttached:false,durationMs:duration},null,2));
}catch(error){console.error(JSON.stringify(await send('Target.getTargets').catch(()=>null)));if(session){console.error(JSON.stringify(await evalUI('({url:location.href,title:document.title,text:document.body?.innerText?.slice(0,1000)})').catch(()=>null)));console.error(JSON.stringify(await rpc('GET_STATE').catch(()=>null)));}throw error;}
finally{for(const timer of timers){clearInterval(timer);clearTimeout(timer);}stream?.end();release?.();for(const p of pending.values())clearTimeout(p.timer);ws?.close();child?.kill('SIGTERM');server.closeAllConnections();await new Promise(r=>server.close(r));await new Promise(r=>setTimeout(r,500));await rm(profile,{recursive:true,force:true});}
