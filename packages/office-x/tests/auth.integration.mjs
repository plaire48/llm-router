import assert from 'node:assert/strict';
import {officeProviders,publicProviderState} from '../runtime-src/nubi-providers.mjs';
import {startLogin} from '../vendor/nubi/packages/nubi-office/worker/aipro-auth.mjs';
async function main(){
const jwt='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'fixture',exp:Date.now()/1000+3600})).toString('base64url')+'.fixture';
const records=new Map();let loginUrl;const phases=[];
const fakeFetch=async(url,options)=>{
  if(String(url).endsWith('/auth/exchange')){assert.equal(options.redirect,'error');return Response.json({token:jwt});}
  if(String(url).endsWith('/api/models'))return Response.json({modelList:[{name:'fixture-a',context_length:128000},{name:'fixture-b',context_length:262144}]});
  throw Error('unexpected_network');
};
// Exercise the original login callback HTTP server with fake upstream exchange/catalog.
const flow=await startLogin({openBrowser:async url=>{loginUrl=url;},fetchImpl:fakeFetch,onProgress:e=>phases.push(e.phase)});
try{
 const port=new URL(loginUrl).searchParams.get('port');
 const invalid=await fetch(`http://127.0.0.1:${port}/auth?code=fixture&status=bad`);assert.equal(invalid.status,400);
 const callback=fetch(`http://127.0.0.1:${port}/auth?code=fixture&status=00`);
 const result=await flow.result;const response=await callback;assert.equal(response.status,200);assert.equal(result.models.length,2);
 assert.ok(!(await response.text()).includes(jwt));assert.ok(phases.includes('exchanging'));assert.ok(phases.includes('loading_models'));
}finally{flow.cancel();}
let resolveLogin;let cancelled=false;
const provider=officeProviders(async(key,value)=>{if(value==null)records.delete(key);else records.set(key,value);},{fetchImpl:fakeFetch,startLogin:async()=>({result:new Promise(resolve=>{resolveLogin=resolve;}),cancel:()=>{cancelled=true;}})});
await provider.login('aipro');assert.equal(provider.status().pending,'aipro');provider.cancelLogin();assert.ok(cancelled);
resolveLogin({token:jwt,models:[{id:'late'}]});await new Promise(r=>setTimeout(r,0));assert.equal(provider.status().connected,false);
await provider.login('aipro');resolveLogin({token:jwt,models:[{id:'fixture-a',label:'A'},{id:'fixture-b',label:'B'}]});await new Promise(r=>setTimeout(r,0));await provider.flushConnections();
assert.equal(provider.status().connected,true);assert.equal(provider.status().models.length,2);assert.ok(!JSON.stringify(publicProviderState(provider)).includes(jwt));
provider.model('fixture-b');provider.reasoning('xhigh');await provider.flushConnections();assert.equal(records.get('provider:aipro').model,'fixture-b');
const restored=officeProviders(async()=>{},{fetchImpl:fakeFetch});await restored.restoreConnections([records.get('provider:aipro')],'aipro');assert.equal(restored.status().model,'fixture-b');assert.equal(restored.status().reasoningEffort,'xhigh');
provider.disconnect('aipro');await provider.flushConnections();assert.equal(records.has('provider:aipro'),false);
provider.dispose();restored.dispose();
const failed=officeProviders(async()=>{throw Error('DPAPI unavailable');},{startLogin:async()=>({result:Promise.resolve({token:jwt,models:[{id:'fixture-a'}]}),cancel:()=>{}})});
await failed.login('aipro');await new Promise(r=>setTimeout(r,0));await failed.flushConnections();assert.equal(failed.status().persistenceError,'connection_not_saved');assert.equal(failed.status().connected,true);failed.dispose();
console.log('PASS original Nubi callback, invalid callback, exchange/catalog, cancel race, model/reasoning selection, restore, logout, vault failure and credential redaction (fixture services).');

}
main().catch(error=>{console.error(error);process.exit(1);});
