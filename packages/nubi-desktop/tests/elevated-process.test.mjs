import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFile,writeFile} from 'node:fs/promises';
import {fixture} from './fixtures.mjs';
import {elevationRequest,elevationReceipt,startElevated} from '../runtime/elevated-process.mjs';
import {prepareSetupAction} from '../runtime/setup-actions.mjs';

const decode=text=>Buffer.from(text,'base64').toString('utf16le');
function fakeLauncher(steps){return (file,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new EventEmitter();
  child.stdin.end=input=>steps({child,request:JSON.parse(input),file,args,options});return child;
};}
async function ready(t){
  const {service,root}=await fixture(t),task=await service.createTask({request:'Verify one elevated command'});
  const action={id:'elevated-fixture',taskId:task.id,workspace:root,script:'Write-Output "검증"',profile:'powershell',privilege:'administrator',privilegeReason:'Fixture',state:'starting',elevationConsentAt:new Date().toISOString(),fingerprint:'fixture',references:[]};
  service.store.set('setup-action:'+action.id,action);
  return {service,action,args:{cwd:root,script:action.script,profile:action.profile,taskId:task.id,setupActionId:action.id}};
}
const settled=async(service,id)=>{for(let i=0;i<200;i++){if(!service.processes.active.has(id))return service.processes.poll(id);await new Promise(r=>setTimeout(r,5));}assert.fail('process did not settle');};
test('payload preserves literal command and paths without execution policy changes or mutable script files',()=>{
  const script='Write-Output "한글 \' $x `n"; # exact command';
  const request=elevationRequest({id:'one',cwd:'C:\\프로젝트 \'one',script,logPath:'log',cancelPath:'cancel',startedPath:'started'});
  const launcher=decode(request.args.at(-1)),payload=JSON.parse(request.input),child=decode(payload.command);
  assert.match(launcher,/-Verb RunAs/);assert.doesNotMatch(launcher+child,/ExecutionPolicy|Set-ExecutionPolicy|Credential\s+/);
  const original=JSON.parse(Buffer.from(child.match(/FromBase64String\('([^']+)'\)/)[1],'base64').toString('utf8'));
  assert.equal(original.script,script);assert.equal(original.cwd,"C:\\프로젝트 'one");assert.equal(payload.script,script);
  assert.match(child,/IsInRole/);assert.match(launcher,/cancelPath/);assert.doesNotMatch(child,/WriteAllText|Out-File|logPath|startedPath/);assert.match(child,/NamedPipeClientStream/);assert(payload.command.length<28000);
  assert.throws(()=>elevationRequest({script:'x'.repeat(3001)}),/elevation_command_limit/);
});
test('only a matching explicit elevation approval can launch and duplicates return the existing receipt',async t=>{
  const {service,args,action}=await ready(t);let launches=0,release;
  const launch=fakeLauncher(({child,request})=>{launches++;release=()=>{child.stdout.end(JSON.stringify({id:request.id,state:'cancelled',started:false,exitCode:null}));child.emit('close',0);};});
  await assert.rejects(startElevated(service.processes,{...args,script:'Other command'},{platform:'win32',launch}),/elevation_approval_required/);
  await assert.rejects(startElevated(service.processes,args,{platform:'darwin',launch}),/elevation_unavailable/);
  service.store.set('setup-action:'+action.id,{...action,elevationConsentAt:null});await assert.rejects(startElevated(service.processes,args,{platform:'win32',launch}),/elevation_approval_required/);
  service.store.set('setup-action:'+action.id,action);const first=await startElevated(service.processes,args,{platform:'win32',launch});
  const again=await startElevated(service.processes,args,{platform:'win32',launch});assert.equal(again.id,first.id);assert.equal(launches,1);
  release();const result=await settled(service,first.id);assert.equal(result.state,'cancelled');assert.equal(result.execution,'not_started');
});
test('UAC rejection, syntax rejection, successful exit and response loss are distinct',async t=>{
  for(const state of ['cancelled','syntax_error','finished','lost']){
    const {service,args}=await ready(t);
    const value=await startElevated(service.processes,args,{platform:'win32',launch:fakeLauncher(({child,request})=>setImmediate(()=>{
      if(state!=='lost')child.stdout.end(JSON.stringify({id:request.id,state,started:state==='finished',exitCode:state==='finished'?0:null}));child.emit('close',state==='lost'?1:0);
    }))});
    const result=await settled(service,value.id);
    assert.equal(result.state,{cancelled:'cancelled',syntax_error:'failed',finished:'completed',lost:'interrupted'}[state]);
    assert.equal(result.execution,state==='lost'?'unknown':state==='finished'?'completed':'not_started');
    assert.equal(service.processes.active.size,0);
  }
});
test('stop writes a cancellation request but keeps observing the elevated child instead of claiming termination',async t=>{
  const {service,args}=await ready(t);let child,request;
  const value=await startElevated(service.processes,args,{platform:'win32',launch:fakeLauncher(data=>{({child,request}=data);})});
  child.kill=()=>assert.fail('must not kill the unprivileged watcher');
  const stopping=service.processes.stop(value.id);assert.equal(stopping.state,'stopping');assert.equal(await readFile(request.cancelPath,'utf8'),'cancel');assert(service.processes.active.has(value.id));
  await writeFile(value.logPath,'Actual result');child.stdout.end(JSON.stringify({id:request.id,state:'finished',started:true,exitCode:0}));child.emit('close',0);
  const result=await settled(service,value.id);assert.equal(result.state,'cancelled');assert.equal(result.execution,'completed');assert.equal(result.output,'Actual result');
});
test('standard approval cannot approve an elevated action and generic run never accepts elevation arguments',async t=>{
  const {service,args,action}=await ready(t);service.store.set('setup-action:'+action.id,{...action,state:'proposed',elevationConsentAt:null});
  await assert.rejects(service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'}),/elevation_approval_required/);
  assert.equal(service.store.list('process:').length,0);
  const task=service.task(args.taskId);
  if(process.platform!=='win32')await assert.rejects(prepareSetupAction(service,task.id,{title:'Test',kind:'verify',reason:'Test',effects:'None',verification:'Read result',profile:'powershell',script:'Write-Output ok',privilege:'administrator',privilegeReason:'Test',references:[{path:'app.txt',hash:'test'}]},null),/elevation_unavailable/);
});
test('dedicated approval records consent before dispatch and cannot dispatch twice',async t=>{
  const {service,action}=await ready(t);let calls=0;
  service.store.set('setup-action:'+action.id,{...action,state:'proposed',elevationConsentAt:null});
  service.processes.start=async args=>{calls++;assert.equal(args.privilege,'administrator');assert.equal(args.script,action.script);assert(service.store.get('setup-action:'+action.id).elevationConsentAt);return {id:'owned-process'};};
  const decision={id:action.id,fingerprint:action.fingerprint,decision:'approve',elevationConsent:true};
  const first=await service.decideSetupAction(decision),second=await service.decideSetupAction(decision);
  assert.equal(first.resultProcessId,'owned-process');assert.equal(second.resultProcessId,first.resultProcessId);assert.equal(calls,1);
});
test('receipts cannot confuse mismatched IDs, unconfirmed starts or malformed stdout with completion',()=>{
  for(const value of ['garbage',{id:'other',state:'finished',started:true,exitCode:0},{id:'one',state:'finished',started:false,exitCode:0},{id:'one',state:'finished',started:true,exitCode:null},{id:'one',state:'cancelled',started:true}])assert.equal(elevationReceipt(typeof value==='string'?value:JSON.stringify(value),'one'),null);
});
