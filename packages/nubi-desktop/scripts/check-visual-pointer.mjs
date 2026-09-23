// Native visual-only check: no driver, provider, company app or mouse injection.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ComputerPointer} from '../runtime/computer-pointer.mjs';

if(process.platform!=='win32')throw Error('Windows required');
const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-pointer-check-')),script=path.join(directory,'state.ps1');
const pointer=new ComputerPointer();
await mkdir('verification',{recursive:true});
await writeFile(script,`param([long]$Window=0,[string]$Capture='')
Add-Type -AssemblyName PresentationFramework,System.Drawing
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class P {
[StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;}
[StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
[DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int i);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
}'
$p=New-Object P+Point;[P]::GetCursorPos([ref]$p)|Out-Null
$r=New-Object P+Rect;[P]::GetWindowRect([IntPtr]$Window,[ref]$r)|Out-Null
if($Capture){$bitmap=New-Object System.Drawing.Bitmap(120,84);$graphics=[System.Drawing.Graphics]::FromImage($bitmap);try{$graphics.CopyFromScreen($r.Left-12,$r.Top-12,0,0,$bitmap.Size);$bitmap.Save($Capture,[System.Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose()}}
@{x=$p.X;y=$p.Y;foreground=[P]::GetForegroundWindow().ToInt64();visible=[P]::IsWindowVisible([IntPtr]$Window);style=[P]::GetWindowLong([IntPtr]$Window,-20);left=$r.Left;top=$r.Top;motion=[System.Windows.SystemParameters]::ClientAreaAnimation}|ConvertTo-Json -Compress
`);
const state=async(hwnd=0,capture)=>JSON.parse((await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Window',String(hwnd),...(capture?['-Capture',path.resolve(capture)]:[])],{windowsHide:true})).stdout);
try{
  const before=await state();
  const first=await pointer.move({id:'visual-native-test'},{element:{x:140,y:140,width:40,height:40}});
  assert.equal(first.available,true,'helper did not start: '+(pointer.diagnostic||''));assert.equal(first.animated,false);
  const next=await pointer.move({id:'visual-native-test'},{element:{x:240,y:240,width:40,height:40}});
  await pointer.pulse();const shown=await state(next.hwnd,'verification/windows-uia-pointer-shape.png');
  assert.equal(shown.x,before.x);assert.equal(shown.y,before.y);assert.equal(shown.foreground,before.foreground);assert.equal(shown.visible,true);
  assert.equal(shown.style&0x08000020,0x08000020);assert.equal(shown.left,250);assert.equal(shown.top,250);assert.equal(next.animated,shown.motion);
  await pointer.hide();const hidden=await state(next.hwnd);assert.equal(hidden.visible,false);
  await writeFile('verification/windows-uia-visual-only.json',JSON.stringify({passed:true,first,next,shown,cursorUnchanged:true,foregroundUnchanged:true,hidden:true,scope:'Windows runner visual overlay only. No actual mouse input.'},null,2));
  console.log('Native visual pointer passed');
}finally{pointer.dispose();await rm(directory,{recursive:true,force:true});}
