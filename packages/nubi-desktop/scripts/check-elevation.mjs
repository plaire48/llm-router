// Owned temporary files only. CI proves the real RunAs/exit bridge, not an
// interactive Windows 11 consent prompt (hosted runners already have admin).
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../runtime/store.mjs';
import {Processes} from '../runtime/processes.mjs';
if(process.platform!=='win32')throw Error('Windows verification host required');
const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const admin=execFileSync(shell,['-NoProfile','-Command','([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{encoding:'utf8'}).trim()==='True';
if(!admin)throw Error('This CI check requires an already-elevated runner; interactive UAC is a separate manual check');
const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-elevation-')),store=new Store(path.join(directory,'state')),owner=new Processes(store);
const checks=[];
try {
  const file=path.join(directory,'literal result.txt'),script=`[IO.File]::WriteAllText('${file.replaceAll("'","''")}','NUBI_ELEVATED_ONCE'); Write-Output 'result verified'; exit 7`;
  const action={id:'fixture',taskId:'task',workspace:directory,profile:'powershell',script,privilege:'administrator',state:'starting',elevationConsentAt:new Date().toISOString()};
  store.set('setup-action:fixture',action);
  const result=await owner.start({cwd:directory,taskId:'task',profile:'powershell',script,privilege:'administrator',setupActionId:'fixture'});
  const deadline=Date.now()+60000;while(owner.active.has(result.id)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  assert(!owner.active.has(result.id),'elevated watcher did not finish');const receipt=owner.poll(result.id);
  assert.equal(receipt.execution,'completed');assert.equal(receipt.exitCode,7);assert.equal(receipt.state,'failed');assert.equal(await readFile(file,'utf8'),'NUBI_ELEVATED_ONCE');
  const duplicate=await owner.start({cwd:directory,taskId:'task',profile:'powershell',script,privilege:'administrator',setupActionId:'fixture'});assert.equal(duplicate.id,result.id);
  checks.push('RunAs executes the frozen PowerShell command in its approved directory','literal file readback and exact nonzero child exit code','duplicate approval returns the original process receipt');
  await mkdir('verification',{recursive:true});await writeFile('verification/windows-elevation.json',JSON.stringify({checks,runnerAlreadyElevated:admin,interactiveUacVerified:false,windows11UserVerified:false},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}finally{owner.dispose();store.close();}
