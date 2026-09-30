const test=require('node:test'),assert=require('node:assert/strict');
const {Host,remoteAddress}=require('../src/host.cjs');
function fixture(){
  const calls=[],v={workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:'/project'}}],textDocuments:[]},env:{},window:{showOpenDialog:async()=>undefined},commands:{executeCommand:async(...args)=>calls.push(args)}};
  const runtime={invoke:async(method,args)=>{calls.push({method,args});return method==='open'?{root:args.root}:{};}};
  return {v,runtime,calls,host:new Host(v,runtime)};
}
test('trust, virtual roots and remote hosts fail before starting any worker',async()=>{
  for(const alter of [v=>v.workspace.isTrusted=false,v=>v.env.remoteName='wsl',v=>v.workspace.workspaceFolders[0].uri.scheme='vscode-remote']){
    const f=fixture();alter(f.v);await assert.rejects(f.host.openCurrent(),/workspace_untrusted|local_workspace_required/);assert.deepEqual(f.calls,[]);
  }
});
test('multi-root choice is explicit and concurrent open requests share the same choice',async()=>{
  const f=fixture();f.v.workspace.workspaceFolders.push({uri:{scheme:'file',fsPath:'/other'}});let picks=0;
  f.v.window.showWorkspaceFolderPick=async()=>{picks++;return f.v.workspace.workspaceFolders[1];};
  await Promise.all([f.host.openCurrent(),f.host.openCurrent()]);assert.equal(picks,1);assert.equal(f.host.root,'/other');assert.deepEqual(f.calls,[{method:'open',args:{root:'/other'}}]);
});
test('webview cannot select raw roots, import paths, approve edits or register arbitrary apps',async()=>{
  const f=fixture();await f.host.openCurrent();f.calls.length=0;
  for(const [method,args]of [['open',{root:'/outside'}],['importSkill',{source:'/outside'}],['applyNewFile',{}],['confirmProposal',{}],['propose',{}],['computer',{method:'register_app',file:'/outside.exe'}]])await assert.rejects(f.host.api(method,args),/method_invalid/);
  for(const method of ['executeCommand','__proto__','constructor'])await assert.rejects(f.host.handle({method,args:[]}),/method_invalid/);
  assert.deepEqual(f.calls,[]);
});
test('file picker cancellation is inert and only picker-selected file paths reach import',async()=>{
  const f=fixture();await f.host.openCurrent();f.calls.length=0;assert.deepEqual(await f.host.api('chooseSkillPackage',{kind:'zip'}),{cancelled:true});assert.deepEqual(f.calls,[]);
  f.v.window.showOpenDialog=async()=>[{scheme:'file',fsPath:'/chosen/skill.zip'}];await f.host.api('chooseSkillPackage',{kind:'zip',source:'/forged'});
  assert.equal(f.calls[0].args.source,'/chosen/skill.zip');
  f.v.workspace.isTrusted=false;await assert.rejects(f.host.api('state'),/workspace_untrusted/);assert.equal(f.calls.length,1);
});
test('workspace removal and unissued URI or external links cannot bypass host scope',async()=>{
  const f=fixture();await f.host.openCurrent();f.calls.length=0;
  for(const [method,value]of [['openURI','file:///private/secret'],['openBrowser','command:terminal.sendSequence'],['openBrowser','https://example.com']])await assert.rejects(f.host.handle({method,args:[value]}),/path_scope|url_scope/);
  f.v.workspace.workspaceFolders=[];await assert.rejects(f.host.api('run',{script:'anything'}),/project_missing/);assert.deepEqual(f.calls,[]);
});

// User decision 2026-09-30: a remote repository address connects a project through VS Code's Git clone.
test('a remote address is https, ssh or user@host and never carries a password',()=>{
  for(const ok of ['https://github.com/owner/repo.git','http://git.example.internal/team/app.git','ssh://git@example.com/owner/repo.git','git@github.com:owner/repo.git','https://user@example.com/owner/repo.git'])assert.equal(remoteAddress(ok),true,ok);
  for(const bad of ['','owner/repo','https://user:secret@example.com/repo.git','file:///etc/passwd','--upload-pack=touch /tmp/x','git@host:','https://example.com/a repo.git','javascript:alert(1)'])assert.equal(remoteAddress(bad),false,bad);
});
test('connecting a remote runs VS Code Git clone with the address, and cancelling is inert',async()=>{
  const f=fixture();f.v.window.showInputBox=async()=>undefined;
  assert.deepEqual(await f.host.handle({method:'cloneRepository',args:[]}),{cancelled:true});assert.deepEqual(f.calls,[]);
  await assert.rejects(f.host.handle({method:'cloneRepository',args:['https://user:pw@example.com/r.git']}),/remote_invalid/);assert.deepEqual(f.calls,[]);
  f.v.commands.executeCommand=async(...args)=>{f.calls.push(args);return '/home/u/repo';};
  assert.deepEqual(await f.host.handle({method:'cloneRepository',args:['https://github.com/owner/repo.git']}),{cloned:true});
  assert.deepEqual(f.calls,[['git.clone','https://github.com/owner/repo.git']]);
  f.v.env.remoteName='ssh-remote';await assert.rejects(f.host.cloneRepository('https://github.com/owner/repo.git'),/local_workspace_required/);
});
test('a folder that needs Git setup reaches the setup methods before it is a project, and becomes the project when opened',async()=>{
  const f=fixture();
  f.runtime.invoke=async(method,args)=>{f.calls.push({method,args});if(method==='open')throw Error('not_git_repository');if(method==='setupRun')return {opened:{name:'project'},environment:true};return {reason:'not_git_repository'};};
  await assert.rejects(f.host.openCurrent(),/not_git_repository/);assert.equal(f.host.root,null);
  assert.deepEqual(await f.host.api('setupStatus'),{reason:'not_git_repository'});
  await assert.rejects(f.host.api('state'),/project_missing/,'other methods still need an open project');
  assert.deepEqual(await f.host.api('setupRun',{id:'p1'}),{opened:{name:'project'},environment:true});assert.equal(f.host.root,'/project');
});
