import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,symlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {inspectEnvironment,preferredShell,rememberEnvironment} from '../runtime/environment-inspection.mjs';
import {SourceObservations,replaceObserved} from '../runtime/source-edits.mjs';
import {prepareSetupAction} from '../runtime/setup-actions.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);
const pkg={packageManager:'pnpm@10.0.0',scripts:{dev:'vite --port 5174',test:'node --test'},engines:{node:'>=22'}};
async function project(t){const value=await fixture(t);await writeFile(path.join(value.root,'package.json'),JSON.stringify(pkg));await writeFile(path.join(value.root,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n');return value;}
const proposal=reference=>({title:'테스트 준비',kind:'verify',script:'printf success',reason:'프로젝트 테스트를 확인합니다.',effects:'로컬 명령 실행',verification:'출력과 결과를 확인합니다.',references:[reference]});

test('static environment discovery chooses manifest defaults without running config or reading secrets',async t=>{
  const {service,root}=await project(t);await writeFile(path.join(root,'.env'),'API_KEY=never-forward-this');await writeFile(path.join(root,'mise.toml'),'[tools]\nnode="22"');
  const observations=new SourceObservations(),result=await inspectEnvironment(root);rememberEnvironment(observations,result);
  assert.equal(result.node.packageManager,'pnpm');assert.equal(result.node.decision,'declared');assert.equal(result.node.engines.node,'>=22');assert.equal(result.node.scripts[0].command,'vite --port 5174');
  assert.equal(result.execution,'not_started');assert.equal(service.store.list('process:').length,0);assert.equal(observations.files.size,0);assert.equal(observations.environment.size,3);assert(!JSON.stringify(result).includes('never-forward-this'));
  assert.equal(result.shell,process.platform==='win32'?'powershell':'bash');assert(result.tools.node==='found_on_path');
});
test('conflicting package managers do not silently choose a winner',async t=>{
  const {root}=await project(t);await writeFile(path.join(root,'package-lock.json'),'{}');
  const result=await inspectEnvironment(root);assert.equal(result.node.packageManager,null);assert(result.conflicts.includes('package_manager_conflict'));
  await writeFile(path.join(root,'package.json'),'{bad json');assert((await inspectEnvironment(root)).conflicts.includes('package_json_invalid'));
});
test('default npm is explicitly a convention and odd workspace metadata does not crash',async t=>{
  const {root}=await fixture(t);await writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{dev:'vite'},workspaces:{packages:'not-an-array'}}));
  const result=await inspectEnvironment(root);assert.equal(result.node.packageManager,'npm');assert.equal(result.node.decision,'default');assert.deepEqual(result.node.workspaces,[]);
});
test('subproject selection is scoped and large or linked configuration remains unverified',async t=>{
  const {root}=await fixture(t);await mkdir(path.join(root,'apps/web'),{recursive:true});await writeFile(path.join(root,'apps/web/package.json'),JSON.stringify(pkg));
  await writeFile(path.join(root,'apps/web/pnpm-lock.yaml'),'#'.repeat(300000));
  const top=await inspectEnvironment(root);assert(top.projects.includes('apps/web'));assert.equal(top.node,null);
  const nested=await inspectEnvironment(root,{directory:'apps/web'});assert.equal(nested.node.packageManager,'pnpm');assert.equal(nested.partial,true);assert(nested.unread.some(v=>v.path.endsWith('pnpm-lock.yaml')));
  await assert.rejects(inspectEnvironment(root,{directory:'../'}),/path_scope/);
  if(process.platform!=='win32'){await symlink('apps/web',path.join(root,'alias'));await assert.rejects(inspectEnvironment(root,{directory:'alias'}),/path_scope/);}
  const controller=new AbortController();controller.abort();await assert.rejects(inspectEnvironment(root,{},controller.signal),/cancelled/);
});
test('setup-only evidence prepares defaults but never grants editing or command execution',async t=>{
  const {service,root}=await project(t),task=await service.createTask({request:'테스트해 주세요.'}),observations=new SourceObservations();
  const result=await inspectEnvironment(root);rememberEnvironment(observations,result);const ref=result.references.find(v=>v.path==='package.json');
  const action=await prepareSetupAction(service,task.id,proposal(ref),observations);assert.equal(action.profile,process.platform==='win32'?'powershell':'bash');assert.equal(action.references.length,2);assert.equal(service.store.list('process:').length,0);
  const source=await service.read({taskId:task.id,path:'package.json'});assert.throws(()=>replaceObserved(source,source.hash,[{oldText:'vite',newText:'other'}],observations),/source_read_required/);
  await writeFile(path.join(root,'pnpm-lock.yaml'),'changed lock');
  await assert.rejects(service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'}),/setup_changed/);assert.equal(service.store.list('process:').length,0);
});
test('host default prefers PowerShell on Windows and preserves explicit shell choice',()=>{
  const profiles=[{id:'bash'},{id:'powershell'},{id:'cmd'}];assert.equal(preferredShell(profiles,'win32'),'powershell');assert.equal(preferredShell(profiles,'darwin'),'bash');assert.equal(preferredShell(profiles,'win32','cmd'),'cmd');assert.equal(preferredShell(profiles,'win32','missing'),'powershell');assert.equal(preferredShell([],'win32'),null);
});
test('Pi inspects project setup and prepares a command without asking the user to configure it',async t=>{
  const {service,root}=await project(t),task=await service.createTask({request:'프로젝트 실행을 준비해 주세요.'});let round=0;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000,maxInputTokens:24000,maxOutputTokens:4096}]}),dispose(){},async complete(messages,tools){
    if(tools.length===1&&tools[0].function.name==='update_plan')return call('update_plan',{steps:[{text:'실행 환경 확인',expected_outcome:'확인한 설정으로 실행 준비',status:'in_progress'}]});
    round++;if(round===1)return call('inspect_environment',{});
    if(round===2){const environment=messages.findLast(m=>m.role==='tool');assert(environment);const data=JSON.parse(environment.content);return call('propose_setup_action',proposal(data.references.find(r=>r.path==='package.json')));}
    return {content:'실행 준비안을 확인해 주세요.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).question,null);assert.equal(service.state().setupActions.length,1);assert.equal(service.store.list('process:').length,0);assert(service.task(task.id).trace.some(v=>v.tool==='inspect_environment'));assert.equal(await readFile(path.join(root,'package.json'),'utf8'),JSON.stringify(pkg));
});
