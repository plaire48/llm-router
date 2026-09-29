import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNT_USAGE_VERSION, ACCOUNT_USAGE_TTL, fetchAccountUsage,normalizeAccountUsage,freshAccountUsage} from '../account-usage.js';
import {chatgptToken} from './fixtures/chatgpt.mjs';
const credential={provider:'chatgpt',token:chatgptToken()};
const payload={email:'private-email',rate_limit:{primary_window:{used_percent:25,limit_window_seconds:18000,reset_at:1800000000},secondary_window:{used_percent:0,limit_window_seconds:604800,reset_after_seconds:60}}};
test('account windows show remaining percentages and explicit reset times, not token balances',()=>{
 const result=normalizeAccountUsage(payload,1000);
 assert.equal(result.windows[0].remaining,75);assert.equal(result.windows[0].resetsAt,1800000000000);
 assert.equal(result.windows[1].remaining,100);assert.equal(result.windows[1].resetsAt,61000);
 assert(!JSON.stringify(result).includes('private-email'));
 assert.equal(normalizeAccountUsage({rate_limit:{primary_window:{used_percent:null}}}).windows[0].remaining,null);
 assert.equal(normalizeAccountUsage({rate_limit:{primary_window:{used_percent:101}}}).windows[0].remaining,0);
 assert.throws(()=>normalizeAccountUsage({error:'private-error'}),/quota_invalid/);
 assert.deepEqual(normalizeAccountUsage({rate_limit:null}),{windows:[]});
});
test('account quota uses the existing router endpoint without cookies or client impersonation',async()=>{
 const result=await fetchAccountUsage(credential,undefined,async(url,options)=>{
  assert.equal(url,'https://chatgpt.com/backend-api/wham/usage');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,`Bearer ${credential.token}`);
  assert.equal(options.headers['ChatGPT-Account-Id'],'synthetic-account');assert.equal(options.headers['User-Agent'],undefined);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
  return Response.json(payload);
 });
 assert.equal(result.status,200);
});
test('credits-only and individual limits preserve zero, unlimited and unknown values without private fields',()=>{
 const result=normalizeAccountUsage({credits:{has_credits:true,unlimited:false,balance:'4500',email:'private-email'},spend_control:{reached:false,individual_limit:{remaining_percent:80,reset_at:1800000000}}});
 assert.deepEqual(result,{windows:[],credits:{balance:4500,unlimited:false},individualLimit:{remaining:80,resetsAt:1800000000000},spendControlReached:false});
 assert.deepEqual(normalizeAccountUsage({credits:{has_credits:false,unlimited:false,balance:'0'}}).credits,{balance:0,unlimited:false});
 assert.deepEqual(normalizeAccountUsage({credits:{unlimited:true}}).credits,{balance:null,unlimited:true});
 assert.equal(normalizeAccountUsage({credits:{balance:'private-secret'}}).credits.balance,null);
 assert.deepEqual(normalizeAccountUsage({spend_control:{individual_limit:{remaining_percent:null}}}).individualLimit,{remaining:null,resetsAt:null});
 assert.equal(normalizeAccountUsage({spend_control:{individual_limit:{remaining_percent:0}}}).individualLimit.remaining,0);
 for(const payload of [{credits:[]},{credits:{unlimited:'yes'}},{spend_control:[]},{spend_control:{individual_limit:'bad'}}])assert.throws(()=>normalizeAccountUsage(payload),/quota_invalid/);
});
test('only successful current-contract quota is cached until TTL or reset',()=>{
 const now=1000000, account={version:ACCOUNT_USAGE_VERSION,fetchedAt:now-1000,data:{windows:[{resetsAt:now+60000}]}};
 assert.equal(freshAccountUsage(account,now),true);
 for(const patch of [{version:1},{error:'quota_network'},{fetchedAt:now-ACCOUNT_USAGE_TTL},{fetchedAt:now+1},{fetchedAt:null},{data:null},{data:{windows:[{resetsAt:now}]}},{data:{windows:[],individualLimit:{resetsAt:now-1}}}])assert.equal(freshAccountUsage({...account,...patch},now),false);
 assert.equal(freshAccountUsage({...account,data:{windows:[],credits:{balance:0}}},now),true);
});
test('quota errors are safe and do not retry or invent an AI Pro endpoint',async()=>{
 for(const status of [401,403,404,429,500]){
  let calls=0;
  await assert.rejects(fetchAccountUsage(credential,undefined,async()=>{calls++;return new Response('private-secret',{status});}),e=>e.message.startsWith('quota_')&&!e.message.includes('private-secret'));
  assert.equal(calls,1);
 }
 await assert.rejects(fetchAccountUsage({provider:'aipro'},undefined,()=>assert.fail('AI Pro quota request invented')),/quota_unavailable/);
 await assert.rejects(fetchAccountUsage(credential,undefined,async()=>Response.json(payload,{headers:{'content-length':'9999999'}})),/quota_invalid/);
});
