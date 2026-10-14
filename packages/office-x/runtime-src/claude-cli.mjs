// Office adapter: preserve the vendored Claude protocol, normalize only discovery
// and process launching. No installation, execution-policy changes or auth reads.
import {spawn} from 'node:child_process';
import {access,readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {claudeEnvironment,claudeFailureCode} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-code.mjs';

// Only this non-secret launch hint survives the subscription credential filter.
// Do not restore API keys, custom endpoints, or auth-store overrides.
export function officeClaudeEnvironment(source=process.env){
  const env=claudeEnvironment(source);
  for(const key of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_|CLAUDE_CONFIG_DIR$|CLAUDECODE$)/i.test(key))delete env[key];
  const bash=envValue(source,'CLAUDE_CODE_GIT_BASH_PATH');
  if(bash&&path.win32.isAbsolute(bash)&&/bash\.exe$/i.test(bash)&&!/[\r\n\0"]/.test(bash))env.CLAUDE_CODE_GIT_BASH_PATH=bash;
  return env;
}
export function claudeProcessFailure(stderr){
  if(/requires git-bash|could not find.*(?:git.bash|bash.exe)|CLAUDE_CODE_GIT_BASH_PATH/i.test(stderr))return 'claude_shell_missing';
  if(/unknown option|unknown command/i.test(stderr))return 'claude_cli_update';
  if(/certificate|unable_to_verify_leaf_signature|self.signed/i.test(stderr))return 'tls_untrusted';
  if(/ENOTFOUND|EAI_AGAIN/i.test(stderr))return 'network_dns';
  if(/ECONNREFUSED/i.test(stderr))return 'network_refused';
  if(/ETIMEDOUT|ECONNRESET|fetch failed/i.test(stderr))return 'network_error';
  return 'claude_cli_failed';
}
const envValue=(env,key)=>env[Object.keys(env).find(k=>k.toLowerCase()===key.toLowerCase())]||'';
const withPath=(env,value)=>({...Object.fromEntries(Object.entries(env).filter(([k])=>k.toLowerCase()!=='path')),Path:value});
function pathDirectories(value,p){
  return [...new Set(value.split(p===path.win32?';':':').map(v=>v.trim().replace(/^"(.*)"$/,'$1')).filter(v=>p.isAbsolute(v)))];
}
function mergePath(a,b){return [...new Set([...pathDirectories(a,path.win32),...pathDirectories(b,path.win32)])].join(';');}
async function exists(file){try{await access(file,process.platform==='win32'?constants.F_OK:constants.X_OK);return true;}catch{return false;}}
const encoded=script=>Buffer.from(script,'utf16le').toString('base64');
const utf8="$ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $OutputEncoding=[Console]::OutputEncoding;";
const loadProfiles=`
foreach($profileFile in @($PROFILE.AllUsersAllHosts,$PROFILE.AllUsersCurrentHost,$PROFILE.CurrentUserAllHosts,$PROFILE.CurrentUserCurrentHost)) {
  if(Test-Path -LiteralPath $profileFile){try{. $profileFile *> $null}catch{}}
}
`;
const discoveryScript=utf8+`
$paths=@($env:Path,[Environment]::GetEnvironmentVariable('Path','User'),[Environment]::GetEnvironmentVariable('Path','Machine'))
$env:Path=($paths | Where-Object { $_ }) -join ';'
$commands=@(Get-Command claude -All -ErrorAction SilentlyContinue | ForEach-Object {
  $c=$_; $i=0
  while($c.CommandType -eq 'Alias' -and $i++ -lt 8) { $c=$c.ResolvedCommand; if(!$c){break} }
  if($c){@{type=[string]$c.CommandType;file=$c.Path;name=$c.Name}}
})
[Console]::WriteLine('OFFICEX_CLAUDE_DISCOVERY:'+(@{path=$env:Path;commands=$commands}|ConvertTo-Json -Compress -Depth 4))
`;
async function* discoverShells(env,hasFile){
  const root=envValue(env,'SystemRoot')||'C:\\Windows';
  const shells=[path.win32.join(root,'Sysnative','WindowsPowerShell','v1.0','powershell.exe'),path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ...pathDirectories(envValue(env,'Path'),path.win32).map(dir=>path.win32.join(dir,'pwsh.exe')),
    path.win32.join(envValue(env,'ProgramW6432')||envValue(env,'ProgramFiles')||'C:\\Program Files','PowerShell','7','pwsh.exe')];
  const available=[];
  for(const shell of [...new Set(shells)])if(await hasFile(shell))available.push(shell);
  // Profile loading is a last resort, used only when ordinary installations fail.
  for(const profile of [false,true])for(const shell of available){
    try{
      const output=await runClaude({kind:'native',file:shell,prefixArgs:[]},['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded((profile?loadProfiles:'')+discoveryScript)],{environment:env,timeoutMs:5000});
      const line=output.split(/\r?\n/).find(line=>line.startsWith('OFFICEX_CLAUDE_DISCOVERY:'));
      if(line)yield {...JSON.parse(line.slice('OFFICEX_CLAUDE_DISCOVERY:'.length)),shell,profile};
    }catch{/* Try another shell; never retain profile output or account details. */}
  }
}
async function normalize(file,{p,hasFile,read,env,shell,profile=false}){
  if(!p.isAbsolute(file)||!await hasFile(file))return null;
  const ext=p.extname(file).toLowerCase();
  if(['.cmd','.bat','.ps1'].includes(ext)){
    // npm shims are not executables. Read the installed public package metadata
    // and run its declared entry point directly, preserving JSON argv exactly.
    const directory=p.dirname(file),manifest=p.join(directory,'node_modules','@anthropic-ai','claude-code','package.json');
    try{
      const pkg=JSON.parse(await read(manifest,'utf8')),bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.claude;
      if(pkg.name==='@anthropic-ai/claude-code'&&typeof bin==='string'){
        const packageRoot=p.dirname(manifest),entry=p.resolve(packageRoot,bin),relative=p.relative(packageRoot,entry);
        if(relative&&!relative.startsWith('..')&&!p.isAbsolute(relative)&&await hasFile(entry)){
          if(p.extname(entry).toLowerCase()==='.exe')return {kind:'native',file:entry,prefixArgs:[],environment:env};
          if(/\.[cm]?js$/i.test(entry))return {kind:'native',file:process.execPath,prefixArgs:[entry],environment:env};
        }
      }
    }catch{/* Non-npm wrappers still run through their own interpreter. */}
    if(ext==='.ps1')return {kind:'powershell',file,shell:shell||p.join(envValue(env,'SystemRoot')||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),profile,environment:env};
    return {kind:'cmd',file,environment:env};
  }
  return {kind:'native',file,prefixArgs:[],environment:env};
}
export async function findClaudeBinary(options={}){
  const platform=options.platform||process.platform,p=platform==='win32'?path.win32:path.posix;
  const env={...(options.env||process.env)},home=options.homedir||os.homedir(),hasFile=options.exists||exists,read=options.read||readFile;
  const probe=options.probe||(launch=>runClaude(launch,['--version'],{timeoutMs:10000}));
  const seen=new Set();let failure=null;
  async function verify(launch){
    if(!launch)return null;
    const key=JSON.stringify([launch.kind,launch.file,launch.prefixArgs,launch.shell,launch.profile,envValue(launch.environment||{},'Path')]);
    if(seen.has(key))return null;seen.add(key);
    try{const version=await probe(launch);if(!/^\s*\d+\.\d+\.\d+(?:[^\r\n]*)\s*$/m.test(version))throw Error('claude_cli_failed');return launch;}
    catch(error){failure=error.message==='claude_cli_timeout'?'claude_cli_timeout':'claude_cli_failed';return null;}
  }
  async function scan(directories,environment=env,shell,profile){
    const names=platform==='win32'?['claude.exe','claude.cmd','claude.bat','claude.ps1']:['claude'];
    for(const dir of [...new Set(directories)])for(const name of names){
      const launch=await normalize(p.join(dir,name),{p,hasFile,read,env:environment,shell,profile}),working=await verify(launch);
      if(working)return working;
    }
    return null;
  }
  const directories=[...pathDirectories(envValue(env,'Path'),p),p.join(home,'.local','bin')];
  if(platform==='win32'){
    directories.push(p.join(envValue(env,'APPDATA')||p.join(home,'AppData','Roaming'),'npm'),
      p.join(envValue(env,'LOCALAPPDATA')||p.join(home,'AppData','Local'),'Microsoft','WinGet','Links'));
    for(const key of ['NPM_CONFIG_PREFIX','NVM_SYMLINK'])if(envValue(env,key))directories.push(envValue(env,key));
    if(envValue(env,'VOLTA_HOME'))directories.push(p.join(envValue(env,'VOLTA_HOME'),'bin'));
  }
  const direct=await scan(directories);if(direct)return direct;
  if(platform==='win32'){
    const rows=options.shellDiscovery?await options.shellDiscovery(env):discoverShells(env,hasFile);
    for await(const row of rows){
      const environment=withPath(env,mergePath(row.path||'',envValue(env,'Path')));
      for(const command of row.commands||[]){
        const launch=command.type==='Function'||command.type==='Filter'
          ? {kind:'powershell',file:'claude',shell:row.shell,profile:row.profile,environment}
          : await normalize(command.file||'',{p,hasFile,read,env:environment,shell:row.shell,profile:row.profile});
        const working=await verify(launch);if(working)return working;
      }
      const working=await scan(pathDirectories(envValue(environment,'Path'),p),environment,row.shell,row.profile);if(working)return working;
    }
  }
  throw Error(failure||'claude_cli_missing');
}

const meta=/([()\][%!^"`<>&|;, *?])/g;
function cmdArgument(value){
  // Quote CRT argv, then escape twice: once for CMD and once for the batch shim.
  const quoted='"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\*)$/,'$1$1')+'"';
  return quoted.replace(meta,'^$1').replace(meta,'^$1');
}
const powershellScript=utf8+`
$ErrorActionPreference='Stop'
try {
  $payload=ConvertFrom-Json ([IO.File]::ReadAllText($env:OFFICEX_CLAUDE_PAYLOAD,[Text.Encoding]::UTF8))
  $arguments=@($payload.arguments | ForEach-Object { [string]$_ })
  $global:LASTEXITCODE=0
  & $payload.file @arguments
  if($null -ne $LASTEXITCODE){exit $LASTEXITCODE}
} catch { exit 1 }
`;
async function prepareLaunch(binary,args,environment,directory){
  const launch=typeof binary==='string'?{kind:process.platform==='win32'&&/\.(cmd|bat)$/i.test(binary)?'cmd':'native',file:binary,prefixArgs:[]}:binary;
  let env={...officeClaudeEnvironment(),...launch.environment,...environment};
  // Sanitize the discovery environment too; credentials stay with the CLI.
  env={...officeClaudeEnvironment(env),...environment};
  if(process.platform==='win32'){
    // Windows environment keys are case-insensitive; Node otherwise chooses the
    // first alphabetic duplicate (PATH can shadow a newly discovered Path).
    const merged=new Map();
    for(const source of [officeClaudeEnvironment(),launch.environment||{},environment])for(const [key,value] of Object.entries(source))merged.set(key.toLowerCase(),[key,value]);
    env={...officeClaudeEnvironment(Object.fromEntries(merged.values())),...environment};
  }
  if(launch.kind==='native')return {file:launch.file,args:[...(launch.prefixArgs||[]),...args],env};
  if(launch.kind==='powershell'){
    const payload=path.join(directory,'arguments.json');
    await writeFile(payload,JSON.stringify({file:launch.file,arguments:args}),{mode:0o600});
    return {file:launch.shell,args:['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded((launch.profile?loadProfiles:'')+powershellScript)],env:{...env,OFFICEX_CLAUDE_PAYLOAD:payload}};
  }
  if(launch.kind!=='cmd')throw Error('claude_cli_failed');
  if(/[\r\n\0"]/.test(launch.file)||args.some(arg=>/[\r\n\0]/.test(arg)))throw Error('claude_cli_failed');
  // Environment expansion occurs once. Passing escaped values this way avoids
  // expanding literal %PATH% in user paths, prompts or JSON a second time.
  env.OFFICEX_CLAUDE_FILE=launch.file;
  args.forEach((arg,i)=>{env['OFFICEX_CLAUDE_ARG_'+i]=cmdArgument(arg);});
  const command='""%OFFICEX_CLAUDE_FILE%" '+args.map((_,i)=>'%OFFICEX_CLAUDE_ARG_'+i+'%').join(' ')+'"';
  return {file:path.win32.join(envValue(env,'SystemRoot')||'C:\\Windows','System32','cmd.exe'),args:['/d','/v:off','/s','/c',command],env,windowsVerbatimArguments:true};
}
export async function runClaude(binary,args,{input='',signal,onEvent=()=>{},environment={},timeoutMs=300000}={}){
  if(signal?.aborted)throw Error('cancelled');
  const directory=await mkdtemp(path.join(os.tmpdir(),'office-x-claude-'));
  try{
    const launch=await prepareLaunch(binary,args,environment,directory);
    return await new Promise((resolve,reject)=>{
      const child=spawn(launch.file,launch.args,{cwd:directory,env:launch.env,shell:false,windowsHide:true,windowsVerbatimArguments:launch.windowsVerbatimArguments,stdio:['pipe','pipe','pipe']});
      let output='',line='',stderr='',bytes=0,failure=null,reportedFailure=null,killTimer;
      const stop=code=>{
        failure ||= Error(code);
        if(process.platform==='win32'&&child.pid){
          const killer=spawn(path.win32.join(envValue(launch.env,'SystemRoot')||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
          killer.on('error',()=>child.kill());killer.unref();
        }else child.kill();
        killTimer ||= setTimeout(()=>child.kill('SIGKILL'),1500);killTimer.unref();
      };
      const abort=()=>stop('cancelled');signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>stop('claude_cli_timeout'),timeoutMs);timer.unref();
      const clean=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
      const emit=raw=>{let event;try{event=JSON.parse(raw);}catch{return;}reportedFailure=claudeFailureCode(event)||reportedFailure;try{onEvent(event);}catch{stop('claude_cli_failed');}};
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        bytes+=Buffer.byteLength(chunk);if(bytes>2000000){stop('output_limit');return;}
        output+=chunk;line+=chunk;let end;
        while((end=line.indexOf('\n'))>=0){emit(line.slice(0,end));line=line.slice(end+1);}
      });
      child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);});child.stdin.on('error',()=>{});
      child.on('error',error=>{clean();reject(Error(error.code==='ENOENT'?'claude_cli_missing':'claude_cli_failed'));});
      child.on('close',code=>{clean();if(line.trim())emit(line);if(failure)reject(failure);else if(code!==0){let unauthenticated=false;if(args[0]==='auth'&&args[1]==='status')try{unauthenticated=JSON.parse(output).loggedIn===false;}catch{}reject(Error(unauthenticated?'claude_login_required':reportedFailure||claudeProcessFailure(stderr)));}else resolve(output);});
      child.stdin.end(input);if(signal?.aborted)abort();
    });
  }finally{await rm(directory,{recursive:true,force:true});}
}
