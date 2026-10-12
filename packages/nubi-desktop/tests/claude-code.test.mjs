import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createClaudeCode,claudeModels,claudeQuota,decodeClaudeResult,claudeEnvironment,runClaude} from '../runtime/claude-code.mjs';
import {createDesktopProviders} from '../runtime/desktop-providers.mjs';
import {DesktopUsage} from '../runtime/usage.mjs';

const catalog=[{value:'sonnet',resolvedModel:'claude-sonnet-5-5',displayName:'Sonnet 5.5',supportsEffort:true,supportedEffortLevels:['low','medium','high']},{value:'opus',resolvedModel:'claude-opus-5-5',displayName:'Opus 5.5',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},{value:'haiku',resolvedModel:'claude-haiku-4-5',displayName:'Haiku 4.5'},{value:'fable',resolvedModel:'claude-fable-5-1',displayName:'Fable 5.1',supportsEffort:true,supportedEffortLevels:['high','max']}];
const result=(calls=[],usage)=>({type:'result',subtype:'success',structured_output:{content:calls.length?'':'확인했습니다.',calls},usage});
const tool={type:'function',function:{name:'source_search',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}}};
function fixture(final=result(),auth={loggedIn:true}){
  const invocations=[];
  const run=async(binary,args,options={})=>{invocations.push({binary,args,options});if(args[0]==='--help')return '--safe-mode --json-schema';if(args[0]==='auth')return JSON.stringify(auth);if(args.includes('--input-format')){options.onEvent({type:'control_response',response:{subtype:'success',request_id:JSON.parse(options.input).request_id,response:{models:catalog}}});return '';}options.onEvent({type:'rate_limit_event',rate_limit_info:{rateLimitType:'five_hour',utilization:.25,resetsAt:2000000000}});options.onEvent(final);return '';};
  return {run,invocations,findBinary:async()=>'/fixture/claude'};
}
test('Claude proposes Nubi tools with no CLI execution authority and uses stdin',async()=>{
  const f=fixture(result([{name:'source_search',arguments:'{"query":"auth"}'}]));const adapter=createClaudeCode(f);await adapter.connect();
  let activity=0;const answer=await adapter.complete([{role:'user',content:'인증 코드를 찾아줘'}],[tool],undefined,()=>{},()=>{},()=>activity++);
  assert.equal(answer.calls[0].function.name,'source_search');assert.equal(activity,2);
  const call=f.invocations.at(-1),args=call.args;assert.equal(args[args.indexOf('--tools')+1],'');assert(args.includes('--safe-mode'));assert(args.includes('--no-session-persistence'));assert(args.includes('--strict-mcp-config'));assert(!args.includes('--bare'));assert(!args.includes('--dangerously-skip-permissions'));assert(!args.join(' ').includes('인증 코드'));
  assert.match(call.options.input,/인증 코드를/);assert.equal(adapter.quota().windows[0].remaining,75);
});
test('missing CLI login and unsupported safe-mode fail before any model call',async()=>{
  const f=fixture(result(),{loggedIn:false}),adapter=createClaudeCode(f);await assert.rejects(adapter.connect(),/claude_login_required/);assert.equal(adapter.status().connected,false);assert.equal(f.invocations.length,2);
  await assert.rejects(createClaudeCode({findBinary:f.findBinary,run:async()=>''}).connect(),/claude_cli_update/);
});
test('native host proposals stop the inner CLI loop and return through Nubi approval boundaries',async()=>{
  const f=fixture(),usage=[],adapter=createClaudeCode({...f,onUsageFinish:(_id,value)=>usage.push(value),run:async(binary,args,options)=>{
    if(args[0]==='--help'||args[0]==='auth'||args.includes('--input-format'))return f.run(binary,args,options);
    assert.equal(args[args.indexOf('--max-turns')+1],'3');
    assert.equal(JSON.parse(options.input).hostActionCatalog[0].function.name,'source_search');
    options.onEvent({type:'assistant',message:{content:[{type:'tool_use',name:'source_search',input:{query:'auth'}}],usage:{input_tokens:12,output_tokens:3}}});
    assert.equal(options.signal.aborted,true,'no native tool-error retry loop');throw Error('cancelled');
  }});
  await adapter.connect();const answer=await adapter.complete([], [tool]);
  assert.equal(answer.content,'');assert.equal(answer.calls[0].function.name,'source_search');assert.deepEqual(JSON.parse(answer.calls[0].function.arguments),{query:'auth'});
  assert.equal(answer.usage.total_tokens,15);assert.equal(usage[0].total_tokens,15);
});
test('native unadvertised tools and user cancellation cannot become host proposals',async()=>{
  for(const name of ['Bash','source_search']){
    const controller=new AbortController(),f=fixture(),adapter=createClaudeCode({...f,run:async(binary,args,options)=>{
      if(args[0]==='--help'||args[0]==='auth'||args.includes('--input-format'))return f.run(binary,args,options);
      if(name==='source_search')controller.abort();
      options.onEvent({type:'assistant',message:{content:[{type:'tool_use',name,input:{query:'auth'}}]}});throw Error('cancelled');
    }});
    await adapter.connect();await assert.rejects(adapter.complete([], [tool],controller.signal),name==='Bash'?/claude_response_invalid/:/cancelled/);
  }
});
test('native or unadvertised tool calls and malformed arguments never execute',()=>{
  for(const value of [result([{name:'Bash',arguments:'{}'}]),result([{name:'source_search',arguments:'not-json'}]),result([{name:'source_search',arguments:'[]'}]),{...result(),is_error:true},{...result(),structured_output:undefined}])assert.throws(()=>decodeClaudeResult(value,[tool]));
});
test('token counts include cached input without fabricating missing totals',()=>{
  const usage=decodeClaudeResult(result([],{input_tokens:10,cache_read_input_tokens:30,cache_creation_input_tokens:20,output_tokens:4})).usage;
  assert.equal(usage.prompt_tokens,60);assert.equal(usage.total_tokens,64);assert.equal(decodeClaudeResult(result()).usage,undefined);
});
test('failed CLI calls retain reported usage and context is distinct from aggregate tokens',async()=>{
  const reports=[],f=fixture();const adapter=createClaudeCode({...f,onUsageStart:()=>1,onUsageFinish:(id,usage)=>reports.push(usage),run:async(binary,args,options)=>{
    if(args[0]==='--help'||args[0]==='auth'||args.includes('--input-format'))return f.run(binary,args,options);
    options.onEvent({type:'system',subtype:'init',model:'claude-fixture'});
    options.onEvent({type:'assistant',message:{usage:{input_tokens:30,output_tokens:4}}});
    options.onEvent({...result([],{input_tokens:100,output_tokens:10}),modelUsage:{'claude-fixture':{contextWindow:200000}}});return '';
  }});
  await adapter.connect();const answer=await adapter.complete([],[]);assert.equal(answer.usage.total_tokens,110);assert.equal(answer.contextUsage.total_tokens,34);assert.equal(adapter.status().models[0].contextLength,200000);
  const failed=createClaudeCode({...fixture({...result([],{input_tokens:10,output_tokens:1}),is_error:true}),onUsageStart:()=>2,onUsageFinish:(id,usage)=>reports.push(usage)});
  await failed.connect();await assert.rejects(failed.complete([],[]));assert.equal(reports.at(-1).total_tokens,11);
});
test('quota preserves independent windows, rejects guessed percentages, and keeps timestamps',()=>{
  const event=info=>({type:'rate_limit_event',rate_limit_info:info});
  const first=claudeQuota(event({unifiedWindows:{five_hour:{utilization:.2,resetsAt:3000},seven_day:{utilization:.6,resetsAt:5000}}}),null,1000);
  assert.deepEqual(first.windows.map(w=>w.remaining),[80,40]);
  const next=claudeQuota(event({rateLimitType:'five_hour',status:'allowed'}),first,2000);
  assert.equal(next.windows[0].remaining,null);assert.equal(next.windows[1].fetchedAt,1000);
  for(const utilization of [-1,2,'0.5',NaN])assert.equal(claudeQuota(event({rateLimitType:'five_hour',utilization})).windows[0].remaining,null);
});
test('adapter does not pass inherited credentials or endpoint overrides to the CLI',()=>{
  const env=claudeEnvironment({PATH:'/bin',HOME:'/home/user',HTTPS_PROXY:'http://proxy',ANTHROPIC_API_KEY:'secret',ANTHROPIC_BASE_URL:'https://wrong',CLAUDE_CODE_OAUTH_TOKEN:'secret',CLAUDECODE:'1',CLAUDE_CONFIG_DIR:'/other'});
  assert.deepEqual(env,{PATH:'/bin',HOME:'/home/user',HTTPS_PROXY:'http://proxy'});
});
test('Desktop wrapper routes foreground and background calls and persists only preferences',async()=>{
  const records=[],baseCalls=[];let active='aipro';const base={status:()=>({provider:active,connected:true,providers:[{id:'aipro',connected:true}],model:'base'}),usageStatus:()=>({auth:{provider:active,present:true},connections:{chatgpt:{present:false}}}),catalogs:()=>[],select:p=>active=p,restoreConnections:async()=>{},flushConnections:async()=>{},accountUsage:async()=>{},complete:async(...args)=>{baseCalls.push(args);return {content:'base'};},dispose:()=>{}};
  const f=fixture();const providers=createDesktopProviders({...f,createBase:()=>base,onConnectionChange:(id,record)=>records.push({id,record}),onActiveProvider:()=>{}});
  await providers.connect({provider:'claude'});assert.equal(providers.status().provider,'claude');assert.equal((await providers.complete([],[])).content,'확인했습니다.');
  await providers.select('aipro');assert.equal((await providers.complete([],[])).content,'base');
  assert.equal((await providers.complete([],[],undefined,undefined,undefined,undefined,{backgroundModel:{provider:'claude',model:'opus'}})).content,'확인했습니다.');
  assert.equal(baseCalls.length,1);assert.equal(records[0].record.credential,undefined);assert.equal(providers.usageStatus().connections.claude.present,true);
  await providers.disconnect('claude');assert.equal(records.at(-1).record,null);
});
test('CLI preferences restore after restart; unavailable vault does not break a live login',async()=>{
  const f=fixture(),provider=createDesktopProviders(f);
  await provider.restoreConnections([{provider:'claude',model:'opus',reasoningEffort:'high'}],'claude');assert.equal(provider.status().model,'claude-opus-5-5');assert.equal(provider.status().reasoningEffort,'high');
  const unavailable=createDesktopProviders({...f,onConnectionChange:()=>{throw Error('locked');},onActiveProvider:()=>{throw Error('locked');}});
  await unavailable.connect({provider:'claude'});assert.equal(unavailable.status().connected,true);assert.equal(unavailable.status().persistenceError,'connection_not_saved');
  await unavailable.flushConnections();provider.dispose();unavailable.dispose();
});
test('Opus 5.5 is pinned and all five effort values are passed literally to the CLI',async()=>{
  const f=fixture(),adapter=createClaudeCode(f);await adapter.connect();adapter.model('opus');
  assert.equal(adapter.status().model,'claude-opus-5-5');assert.deepEqual(adapter.status().reasoningOptions,['low','medium','high','xhigh','max']);
  for(const effort of adapter.status().reasoningOptions){
    adapter.reasoning(effort);await adapter.complete([],[]);const {args}=f.invocations.at(-1);
    assert.equal(args[args.indexOf('--model')+1],'claude-opus-5-5');assert.equal(args[args.indexOf('--effort')+1],effort);
  }
  adapter.model('sonnet');assert.equal(adapter.status().reasoningEffort,'medium');
});
test('Claude usage is retained alongside other Desktop providers',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-claude-usage-'));const ledger=new DesktopUsage(root);
  try{const id=ledger.start({provider:'claude'});ledger.finish(id,{prompt_tokens:4,completion_tokens:6,total_tokens:10});assert.equal(ledger.summary().usage.total.claude.total,10);}finally{ledger.close();await rm(root,{recursive:true,force:true});}
});
test('real process runner supports split JSON, cancellation and bounded output',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-cli-fixture-')),script=path.join(root,'cli.cjs');
  try{
    await writeFile(script,"process.stdout.write('{\"type\":');setTimeout(()=>{process.stdout.write('\"result\"}\\n');},10)");const events=[];await runClaude(process.execPath,[script],{onEvent:e=>events.push(e)});assert.deepEqual(events,[{type:'result'}]);
    await writeFile(script,"process.stdout.write('{\"type\":\"result\"}')");const tail=[];await runClaude(process.execPath,[script],{onEvent:e=>tail.push(e)});assert.deepEqual(tail,[{type:'result'}]);
    await writeFile(script,'setInterval(()=>{},1000)');const controller=new AbortController();const pending=runClaude(process.execPath,[script],{signal:controller.signal});setTimeout(()=>controller.abort(),60);await assert.rejects(pending,/cancelled/);
    await writeFile(script,"process.stdout.write('x'.repeat(2100000));setInterval(()=>{},1000)");await assert.rejects(runClaude(process.execPath,[script]),/output_limit/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('CLI model discovery replaces the fixed list and exposes reported effort per model',async()=>{
 const f=fixture(),adapter=createClaudeCode(f);await adapter.connect();
 assert.equal(adapter.status().models.length,4);assert.equal(adapter.status().modelCatalog.source,'cli_initialize');
 adapter.model('fable');assert.equal(adapter.status().model,'claude-fable-5-1');assert.deepEqual(adapter.status().reasoningOptions,['high','max']);
 await adapter.complete([],[]);assert.equal(f.invocations.at(-1).args[f.invocations.at(-1).args.indexOf('--effort')+1],'high');
 adapter.model('haiku');await adapter.complete([],[]);assert.equal(f.invocations.at(-1).args.includes('--effort'),false);assert.equal(adapter.status().reasoningEffort,null);
 const request=f.invocations.find(c=>c.args.includes('--input-format'));assert.equal(JSON.parse(request.options.input).type,'control_request');assert(!request.args.includes('--model'));
 assert.throws(()=>adapter.model('invented-model'),/invalid_model/);
});
test('catalog normalizes aliases without hiding distinct historical versions',()=>{
 const rows=claudeModels([{value:'default',resolvedModel:'claude-fable-5-1',displayName:'Default'},...catalog,{value:'claude-opus-4-6',displayName:'Opus 4.6'}]);
 assert.equal(rows.length,5);assert.equal(rows.find(m=>m.id==='claude-fable-5-1').label,'Fable 5.1');assert.deepEqual(rows.find(m=>m.id==='claude-fable-5-1').aliases,['default','fable']);
 for(const value of [null,[],[{value:'bad value',displayName:'bad'}]])assert.throws(()=>claudeModels(value),/claude_models_unavailable/);
});
test('failed discovery never silently falls back to three invented available models',async()=>{
 const f=fixture(),adapter=createClaudeCode({...f,run:(b,a,o)=>a.includes('--input-format')?Promise.resolve(''):f.run(b,a,o)});
 await assert.rejects(adapter.connect(),/claude_models_unavailable/);assert.deepEqual(adapter.status().models,[]);
});

test('background model effort follows that model and discovery is coalesced and cancelled on disconnect',async()=>{
 const f=fixture(),adapter=createClaudeCode(f);await Promise.all([adapter.connect(),adapter.connect()]);assert.equal(f.invocations.filter(c=>c.args.includes('--input-format')).length,1);
 await adapter.complete([],[],undefined,undefined,undefined,undefined,{backgroundModel:{model:'fable'}});
 const args=f.invocations.at(-1).args;assert.equal(args[args.indexOf('--effort')+1],'high');
 let finish;const pendingAdapter=createClaudeCode({...f,run:async(b,a,o)=>{if(a.includes('--input-format'))await new Promise(r=>finish=r);return f.run(b,a,o);}});
 const pending=pendingAdapter.connect();while(!finish)await new Promise(r=>setImmediate(r));pendingAdapter.disconnect();finish();await assert.rejects(pending,/cancelled/);assert.equal(pendingAdapter.status().connected,false);
});
