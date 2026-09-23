const vscode=require('vscode');
const {randomBytes}=require('node:crypto');
const {Runtime}=require('./runtime.cjs');
const {Host}=require('./host.cjs');

function activate(context){
  const runtime=new Runtime(context.extensionPath,context.globalStorageUri.fsPath),host=new Host(vscode,runtime);
  let panel;
  const bind=target=>{
    panel=target;const nonce=randomBytes(24).toString('base64url');
    const media=vscode.Uri.joinPath(context.extensionUri,'media');
    panel.webview.options={enableScripts:true,localResourceRoots:[media]};
    panel.iconPath=vscode.Uri.joinPath(media,'icons/agent-32.png');
    const base=panel.webview.asWebviewUri(media).toString()+'/',source=panel.webview.cspSource;
    panel.webview.html=`<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${source} data: blob:; font-src ${source}; style-src ${source} 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri ${source};"><base href="${base}"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script nonce="${nonce}" src="app.js"></script></body></html>`;
    const active=new Set();
    panel.webview.onDidReceiveMessage(async message=>{
      if(!message||typeof message.id!=='string'||message.id.length>100||active.has(message.id))return;
      active.add(message.id);
      try {const result=await host.handle(message);await target.webview.postMessage({id:message.id,result});}
      catch(error){await target.webview.postMessage({id:message.id,error:/^[a-z_]{3,50}$/.test(error.message)?error.message:'operation_failed'});}
      finally{active.delete(message.id);}
    },null,context.subscriptions);
    panel.onDidDispose(()=>{if(panel===target)panel=null;},null,context.subscriptions);
  };
  const show=async()=>{
    if(!vscode.workspace.isTrusted){await vscode.window.showWarningMessage('이 프로젝트를 신뢰한 뒤 누비를 열어 주세요.');return;}
    if(vscode.env.remoteName||vscode.workspace.workspaceFolders?.some(f=>f.uri.scheme!=='file')){await vscode.window.showWarningMessage('현재 누비는 로컬 VS Code 작업 공간을 지원합니다.');return;}
    if(panel){panel.reveal();return;}
    bind(vscode.window.createWebviewPanel('nubi.workspace','누비 Workspace',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true}));
  };
  context.subscriptions.push(vscode.commands.registerCommand('nubi.open',show),{dispose:()=>runtime.dispose()},
    vscode.window.registerWebviewPanelSerializer('nubi.workspace',{async deserializeWebviewPanel(saved){if(!vscode.workspace.isTrusted||vscode.env.remoteName){saved.dispose();return;}bind(saved);}}));
  return {show};
}
module.exports={activate};
