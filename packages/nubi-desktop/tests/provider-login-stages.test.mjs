import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviders} from '../../nubi-office/worker/providers.mjs';
import {startLogin} from '../../nubi-office/worker/aipro-auth.mjs';
import {providerLoginError} from '../ui/provider-login-state.mjs';
const jwt='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.fixture';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('a completed browser callback remains loading_models until the actual catalog is ready',async()=>{
 let port,finishModels,callback;const models=new Promise(resolve=>finishModels=resolve);
 const p=createProviders({startLogin:options=>startLogin({...options,timeoutMs:5000,openBrowser:async url=>{port=new URL(url).searchParams.get('port');}}),fetchImpl:async url=>url.endsWith('/auth/exchange')?Response.json({token:jwt}):models});
 try{await p.login('aipro');callback=fetch(`http://127.0.0.1:${port}/auth?status=00&code=fixture-private-code`);for(let i=0;i<50&&p.status().pendingPhase!=='loading_models';i++)await new Promise(r=>setTimeout(r,10));assert.equal(p.status().pendingPhase,'loading_models');assert.equal(p.status().connected,false);finishModels(Response.json({modelList:[{name:'exact-model-id'}]}));assert.equal((await callback).status,200);await tick();assert.equal(p.status().connected,true);assert.equal(p.status().model,'exact-model-id');assert.equal(p.status().pending,null);assert(!JSON.stringify(p.status()).includes(jwt));assert(!JSON.stringify(p.status()).includes('fixture-private-code'));}finally{p.dispose();await callback?.catch(()=>{});}
});
test('a model HTTP denial and TLS failure show the actual failed stage with safe errors',async()=>{
 for(const type of ['forbidden','tls_untrusted']){
  let port;const p=createProviders({startLogin:options=>startLogin({...options,timeoutMs:5000,openBrowser:async url=>{port=new URL(url).searchParams.get('port');}}),fetchImpl:async url=>{if(type==='tls_untrusted')throw Object.assign(Error('private data'),{code:'SELF_SIGNED_CERT_IN_CHAIN'});return url.endsWith('/auth/exchange')?Response.json({token:jwt}):Response.json({}, {status:403});}});
  try{await p.login('aipro');assert.equal((await fetch(`http://127.0.0.1:${port}/auth?status=00&code=fixture`)).status,400);await tick();const state=p.status();assert.equal(state.loginError,type);assert.equal(state.connected,false);assert.match(providerLoginError(state),type==='forbidden'?/모델 목록 조회 실패/:/인증 확인 실패/);assert(!JSON.stringify(state).includes('private data'));if(type==='forbidden')assert.equal(state.loginDiagnostics.at(-1).status,403);}finally{p.dispose();}
 }
});
test('cancel fences late progress and credentials from the same login attempt',async()=>{
 let progress,finish;const p=createProviders({startLogin:async options=>{progress=options.onProgress;return {result:new Promise(resolve=>finish=resolve),cancel(){}};}});
 await p.login('aipro');progress({phase:'exchanging',elapsedMs:1,token:jwt});assert(!JSON.stringify(p.status()).includes(jwt));p.cancelLogin();progress({phase:'ready',token:jwt});finish({token:jwt,models:[{id:'late'}]});await tick();assert.equal(p.status().connected,false);assert.deepEqual(p.status().loginDiagnostics,[]);p.dispose();
});
