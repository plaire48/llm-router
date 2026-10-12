import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {interactiveShell,TerminalHost}=createRequire(import.meta.url)('../electron-app/terminal-host.cjs');
test('interactive PowerShell prefers installed 7 and retains its real startup banner',async()=>{
 const shell=await interactiveShell('powershell',{platform:'win32',env:{ProgramFiles:'C:\\Program Files'},lookup:async()=>{throw Error();},exists:async file=>{assert.equal(file,'C:\\Program Files\\PowerShell\\7\\pwsh.exe');}});
 assert.match(shell.executable,/pwsh\.exe$/);assert.deepEqual(shell.argv,['-NoProfile']);
});
test('PowerShell falls back to the installed Windows shell, never a fabricated version',async()=>{
 const shell=await interactiveShell('powershell',{platform:'win32',env:{SystemRoot:'C:\\Windows'},lookup:async()=>{throw Error();},exists:async file=>{if(file.includes('pwsh.exe'))throw Error();}});
 assert.equal(shell.executable,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.deepEqual(shell.argv,['-NoProfile']);
});
test('a project change during terminal setup refuses spawning',async()=>{
 let reads=0,spawns=0;const host=new TerminalHost({notify:()=>{},profiles:async()=>[{id:'bash',executable:'/bin/bash'}],invoke:async method=>{
  if(method==='overview')return {projectId:'a',defaultShell:'bash',profiles:[{id:'bash',executable:'/bin/bash'}]};
  if(method==='browseDirectory')return {absolute:'/fixture'};
  if(method==='projectPath'){if(++reads>1)throw Error('project_changed');return {projectId:'a',path:'/fixture'};}
 }});host.call=async()=>{spawns++;};
 await assert.rejects(host.request({action:'open',id:'terminal-a',projectId:'a'}),/project_changed/);assert.equal(reads,2);assert.equal(spawns,0);
});
test('terminal control requires the bound project and does not forward arbitrary actions',async()=>{
 const host=new TerminalHost({notify:()=>{}});host.sessions.set('one','a');let calls=0;host.call=async()=>{calls++;return {};};
 await assert.rejects(host.request({action:'input',id:'one',projectId:'b',data:'pwd\r'}),/terminal_session_missing/);
 await assert.rejects(host.request({action:'dispose',id:'one',projectId:'a'}),/method_invalid/);assert.equal(calls,0);
 await host.request({action:'input',id:'one',projectId:'a',data:'pwd\r'});assert.equal(calls,1);
});
test('pending opens are deduplicated and cannot attach a different project',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let starts=0;
 const host=new TerminalHost({notify:()=>{},profiles:async()=>[{id:'bash',executable:'/bin/bash'}],invoke:async method=>{if(method==='projectPath'){await gate;return {projectId:'a'};}return {absolute:'/fixture'};}});
 host.call=async()=>{starts++;return {state:'running'};};
 const first=host.request({action:'open',id:'same',projectId:'a'}),second=host.request({action:'open',id:'same',projectId:'a'});
 await assert.rejects(host.request({action:'open',id:'same',projectId:'b'}),/terminal_session_missing/);
 release();await Promise.all([first,second]);assert.equal(starts,1);
});
test('disposing the host cancels a pending open before a shell is spawned',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let starts=0;
 const host=new TerminalHost({notify:()=>{},invoke:async()=>{await gate;return {projectId:'a'};}});host.call=async()=>{starts++;};
 const pending=host.request({action:'open',id:'late',projectId:'a'});host.dispose();release();
 await assert.rejects(pending,/terminal_disconnected/);assert.equal(starts,0);
});
