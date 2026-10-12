const ORIGIN='https://code.sdsdev.co.kr';
const CLIENT_ID='Iv1.8526278f12b92180';
const SECRET_KEY='nubi.ghes.code.sdsdev.co.kr';
const error=code=>{throw Error(code);};
const active=signal=>{if(signal?.aborted)error('ghes_cancelled');};
const validToken=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\s\x00-\x1f]/.test(value);
const safeUrl=value=>{try{const u=new URL(value);return u.origin===ORIGIN&&!u.username&&!u.password?u:null;}catch{return null;}};
async function bounded(response,limit){
  const chunks=[];let size=0;
  if(!response.body)error('ghes_response_invalid');
  try{for await(const chunk of response.body){size+=chunk.length;if(size>limit)error('ghes_response_limit');chunks.push(Buffer.from(chunk));}}catch(e){if(e.message.startsWith('ghes_'))throw e;error('ghes_network');}
  return Buffer.concat(chunks);
}
function requestStage(route){
  if(route==='/login/device/code')return 'device_code';
  if(route==='/login/oauth/access_token')return 'authorization';
  if(route==='/api/v3/user')return 'identity';
  if(route.startsWith('/api/v3/repos/')||route.startsWith('/api/v3/user/installations'))return 'repositories';
  return 'request';
}
const loginErrors={incorrect_client_credentials:'ghes_app_configuration',device_flow_disabled:'ghes_device_disabled',access_denied:'ghes_access_denied',expired_token:'ghes_device_expired',bad_verification_code:'ghes_device_expired'};
function httpError(response,route=''){
  if(response.status===401)error('ghes_session_expired');
  if(response.status===403&&response.headers.get('x-github-sso'))error('ghes_sso_required');
  if(response.status===429||response.status===403&&response.headers.get('x-ratelimit-remaining')==='0')error('ghes_rate_limited');
  if(response.status===403)error('ghes_permission');
  if(response.status===404){
    const stage=requestStage(route);
    error(['device_code','authorization'].includes(stage)?'ghes_login_endpoint_unavailable':stage==='identity'?'ghes_identity_unavailable':stage==='repositories'?'ghes_repository_missing':'ghes_resource_missing');
  }
  if(!response.ok)error('ghes_network');
}
function wait(ms,signal){return new Promise((resolve,reject)=>{
  active(signal);const cancel=()=>{clearTimeout(timer);reject(Error('ghes_cancelled'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
  signal?.addEventListener('abort',cancel,{once:true});
});}

// E2E Report's Device Flow and verified /user identity, adapted to the native host.
// SAML belongs to the GHES browser login. No password, assertion or client secret
// enters this host, the webview, project state or model messages.
class GhesAccount {
  constructor({secrets,openExternal,copyCode,clientId=CLIENT_ID,fetcher=fetch,waiter=wait,now=Date.now,onInvalidated=async()=>{}}){
    this.secrets=secrets;this.openExternal=openExternal;this.clientId=clientId;this.fetcher=fetcher;this.waiter=waiter;this.now=now;this.onInvalidated=onInvalidated;
    this.state='guest';this.generation=0;this.loaded=false;this.writes=Promise.resolve();this.accessController=new AbortController();
    this.copyCode=copyCode;
  }
  view(){return {host:ORIGIN,state:this.state,connected:this.state==='connected',profile:this.profile||null,device:this.device||null,error:this.failure||null,diagnostic:this.failureDiagnostic||null};}
  write(fn){const next=this.writes.then(fn,fn);this.writes=next.catch(()=>{});return next;}
  async request(route,{token,signal,body,limit=1024*1024,accept='application/vnd.github+json',allowRedirect=false}={}){
    let url=safeUrl(ORIGIN+route);if(!url||!route.startsWith('/')||route.startsWith('//'))error('ghes_url_invalid');
    if(token&&token===this.record?.token)signal=AbortSignal.any([...(signal?[signal]:[]),this.accessController.signal]);
    active(signal);let response;
    for(let redirects=0;;redirects++){
      try{response=await this.fetcher(url.href,{method:body?'POST':'GET',redirect:allowRedirect?'manual':'error',cache:'no-store',credentials:'omit',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)]),headers:{Accept:accept,'X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
      catch{active(signal);error('ghes_network');}
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('location');let next;
      try{next=location&&safeUrl(new URL(location,url).href);}catch{}
      await response.body?.cancel();
      if(!allowRedirect||body||!next||redirects>=2)error('ghes_redirect_refused');url=next;
    }
    active(signal);
    // Login endpoints may return OAuth errors with HTTP 400. Read only a fixed
    // error code; never expose the server body, callback values or credentials.
    const stage=requestStage(route),loginRequest=['device_code','authorization'].includes(stage);
    let bytes,data;
    try{
      if(loginRequest){
        bytes=await bounded(response,limit);active(signal);
        try{data=JSON.parse(bytes.toString('utf8'));}catch{}
        const code=typeof data?.error==='string'&&Object.hasOwn(loginErrors,data.error)?loginErrors[data.error]:null;
        if(code)error(code);
      }
      httpError(response,route);
    }catch(e){
      e.diagnostic={stage,status:response.status};throw e;
    }
    bytes??=await bounded(response,limit);active(signal);
    if(accept==='application/octet-stream')return bytes;
    try{return JSON.parse(bytes.toString('utf8'));}catch{error('ghes_response_invalid');}
  }
  async identity(record,signal){
    const value=await this.request('/api/v3/user',{token:record.token,signal});
    if(!Number.isSafeInteger(value.id)||value.id<=0||typeof value.login!=='string'||!value.login||value.login.length>100)error('ghes_identity_invalid');
    const name=typeof value.name==='string'?value.name.trim().slice(0,200):'';
    const url=safeUrl(value.html_url),avatar=safeUrl(value.avatar_url);
    const company=typeof value.company==='string'?value.company.trim().slice(0,200):'';
    const email=typeof value.email==='string'&&value.email.length<=254&&/^[^\s@<>]+@[^\s@<>]+$/.test(value.email)?value.email:null;
    const bio=typeof value.bio==='string'?value.bio.trim().slice(0,500):'';
    const location=typeof value.location==='string'?value.location.trim().slice(0,200):'';
    return {id:value.id,login:value.login,name:name||value.login,...(bio?{bio}:{}),...(location?{location}:{}),...(company?{company}:{}),...(email?{email}:{}),...(url?{url:url.href}:{}),avatar:avatar?await this.avatar(avatar,record.token,signal):null};
  }
  async avatar(url,token,signal){
    // Protected company avatars become bounded image bytes. External avatar URLs
    // fall back to the person glyph; never send a GHES token to Gravatar/CDNs.
    try{
      const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(5000)]);
      let target=new URL(url.href),response;target.searchParams.set('s','128');
      for(let redirects=0;;redirects++){
        response=await this.fetcher(target.href,{redirect:'manual',cache:'no-store',credentials:'omit',headers:{Authorization:'Bearer '+token},signal:deadline});
        if(![301,302,303,307,308].includes(response.status))break;
        const location=response.headers.get('location'),next=location&&safeUrl(new URL(location,target).href);
        await response.body?.cancel();
        if(!next||redirects>=2)return null;target=next;
      }
      if(!response.ok)return null;const bytes=await bounded(response,256*1024),mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      const valid=mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255||mime==='image/gif'&&/^GIF8[79]a$/.test(bytes.subarray(0,6).toString())||mime==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
      return valid?'data:'+mime+';base64,'+bytes.toString('base64'):null;
    }catch{return null;}
  }
  async invalidate(code='ghes_session_expired'){
    ++this.generation;this.controller?.abort();this.accessController.abort();this.record=null;this.profile=null;this.device=null;this.failure=code;this.failureDiagnostic=null;this.state='guest';
    await this.write(()=>this.secrets.delete(SECRET_KEY));await this.onInvalidated();
  }
  async restore(){
    if(this.loaded)return;this.loaded=true;const generation=this.generation;
    const stored=await this.secrets.get(SECRET_KEY);if(generation!==this.generation)return;
    if(!stored)return;
    try{
      const record=JSON.parse(stored);
      if(record.host!==ORIGIN||record.clientId!==this.clientId||!validToken(record.token)||record.expiresAt&&(!Number.isFinite(record.expiresAt)||record.expiresAt<=this.now()))error('ghes_session_expired');
      const profile=await this.identity(record);if(generation!==this.generation)return;
      this.accessController=new AbortController();this.record=record;this.profile=profile;this.state='connected';this.failure=null;this.failureDiagnostic=null;
    }catch(e){
      if(generation!==this.generation)return;
      if(e.message==='ghes_session_expired'){await this.invalidate();return;}
      this.state='attention';this.failure=e.message.startsWith('ghes_')?e.message:'ghes_storage';this.failureDiagnostic=e.diagnostic||null;
    }
  }
  async status(){this.restoring??=this.restore().finally(()=>{this.restoring=null;});await this.restoring;
    if(this.record?.expiresAt&&this.record.expiresAt<=this.now())await this.invalidate();return this.view();}
  login(){if(this.loginStarting)return this.loginStarting;this.loginStarting=this.startLogin().finally(()=>{this.loginStarting=null;});return this.loginStarting;}
  async startLogin(){
    if(this.state==='connecting')return this.view();
    if(typeof this.clientId!=='string'||!/^\w[\w.-]{3,100}$/.test(this.clientId))error('ghes_app_configuration');
    await this.invalidate(null);this.loaded=true;
    const generation=++this.generation,controller=this.controller=new AbortController();this.state='connecting';this.failure=null;
    this.authorization=this.authorize(generation,controller.signal).catch(async e=>{
      if(generation!==this.generation)return;
      this.device=null;this.state='guest';this.failure=e.message.startsWith('ghes_')?e.message:'ghes_login_failed';this.failureDiagnostic=e.diagnostic||null;
    });
    return this.view();
  }
  async authorize(generation,signal){
    const device=await this.request('/login/device/code',{signal,body:{client_id:this.clientId},accept:'application/json'});
    if(device.error)error(device.error==='incorrect_client_credentials'?'ghes_app_configuration':'ghes_device_unavailable');
    const uri=safeUrl(device.verification_uri||ORIGIN+'/login/device');
    if(!uri||uri.pathname!=='/login/device'||uri.search||uri.hash||!validToken(device.device_code)||!/^[-A-Z0-9]{4,20}$/.test(device.user_code||'')||!Number.isFinite(device.expires_in)||device.expires_in<=0||device.expires_in>1800)error('ghes_device_invalid');
    const expiresAt=this.now()+device.expires_in*1000;let interval=Math.max(5,Number(device.interval)||5);if(!Number.isFinite(interval)||interval>1800)error('ghes_device_invalid');
    active(signal);this.device={code:device.user_code,uri:uri.href,expiresAt};
    if(!await this.openExternal(uri.href))error('ghes_browser_unavailable');active(signal);
    while(this.now()<expiresAt){
      await this.waiter(Math.min(interval*1000,expiresAt-this.now()),signal);active(signal);if(this.now()>=expiresAt)break;
      const data=await this.request('/login/oauth/access_token',{signal,body:{client_id:this.clientId,device_code:device.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'},accept:'application/json'});
      if(this.now()>=expiresAt)break;
      if(data.access_token){
        if(!validToken(data.access_token)||data.token_type!=='bearer'||data.expires_in!==undefined&&(!Number.isFinite(data.expires_in)||data.expires_in<=0))error('ghes_response_invalid');
        const record={host:ORIGIN,clientId:this.clientId,token:data.access_token,...(data.expires_in?{expiresAt:this.now()+data.expires_in*1000}:{})};
        const profile=await this.identity(record,signal);active(signal);if(generation!==this.generation)return;
        // Refresh requires a client secret on GHES. Desktop keeps no client secret;
        // expired/revoked tokens use the same company login flow again.
        this.accessController=new AbortController();this.record=record;
        await this.write(async()=>{active(signal);if(generation===this.generation)await this.secrets.store(SECRET_KEY,JSON.stringify(record));});
        active(signal);if(generation!==this.generation)return;
        this.profile=profile;this.device=null;this.state='connected';return;
      }
      if(data.error==='authorization_pending')continue;
      if(data.error==='slow_down'){interval+=5;continue;}
      if(data.error==='expired_token')break;
      error(data.error==='access_denied'?'ghes_access_denied':data.error==='incorrect_client_credentials'?'ghes_app_configuration':'ghes_login_failed');
    }
    error('ghes_device_expired');
  }
  async logout(){await this.invalidate(null);this.loaded=true;return this.view();}
  async credential(){
    await this.status();if(this.state!=='connected'||!this.record)error('ghes_login_required');
    const generation=this.generation,record=this.record;
    try{const profile=await this.identity(record);if(generation!==this.generation)error('ghes_session_changed');if(profile.id!==this.profile.id)error('ghes_identity_changed');this.profile=profile;return {token:record.token,generation,userId:profile.id};}
    catch(e){if(generation===this.generation&&['ghes_session_expired','ghes_identity_changed'].includes(e.message))await this.invalidate(e.message);throw e;}
  }
  async json(route){const credential=await this.credential();const result=await this.request('/api/v3'+route,{token:credential.token});if(credential.generation!==this.generation)error('ghes_session_changed');return result;}
  async action(operation){
    if(operation==='status')return this.status();if(operation==='login')return this.login();if(operation==='logout'||operation==='cancel')return this.logout();
    if(operation==='retry'){this.loaded=false;return this.status();}
    if(operation==='browser'){const uri=this.device?.uri||ORIGIN+'/login';if(!safeUrl(uri))error('ghes_url_invalid');await this.openExternal(uri);return this.view();}
    if(operation==='profile'){if(!this.profile?.url)error('ghes_login_required');await this.openExternal(this.profile.url);return this.view();}
    if(operation==='refresh'){await this.credential();return this.view();}
    if(operation==='copy'){if(!this.device?.code||!this.copyCode)error('ghes_device_expired');await this.copyCode(this.device.code);return this.view();}
    error('method_invalid');
  }
  dispose(){++this.generation;this.controller?.abort();this.accessController.abort();this.record=null;this.profile=null;}
}
module.exports={GhesAccount,ORIGIN,CLIENT_ID,SECRET_KEY,safeUrl,bounded,httpError,validToken};
