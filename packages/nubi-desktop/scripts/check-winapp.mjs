import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {WinappComputer} from '../runtime/computer-use.mjs';
if(process.platform!=='win32')throw Error('Windows required');
const driver=path.resolve('generated/winapp'),manifest=JSON.parse(await readFile(path.join(driver,'manifest.json'),'utf8'));
const adapter=new WinappComputer({binary:path.join(driver,'winapp.exe'),digest:manifest.sha256});
const nativeCall=adapter.call.bind(adapter);
adapter.call=async args=>{const result=await nativeCall(args);if(args[0]==='screenshot'){await mkdir('verification',{recursive:true});await writeFile('verification/windows-uia-capture.json',JSON.stringify({args,result},null,2));}return result;};
const call=adapter.call.bind(adapter);adapter.call=async args=>{const result=await call(args);if(args[0]==='screenshot')await writeFile('verification/windows-uia-capture-'+(args.includes('--capture-screen')?'window':'element')+'.json',JSON.stringify({args,result},null,2));return result;};
const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-winapp-')),script=path.join(directory,'fixture.ps1');
await writeFile(script,`Add-Type -AssemblyName PresentationFramework\n$w=New-Object System.Windows.Window\n$w.Title='Nubi UIA Verification'\n$w.Width=500\n$w.Height=560\n$p=New-Object System.Windows.Controls.StackPanel\n$t=New-Object System.Windows.Controls.TextBox\n$t.Text='before'\n[System.Windows.Automation.AutomationProperties]::SetName($t,'Nubi value')\n[System.Windows.Automation.AutomationProperties]::SetAutomationId($t,'NubiValue')\n$p.Children.Add($t) | Out-Null\n$secret=New-Object System.Windows.Controls.PasswordBox\n[System.Windows.Automation.AutomationProperties]::SetName($secret,'Nubi password')\n$p.Children.Add($secret) | Out-Null\n$b=New-Object System.Windows.Controls.Button\n$b.Content='Verify'\n$b.Add_Click({$t.Text='clicked'})\n$p.Children.Add($b) | Out-Null\n$check=New-Object System.Windows.Controls.CheckBox\n$check.Content='Nubi enabled'\n[System.Windows.Automation.AutomationProperties]::SetAutomationId($check,'NubiEnabled')\n$p.Children.Add($check) | Out-Null\n$list=New-Object System.Windows.Controls.ListBox\n$first=New-Object System.Windows.Controls.ListBoxItem\n$first.Content='First option'\n$second=New-Object System.Windows.Controls.ListBoxItem\n$second.Content='Second option'\n[System.Windows.Automation.AutomationProperties]::SetAutomationId($second,'NubiSecond')\n$list.Items.Add($first) | Out-Null\n$list.Items.Add($second) | Out-Null\n$list.SelectedIndex=0\n$p.Children.Add($list) | Out-Null\n$tree=New-Object System.Windows.Controls.TreeView\n$branch=New-Object System.Windows.Controls.TreeViewItem\n$branch.Header='Nubi branch'\n[System.Windows.Automation.AutomationProperties]::SetAutomationId($branch,'NubiBranch')\n$leaf=New-Object System.Windows.Controls.TreeViewItem\n$leaf.Header='Details'\n$branch.Items.Add($leaf) | Out-Null\n$tree.Items.Add($branch) | Out-Null\n$p.Children.Add($tree) | Out-Null\n$w.Content=$p\n$w.ShowDialog() | Out-Null\n`);
const child=spawn('powershell.exe',['-NoProfile','-STA','-File',script],{stdio:['ignore','pipe','pipe'],windowsHide:false});let stderr='';child.stderr.on('data',d=>stderr+=d);
try{
 let window;for(let i=0;i<20;i++){window=(await adapter.windows()).find(v=>v.processId===child.pid);if(window)break;if(child.exitCode!==null)throw Error(stderr||'fixture exited');await new Promise(r=>setTimeout(r,500));}
 assert(window,'Fixture window not found');await mkdir('verification',{recursive:true});await writeFile('verification/windows-uia-status.json',JSON.stringify(await adapter.call(['status','-w',String(window.hwnd)]),null,2));const status=await adapter.status(window.hwnd);await writeFile('verification/windows-uia-inspect.json',JSON.stringify(await adapter.call(['inspect','-w',String(window.hwnd),'--depth','5']),null,2));const observation=await adapter.inspect(window.hwnd);
 const target=observation.elements.find(v=>v.name==='Nubi value'&&['Edit','TextBox'].includes(v.type));assert(target,'Editable UIA element missing');
 await writeFile('verification/windows-uia-property.json',JSON.stringify(await adapter.call(['get-property',target.selector,'-w',String(window.hwnd)]),null,2));const property=await adapter.property(window.hwnd,target.selector);assert.equal(property.password,'False');const password=observation.elements.find(v=>v.name==='Nubi password');assert(password);assert.equal((await adapter.property(window.hwnd,password.selector)).password,'True');
 await adapter.act(window.hwnd,target.selector,'set_value','Nubi verified');assert.equal(await adapter.value(window.hwnd,target.selector),'Nubi verified');
 const search=await adapter.search(window.hwnd,'Verify');const button=search.elements.find(v=>v.name==='Verify');assert(button,'UIA search did not find fixture button');
 assert.equal((await adapter.search(window.hwnd,'NubiMissingElement987654')).elements.length,0);
 await adapter.act(window.hwnd,button.selector,'invoke');assert.equal(await adapter.value(window.hwnd,target.selector),'clicked');
 const cursorScript=path.join(directory,'cursor.ps1');await writeFile(cursorScript,'Add-Type -AssemblyName System.Windows.Forms\n$p=[System.Windows.Forms.Cursor]::Position\n@{x=$p.X;y=$p.Y}|ConvertTo-Json -Compress');
 const cursor=async()=>JSON.parse((await promisify(execFile)('powershell.exe',['-NoProfile','-File',cursorScript],{windowsHide:true})).stdout);
 const patternChecks=[];
 for(const [selector,action,property,expected] of [['NubiEnabled','toggle_on','toggle','On'],['NubiEnabled','toggle_on','toggle','On'],['NubiEnabled','toggle_off','toggle','Off'],['NubiSecond','select','selected','True'],['NubiBranch','expand','expansion','Expanded'],['NubiBranch','collapse','expansion','Collapsed']]){
   const target=await adapter.property(window.hwnd,selector),beforePointer=await cursor();
   await adapter.act(window.hwnd,target.resolvedSelector,action);
   const afterPointer=await cursor(),actual=(await adapter.property(window.hwnd,selector)).controlState[property];
   assert.equal(actual,expected,action+' readback');assert.deepEqual(afterPointer,beforePointer,action+' moved the user pointer');
   patternChecks.push({action,selector,property,expected,actual,cursorUnchanged:true});
 }
 await writeFile('verification/windows-uia-patterns.json',JSON.stringify({patternChecks,scope:'Owned WPF controls on Windows runner; no claim for company apps, user focus isolation or model quality'},null,2));
 await adapter.capture(window.hwnd);const screenshot=await adapter.capture(window.hwnd,target.selector);assert(screenshot.width>0&&screenshot.data.length>0);
 await mkdir('verification',{recursive:true});await writeFile('verification/windows-uia.json',JSON.stringify({passed:true,driver:manifest.version,status,checks:['window discovery','UIA observation','password metadata','literal value write and readback','target search and empty search','button invoke and value readback','PNG capture','select/toggle/expand/collapse state readback','cursor position unchanged during UIA state actions'],scope:'Owned WPF fixture only; not company apps or model quality'},null,2));
 await writeFile('verification/windows-uia.png',Buffer.from(screenshot.data,'base64'));console.log('Windows UIA fixture passed');
}finally{child.kill();adapter.dispose();}
