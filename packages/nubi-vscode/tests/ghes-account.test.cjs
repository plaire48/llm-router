const test=require('node:test'),assert=require('node:assert/strict');
const {GhesAccount,ORIGIN,CLIENT_ID,SECRET_KEY}=require('../src/ghes.cjs');
const profile={id:42,login:'nubi-user',name:'누비 사용자',html_url:ORIGIN+'/nubi-user'};
const device={device_code:'DEVICE_PRIVATE',user_code:'ABCD-EFGH',verification_uri:ORIGIN+'/login/device',expires_in:900,interval:5};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({responses=[],stored,waiter,fetcher}={}){
  const calls=[],saved=new Map(stored?[[SECRET_KEY,stored]]:[]),opens=[],invalidations=[];let clock=1000;
  const secrets={get:async k=>saved.get(k),store:async(k,v)=>saved.set(k,v),delete:async k=>saved.delete(k)};
  const account=new GhesAccount({secrets,openExternal:async url=>{opens.push(url);return true;},now:()=>clock,waiter:waiter||(async ms=>{clock+=ms;}),onInvalidated:async()=>invalidations.push(true),fetcher:fetcher||(async(url,options)=>{calls.push({url,options});const value=responses.shift();if(value instanceof Error)throw value;return value instanceof Response?value:Response.json(value);})});
  return {account,calls,saved,opens,secrets,invalidations,setClock:value=>clock=value};
}
async function login(f){await f.account.login();await f.account.authorization;return f.account.view();}
test('company Device Flow validates /user before storing credentials; only display identity reaches the webview',async()=>{
  assert.equal(CLIENT_ID,'Iv1.8526278f12b92180','company-confirmed Client ID starts with uppercase I, not lowercase l');
  const f=fixture({responses:[device,{access_token:'GHES_PRIVATE',token_type:'bearer',expires_in:28800,refresh_token:'REFRESH_PRIVATE'},profile]});
  const state=await login(f);assert.equal(state.connected,true);assert.equal(state.profile.name,'누비 사용자');
  assert.ok(!JSON.stringify(state).includes('PRIVATE'));assert.deepEqual(f.opens,[ORIGIN+'/login/device']);
  const stored=JSON.parse(f.saved.get(SECRET_KEY));assert.equal(stored.token,'GHES_PRIVATE');assert.equal(stored.clientId,CLIENT_ID);assert.ok(!f.saved.get(SECRET_KEY).includes('REFRESH_PRIVATE'));
  assert.ok(f.calls.every(r=>r.url.startsWith(ORIGIN+'/')&&!r.url.includes('PRIVATE')&&r.options.redirect==='error'));
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{client_id:CLIENT_ID});assert.equal(f.calls[2].options.headers.Authorization,'Bearer GHES_PRIVATE');
});
test('polling respects interval and adds five seconds for slow_down',async()=>{
  const delays=[];let clock=0;const f=fixture({responses:[device,{error:'authorization_pending'},{error:'slow_down'},{access_token:'TOKEN',token_type:'bearer'},profile],waiter:async ms=>{delays.push(ms);clock+=ms;}});f.account.now=()=>clock;
  assert.equal((await login(f)).connected,true);assert.deepEqual(delays,[5000,5000,10000]);
});
test('duplicate login calls start a single device flow',async()=>{
  const f=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},profile]});await Promise.all([f.account.login(),f.account.login()]);await f.account.authorization;
  assert.equal(f.calls.filter(r=>r.url.endsWith('/login/device/code')).length,1);
});
test('external, credential-bearing or malformed verification addresses never open a browser or poll',async()=>{
  for(const uri of ['https://attacker.invalid/login/device',ORIGIN.replace('https://','https://u:p@')+'/login/device',ORIGIN+'/login/device?token=secret',ORIGIN+'/wrong']){
    const f=fixture({responses:[{...device,verification_uri:uri}]});assert.equal((await login(f)).error,'ghes_device_invalid');assert.deepEqual(f.opens,[]);assert.equal(f.calls.length,1);assert.equal(f.saved.size,0);
  }
});
test('access denial and expiry keep the account disconnected without saving credentials',async()=>{
  for(const [result,code] of [[{error:'access_denied'},'ghes_access_denied'],[{error:'expired_token'},'ghes_device_expired']]){
    const f=fixture({responses:[device,result]});assert.equal((await login(f)).error,code);assert.equal(f.saved.size,0);
  }
});
test('cancelled polling cannot save a late successful response or connect the account',async()=>{
  let release;const f=fixture({responses:[device,{access_token:'LATE_PRIVATE',token_type:'bearer'},profile],waiter:()=>new Promise(r=>release=r)});
  await f.account.login();while(!release)await tick();await f.account.logout();release();await f.account.authorization;
  assert.equal(f.account.view().connected,false);assert.equal(f.calls.length,1);assert.equal(f.saved.size,0);
});
test('cancellation during secure storage deletes the late saved credential',async()=>{
  let release,start;const started=new Promise(r=>start=r),f=fixture({responses:[device,{access_token:'LATE_PRIVATE',token_type:'bearer'},profile]});
  f.secrets.store=async(k,v)=>{start();await new Promise(r=>release=r);f.saved.set(k,v);};
  await f.account.login();await started;const logout=f.account.logout();release();await logout;await f.account.authorization;
  assert.equal(f.account.view().connected,false);assert.equal(f.saved.size,0);
});
test('restored credentials are checked with /user; revoked and expired sessions clear secure storage',async()=>{
  const stored=JSON.stringify({host:ORIGIN,clientId:CLIENT_ID,token:'SAVED_PRIVATE'});
  const good=fixture({stored,responses:[profile]});assert.equal((await good.account.status()).connected,true);assert.equal(good.calls.length,1);
  const revoked=fixture({stored,responses:[new Response('{}',{status:401})]});assert.equal((await revoked.account.status()).error,'ghes_session_expired');assert.equal(revoked.saved.size,0);
  const expired=fixture({stored:JSON.stringify({host:ORIGIN,clientId:CLIENT_ID,token:'TOKEN',expiresAt:100})});assert.equal((await expired.account.status()).connected,false);assert.equal(expired.calls.length,0);assert.equal(expired.saved.size,0);
});
test('restore rejects another host/app and never transmits its token',async()=>{
  for(const override of [{host:'https://github.com'},{clientId:'ANOTHER_APP'}]){const f=fixture({stored:JSON.stringify({host:ORIGIN,clientId:CLIENT_ID,token:'OTHER_PRIVATE',...override})});await f.account.status();assert.equal(f.calls.length,0);assert.equal(f.saved.size,0);}
});
test('network failure keeps stored identity unverified and permits a read-only reconnect',async()=>{
  const f=fixture({stored:JSON.stringify({host:ORIGIN,clientId:CLIENT_ID,token:'SAVED_PRIVATE'}),responses:[Error('PRIVATE_BODY'),profile]});
  assert.equal((await f.account.status()).state,'attention');assert.equal(f.saved.size,1);assert.equal((await f.account.action('retry')).connected,true);
});
test('SSO restriction, permission, rate limit and missing resource are distinct safe errors',async()=>{
  for(const [status,headers,code] of [[403,{'x-github-sso':'required; url=https://attacker.invalid'},'ghes_sso_required'],[403,{},'ghes_permission'],[403,{'x-ratelimit-remaining':'0'},'ghes_rate_limited'],[404,{},'ghes_identity_unavailable']]){
    const f=fixture({responses:[new Response('PRIVATE_BODY',{status,headers})]});await assert.rejects(f.account.request('/api/v3/user'),{message:code});assert.deepEqual(f.opens,[]);
  }
});

