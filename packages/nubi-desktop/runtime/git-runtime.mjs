import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const exec=promisify(execFile);
// A running Windows app keeps its original PATH. Discover standard Git installs
// again after installation, without restarting the app or changing global PATH.
export function gitCandidates(platform=process.platform,env=process.env){
 if(platform!=='win32')return ['git'];
 if(env.NUBI_BUNDLED_GIT&&path.win32.isAbsolute(env.NUBI_BUNDLED_GIT))return [env.NUBI_BUNDLED_GIT];
 return ['git',...new Set([env.ProgramW6432,env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean).map(base=>path.win32.join(base,'Git','cmd','git.exe'))),...(env.LOCALAPPDATA?[path.win32.join(env.LOCALAPPDATA,'Programs','Git','cmd','git.exe')]:[])];
}
export async function runGit(args,options={},run=exec,candidates=gitCandidates()){
 let missing;
 for(const executable of candidates){try{return await run(executable,args,{windowsHide:true,timeout:20000,maxBuffer:12*1024*1024,...options});}catch(error){if(error.code!=='ENOENT')throw error;missing=error;}}
 throw missing||Object.assign(Error('git_unavailable'),{code:'ENOENT'});
}
export function gitFailure(error){
 if(error?.code==='ENOENT')return 'git_unavailable';
 if(error?.killed||error?.code==='ETIMEDOUT')return 'git_timeout';
 const detail=String(error?.stderr||'');
 if(/dubious ownership/i.test(detail))return 'git_unsafe_directory';
 if(error?.code==='EACCES'||error?.code==='EPERM'||/permission denied|access is denied/i.test(detail))return 'git_access_denied';
 if(/not a git repository/i.test(detail))return 'not_git_repository';
 return 'git_history_failed';
}
export async function gitAvailability(){try{const {stdout}=await runGit(['--version'],{timeout:5000});return {available:true,version:stdout.trim()};}catch(error){return {available:false,error:gitFailure(error)};}}
export async function requireWikiGit(){const status=await gitAvailability();if(!status.available)throw Error(status.error==='git_unavailable'?'wiki_git_required':status.error);}
