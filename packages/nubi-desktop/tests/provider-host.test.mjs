import test from 'node:test';
import assert from 'node:assert/strict';
import {startLogin} from '../../nubi-office/worker/aipro-auth.mjs';
import {createProviders} from '../../nubi-office/worker/providers.mjs';
test('shared login callback uses the desktop host while Office default and label allowlist remain intact',async()=>{
  for(const [hostLabel,expected]of [['누비 워크스페이스','누비 워크스페이스'],[undefined,'Excel'],['<script>fixture</script>','Excel']]){
    let html='';const flow=await startLogin({hostLabel,timeoutMs:3000,fetchImpl:async()=>Response.json({ok:false},{status:401}),openBrowser:async url=>{
      const port=new URL(url).searchParams.get('port');html=await(await fetch(`http://127.0.0.1:${port}/auth?status=00&code=fixture-code`)).text();
    }});
    await assert.rejects(flow.result);assert(html.includes(expected==='누비 워크스페이스'?'누비 Workspace':'누비 Office'));assert(html.includes('누비 새 캐릭터'));assert(html.includes('font-face'));assert(!html.includes('<script>'));
  }
});
test('provider login forwards host identity to both official login adapters',async()=>{
  for(const provider of ['aipro','chatgpt']){
    let received;const adapter=async options=>{received=options.hostLabel;return {result:new Promise(()=>{}),cancel(){}};};
    const providers=createProviders({hostLabel:'누비 워크스페이스',startLogin:adapter,chatGPTLogin:adapter});
    await providers.login(provider);assert.equal(received,'누비 워크스페이스');providers.dispose();
  }
});
