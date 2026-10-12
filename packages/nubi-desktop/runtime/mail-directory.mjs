import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// A domain account's short name can resolve to a different local account.
// Grant the actual process user's SID before removing inherited permissions.
export async function protectMailDirectory(directory,{platform=process.platform,execute=run}={}){
  if(platform!=='win32')return;
  try{
    const {stdout}=await execute('whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true,timeout:10000});
    const sids=[...stdout.matchAll(/\bS-1-5-\d+(?:-\d+)+\b/g)].map(match=>match[0]);
    if(sids.length!==1)throw Error('invalid_user_sid');
    await execute('icacls.exe',[directory,'/grant:r',`*${sids[0]}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,timeout:10000});
    await execute('icacls.exe',[directory,'/inheritance:r'],{windowsHide:true,timeout:10000});
  }catch{throw Error('mail_storage_permission');}
}
