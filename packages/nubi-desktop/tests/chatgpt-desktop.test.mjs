import test from 'node:test';import assert from 'node:assert/strict';
import {createProviders,chatGPTLogin} from '../../nubi-office/worker/providers.mjs';
import {chatgptToken,responsesSSE} from '../../../extensions/aipro-chat/tests/fixtures/chatgpt.mjs';
import {safeError} from '../../nubi-office/worker/connection-errors.mjs';
const tick=()=>new Promise(r=>setTimeout(r,5));
test('Desktop ChatGPT callback and first Codex SSE completion use the injected transport end to end',async()=>{
 let loginURL,request;const p=createProviders({hostLabel:'누비 워크스페이스',chatGPTLogin:options=>chatGPTLogin({...options,openBrowser:async url=>{loginURL=url;}}),fetchImpl:async(url,options)=>{if(String(url).includes('oauth/token'))return Response.json({access_token:chatgptToken(),refresh_token:'fixture-refresh',expires_in:3600});request={url,options};return new Response(responsesSSE({text:'Verified fixture answer'}),{headers:{'content-type':'text/event-stream'}});}});
 try{await p.login('chatgpt');const state=new URL(loginURL).searchParams.get('state');const callback=await fetch('http://127.0.0.1:1455/auth/callback?state='+state+'&code=private-fixture-code');assert.equal(callback.status,200);const html=await callback.text();assert.match(html,/누비 새 캐릭터/);assert.match(html,/history.replaceState/);assert(!html.includes('private-fixture-code'));for(let i=0;i<100&&!p.status().connected;i++)await tick();assert(p.status().connected);assert.equal(p.status().verified,false);assert(p.status().models.some(m=>m.id==='gpt-5.6-sol'));p.model('gpt-5.6-sol');const result=await p.complete([{role:'user',content:'reply briefly'}],[],new AbortController().signal);assert.equal(result.content,'Verified fixture answer');assert.equal(request.url,'https://chatgpt.com/backend-api/codex/responses');assert.equal(new Headers(request.options.headers).get('chatgpt-account-id'),'synthetic-account');assert.equal(p.status().verified,true);assert(!JSON.stringify(p.status()).includes(chatgptToken()));}finally{p.dispose();}
});
test('Codex network failure preserves the native TLS cause as a safe diagnostic',async()=>{
 const {completeChatGPT}=await import('../../../extensions/aipro-chat/chatgpt-api.js');
 await assert.rejects(completeChatGPT({fetchImpl:async()=>{throw Object.assign(new Error('private network detail'),{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN'}});},messages:[{role:'user',content:'fixture'}],tools:[],modelId:'gpt-5.6-sol',credential:{token:chatgptToken()},signal:new AbortController().signal,onText(){},onPhase(){}}),error=>safeError(error)==='tls_untrusted');
});
