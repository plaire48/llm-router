import assert from 'node:assert/strict';
import {officeProviders,publicProviderState} from '../runtime-src/nubi-providers.mjs';
import {startAgent} from '../runtime-src/agent.ts';
import {nubiTransport} from '../runtime-src/nubi-transport.ts';
import {claudeEnvironment,decodeClaudeResult} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-code.mjs';
import {claudeAuthorizationUrl} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-login.mjs';
async function main(){
 let authenticated=false,turn=0,logins=0;const vault=new Map(),calls=[];
 const run=async(binary,args,options={})=>{
  calls.push(args);assert.equal(binary,'fixture-claude');
  if(args[0]==='--help')return '--safe-mode --json-schema';
  if(args[0]==='auth')return JSON.stringify({loggedIn:authenticated});
  assert.ok(args.includes('--safe-mode'));assert.equal(args[args.indexOf('--disallowedTools')+1],'mcp__*');assert.equal(args[args.indexOf('--tools')+1],'');
  assert.equal(args[args.indexOf('--mcp-config')+1],'{"mcpServers":{}}');
  assert.ok(args.includes('--no-session-persistence'));assert.ok(args.includes('--disable-slash-commands'));
  if(args.includes('--input-format')){
   const request=JSON.parse(options.input);
   options.onEvent({type:'control_response',response:{request_id:request.request_id,subtype:'success',response:{models:[{value:'sonnet',resolvedModel:'claude-sonnet-fixture',displayName:'Sonnet fixture',supportsEffort:true,supportedEffortLevels:['low','medium','high']},{value:'opus',resolvedModel:'claude-opus-fixture',displayName:'Opus fixture',supportsEffort:true,supportedEffortLevels:['medium','high','max']}]}}});return '';
  }
  assert.ok(args.includes('--json-schema'));assert.equal(args[args.indexOf('--model')+1],'claude-opus-fixture');
  const prompt=JSON.parse(options.input);assert.ok(prompt.hostActionCatalog.some(t=>t.function.name==='read_selection'));
  const tool=turn++===0;
  options.onEvent({type:'result',subtype:'success',structured_output:{content:tool?'표를 읽겠습니다.':'Claude로 선택한 범위를 확인했습니다.',calls:tool?[{name:'read_selection',arguments:'{}'}]:[]},usage:{input_tokens:12,output_tokens:3}});return '';
 };
 const providers=officeProviders(async(k,v)=>{if(v==null)vault.delete(k);else vault.set(k,v);},{run,findBinary:async()=> 'fixture-claude',startClaudeLogin:async()=>{logins++;authenticated=true;}});
 await providers.login('claude');for(let i=0;i<30&&providers.status().pending;i++)await new Promise(r=>setTimeout(r,1));
 await providers.flushConnections();assert.equal(logins,1);assert.equal(providers.status().provider,'claude');assert.equal(providers.status().models.length,2);
 await providers.model('claude-opus-fixture');await providers.reasoning('max');await providers.flushConnections();
 assert.deepEqual(Object.keys(vault.get('provider:claude')).sort(),['model','provider','reasoningEffort','version']);
 assert.equal(publicProviderState(providers).reasoningEffort,'max');
 const native=[];const agent=startAgent({transport:nubiTransport(providers),request:'표를 읽어줘',context:{documentId:'fixture'},native:async name=>{native.push(name);return {snapshotId:'fixture',cells:[]};},event:()=>{}});
 assert.equal((await agent.result).text,'Claude로 선택한 범위를 확인했습니다.');assert.deepEqual(native,['read_selection']);assert.equal(turn,2);
 assert.throws(()=>decodeClaudeResult({subtype:'success',structured_output:{content:'',calls:[{name:'Bash',arguments:'{}'}]}},[]),/claude_response_invalid/);
 assert.equal(claudeEnvironment({ANTHROPIC_API_KEY:'secret',CLAUDE_CONFIG_DIR:'secret',PATH:'bin'}).ANTHROPIC_API_KEY,undefined);
 assert.equal(claudeAuthorizationUrl('https://example.com/oauth?redirect_uri=http://localhost:123/callback&state=s&code_challenge=c'),null);
 const restored=officeProviders(async()=>{},{run,findBinary:async()=> 'fixture-claude'});await restored.restoreConnections([vault.get('provider:claude')],'claude');assert.equal(restored.status().model,'claude-opus-fixture');
 await providers.disconnect('claude');assert.equal(providers.status().connected,false);assert.equal(vault.has('provider:claude'),false);
 providers.dispose();restored.dispose();
 console.log('PASS Nubi Claude login/catalog/model/effort/metadata restore → GenOffice tool loop; CLI tools/MCP disabled, unknown proposals rejected, no credential extraction (mock CLI).');
}
main().catch(error=>{console.error(error);process.exit(1);});
