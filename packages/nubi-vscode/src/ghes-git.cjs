const {ORIGIN,safeUrl}=require('./ghes.cjs');
// Reuse native Git and its askpass channel. Never put credentials in clone URLs,
// Git configuration, shell arguments or a project credential helper.
async function registerGhesGit(vscode,account){
  const extension=vscode.extensions.getExtension('vscode.git');if(!extension)return null;
  const exported=extension.isActive?extension.exports:await extension.activate();
  const api=exported?.getAPI?.(1);if(!api?.registerCredentialsProvider)return null;
  return api.registerCredentialsProvider({async getCredentials(uri){
    if(!vscode.workspace.isTrusted||vscode.env.remoteName||vscode.workspace.workspaceFolders?.some(folder=>folder.uri.scheme!=='file')||uri.scheme!=='https'||uri.authority!=='code.sdsdev.co.kr')return;
    if(!(await account.status()).connected)return;
    const {token}=await account.credential();return {username:'x-access-token',password:token};
  }});
}
async function chooseRepository(vscode,account){
  const generation=account.generation;
  const installs=await account.json('/user/installations?per_page=100');
  if(!Array.isArray(installs.installations)||installs.installations.length>100)throw Error('ghes_response_invalid');
  if(installs.total_count>100)throw Error('ghes_repository_limit');
  const items=[],seen=new Set();let limited=false;
  for(const install of installs.installations){
    if(!Number.isSafeInteger(install.id)||install.id<=0)throw Error('ghes_response_invalid');
    for(let page=1;page<=5;page++){
      const data=await account.json('/user/installations/'+install.id+'/repositories?per_page=100&page='+page);
      if(!Array.isArray(data.repositories)||data.repositories.length>100)throw Error('ghes_response_invalid');
      for(const repo of data.repositories){
        const url=safeUrl(repo.clone_url);
        if(!Number.isSafeInteger(repo.id)||!url||!/^\/[\w.-]+\/[\w.-]+\.git$/.test(url.pathname)||url.search||url.hash||typeof repo.full_name!=='string')continue;
        if(seen.has(repo.id))continue;seen.add(repo.id);items.push({label:repo.full_name,description:repo.private?'비공개':'공개',url:url.href});
      }
      if(data.repositories.length<100)break;
      if(page===5||items.length>=500){limited=true;break;}
    }
    if(items.length>=500){limited=true;break;}
  }
  if(!items.length)throw Error('ghes_repository_missing');
  const selected=await vscode.window.showQuickPick(items.slice(0,500),{title:'회사 저장소 열기',placeHolder:limited?'조회한 저장소 중 선택하세요. 더 많은 저장소는 주소로 복제할 수 있습니다.':'복제할 저장소를 선택하세요.',matchOnDescription:true});
  if(!selected)return {cancelled:true};
  if(generation!==account.generation)throw Error('ghes_session_changed');
  // Picked values, never a webview-supplied URL. Git's credential provider checks
  // the live account again when Git actually requests authentication.
  const directory=await vscode.commands.executeCommand('git.clone',selected.url);
  return directory?{cloned:true}:{cancelled:true};
}
module.exports={registerGhesGit,chooseRepository};
