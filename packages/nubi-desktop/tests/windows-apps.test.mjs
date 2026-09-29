import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {fixture} from './fixtures.mjs';
import {WindowsApps,localExecutable,appEnvironment} from '../runtime/windows-apps.mjs';
import {WinappComputer,proposeComputerLaunch,winappEnvironment} from '../runtime/computer-use.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
installAgent(ProjectService);

async function setup(t){
  const {service}=await fixture(t),task=await service.createTask({request:'등록한 앱을 실행하고 화면을 확인한다.'});
  const data={started:0,windows:false,digest:'a'.repeat(64),alive:true,fail:false,existing:false};
  const identity={hwnd:100,processId:77,processName:'업무 앱',windowTitle:'한국어 업무 앱',windowDpi:144,scale:1.5,coordinateSpace:'physical-screen-pixels'};
  service.computerAdapter=new WinappComputer({platform:'win32',runner:async args=>{
    if(args[1]==='list-windows')return data.windows||data.existing?[{...identity,title:identity.windowTitle,width:800,height:600}]:[];
    if(args[1]==='status')return {...identity};throw Error('unexpected '+args[1]);
  }});
  service.computerLauncher=new WindowsApps({platform:'win32',inspectFile:async file=>({path:file,name:'업무 앱.exe',sha256:data.digest}),spawnProcess:(file,args,options)=>{
    data.started++;data.spawn={file,args,options};const child=new EventEmitter();child.pid=77;child.unref=()=>{};
    queueMicrotask(()=>{if(data.fail)child.emit('error',new Error('lost'));else {data.windows=data.alive;child.emit('spawn');if(!data.alive)child.emit('exit',0);}});return child;
  }});
  await service.computer({method:'register_app',taskId:task.id,file:'C:\\Program Files\\업무 앱\\업무 앱.exe'});
  const app=service.state().computer.apps[0];
  const propose=()=>proposeComputerLaunch(service,task.id,{appId:app.id,reason:'요청한 앱을 실행합니다.'});
  const decide=(p,decision='approve')=>service.computer({method:'decide',taskId:task.id,id:p.id,fingerprint:p.fingerprint,decision});
  return {service,task,data,app,identity,propose,decide};
}
test('launch accepts only an exact local EXE and excludes shell, URI, UNC and inherited secrets',()=>{
  for(const bad of ['calc.exe','C:calc.exe','C:\\a.cmd','https://a/app.exe','\\\\server\\app.exe','C:\\a.exe:other.exe','C:\\a\n.exe'])assert.throws(()=>localExecutable(bad),/computer_app_invalid/);
  assert.equal(localExecutable('C:\\Program Files\\한국어.exe'),'C:\\Program Files\\한국어.exe');
  assert.deepEqual(appEnvironment({SystemRoot:'C:\\Windows',PATH:'injected',NODE_OPTIONS:'--import evil',AIPRO_ACCESS_TOKEN:'secret',APPDATA:'C:\\user'}),{SystemRoot:'C:\\Windows',APPDATA:'C:\\user'});
  assert.deepEqual(winappEnvironment({SystemRoot:'C:\\Windows',PATH:'injected',NODE_OPTIONS:'--import evil',AIPRO_ACCESS_TOKEN:'secret',APPDATA:'C:\\user',WINAPP_UI_WORKFLOW_ID:'foreign'},'nubi-test'),{SystemRoot:'C:\\Windows',APPDATA:'C:\\user',WINAPP_UI_WORKFLOW_ID:'nubi-test'});
});
test('launch is inert until approval; duplicate approvals spawn once and window verification does not grant control',async t=>{
  const {service,data,app,propose,decide}=await setup(t),p=await propose();assert.equal(data.started,0);
  await Promise.all([decide(p),decide(p)]);assert.equal(data.started,1);
  assert.equal(data.spawn.file,app.path);assert.deepEqual(data.spawn.args,[]);assert.equal(data.spawn.options.shell,false);assert.equal(data.spawn.options.windowsHide,false);assert.equal(data.spawn.options.cwd,'C:\\Program Files\\업무 앱');
  const state=service.state().computer;assert.equal(state.actions[0].execution,'process_started');assert.equal(state.actions[0].verification,'window_observed');assert.equal(state.binding,null);
});
test('changed binary, revoked app, expired review and pre-existing app never spawn',async t=>{
  const {service,task,data,app,propose,decide}=await setup(t);const a=await propose();data.digest='b'.repeat(64);await decide(a);assert.equal(service.state().computer.actions[0].state,'stale');data.digest='a'.repeat(64);
  const b=await propose();const saved=service.store.get('computer-action:'+b.id);saved.expiresAt=0;service.store.set('computer-action:'+b.id,saved);await decide(b);
  const c=await propose();data.existing=true;await decide(c);assert.equal(service.state().computer.actions[0].error,'computer_app_running');data.existing=false;
  const d=await propose();await service.computer({method:'remove_app',taskId:task.id,appId:app.id});await decide(d);assert.equal(data.started,0);
});
test('lost launch outcome blocks re-proposal and refresh never repeats the launch',async t=>{
  const {service,data,propose,decide}=await setup(t);data.fail=true;const p=await propose();await decide(p);await decide(p);assert.equal(data.started,1);assert.equal(service.state().computer.actions[0].execution,'unknown');
  await assert.rejects(propose,/computer_review_required/);await decide(p,'acknowledge');assert.equal(data.started,1);
});
test('process creation without a live matching window is not verified, including later lookup',async t=>{
  const {service,task,data,propose,decide}=await setup(t);data.alive=false;const p=await propose();await decide(p);
  let receipt=service.state().computer.actions[0];assert.equal(receipt.state,'attention');assert.equal(receipt.execution,'process_started');assert.equal(receipt.verification,'window_not_observed');
  data.windows=true;await service.computer({method:'refresh_launch',taskId:task.id,id:p.id});receipt=service.state().computer.actions[0];assert.equal(receipt.verification,'window_not_observed');assert.equal(data.started,1);
});
test('task isolation, changed window at connection and cancellation preserve the grant boundary',async t=>{
  const {service,task,data,app,identity,propose,decide}=await setup(t);const other=await service.createTask({request:'다른 작업'});
  await assert.rejects(()=>proposeComputerLaunch(service,other.id,{appId:app.id,reason:'not mine'}),/computer_app_required/);
  const p=await propose();await decide(p);const expectedIdentity={...identity};identity.processId++;
  await assert.rejects(()=>service.computer({method:'bind',taskId:task.id,window:100,expectedIdentity}),/computer_target_changed/);assert.equal(service.state().computer.binding,null);
  service.store.set('task:'+task.id,{...task,state:'cancelled'});await assert.rejects(propose,/computer_cancelled/);assert.equal(data.started,1);
});
test('restart forgets app grants and never replays a starting launch',async t=>{
  const {service,task,data,propose}=await setup(t),p=await propose();service.store.set('computer-action:'+p.id,{...p,state:'starting'});const root=service.root;service.store.close();await service.open(root);
  assert.deepEqual(service.state().computer.apps,[]);assert.equal(service.state().computer.actions[0].state,'attention');assert.equal(data.started,0);
  await service.computer({method:'refresh_launch',taskId:task.id,id:p.id}).catch(e=>assert.match(e.message,/computer_invalid/));assert.equal(data.started,0);
});
test('Pi discovers registered apps, proposes an exact app and receives host launch receipts',async t=>{
  const {service,task,data,app,decide}=await setup(t);let round=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages,definitions)=>{
    assert(!definitions.some(v=>['register_app','launch_app','computer'].includes(v.function?.name)));
    if(++round===1)return call('list_computer_apps',{});
    if(round===2){assert.match(JSON.stringify(messages),new RegExp(app.id));return call('propose_computer_launch',{appId:app.id,reason:'등록한 앱을 실행합니다.'});}
    if(round===3)assert.match(JSON.stringify(messages),/window_observed/);
    return {content:'실행 기록을 확인했습니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(data.started,0);await decide(service.state().computer.actions[0]);assert.equal(data.started,1);
  await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(round,3);
});
test('explicit Wiki export links host receipts to the task without app paths, values or screenshots',async t=>{
  const {service,task,propose,decide}=await setup(t);await decide(await propose());
  service.store.set('computer-check:check-fixture',{id:'check-fixture',taskId:task.id,observationId:'observed-fixture',verification:'value_matched',scope:'exact_control_value',at:new Date().toISOString(),actual:'PRIVATE_VALUE',expected:'PRIVATE_VALUE',identity:{windowTitle:'PRIVATE_TITLE'}});
  const record=await service.recordKnowledge({taskId:task.id}),text=await readFile(path.join(service.root,record.path),'utf8');
  assert.match(text,/Windows 앱 확인/);assert.match(text,/화면 값 일치/);assert.match(text,/저장, 제출과 업무 완료를 증명하지 않습니다/);assert.doesNotMatch(text,/PRIVATE_|Program Files|data:image/);
  assert.equal((await service.recordKnowledge({taskId:task.id})).noChange,true);
  const item=service.store.get('computer-check:check-fixture');service.store.set('computer-check:check-fixture',{...item,verification:'value_mismatch'});assert.equal((await service.knowledgeStatus({taskId:task.id})).state,'outdated');
});
