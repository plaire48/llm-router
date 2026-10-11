import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {POWERSHELL_TEXT_ARGS,POWERSHELL_UTF8_PREFIX} from './powershell-encoding.mjs';

const encoded=text=>Buffer.from(text,'utf16le').toString('base64');
// The approved command is passed in memory, never loaded from a mutable .ps1
// file after UAC. No ExecutionPolicy changes, stored credentials or shell UI.
const launcher=POWERSHELL_UTF8_PREFIX+String.raw`
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$receipt = @{ id=$request.id; state='unknown'; started=$false; exitCode=$null }
$pipe=$null; $reader=$null; $writer=$null; $log=$null
try {
  $tokens=$null; $parseErrors=$null
  [System.Management.Automation.Language.Parser]::ParseInput($request.script,[ref]$tokens,[ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) { $receipt.state='syntax_error' }
  elseif (Test-Path -LiteralPath $request.cancelPath) { $receipt.state='cancelled' }
  else {
    $pipe=New-Object IO.Pipes.NamedPipeServerStream($request.pipeName,[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,[IO.Pipes.PipeOptions]::Asynchronous)
    $connection=$pipe.BeginWaitForConnection($null,$null)
    $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-InputFormat','Text','-OutputFormat','Text','-EncodedCommand',$request.command) -PassThru
    $null=$child.Handle
    while(!$connection.AsyncWaitHandle.WaitOne(100) -and !$child.HasExited) {}
    if($connection.IsCompleted){
      $pipe.EndWaitForConnection($connection)
      $reader=New-Object IO.StreamReader($pipe)
      $writer=New-Object IO.StreamWriter($pipe)
      $writer.AutoFlush=$true
      $log=New-Object IO.StreamWriter($request.logPath,$false,[Text.UTF8Encoding]::new($false))
      $writer.WriteLine($(if(Test-Path -LiteralPath $request.cancelPath){'cancel'}else{'run'}))
      while($null -ne ($line=$reader.ReadLine())){
        if($line.Length -gt 24000){throw 'invalid_frame'}
        $frame=$line | ConvertFrom-Json
        if($frame.type -eq 'started'){$receipt.started=$true}
        elseif($frame.type -eq 'output'){$log.WriteLine([string]$frame.text)}
        else{throw 'invalid_frame'}
      }
    }
    $child.WaitForExit()
    $receipt.exitCode=$child.ExitCode
    $receipt.state=if($receipt.started){'finished'}elseif($child.ExitCode -eq 1223){'cancelled'}else{'unknown'}
  }
} catch {
  $errorItem=$_.Exception
  while($errorItem -and $errorItem.NativeErrorCode -ne 1223){$errorItem=$errorItem.InnerException}
  if($errorItem -and !$receipt.started){$receipt.state='cancelled'}
} finally {
  if($log){$log.Dispose()}; if($writer){$writer.Dispose()}; if($reader){$reader.Dispose()}; if($pipe){$pipe.Dispose()}
}
[Console]::Out.WriteLine(($receipt | ConvertTo-Json -Compress))
`;

export function elevationRequest({id,cwd,script,logPath,cancelPath}) {
  if(typeof script!=='string'||!script.trim()||script.length>3000)throw new Error('elevation_command_limit');
  const pipeName='nubi-elevation-'+id;
  const payload=Buffer.from(JSON.stringify({cwd,script,pipeName}),'utf8').toString('base64');
  // The elevated wrapper only uses IPC for receipts. It never writes a log,
  // marker or result to a lower-privilege writable path after consent.
  const command=encoded(POWERSHELL_UTF8_PREFIX+String.raw`
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(!$admin){exit 740}
$pipe=New-Object IO.Pipes.NamedPipeClientStream('.',$p.pipeName,[IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(15000)
$reader=New-Object IO.StreamReader($pipe)
$writer=New-Object IO.StreamWriter($pipe)
$writer.AutoFlush=$true
if($reader.ReadLine() -ne 'run'){exit 1223}
Get-ChildItem Env: | Where-Object {$_.Name -match 'TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|CREDENTIAL'} | ForEach-Object {Remove-Item ('Env:'+ $_.Name)}
Set-Location -LiteralPath $p.cwd
$writer.WriteLine('{"type":"started"}')
$global:LASTEXITCODE=0
try {
  & ([ScriptBlock]::Create($p.script)) *>&1 | ForEach-Object {
    $text=[string]$_
    for($offset=0;$offset -lt $text.Length;$offset+=2000){$writer.WriteLine((@{type='output';text=$text.Substring($offset,[Math]::Min(2000,$text.Length-$offset))} | ConvertTo-Json -Compress))}
  }
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  exit 0
} catch {
  $writer.WriteLine((@{type='output';text='Command failed. Inspect the approved command and actual state before retrying.'} | ConvertTo-Json -Compress))
  exit 1
}
`);
  if(command.length>28000)throw new Error('elevation_command_limit');
  return {args:[...POWERSHELL_TEXT_ARGS,'-EncodedCommand',encoded(launcher)],input:JSON.stringify({id,script,command,cancelPath,logPath,pipeName})};
}

