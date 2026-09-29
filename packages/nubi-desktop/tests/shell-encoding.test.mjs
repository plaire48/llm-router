import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Processes,shellArguments,shellProfiles,hostShell} from '../runtime/processes.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

test('Windows prefers PowerShell even when Git Bash is available',async t=>{
  const {root}=await fixture(t),gitBash=path.join(root,'git-bash');await writeFile(gitBash,'');
  const profiles=await shellProfiles({platform:'win32',bashCandidates:[gitBash]});
  assert.deepEqual(profiles.map(item=>item.id),['powershell','cmd','bash']);
  assert.equal(hostShell('win32'),'powershell');
  assert.equal(hostShell('darwin'),'bash');
});

test('project shell setting rejects unavailable choices and survives host restart',async t=>{
  const {service,root,directory}=await fixture(t);
  const choice=process.platform==='win32'?'cmd':'bash';
  await assert.rejects(service.invoke('setShellPreference',{profile:'invented'}),/shell_unavailable/);
  assert.deepEqual(await service.invoke('setShellPreference',{profile:choice}),{profile:choice});
  assert.equal((await service.overview()).defaultShell,choice);
  assert.equal(service.shellPreference(),choice);
  service.dispose();service.store.close();
  const restored=new ProjectService({storageRoot:path.join(directory,'state')});t.after(()=>{restored.dispose();restored.store?.close();});
  await restored.open(root);
  assert.equal((await restored.overview()).defaultShell,choice);
});

test('PowerShell transport preserves literal Korean and quotes with explicit UTF-8 output',()=>{
  const script="Write-Output '한글 \"literal\" $value'; exit 7";
  const args=shellArguments({args:['-Command']},'powershell',script);
  assert.equal(args.at(-2),'-EncodedCommand');
  const decoded=Buffer.from(args.at(-1),'base64').toString('utf16le');
  assert.ok(decoded.endsWith(script));assert.match(decoded,/OutputEncoding/);assert.doesNotMatch(decoded,/ExecutionPolicy|RunAs/);
  assert.deepEqual(shellArguments({args:['--norc','-c']},'bash','echo hi'),['--norc','-c','echo hi']);
  assert.deepEqual(shellArguments({args:['/D','/Q','/C']},'cmd','echo 한글'),['/D','/Q','/C','chcp 65001>nul & echo 한글']);
  assert.throws(()=>shellArguments({args:['/D','/Q','/C']},'cmd','x'.repeat(7600)),/shell_command_limit/);
});

test('oversized encoded PowerShell is rejected before spawn with a recoverable receipt',async t=>{
  const {service,root}=await fixture(t);
  const processes=new Processes(service.store,{profiles:async()=>[{id:'powershell',executable:'must-not-run',args:[]}]});
  const result=await processes.start({cwd:root,taskId:'size-test',profile:'powershell',script:'x'.repeat(16000)});
  assert.equal(result.state,'failed');assert.equal(result.execution,'not_started');assert.equal(result.fault,'shell_command_limit');assert.equal(processes.active.size,0);
});

test('separate stdout chunks preserve a split UTF-8 character in real process output',async t=>{
  const {service,root}=await fixture(t);
  const processes=new Processes(service.store,{profiles:async()=>[{id:'node-fixture',executable:process.execPath,args:['-e']}]});
  const result=await processes.start({cwd:root,taskId:'unicode-test',profile:'node-fixture',script:"const b=Buffer.from('한글');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),40);"});
  const until=Date.now()+5000;while(processes.active.size&&Date.now()<until)await new Promise(r=>setTimeout(r,20));
  const receipt=processes.poll(result.id);assert.equal(receipt.output,'한글');assert.equal(receipt.state,'completed');processes.dispose();
});
