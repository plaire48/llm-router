import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createChatGPTLogin, CHATGPT_REDIRECT, chatGPTCallback, exchangeChatGPTCode, refreshChatGPTToken} from '../chatgpt-auth.js';

const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now()/1000)+3600, 'https://api.openai.com/auth': {chatgpt_account_id: 'synthetic-account'}})).toString('base64url')}.signature`;
const payload = {access_token: token, refresh_token: 'synthetic-private-refresh', expires_in: 3600};
test('browser PKCE uses fresh S256 verifier and state with the fixed loopback callback', async () => {
  const first = await createChatGPTLogin(), second = await createChatGPTLogin(), url = new URL(first.url);
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.searchParams.get('redirect_uri'), CHATGPT_REDIRECT);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(first.verifier).digest('base64url'));
  assert.notEqual(first.state, second.state); assert.notEqual(first.verifier, second.verifier);
  assert(!first.url.includes(first.verifier));
  assert.equal(chatGPTCallback(`${CHATGPT_REDIRECT}?${new URLSearchParams({state:first.state,code:'synthetic-code'})}`, first), 'synthetic-code');
  for (const url of [`${CHATGPT_REDIRECT}?state=wrong&code=x`, `${CHATGPT_REDIRECT}?state=${first.state}&state=${first.state}&code=x`, `${CHATGPT_REDIRECT}/other?state=${first.state}&code=x`, `${CHATGPT_REDIRECT}?state=${first.state}&code=x&code=y`]) assert.throws(() => chatGPTCallback(url, first), /chatgpt_callback_invalid/);
  assert.throws(() => chatGPTCallback(`${CHATGPT_REDIRECT}?state=${first.state}&error=access_denied`, first), /chatgpt_login_denied/);
});
test('code exchange is URLencoded, cookie-free and contains PKCE; refresh preserves credential identity', async () => {
  const flow = await createChatGPTLogin();
  let requests=[];
  const fetchImpl = async (url, options) => {requests.push({url, options}); return Response.json(payload);};
  const first = await exchangeChatGPTCode('synthetic-code', flow, {fetchImpl});
  assert.equal(first.credential.provider, 'chatgpt');
  assert.equal(first.credential.token, token);
  const request=requests[0], body=new URLSearchParams(request.options.body);
  assert.equal(request.url, 'https://auth.openai.com/oauth/token');
  assert.equal(request.options.method, 'POST'); assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.redirect, 'error');
  assert.equal(body.get('code_verifier'), flow.verifier); assert.equal(body.get('redirect_uri'), CHATGPT_REDIRECT);
  const second = await refreshChatGPTToken(first.credential, {fetchImpl});
  assert.equal(second.credential.receivedAt, first.credential.receivedAt);
  assert.equal(new URLSearchParams(requests[1].options.body).get('grant_type'),'refresh_token');
});
test('token rejection, oversized or invalid credentials and cancellation never expose response secrets', async () => {
  const flow=await createChatGPTLogin();
  for (const response of [new Response('private-token-body',{status:401}),Response.json({...payload,access_token:'private-invalid'}),Response.json({...payload,expires_in:0}),Response.json(payload,{headers:{'content-length':'500000'}})]) {
    await assert.rejects(exchangeChatGPTCode('synthetic-code',flow,{fetchImpl:async()=>response}), error => error.message.startsWith('chatgpt_') && !error.message.includes('private'));
  }
  const controller=new AbortController(); controller.abort();
  await assert.rejects(exchangeChatGPTCode('synthetic-code',flow,{signal:controller.signal,fetchImpl:()=>assert.fail('cancelled request sent')}), /exchange_interrupted/);
});
