import {it,expect,vi} from 'vitest';
// @ts-expect-error Office connection adapter
import {restoreManualConnection,refreshCatalog,providerCommandError,loginCatalogFetch} from '../runtime-src/provider-connection.mjs';
// @ts-expect-error Office UI helper
import {providerCommandMessage} from '../ui/provider-command-errors.js';
// @ts-expect-error Nubi provider adapter
import {officeProviders} from '../runtime-src/nubi-providers.mjs';

it('restores a saved login after a transient model lookup without starting OAuth or losing the record',async()=>{
 let calls=0;const browser=vi.fn(),persist=vi.fn();
 const providers=officeProviders(persist,{openBrowser:browser,fetchImpl:async()=>{if(calls++===0)throw Object.assign(Error('fetch failed'),{cause:{code:'ECONNRESET'}});return Response.json({modelList:[{name:'fixture-a'}]});}});
 const token='fixture.'+Buffer.from(JSON.stringify({sub:'fixture',exp:Date.now()/1000+3600})).toString('base64url')+'.fixture';
 const record={version:1,provider:'aipro',credential:{token,mode:'browser'},model:'fixture-a'};
 const result=await restoreManualConnection(providers,record,'aipro',{sleep:async()=>{}});
 expect(result.connected).toBe(true);expect(result.model).toBe('fixture-a');expect(result.loginError).toBeNull();expect(calls).toBe(2);expect(browser).not.toHaveBeenCalled();expect(record.credential.token).toBe(token);providers.dispose();
});
it('bounds transient restore retries and preserves a classified error for the next manual click',async()=>{
 const restoreConnections=vi.fn(),cancelLogin=vi.fn();const provider={restoreConnections,cancelLogin,status:()=>({provider:'aipro',connected:false,loginError:'network_timeout'})};
 await expect(restoreManualConnection(provider,{provider:'aipro'},'aipro',{sleep:async()=>{}})).rejects.toThrow('network_timeout');expect(restoreConnections).toHaveBeenCalledTimes(2);expect(cancelLogin).not.toHaveBeenCalled();
});
it('does not retry certificate or auth rejection and never resumes a cancelled restore',async()=>{
 for(const code of ['tls_untrusted','unauthorized']){const restoreConnections=vi.fn();const p={restoreConnections,status:()=>({connected:false,loginError:code})};const work=restoreManualConnection(p,{},'aipro',{sleep:async()=>{}});if(code==='unauthorized')expect(await work).toBeNull();else await expect(work).rejects.toThrow(code);expect(restoreConnections).toHaveBeenCalledOnce();}
 let cancelled=false;const restoreConnections=vi.fn(async()=>{cancelled=true;});await expect(restoreManualConnection({restoreConnections,status:()=>({connected:true,provider:'aipro'})},{},'aipro',{cancelled:()=>cancelled})).rejects.toThrow('cancelled');expect(restoreConnections).toHaveBeenCalledOnce();
});
it('retries only transient catalog reads once and leaves permanent errors intact',async()=>{
 const work=vi.fn().mockRejectedValueOnce(Object.assign(Error('socket'),{code:'ECONNRESET'})).mockResolvedValue('catalog');expect(await refreshCatalog(work,{sleep:async()=>{}})).toBe('catalog');expect(work).toHaveBeenCalledTimes(2);
 const denied=vi.fn().mockRejectedValue(Object.assign(Error('unauthorized'),{status:401}));await expect(refreshCatalog(denied,{sleep:async()=>{}})).rejects.toThrow('unauthorized');expect(denied).toHaveBeenCalledOnce();
});
it('retains safe login reasons and keeps unrelated setting errors distinct from connection failures',()=>{
 expect(providerCommandError('login',Object.assign(Error('private token'),{cause:{code:'ECONNRESET'}}))).toBe('network_error');expect(providerCommandError('login',Error('private token'))).toBe('connection_failed');expect(providerCommandError('reasoning',Error('invalid_reasoning_effort'))).toBe('invalid_reasoning_effort');expect(providerCommandError('model',Error('private token'))).toBe('model_selection_failed');
 expect(providerCommandMessage('connection_failed','refreshModels')).toContain('모델 목록 조회');expect(providerCommandMessage('invalid_reasoning_effort','reasoning')).toContain('추론 설정');expect(providerCommandMessage('network_timeout','login')).toContain('서버 응답 시간');
});
it('retries only the initial login model GET and never repeats the OAuth exchange',async()=>{
 const read=vi.fn().mockRejectedValueOnce(Object.assign(Error('socket'),{code:'ECONNRESET'})).mockResolvedValue(Response.json({modelList:[]}));await loginCatalogFetch(read,'https://fixture.test')('https://fixture.test/api/models');expect(read).toHaveBeenCalledTimes(2);
 const exchange=vi.fn().mockRejectedValue(Object.assign(Error('socket'),{code:'ECONNRESET'}));await expect(loginCatalogFetch(exchange,'https://fixture.test')('https://fixture.test/oauth/exchange',{method:'POST'})).rejects.toThrow('socket');expect(exchange).toHaveBeenCalledOnce();
 const cancelled=vi.fn();await expect(loginCatalogFetch(cancelled,'https://fixture.test')('https://fixture.test/api/models',{signal:AbortSignal.abort()})).rejects.toThrow('cancelled');expect(cancelled).not.toHaveBeenCalled();
});
it('does not replay ChatGPT token renewal when restoring a saved account',async()=>{const restoreConnections=vi.fn();await expect(restoreManualConnection({restoreConnections,status:()=>({connected:false,loginError:'network_error'})},{},'chatgpt')).rejects.toThrow('network_error');expect(restoreConnections).toHaveBeenCalledOnce();});
it('restores the requested non-Claude account even while Claude was previously active',async()=>{
 let restored=false;const base={status:()=>({provider:'aipro',connected:restored,providers:[],model:'fixture-a',loginError:null}),restoreConnections:async()=>{restored=true;},select:async()=>{},cancelLogin:()=>{}};
 const p=officeProviders(async()=>{},{createBase:()=>base,createClaude:()=>({status:()=>({provider:'claude',connected:true,models:[],model:'sonnet'})})});
 await p.select('claude');expect(p.status().provider).toBe('claude');const state=await restoreManualConnection(p,{provider:'aipro'},'aipro');expect(state.provider).toBe('aipro');expect(p.status().provider).toBe('aipro');expect(state.connected).toBe(true);
});
it('keeps an earlier Claude diagnostic from replacing another provider login error',async()=>{
 const base={status:()=>({provider:'aipro',connected:false,providers:[],loginError:'tls_untrusted'})};
 const p=officeProviders(async()=>{},{createBase:()=>base,createClaude:()=>({status:()=>({provider:'claude',connected:false}),connect:async()=>{throw Error('claude_cli_update');}})});
 await expect(p.connect({provider:'claude'})).rejects.toThrow('claude_cli_update');expect(p.status().loginError).toBe('tls_untrusted');
});