test('a missing login endpoint is not reported as repository permission failure',async()=>{
  for(const [responses,stage] of [[[], 'device_code'],[[device], 'authorization'],[[device,{access_token:'TOKEN',token_type:'bearer'}], 'identity']]){
    const f=fixture({responses:[...responses,new Response('PRIVATE_PROXY_RESPONSE',{status:404})]});
    const view=await login(f);
    assert.equal(view.error,stage==='identity'?'ghes_identity_unavailable':'ghes_login_endpoint_unavailable');
    assert.deepEqual(view.diagnostic,{stage,status:404});
    assert.equal(view.connected,false);assert.equal(f.saved.size,0);
    assert.doesNotMatch(JSON.stringify(view),/PRIVATE|TOKEN|device_code"\s*:/);
  }
});
test('known OAuth configuration failures are classified for JSON error responses on HTTP 200 or 400',async()=>{
  for(const status of [200,400])for(const [error,expected] of [['device_flow_disabled','ghes_device_disabled'],['incorrect_client_credentials','ghes_app_configuration']]){
    const f=fixture({responses:[Response.json({error,error_description:'PRIVATE_DESCRIPTION'},{status})]});
    const view=await login(f);assert.equal(view.error,expected);assert.deepEqual(view.diagnostic,{stage:'device_code',status});assert.equal(f.opens.length,0);assert.equal(f.saved.size,0);assert.doesNotMatch(JSON.stringify(view),/PRIVATE/);
  }
});
test('repository 404 remains scoped to repository access after a verified login',async()=>{
  const f=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},profile,profile,new Response('{}',{status:404})]});
  await login(f);
  await assert.rejects(f.account.json('/repos/org/repo'),{message:'ghes_repository_missing',diagnostic:{stage:'repositories',status:404}});
  assert.equal(f.account.view().connected,true);assert.equal(f.saved.size,1);
});
test('successful read-only reconnect clears the previous failed identity diagnostic',async()=>{
  const f=fixture({stored:JSON.stringify({host:ORIGIN,clientId:CLIENT_ID,token:'SAVED_PRIVATE'}),responses:[new Response('{}',{status:404}),profile]});
  assert.deepEqual((await f.account.status()).diagnostic,{stage:'identity',status:404});
  const view=await f.account.action('retry');assert.equal(view.connected,true);assert.equal(view.error,null);assert.equal(view.diagnostic,null);
});
test('protected avatars become bounded image data; external or SVG avatars never receive credentials',async()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10]);
  const f=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},{...profile,avatar_url:ORIGIN+'/avatars/42'},new Response(png,{headers:{'content-type':'image/png'}})]});
  assert.match((await login(f)).profile.avatar,/^data:image\/png;base64,/);assert.equal(f.calls.at(-1).options.redirect,'manual');
  const external=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},{...profile,avatar_url:'https://attacker.invalid/a'}]});assert.equal((await login(external)).profile.avatar,null);assert.equal(external.calls.length,3);
  const svg=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},{...profile,avatar_url:ORIGIN+'/avatar'},new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})]});assert.equal((await login(svg)).profile.avatar,null);
});
test('same-company asset redirect is followed but cross-origin redirects are refused',async()=>{
  const f=fixture({responses:[new Response(null,{status:302,headers:{location:ORIGIN+'/asset'}}),new Response('bytes')]});
  assert.equal((await f.account.request('/api/v3/asset',{token:'TOKEN',accept:'application/octet-stream',allowRedirect:true})).toString(),'bytes');
  const other=fixture({responses:[new Response(null,{status:302,headers:{location:'https://attacker.invalid/asset'}})]});await assert.rejects(other.account.request('/asset',{token:'TOKEN',accept:'application/octet-stream',allowRedirect:true}),/ghes_redirect_refused/);assert.equal(other.calls.length,1);
});
test('protected operations revalidate identity and logout cancels an in-flight request',async()=>{
  const f=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},profile,{...profile,id:43}]});await login(f);await assert.rejects(f.account.credential(),/ghes_identity_changed/);assert.equal(f.saved.size,0);
  const g=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},profile]});await login(g);let release;
  g.account.fetcher=async()=>new Promise(r=>release=r);const request=g.account.request('/api/v3/user',{token:'TOKEN'});await tick();await g.account.logout();release(Response.json(profile));await assert.rejects(request,/ghes_cancelled/);
});

