import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {claudeAuthorizationUrl,runClaudeLogin} from '../runtime/claude-login.mjs';
import {createDesktopProviders} from '../runtime/desktop-providers.mjs';
const authorization='https://claude.com/cai/oauth/authorize?state=fixture&code_challenge=fixture&redirect_uri='+encodeURIComponent('http://localhost:4567/callback');
test('only official authorization URLs with the original loopback callback are forwarded',()=>{
 assert.equal(claudeAuthorizationUrl(authorization),authorization);
 for(const url of [authorization.replace('claude.com','claude.com.evil.test'),authorization.replace('https:','http:'),authorization.replace('state=fixture','state='),authorization.replace(encodeURIComponent('http://localhost:4567/callback'),encodeURIComponent('https://platform.claude.com/oauth/code/callback')),authorization.replace('localhost','evil.test')])assert.equal(claudeAuthorizationUrl(url),null);
});
test('CLI BROWSER handoff opens once, closes its own tab and removes temporary files',async()=>{
 const opened=[],closed=[];let capture,release;
 const ready=new Promise(resolve=>release=resolve);
 await runClaudeLogin('/fixture/claude',{run:async(binary,args,options)=>{
  assert.deepEqual(args,['auth','login']);assert.equal(options.timeoutMs,600000);capture=options.environment.NUBI_CLAUDE_AUTH_CAPTURE;
  assert(options.environment.BROWSER);await writeFile(capture,authorization);await ready;
 },openBrowser:async url=>{opened.push(url);release();return {opened:true,tabId:'only-this-auth-tab'};},closeBrowser:async id=>closed.push(id)});
 assert.deepEqual(opened,[authorization]);assert.deepEqual(closed,['only-this-auth-tab']);await assert.rejects(access(capture));
});
const base=()=>({status:()=>({provider:'aipro',providers:[]}),cancelLogin:()=>{},dispose:()=>{},restoreConnections:async()=>{},flushConnections:async()=>{}});
test('browser failure aborts the child and cancelled login cannot produce a connection',async()=>{
 let signal;
 await assert.rejects(runClaudeLogin('/fixture/claude',{run:async(_b,_a,o)=>{
  signal=o.signal;await writeFile(o.environment.NUBI_CLAUDE_AUTH_CAPTURE,authorization);
  await delay(60000,undefined,{signal:o.signal});
 },openBrowser:async()=>{throw Error('closed');}}),/browser_unavailable/);assert.equal(signal.aborted,true);
 let started=0,finish,authenticated=false;
 const providers=createDesktopProviders({createBase:base,findBinary:async()=>'/fixture/claude',run:async(_b,args,options)=>{if(args.includes('--input-format')){options.onEvent({type:'control_response',response:{subtype:'success',request_id:JSON.parse(options.input).request_id,response:{models:[{value:'sonnet',displayName:'Sonnet',supportsEffort:true,supportedEffortLevels:['medium']}]}}});return '';}return args[0]==='--help'?'--safe-mode --json-schema':JSON.stringify({loggedIn:authenticated});},startClaudeLogin:async(_b,o)=>{started++;signal=o.signal;await new Promise(resolve=>finish=resolve);authenticated=true;}});
 const pending=await providers.login('claude');assert.equal(pending.pending,'claude');assert.equal(pending.connected,false);
 await assert.rejects(providers.login('claude'),/login_busy/);assert.equal(started,1);
 providers.cancelLogin();assert.equal(signal.aborted,true);finish();await delay(0);assert.equal(providers.status().connected,false);assert.equal(providers.status().pending,null);providers.dispose();
});
test('successful interactive login verifies CLI auth and persists only model preferences',async()=>{
 let authenticated=false,finish;const stored=[];
 const providers=createDesktopProviders({createBase:base,findBinary:async()=>'/fixture/claude',run:async(_b,args,options)=>{if(args.includes('--input-format')){options.onEvent({type:'control_response',response:{subtype:'success',request_id:JSON.parse(options.input).request_id,response:{models:[{value:'sonnet',displayName:'Sonnet',supportsEffort:true,supportedEffortLevels:['medium']}]}}});return '';}return args[0]==='--help'?'--safe-mode --json-schema':JSON.stringify({loggedIn:authenticated});},startClaudeLogin:async()=>{await new Promise(resolve=>finish=resolve);authenticated=true;},onConnectionChange:async(_id,record)=>stored.push(record)});
 await providers.restoreConnections([{provider:'claude'}],'claude');assert.equal(finish,undefined,'restore never starts login');
 await providers.login('claude');finish();await delay(0);assert.equal(providers.status().connected,true);assert.equal(providers.status().pending,null);
 assert.deepEqual(Object.keys(stored[0]).sort(),['model','provider','reasoningEffort','version']);providers.dispose();
});
