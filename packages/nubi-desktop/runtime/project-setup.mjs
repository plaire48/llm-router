// What a folder needs before it opens as a project (user decision 2026-09-30): Git installed, and the folder
// in a Git repository. The host shows each exact command and runs it only after the user approves it. When
// the prepared command fails, the model reads the failure and proposes another command, again for approval.
import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {promisify} from 'node:util';
import {git} from './files.mjs';

const exec=promisify(execFile);
const OUTPUT=20000,COMMAND=2000,ATTEMPTS=4;
export const SETUP_IDENTITY={name:'누비 Workspace',email:'nubi-workspace@localhost'};

// A per-user install needs no administrator rights, which company PCs often withhold.
export function gitInstallPlan(platform=process.platform){
  if(platform==='win32')return {kind:'install_git',profile:'powershell',source:'prepared',
    command:'winget install --id Git.Git -e --source winget --scope user --silent --accept-package-agreements --accept-source-agreements',
    effects:'Windows 패키지 관리자(winget)로 Git for Windows를 현재 사용자에게 설치합니다. 관리자 권한은 쓰지 않습니다.'};
  if(platform==='darwin')return {kind:'install_git',profile:'bash',source:'prepared',command:'xcode-select --install',
    effects:'macOS의 명령줄 도구 설치 창을 엽니다. 창에서 설치를 누르고, 끝나면 다시 확인해 주세요.'};
  return {kind:'install_git',profile:'bash',source:'prepared',command:null,effects:'이 운영체제에서는 배포판의 패키지 관리자로 Git을 설치해 주세요.'};
}

export function repositoryPlan({identity}){
  const commit=identity?'git commit --allow-empty -m "누비 Workspace 시작"':`git -c user.name="${SETUP_IDENTITY.name}" -c user.email=${SETUP_IDENTITY.email} commit --allow-empty -m "누비 Workspace 시작"`;
  return {kind:'init_repository',profile:'git',source:'prepared',command:'git init\n'+commit,
    effects:'이 폴더에 Git 저장소를 만들고 빈 첫 커밋을 남깁니다. 파일은 커밋하지 않습니다.'+(identity?'':' Git 사용자 이름이 없어 첫 커밋 작성자를 "누비 Workspace"로 둡니다.')};
}

// Where an installer puts git.exe. A running app keeps the PATH it started with, so a new install is found here.
export function gitCandidates(env=process.env,platform=process.platform){
  if(platform!=='win32')return ['/usr/bin','/usr/local/bin','/opt/homebrew/bin'].map(dir=>path.join(dir,'git'));
  const roots=[env.LOCALAPPDATA&&path.win32.join(env.LOCALAPPDATA,'Programs','Git'),env.ProgramFiles&&path.win32.join(env.ProgramFiles,'Git'),env['ProgramFiles(x86)']&&path.win32.join(env['ProgramFiles(x86)'],'Git')].filter(Boolean);
  return roots.map(root=>path.win32.join(root,'cmd','git.exe'));
}

// Git on PATH, or a newly installed one whose folder is then added to this process's PATH.
export async function findGit({env=process.env,platform=process.platform,run=exec,exists=file=>access(file).then(()=>true,()=>false)}={}){
  const version=async file=>{try{const {stdout}=await run(file,['--version'],{windowsHide:true,timeout:10000,env});return stdout.trim();}catch{return null;}};
  const onPath=await version('git');if(onPath)return {available:true,version:onPath,added:null};
  for(const file of gitCandidates(env,platform)){
    if(!await exists(file))continue;
    const found=await version(file);if(!found)continue;
    const key=Object.keys(env).find(name=>name.toUpperCase()==='PATH')||'PATH',dir=(platform==='win32'?path.win32:path.posix).dirname(file);
    env[key]=dir+(platform==='win32'?';':':')+(env[key]||'');
    return {available:true,version:found,added:dir};
  }
  return {available:false,version:null,added:null};
}

