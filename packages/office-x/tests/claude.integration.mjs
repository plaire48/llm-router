import assert from 'node:assert/strict';
import {officeProviders,publicProviderState} from '../runtime-src/nubi-providers.mjs';
import {startAgent} from '../runtime-src/agent.ts';
import {nubiTransport} from '../runtime-src/nubi-transport.ts';
import {claudeEnvironment,decodeClaudeResult} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-code.mjs';
import {claudeAuthorizationUrl} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-login.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
async function launcherIntegration(){
 const directory=await mkdtemp(path.join(tmpdir(),'office-claude-integration-'));
 const file=path.join(directory,'cli.cjs'),auth=path.join(directory,'authenticated');
 let providers,restored;
 try{
  await writeFile(file,`const fs=require('node:fs');const args=process.argv.slice(2);
if(args[0]==='--help'){console.log('--safe-mode --json-schema');return;}
if(args[0]==='auth'&&args[1]==='status'){console.log(JSON.stringify({loggedIn:fs.existsSync(process.env.OFFICEX_TEST_AUTH_FILE)}));return;}
if(args[0]==='auth'&&args[1]==='login'){
 fs.writeFileSync(process.env.NUBI_CLAUDE_AUTH_CAPTURE,'https://claude.ai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A12345%2Fcallback&state=fixture&code_challenge=fixture');
 setTimeout(()=>fs.writeFileSync(process.env.OFFICEX_TEST_AUTH_FILE,'signed-in fixture'),300);return;
}
if(!args.includes('--safe-mode')||!args.includes('--disallowedTools')||args[args.indexOf('--tools')+1]!==''){process.exit(1);}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
 if(args.includes('--input-format')){const request=JSON.parse(input);console.log(JSON.stringify({type:'control_response',response:{request_id:request.request_id,subtype:'success',response:{models:[{value:'sonnet',resolvedModel:'fixture-sonnet',displayName:'Fixture Sonnet'}]}}}));return;}
 const schema=JSON.parse(args[args.indexOf('--json-schema')+1]);if(!schema.properties.calls){process.exit(1);}
 console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{content:'실제 자식 프로세스 연결 확인',calls:[]}}));
});`);
  const launch={kind:'native',file:process.execPath,prefixArgs:[file],environment:{OFFICEX_TEST_AUTH_FILE:auth}},records=new Map();let opened=0;
  providers=officeProviders(async(key,value)=>records.set(key,value),{findBinary:async()=>launch,openBrowser:async()=>{opened++;return {external:true};}});
  await providers.login('claude');const started=Date.now();
  while(providers.status().pending&&Date.now()-started<10000)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(providers.status().connected,true,providers.status().loginError);assert.equal(opened,1);
  await providers.flushConnections();
  assert.equal((await providers.complete([{role:'user',content:'한글과 JSON 인자 확인'}])).content,'실제 자식 프로세스 연결 확인');
  restored=officeProviders(async()=>{},{findBinary:async()=>launch});
  await restored.restoreConnections([records.get('provider:claude')],'claude');assert.equal(restored.status().connected,true);
  console.log('PASS real child-process fixture: Office launcher → CLI-owned login capture → auth status → model discovery → JSON completion → reconnect. No real account/network.');
 }finally{providers?.dispose();restored?.dispose();await rm(directory,{recursive:true,force:true});}
}
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
 await launcherIntegration();
 console.log('PASS Nubi Claude login/catalog/model/effort/metadata restore → GenOffice tool loop; CLI tools/MCP disabled, unknown proposals rejected, no credential extraction (mock CLI).');
}
main().catch(error=>{console.error(error);process.exit(1);});
