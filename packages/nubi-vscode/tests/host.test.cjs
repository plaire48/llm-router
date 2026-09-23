const test=require('node:test'),assert=require('node:assert/strict');
const {Host}=require('../src/host.cjs');
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