const tail=text=>String(text||'').slice(-OUTPUT);
export async function runSetupCommand(plan,{cwd,signal,run=exec,timeoutMs=15*60*1000}={}){
  if(!plan?.command||plan.profile==='git')throw new Error('setup_plan_invalid');
  const [file,args]=plan.profile==='powershell'?['powershell.exe',['-NoProfile','-NonInteractive','-Command',plan.command]]:['bash',['-c',plan.command]];
  try{const {stdout,stderr}=await run(file,args,{cwd,signal,timeout:timeoutMs,windowsHide:true,maxBuffer:8*1024*1024});return {exitCode:0,output:tail(stdout+stderr)};}
  catch(error){
    if(signal?.aborted)throw new Error('cancelled');
    return {exitCode:Number.isInteger(error.code)?error.code:null,error:error.code==='ENOENT'?'shell_unavailable':error.killed?'setup_timeout':'setup_failed',output:tail((error.stdout||'')+(error.stderr||'')||error.message)};
  }
}

export async function gitIdentity(root){
  const read=async key=>{try{return (await git(root,['config','--get',key])).trim();}catch{return '';}};
  return Boolean(await read('user.name')&&await read('user.email'));
}

export async function initializeRepository(root){
  await git(root,['init','-q']);
  const identity=await gitIdentity(root);
  await git(root,[...(identity?[]:['-c','user.name='+SETUP_IDENTITY.name,'-c','user.email='+SETUP_IDENTITY.email]),'commit','--allow-empty','-q','-m','누비 Workspace 시작']);
  return {identity};
}

export const SETUP_PROMPT='You help a user install Git on their own PC so that a folder can open as a project in Nubi Desktop. Earlier commands failed; their outputs follow. Return ONLY JSON {"explanation":"two short Korean sentences: why it failed and what the next command does","command":"one command for the given shell","needsAdmin":false}. Install Git from an official source only: winget, the Git for Windows release on github.com/git-for-windows, or the operating system package manager. Prefer a per-user install. Never disable security checks, certificate verification or antivirus, never change proxy or network settings, never ask for or embed credentials, and never touch files outside the installation. If no safe command remains, return {"explanation":"...","command":"","needsAdmin":false}. The user sees the exact command and runs it only after approval.';

export function suggestionPlan(content,platform=process.platform){
  let value;try{value=JSON.parse(String(content||'').replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw new Error('setup_suggestion_invalid');}
  const command=typeof value?.command==='string'?value.command.trim():'';
  if(typeof value?.explanation!=='string'||!value.explanation.trim())throw new Error('setup_suggestion_invalid');
  if(!command)return {kind:'install_git',profile:platform==='win32'?'powershell':'bash',source:'model',command:null,effects:value.explanation.trim().slice(0,600),needsAdmin:false};
  if(command.length>COMMAND||command.includes('\0'))throw new Error('setup_suggestion_invalid');
  return {kind:'install_git',profile:platform==='win32'?'powershell':'bash',source:'model',command,effects:value.explanation.trim().slice(0,600),needsAdmin:value.needsAdmin===true};
}

// The folder that did not open, why, and the command waiting for approval.
export function createProjectSetup({platform=process.platform}={}){
  let pending=null;
  const offer=plan=>{pending={...pending,plan:plan.command||plan.kind==='init_repository'?{...plan,id:randomUUID()}:{...plan,id:null}};return view();};
  const view=()=>pending&&{root:pending.root,reason:pending.reason,plan:pending.plan,attempts:pending.attempts.map(({command,exitCode,error,output,source})=>({command,exitCode,error,source,output:output.slice(-4000)}))};
  return {
    view,
    async fail(root,reason){
      pending={root,reason,attempts:[],plan:null};
      return offer(reason==='git_unavailable'?gitInstallPlan(platform):repositoryPlan({identity:await gitIdentity(root).catch(()=>false)}));
    },
    approved(id){if(!pending?.plan?.id||pending.plan.id!==id)throw new Error('setup_plan_changed');return pending.plan;},
    record(attempt){pending.attempts.push(attempt);if(pending.attempts.length>=ATTEMPTS)pending.plan=null;return view();},
    offer,
    clear(){pending=null;},
    get pending(){return pending;},
  };
}
