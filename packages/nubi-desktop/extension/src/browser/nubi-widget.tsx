import * as React from 'react';
import {injectable, inject, postConstruct} from '@theia/core/shared/inversify';
import {ReactWidget} from '@theia/core/lib/browser/widgets/react-widget';
import {WorkspaceTrustService} from '@theia/workspace/lib/browser/workspace-trust-service';
import {WorkspaceService} from '@theia/workspace/lib/browser/workspace-service';
import {EditorManager} from '@theia/editor/lib/browser/editor-manager';
import {CommandService} from '@theia/core/lib/common/command';
import URI from '@theia/core/lib/common/uri';
import {DiffUris} from '@theia/core/lib/browser/diff-uris';
import {FileDialogService} from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import {NubiService} from '../common/protocol';
// Bundled from the shared React/CX surfaces without a second React runtime.
// @ts-ignore generated UI declaration is intentionally host-neutral
import {Workbench} from './workbench';

@injectable()
export class NubiWidget extends ReactWidget {
  static readonly ID='nubi-workspace';
  @inject(NubiService) protected readonly service!: NubiService;
  @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
  @inject(WorkspaceTrustService) protected readonly trust!: WorkspaceTrustService;
  @inject(EditorManager) protected readonly editors!: EditorManager;
  @inject(CommandService) protected readonly commands!: CommandService;
  @inject(FileDialogService) protected readonly fileDialogs!: FileDialogService;
  protected async call(method:string,args:any){
    if(method==='chooseSkillPackage') {
      const folder=args.kind==='folder';
      const file=await this.fileDialogs.showOpenDialog({title:folder?'스킬 폴더 등록':'스킬 ZIP 등록',canSelectFiles:!folder,canSelectFolders:folder,canSelectMany:false,...(!folder?{filters:{'Skill ZIP':['zip']}}:{})});
      if(!file)return {cancelled:true};
      return this.service.invoke('importSkill',{taskId:args.taskId,source:file.path.fsPath()});
    }
    if(method!=='chooseComputerApp')return this.service.invoke(method,args);
    const file=await this.fileDialogs.showOpenDialog({title:'실행할 Windows 앱 선택',canSelectFiles:true,canSelectFolders:false,canSelectMany:false,filters:{'Windows apps':['exe']}});
    if(!file)return {cancelled:true};
    return this.service.invoke('computer',{method:'register_app',taskId:args.taskId,file:file.path.fsPath()});
  }
  @postConstruct() init(){this.id=NubiWidget.ID;this.title.label='누비 workspace';this.title.caption='누비 workspace beta 1.0.0';this.title.closable=false;this.title.iconClass='nubi-workspace-tab-icon';this.addClass('nubi-widget');this.node.tabIndex=0;this.update();}
  protected onActivateRequest():void {this.node.focus({preventScroll:true});}
  protected async openCurrent(){if(!await this.trust.getWorkspaceTrust())throw new Error('workspace_untrusted');const roots=await this.workspace.roots;if(!roots.length)return null;return this.service.invoke('open',{root:roots[0].resource.path.fsPath()});}
  protected async openPath(path:string,taskId?:string){const file=await this.service.invoke('read',{path,taskId,full:true});return this.editors.open(new URI(file.uri),{mode:'activate'});}
  protected async review(proposalId:string){const proposal=await this.service.invoke('proposalArtifacts',{proposalId});await this.editors.open(DiffUris.encode(new URI(proposal.beforeUri),new URI(proposal.afterUri),'누비 변경 제안'),{mode:'activate'});}
  protected async apply(proposalId:string){
    const proposal=await this.service.invoke('prepareProposal',{proposalId});if(proposal.alreadyApplied)return proposal;
    if(proposal.kind==='create'){
      const uri=new URI(proposal.uri);
      if(this.editors.all.some(widget=>widget.editor.uri.isEqual(uri)&&widget.editor.document.dirty))throw new Error('editor_dirty');
      return this.service.invoke('applyNewFile',{proposalId});
    }
    const widget=await this.editors.getOrCreateByUri(new URI(proposal.uri));const editor=widget.editor,doc=editor.document;
    if(doc.dirty)throw new Error('editor_dirty');
    const version=doc.version;
    const bytes=new TextEncoder().encode(doc.getText());const digest=await crypto.subtle.digest('SHA-256',bytes);
    const actual='sha256:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if(doc.version!==version||doc.dirty||actual!==proposal.expectedHash)throw new Error('source_stale');
    // Monaco executeEdits participates in normal undo and never bypasses a dirty buffer.
    const applied=editor.executeEdits([{range:{start:{line:0,character:0},end:doc.positionAt(doc.getText().length)},newText:proposal.content}]);
    if(!applied)throw new Error('editor_apply_failed');
    await doc.save();return this.service.invoke('confirmProposal',{proposalId});
  }
  protected render():React.ReactNode{return <Workbench api={(method:string,args:any)=>this.call(method,args)} openCurrent={()=>this.openCurrent()} chooseFolder={()=>this.commands.executeCommand('workspace:open')} openPath={(path:string,taskId?:string)=>this.openPath(path,taskId)} review={(id:string)=>this.review(id)} apply={(id:string)=>this.apply(id)} openBrowser={(url:string)=>window.open(url,'_blank','noopener,noreferrer')} openURI={(uri:string)=>this.editors.open(new URI(uri),{mode:'activate'})}/>;}
}
