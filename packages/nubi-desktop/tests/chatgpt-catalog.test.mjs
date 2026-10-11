import test from 'node:test';import assert from 'node:assert/strict';
import {desktopChatGPTModels} from '../runtime/chatgpt-catalog.mjs';
import {chatgptToken} from '../../../extensions/aipro-chat/tests/fixtures/chatgpt.mjs';
import {createProviders} from '../../nubi-office/worker/providers.mjs';
test('Desktop catalog uses account metadata and excludes invisible models without exposing credentials',async()=>{
 let request;const credential={token:chatgptToken()};const result=await desktopChatGPTModels({credential,fetchImpl:async(url,options)=>{request={url,options};return Response.json({models:[{slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',context_window:262144,visibility:'list',input_modalities:['text','image']},{slug:'hidden-model',visibility:'hide'}]});}});
 assert.equal(result.source,'account');assert.deepEqual(result.payload.modelList.map(m=>m.name),['gpt-6.1-sol']);assert.equal(result.payload.modelList[0].context_length,262144);assert.equal(new Headers(request.options.headers).get('originator'),'pi');assert.equal(new Headers(request.options.headers).get('ChatGPT-Account-ID'),'synthetic-account');assert(!JSON.stringify(result).includes(credential.token));
 await assert.rejects(desktopChatGPTModels({credential,fetchImpl:async()=>Response.json({error:'fixture'},{status:403})}),error=>error.status===403);
});
test('catalog failures stay disconnected and cancellation fences an in-flight account catalog',async()=>{
 for(const mode of ['failure','cancel']){let finish;const waiting=new Promise(resolve=>finish=resolve);const p=createProviders({chatGPTLogin:async()=>({result:Promise.resolve({token:chatgptToken()}),cancel(){}}),chatGPTModels:async()=>{await waiting;if(mode==='failure')throw Error('models_invalid');return {payload:{modelList:[{name:'gpt-6.1-sol'}]}};}});
 try{await p.login('chatgpt');await new Promise(r=>setTimeout(r,5));assert.equal(p.status().pendingPhase,'loading_models');if(mode==='cancel')p.cancelLogin();finish();await new Promise(r=>setTimeout(r,5));assert.equal(p.status().connected,false);assert.equal(p.status().models.length,0);assert.equal(p.status().loginError,mode==='failure'?'models_invalid':null);if(mode==='failure')assert.equal(p.status().loginDiagnostics.at(-1).failedStage,'loading_models');}finally{p.dispose();}}
});