test('profile exposes verified company and valid email without inventing missing fields',async()=>{
  const f=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},{...profile,company:'  Manufacturing IT  ',email:'user@example.test'}]});
  const view=await login(f);assert.equal(view.profile.company,'Manufacturing IT');assert.equal(view.profile.email,'user@example.test');
  assert(!JSON.stringify(view).includes('TOKEN'));assert(!JSON.stringify(view).includes('device_code'));
  const missing=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},{...profile,company:null,email:'<invalid@example.test>'}]});
  const other=await login(missing);assert(!Object.hasOwn(other.profile,'company'));assert(!Object.hasOwn(other.profile,'email'));
});

test('profile display fields are bounded and copied only from verified GHES identity',async()=>{
  const f=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},{...profile,bio:'  업무 소개  ',location:'  서울  ',company:'개발팀',email:'user@example.test',token:'PRIVATE'}]});
  const value=(await login(f)).profile;
  assert.equal(value.bio,'업무 소개');assert.equal(value.location,'서울');assert.equal(value.company,'개발팀');assert.equal(value.email,'user@example.test');assert.equal(value.token,undefined);
});

test('profile photo follows only same-company redirects with a bounded thumbnail request',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
 const f=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},{...profile,avatar_url:ORIGIN+'/avatars/42'},new Response(null,{status:302,headers:{location:'/avatars/42.png'}}),new Response(png,{headers:{'content-type':'image/png'}})]});
 assert.match((await login(f)).profile.avatar,/^data:image\/png;base64,/);assert.equal(new URL(f.calls[3].url).searchParams.get('s'),'128');
 const external=fixture({responses:[device,{access_token:'TOKEN',token_type:'bearer'},{...profile,avatar_url:ORIGIN+'/avatars/42'},new Response(null,{status:302,headers:{location:'https://attacker.invalid/photo'}})]});
 assert.equal((await login(external)).profile.avatar,null);assert.equal(external.calls.length,4);
});
