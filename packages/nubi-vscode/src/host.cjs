const {createHash}=require('node:crypto');
const {realpath}=require('node:fs/promises');
const digest=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
const API=new Set(['listSkills','importVoc','queryVoc','readVoc','computer','decideSetupAction','codeOutline','recoverySnapshot','resumeAgent','diagnoseProcess','applyCommandRepair','knowledgeMap','knowledgeQuery','initializeKnowledgeCatalog','exportKnowledgeMap','databaseConnection','knowledgeStatus','recordKnowledge','comparison','connectKnowledge','overview','state','read','search','wikiQuery','createTask','exportRequirement','createWorktree','mergeProposal','diff','run','exportReport','compare','provider','fabrix','startAgent','answerAgent','saveQuestionDraft','stopAgent','poll','stop','events']);

class Host {
  constructor(vscode,runtime){this.vscode=vscode;this.runtime=runtime;this.root=null;this.opening=null;this.links=new Set();this.urls=new Set();this.applying=false;}
  trusted(){if(!this.vscode.workspace.isTrusted)throw Error('workspace_untrusted');if(this.vscode.env.remoteName)throw Error('local_workspace_required');}
  async openCurrent(){
    this.trusted();if(this.opening)return this.opening;
    this.opening=this.selectRoot();try{return await this.opening;}finally{this.opening=null;}
  }
  async selectRoot(){
    const v=this.vscode,roots=v.workspace.workspaceFolders||[];
    if(!roots.length)return null;
    if(this.root&&roots.some(r=>r.uri.fsPath===this.root))return this.runtime.invoke('overview');
    const selected=roots.length===1?roots[0]:await v.window.showWorkspaceFolderPick({placeHolder:'누비에서 사용할 프로젝트를 선택하세요.'});
    if(!selected)return null;if(selected.uri.scheme!=='file')throw Error('local_workspace_required');
    this.trusted();const value=await this.runtime.invoke('open',{root:selected.uri.fsPath});this.root=selected.uri.fsPath;return value;
  }
  async ensureRoot(){
    this.trusted();
    if(!this.root||(this.vscode.workspace.workspaceFolders||[]).every(r=>r.uri.scheme!=='file'||r.uri.fsPath!==this.root))throw Error('project_missing');
  }
  async api(method,args={}){
    this.trusted();
    if(['chooseSkillPackage','chooseComputerApp'].includes(method)){
      await this.ensureRoot();const isSkill=method==='chooseSkillPackage',folder=isSkill&&args.kind==='folder';
      if(isSkill&&!['folder','zip'].includes(args.kind))throw Error('input_invalid');
      const choice=await this.vscode.window.showOpenDialog({title:isSkill?(folder?'스킬 폴더 등록':'스킬 ZIP 등록'):'실행할 Windows 앱 선택',canSelectFolders:folder,canSelectFiles:!folder,canSelectMany:false,...(!folder?{filters:isSkill?{'Skill ZIP':['zip']}:{'Windows apps':['exe']}}:{})});
      if(!choice?.length)return {cancelled:true};if(choice[0].scheme!=='file')throw Error('local_workspace_required');
      await this.ensureRoot();
      return this.runtime.invoke(isSkill?'importSkill':'computer',isSkill?{taskId:args.taskId,source:choice[0].fsPath}:{method:'register_app',taskId:args.taskId,file:choice[0].fsPath});
    }
    if(!API.has(method)||method==='computer'&&args.method==='register_app')throw Error('method_invalid');
    if(!['provider','fabrix'].includes(method))await this.ensureRoot();
    const result=await this.runtime.invoke(method,args);
    if(method==='exportReport'&&result.uri)this.links.add(result.uri);
    if(method==='connectKnowledge'&&result.url)this.urls.add(result.url);
    return result;
  }
  async openPath(file,taskId){await this.ensureRoot();const result=await this.runtime.invoke('read',{path:file,taskId,full:true});await this.vscode.window.showTextDocument(this.vscode.Uri.parse(result.uri),{preview:false,viewColumn:this.vscode.ViewColumn.Two});}
  async review(proposalId){await this.ensureRoot();const p=await this.runtime.invoke('proposalArtifacts',{proposalId});await this.vscode.commands.executeCommand('vscode.diff',this.vscode.Uri.parse(p.beforeUri),this.vscode.Uri.parse(p.afterUri),'누비 변경 제안',{preview:true,viewColumn:this.vscode.ViewColumn.Two});}
  async apply(proposalId){
    await this.ensureRoot();if(this.applying)throw Error('project_busy');this.applying=true;
    try{
      const v=this.vscode,p=await this.runtime.invoke('prepareProposal',{proposalId});if(p.alreadyApplied)return p;
      const uri=v.Uri.parse(p.uri),target=uri.fsPath;
      for(const doc of v.workspace.textDocuments){
        if(!doc.isDirty||doc.uri.scheme!=='file')continue;
        if(doc.uri.fsPath===target)throw Error('editor_dirty');
        const actual=await realpath(doc.uri.fsPath).catch(()=>null);if(actual&&actual===await realpath(target).catch(()=>null))throw Error('editor_dirty');
      }
      if(p.kind==='create')return this.runtime.invoke('applyNewFile',{proposalId});
      const editor=await v.window.showTextDocument(uri,{preview:false,viewColumn:v.ViewColumn.Two}),doc=editor.document;
      if(doc.isDirty)throw Error('editor_dirty');
      const version=doc.version;if(digest(doc.getText())!==p.expectedHash)throw Error('source_stale');
      await this.ensureRoot();
      const check=await this.runtime.invoke('prepareProposal',{proposalId});
      if(check.alreadyApplied)return check;
      if(check.expectedHash!==p.expectedHash||check.afterHash!==p.afterHash||doc.version!==version||doc.isDirty)throw Error('source_stale');
      const edited=await editor.edit(edit=>edit.replace(new v.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),p.content),{undoStopBefore:true,undoStopAfter:true});
      if(!edited)throw Error('editor_apply_failed');
      if(doc.version!==version+1||digest(doc.getText())!==p.afterHash)throw Error('editor_changed');
      if(!await doc.save())throw Error('editor_save_failed');
      return this.runtime.invoke('confirmProposal',{proposalId});
    }finally{this.applying=false;}
  }
  async handle(request){
    this.trusted();if(!request||typeof request.method!=='string'||!Array.isArray(request.args))throw Error('method_invalid');
    const [a,b]=request.args;
    switch(request.method){
      case 'api':return this.api(a,b);
      case 'openCurrent':return this.openCurrent();
      case 'chooseFolder':return this.vscode.commands.executeCommand('vscode.openFolder');
      case 'openPath':return this.openPath(a,b);
      case 'review':return this.review(a);
      case 'apply':return this.apply(a);
      case 'openURI':if(!this.links.has(a))throw Error('path_scope');await this.vscode.window.showTextDocument(this.vscode.Uri.parse(a),{viewColumn:this.vscode.ViewColumn.Two});return;
      case 'openBrowser':if(!this.urls.has(a)||!/^https?:\/\/127\.0\.0\.1:/.test(a))throw Error('url_scope');return this.vscode.env.openExternal(this.vscode.Uri.parse(a));
      default:throw Error('method_invalid');
    }
  }
}
module.exports={Host};