export function elevationReceipt(text,id) {
  try {
    const value=JSON.parse(text.trim());
    if(value.id!==id||!['finished','cancelled','syntax_error','unknown'].includes(value.state)||typeof value.started!=='boolean')return null;
    if(value.state==='finished'&&(!value.started||!Number.isSafeInteger(value.exitCode)))return null;
    if(['cancelled','syntax_error'].includes(value.state)&&value.started)return null;
    return value;
  }catch{return null;}
}
async function logTail(file) {
  let handle;try{handle=await open(file,'r');const size=(await handle.stat()).size,buffer=Buffer.alloc(Math.min(size,128000));const {bytesRead}=await handle.read(buffer,0,buffer.length,Math.max(0,size-buffer.length));let start=0;while(start<bytesRead&&(buffer[start]&0xc0)===0x80)start++;return buffer.subarray(start,bytesRead).toString('utf8');}
  catch(error){if(error.code==='ENOENT')return '';throw error;}finally{await handle?.close();}
}

export async function startElevated(owner,{cwd,script,profile,taskId,setupActionId},{platform=process.platform,launch=spawn}={}) {
  if(platform!=='win32'||profile!=='powershell')throw new Error('elevation_unavailable');
  const action=owner.store.get('setup-action:'+setupActionId);
  if(!action||action.state!=='starting'||action.privilege!=='administrator'||!action.elevationConsentAt||action.taskId!==taskId||action.workspace!==cwd||action.script!==script||action.profile!==profile)throw new Error('elevation_approval_required');
  if(action.resultProcessId)return owner.poll(action.resultProcessId);
  const id=randomUUID(),directory=path.join(owner.store.directory,'elevation',id);
  const logPath=path.join(directory,'output.log'),cancelPath=path.join(directory,'cancel');
  const request=elevationRequest({id,cwd,script,logPath,cancelPath});
  const record={id,taskId,cwd,script,profile,setupActionId,privilege:'administrator',startedAt:new Date().toISOString(),state:'running',lastOutputAt:Date.now(),execution:'requested',output:'Windows 승인과 실행 결과를 기다리고 있습니다.',exitCode:null,logPath,autoDiagnose:true};
  mkdirSync(directory,{recursive:true,mode:0o700});
  owner.store.set('process:'+id,record);
  owner.store.set('setup-action:'+setupActionId,{...action,resultProcessId:id});
  owner.records.set(id,record);
  let output='',settled=false;const decoder=new StringDecoder('utf8');
  const persist=()=>owner.store.set('process:'+id,record);
  const finish=async(code)=>{
    if(settled)return;settled=true;
    const receipt=code===0?elevationReceipt(output,id):null;
    record.exitCode=receipt?.exitCode??null;
    record.execution=receipt?.state==='finished'?'completed':receipt&&['cancelled','syntax_error'].includes(receipt.state)?'not_started':'unknown';
    record.state=record.execution==='unknown'?'interrupted':receipt.state==='cancelled'||record.cancellationRequested?'cancelled':receipt.state==='syntax_error'||record.exitCode!==0?'failed':'completed';
    record.fault=record.execution==='unknown'?'elevation_outcome_unknown':receipt.state==='cancelled'?'elevation_cancelled':receipt.state==='syntax_error'?'shell_syntax':record.state==='failed'?'command_failed':undefined;
    try{record.output=await logTail(logPath)||record.fault||'실행이 종료됐습니다. 실제 변경 결과를 확인해 주세요.';}catch{record.logIncomplete=true;}
    record.finishedAt=new Date().toISOString();persist();owner.active.delete(id);owner.records.delete(id);
    owner.store.event('process_finished',{id,state:record.state,exitCode:record.exitCode});
    try{owner.onFinished({...record});}catch{}
  };
  try {
    const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/(TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|CREDENTIAL)/i.test(name)));
    const child=launch(executable,request.args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.nubiElevation={cancelPath};owner.active.set(id,child);
    child.stdout.on('data',data=>{output=(output+decoder.write(data)).slice(-32000);});
    child.stderr.on('data',()=>{}); // No raw upstream/runtime details in receipts.
    child.once('error',()=>{void finish(null);});child.once('close',code=>{output=(output+decoder.end()).slice(-32000);void finish(code);});
    child.stdin.on('error',()=>{});child.stdin.end(request.input);
  }catch{await finish(null);}
  return {...record};
}

export function stopElevated(owner,id,child,reason) {
  const record=owner.records.get(id);
  record.state='stopping';record.cancellationRequested=true;record.stopReason=reason;
  record.output='중지를 요청했습니다. 이미 시작한 관리자 작업의 중지는 보장되지 않습니다. 실행 결과를 기다립니다.';
  owner.store.set('process:'+id,record);
  try{writeFileSync(child.nubiElevation.cancelPath,'cancel',{flag:'wx'});}catch{}
  // A normal user process cannot reliably terminate an elevated process.
  // Keep observing its exit instead of killing the watcher and claiming stop.
  return {...record};
}
