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
  // Closed before the fixture removes its folder: Windows cannot delete the open owner journal (EBUSY).
  restored.dispose();restored.store.close();
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

test('Windows PowerShell preserves Korean output, UTF-8 source reads and explicit legacy decoding', {skip:process.platform!=='win32'}, async t=>{
  const {service,root}=await fixture(t),content='누비 한글 문서 확인',file=path.join(root,'한글 원문.txt');
  await writeFile(file,content,'utf8');
  await writeFile(path.join(root,'utf16.txt'),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(content,'utf16le')]));
  await writeFile(path.join(root,'latin.txt'),Buffer.from([0xe9]));
  const record=await service.processes.start({cwd:root,taskId:'encoding',profile:'powershell',autoDiagnose:false,script:"Write-Output '한글 직접 출력'; Get-Content -LiteralPath './한글 원문.txt'; Get-Content -LiteralPath './utf16.txt'; Get-Content -LiteralPath './latin.txt' -Encoding Byte; [Console]::Error.WriteLine('한글 오류 출력'); exit 7"});
  const deadline=Date.now()+15000;
  while(service.processes.active.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
  const result=service.processes.poll(record.id);
  assert.equal(result.exitCode,7);assert.equal(result.state,'failed');
  assert.match(result.output,/한글 직접 출력/);assert.match(result.output,/한글 오류 출력/);
  assert.equal(result.output.split(content).length-1,2,'UTF-8 without BOM and UTF-16 with BOM both retain Korean');
  assert.match(result.output,/233/,'explicit Encoding overrides the process-local read default');
  assert.equal(await (await import('node:fs/promises')).readFile(file,'utf8'),content,'reading preserves original bytes');
});
