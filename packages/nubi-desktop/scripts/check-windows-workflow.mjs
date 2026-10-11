import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {WinappComputer,observeComputer,proposeComputerAction,verifyComputerValue} from '../runtime/computer-use.mjs';
import {git} from '../runtime/files.mjs';
import {shellProfiles} from '../runtime/processes.mjs';

if(process.platform!=='win32')throw Error('Windows required');
const exec=promisify(execFile),directory=await mkdtemp(path.join(os.tmpdir(),'nubi-workflow-'));
const root=path.join(directory,'repo'),appDir=path.join(directory,'한국어 앱 경로');
await mkdir(root);await mkdir(appDir);await git(root,['init','-q']);
await writeFile(path.join(root,'README.md'),'Owned Windows acceptance workspace.');
const file=path.join(appDir,'NubiWorkflowFixture.exe'),script=path.join(directory,'compile.ps1');
await writeFile(script,'param([string]$source,[string]$output)\n$ErrorActionPreference="Stop"\nAdd-Type -TypeDefinition (Get-Content -LiteralPath $source -Raw) -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $output -OutputType WindowsApplication\n');
await exec('powershell.exe',['-NoProfile','-File',script,path.resolve('scripts/fixtures/windows-workflow.cs'),file],{timeout:60000});
const manifest=JSON.parse(await readFile('generated/winapp/manifest.json','utf8'));
const service=new ProjectService({storageRoot:path.join(directory,'state')});let child;
const report={passed:false,windows:os.release(),scope:'Owned WinForms draft app and actual host shell processes. No real messenger, Windows 11 user session or live model claim.',checks:[]};
try {
  await service.open(root);
  service.computerAdapter=new WinappComputer({binary:path.resolve('generated/winapp/winapp.exe'),digest:manifest.sha256});
  const task=await service.createTask({request:'Open the owned app, prepare a Korean draft and verify the saved result.'});
  const taskId=task.id,decide=proposal=>service.computer({method:'decide',taskId,id:proposal.id,fingerprint:proposal.fingerprint,decision:'approve'});
  await service.computer({method:'register_app',taskId,file});
  const app=service.state().computer.apps[0];
  const launch=await service.computer({method:'propose_launch',taskId,appId:app.id});
  await decide(launch);
  const receipt=service.store.get('computer-action:'+launch.id);
  child=service.computerLauncher.children.get(launch.id)?.child;
  assert.equal(receipt.verification,'window_observed',JSON.stringify(receipt));
  await decide(launch);assert.equal(service.computerLauncher.children.size,1);
  const window=receipt.windows[0];
  await service.computer({method:'bind',taskId,window:window.hwnd,expectedIdentity:window.identity});
  report.checks.push('real EXE registration and approved launch from Korean path','exact live PID window and explicit binding','duplicate launch approval starts once');
  let observation=await observeComputer(service,taskId,{query:'Nubi draft',includeImage:false});
  const input=observation.elements.find(v=>v.name==='Nubi draft');assert(input,'Draft edit control unavailable');
  const value='누비 초안: 한글과 "quotes" 확인';
  const proposal=await proposeComputerAction(service,taskId,{observationId:observation.observationId,selector:input.selector,action:'set_value',value,reason:'Prepare the owned draft; no external message is sent.'});
  await decide(proposal);assert.equal(service.store.get('computer-action:'+proposal.id).verification,'value_matched');
  observation=await observeComputer(service,taskId,{query:'Nubi draft',includeImage:false});
  assert.equal((await verifyComputerValue(service,taskId,{observationId:observation.observationId,selector:observation.elements.find(v=>v.name==='Nubi draft').selector,expected:value})).verification,'value_matched');
  report.checks.push('approved Korean draft input','fresh independent control value comparison');
  observation=await observeComputer(service,taskId,{query:'Save draft',includeImage:false});
  const save=await proposeComputerAction(service,taskId,{observationId:observation.observationId,selector:observation.elements.find(v=>v.name==='Save draft').selector,action:'invoke',reason:'Save only the owned temporary draft.'});
  await decide(save);assert.equal(service.store.get('computer-action:'+save.id).state,'observed');
  await decide(save);
  assert.equal(await readFile(path.join(appDir,'draft.txt'),'utf8'),value);
  assert.equal(await readFile(path.join(appDir,'receipts.txt'),'utf8'),'saved\n');
  const images=await service.computer({method:'artifact',taskId,id:save.id});assert(images.before.data&&images.after.data);
  await mkdir('verification',{recursive:true});await writeFile('verification/windows-workflow.png',Buffer.from(images.after.data,'base64'));
  report.checks.push('approved button action','independent UTF-8 file readback','duplicate approval saves once','before and after screenshots');
  report.shells=[];
  for(const profile of await shellProfiles()) {
    // Each shell gets its own syntax: CMD joined the Windows profiles after 1.0.0. Its Korean output is not
    // preserved when it runs without a console (chcp 65001 has no console to change), so CMD is checked with
    // ASCII text and its Korean output is recorded below as a known limitation, not asserted.
    const {script,expected}={powershell:{script:"Write-Output '누비 PowerShell 확인'; exit 7",expected:/누비 PowerShell 확인/},cmd:{script:'echo Nubi CMD check& exit /b 7',expected:/Nubi CMD check/}}[profile.id]||{script:"printf '누비 Bash 확인\\n'; exit 7",expected:/누비 Bash 확인/};
    const started=await service.processes.start({taskId,cwd:root,script,profile:profile.id,timeoutMs:15000,autoDiagnose:false});
    const deadline=Date.now()+20000;let result;
    do {result=service.processes.poll(started.id);if(!['checking','running','stopping'].includes(result.state))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
    assert.equal(result.state,'failed',profile.id);assert.equal(result.exitCode,7,profile.id);assert.match(result.output,expected);
    report.shells.push({profile:profile.id,unicodeOutput:profile.id!=='cmd',exitCode:result.exitCode});
    if(profile.id==='cmd'){
      const korean=await service.processes.start({taskId,cwd:root,script:'echo 누비 CMD 확인& exit /b 7',profile:'cmd',timeoutMs:15000,autoDiagnose:false});
      const until=Date.now()+20000;let observed;
      do {observed=service.processes.poll(korean.id);if(!['checking','running','stopping'].includes(observed.state))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);
      report.cmdKoreanOutput={preserved:/누비 CMD 확인/.test(observed.output||''),output:String(observed.output||'').slice(0,80),exitCode:observed.exitCode};
    }
  }
  assert(report.shells.some(s=>s.profile==='powershell'));assert(report.shells.some(s=>s.profile==='bash'),'Git Bash missing on acceptance host');
  report.checks.push('real PowerShell and Git Bash Unicode output and exit code','real CMD ASCII output and exit code; its Korean output recorded, not asserted');report.passed=true;
} finally {
  // Only close the child created by this acceptance script, never arbitrary apps.
  child?.kill();service.dispose();service.store?.close();
  await mkdir('verification',{recursive:true});await writeFile('verification/windows-workflow.json',JSON.stringify(report,null,2));
}
console.log('Windows host app workflow and shells passed');
