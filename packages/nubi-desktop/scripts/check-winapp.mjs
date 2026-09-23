import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {WinappComputer} from '../runtime/computer-use.mjs';
import {ComputerPointer} from '../runtime/computer-pointer.mjs';
if(process.platform!=='win32')throw Error('Windows required');
const driver=path.resolve('generated/winapp'),manifest=JSON.parse(await readFile(path.join(driver,'manifest.json'),'utf8'));
const adapter=new WinappComputer({binary:path.join(driver,'winapp.exe'),digest:manifest.sha256});
const visualPointer=new ComputerPointer();
const nativeCall=adapter.call.bind(adapter);
adapter.call=async args=>{const result=await nativeCall(args);if(args[0]==='screenshot'){await mkdir('verification',{recursive:true});await writeFile('verification/windows-uia-capture.json',JSON.stringify({args,result},null,2));}return result;};
const call=adapter.call.bind(adapter);adapter.call=async args=>{const result=await call(args);if(args[0]==='screenshot')await writeFile('verification/windows-uia-capture-'+(args.includes('--capture-screen')?'window':'element')+'.json',JSON.stringify({args,result},null,2));return result;};
const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-winapp-')),script=path.join(directory,'fixture.ps1');
await writeFile(script,await readFile(new URL('./fixtures/windows-controls.ps1',import.meta.url)));
const child=spawn('powershell.exe',['-NoProfile','-STA','-File',script],{stdio:['ignore','pipe','pipe'],windowsHide:false});let stderr='';child.stderr.on('data',d=>stderr+=d);
try{
 await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{cleanup();reject(Error('fixture_start_timeout: '+stderr));},45000);
   const ready=chunk=>{if(chunk.toString().includes('NUBI_FIXTURE_READY')){cleanup();resolve();}};
   const exit=()=>{cleanup();reject(Error('fixture_start_failed: '+stderr));};
   function cleanup(){clearTimeout(timer);child.stdout.off('data',ready);child.off('exit',exit);}
   child.stdout.on('data',ready);child.once('exit',exit);
 });
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
 const beforeVisualCursor=await cursor(),visualBinding={id:'windows-uia-fixture'};
 const firstVisual=await visualPointer.move(visualBinding,await adapter.property(window.hwnd,button.selector));assert.equal(firstVisual.available,true,'visual pointer helper started: '+(visualPointer.diagnostic||''));assert.equal(firstVisual.animated,false,'first location is immediate');
 const visual=await visualPointer.move(visualBinding,property);assert.equal(visual.available,true);await visualPointer.pulse();
 const overlayImage=await adapter.capture(window.hwnd);await writeFile('verification/windows-uia-visual-pointer.png',Buffer.from(overlayImage.data,'base64'));
 const visualScript=path.join(directory,'visual.ps1');await writeFile(visualScript,`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class V {[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int i);[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);}'\n@{style=[V]::GetWindowLong([IntPtr]${visual.hwnd},-20);foreground=[V]::GetForegroundWindow().ToInt64();visible=[V]::IsWindowVisible([IntPtr]${visual.hwnd})}|ConvertTo-Json -Compress`);
 const readVisual=async()=>JSON.parse((await promisify(execFile)('powershell.exe',['-NoProfile','-File',visualScript],{windowsHide:true})).stdout);
 const nativeVisual=await readVisual();assert.equal(nativeVisual.visible,true);assert.notEqual(nativeVisual.foreground,visual.hwnd);assert.equal(nativeVisual.style&0x08000020,0x08000020);
 assert.deepEqual(await cursor(),beforeVisualCursor,'visual pointer must not move user cursor');
 await visualPointer.hide();assert.equal((await readVisual()).visible,false,'hide completes before evidence capture');
 await writeFile('verification/windows-uia-visual-pointer.json',JSON.stringify({firstVisual,visual,nativeVisual,cursorUnchanged:true,hiddenBeforeCapture:true,scope:'Native visual-only overlay on owned WPF fixture. No user input injection.'},null,2));
 const patternChecks=[];
 for(const [selector,action,property,expected] of [['NubiEnabled','toggle_on','toggle','On'],['NubiEnabled','toggle_on','toggle','On'],['NubiEnabled','toggle_off','toggle','Off'],['NubiSecond','select','selected','True'],['NubiBranch','expand','expansion','Expanded'],['NubiBranch','collapse','expansion','Collapsed']]){
   const target=await adapter.property(window.hwnd,selector),beforePointer=await cursor();
   await adapter.act(window.hwnd,target.resolvedSelector,action);
   const afterPointer=await cursor(),actual=(await adapter.property(window.hwnd,selector)).controlState[property];
   assert.equal(actual,expected,action+' readback');assert.deepEqual(afterPointer,beforePointer,action+' moved the user pointer');
   patternChecks.push({action,selector,property,expected,actual,cursorUnchanged:true});
 }
 await writeFile('verification/windows-uia-patterns.json',JSON.stringify({patternChecks,scope:'Owned WPF controls on Windows runner; no claim for company apps, user focus isolation or model quality'},null,2));
 const pointerChecks=[];
 for(const [action,expected] of [['hover','hovered'],['pointer_click','mouse-clicked'],['pointer_double_click','double-clicked'],['pointer_right_click','right-clicked'],['drag','dropped']]){
   const selector=action==='drag'?'NubiDragFrom':'NubiMouse',targetControl=await adapter.property(window.hwnd,selector);
   const destination=action==='drag'?await adapter.property(window.hwnd,'NubiDragTo'):null;
   await adapter.act(window.hwnd,target.selector,'set_value','await-hover');
   await assert.rejects(adapter.act(window.hwnd,targetControl.resolvedSelector,action),/computer_pointer_consent_required/);
   await adapter.act(window.hwnd,targetControl.resolvedSelector,action,undefined,{pointerConsent:true,destinationSelector:destination?.resolvedSelector});
   const actual=await adapter.value(window.hwnd,target.selector);assert.equal(actual,expected,action+' real WPF event result');
   pointerChecks.push({action,expected,actual,cursor:await cursor()});
 }
 await writeFile('verification/windows-uia-pointer.json',JSON.stringify({pointerChecks,scope:'Explicitly permitted shared-pointer actions on an owned WPF fixture. Host HITL gates tested separately; not company apps.'},null,2));
 await adapter.capture(window.hwnd);const screenshot=await adapter.capture(window.hwnd,target.selector);assert(screenshot.width>0&&screenshot.data.length>0);
 await mkdir('verification',{recursive:true});await writeFile('verification/windows-uia.json',JSON.stringify({passed:true,driver:manifest.version,status,checks:['window discovery','UIA observation','password metadata','literal value write and readback','target search and empty search','button invoke and value readback','PNG capture','select/toggle/expand/collapse state readback','cursor position unchanged during UIA state actions','explicitly permitted mouse events and real drag/drop'],scope:'Owned WPF fixture only; not company apps or model quality'},null,2));
 await writeFile('verification/windows-uia.png',Buffer.from(screenshot.data,'base64'));console.log('Windows UIA fixture passed');
}finally{visualPointer.dispose();child.kill();adapter.dispose();}
