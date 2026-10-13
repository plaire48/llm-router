import {safeError} from '../vendor/nubi/packages/nubi-office/worker/connection-errors.mjs';
const transient=new Set(['network_error','network_timeout','network_dns','network_refused','upstream']);
const authErrors=new Set(['unauthorized','forbidden','no_credential','credential_expired','refresh_failed','invalid_credentials','claude_login_required']);
const exposed=new Set([...transient,...authErrors,'worker_busy','provider_initializing','connection_timeout','login_busy','login_timeout','login_port_busy','login_browser_failed','browser_unavailable','aipro_login_failed','rate_limited','system_ca_unavailable','claude_cli_missing','claude_cli_failed','claude_cli_timeout','claude_cli_update','claude_response_invalid','claude_login_failed','tls_untrusted','tls_expired','tls_hostname','models_invalid','response_json_invalid','invalid_model','invalid_reasoning_effort','storage_failed','cancelled']);
export function providerCommandError(method,error){
 const code=safeError(error);if(exposed.has(code))return code;
 return ({refreshModels:'models_refresh_failed',model:'model_selection_failed',select:'model_selection_failed',reasoning:'reasoning_update_failed',disconnect:'disconnect_failed',cancelLogin:'login_cancel_failed'})[method]||'connection_failed';
}
// This retries only reading the saved connection/model catalog. It never starts
// another OAuth flow or replays model requests, native edits or document writes.
export async function restoreManualConnection(providers,record,provider,{cancelled=()=>false,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const check=()=>{if(cancelled())throw Error('cancelled');};
 for(let attempt=0;attempt<2;attempt++){
  check();const restored=await providers.restoreConnections([record],provider);check();const state=restored||providers.status();
  if(state.connected&&state.provider===provider){if(!state.pending)providers.cancelLogin();return providers.status();}
  if(!state.loginError)return null;
  const code=providerCommandError('login',Error(state.loginError));
  if(authErrors.has(code))return null;
  // ChatGPT restoration can renew a refresh token before reading the catalog.
  // Its catalog reader handles retries; never replay that whole auth sequence.
  if(provider!=='chatgpt'&&attempt===0&&transient.has(code)){await sleep(350);continue;}
  throw Error(code);
 }
}
export async function refreshCatalog(work,{sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 try{return await work();}catch(error){
  const code=safeError(error),status=error?.status;
  if(!transient.has(code)&&![502,503,504].includes(status))throw error;
  await sleep(350);return work();
 }
}
export function loginCatalogFetch(fetchImpl,origin){
 return (url,options={})=>{
  let target;try{target=new URL(url);}catch{return fetchImpl(url,options);}
  if(target.origin!==origin||target.pathname!=='/api/models'||options.method&&options.method!=='GET')return fetchImpl(url,options);
  return refreshCatalog(async()=>{
   if(options.signal?.aborted)throw Error('cancelled');
   const response=await fetchImpl(url,options);
   if([502,503,504].includes(response.status)){await response.body?.cancel();throw Object.assign(Error('upstream'),{status:response.status});}
   return response;
  });
 };
}
