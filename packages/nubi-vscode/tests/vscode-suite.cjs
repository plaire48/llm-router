const vscode=require('vscode'),assert=require('node:assert/strict');
const {mkdtemp,readFile,writeFile,rm}=require('node:fs/promises');
const path=require('node:path'),os=require('node:os');

exports.run=async()=>{
  const waitFor=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,30));}assert(check());};
  const browser=await require('playwright').chromium.connectOverCDP('http://127.0.0.1:'+process.env.NUBI_TEST_CDP_PORT);
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('workbench'))||browser.contexts()[0].pages()[0];
  const checks=[],directory=path.resolve(__dirname,'..'),root=vscode.workspace.workspaceFolders[0].uri.fsPath;
  const extension=vscode.extensions.getExtension('nubi-internal.nubi-workspace');assert(extension);
  if(process.env.NUBI_TEST_INSTALLED==='1')assert.notEqual(extension.extensionPath,directory);
  const {Runtime}=require(path.join(extension.extensionPath,'src/runtime.cjs')),{Host}=require(path.join(extension.extensionPath,'src/host.cjs'));
  const state=await mkdtemp(path.join(os.tmpdir(),'nubi-vscode-state-')),runtime=new Runtime(extension.extensionPath,state),host=new Host(vscode,runtime);
  const uri=vscode.Uri.file(path.join(root,'app.txt'));
  try{
    await extension.activate();await vscode.commands.executeCommand('nubi.open');checks.push('real VS Code activates the extension and opens its webview');
    let frame;for(let i=0;i<150&&!frame;i++){frame=page.frames().find(f=>f.url().includes('/fake.html'));if(!frame)await new Promise(r=>setTimeout(r,100));}assert(frame,'Nubi webview frame loads');
    for(const name of ['AI Pro','ChatGPT','FabriX'])await frame.getByRole('button',{name,exact:true}).waitFor({state:'visible',timeout:15000});
    const fonts=await frame.evaluate(async()=>{const faces=await document.fonts.load('400 14px "Noto Sans KR"','누비');return faces.map(f=>f.status);});assert(fonts.length&&fonts.every(s=>s==='loaded'));assert(await frame.evaluate(()=>Array.from(document.images).filter(i=>i.src).every(i=>i.complete&&i.naturalWidth>0)));checks.push('actual webview loads shared login, all three provider buttons, fonts and brand icons');
    await page.screenshot({path:path.join(directory,'verification/vscode-ui.png')});
    await frame.getByRole('button',{name:'스킬 관리',exact:true}).click();await frame.getByRole('button',{name:'ZIP 등록',exact:true}).waitFor();await frame.getByText('등록한 스킬이 없어요.',{exact:false}).waitFor();
    await page.screenshot({path:path.join(directory,'verification/vscode-skills.png')});checks.push('actual skill modal loads registered catalog through the webview RPC');
    await page.keyboard.press('Escape');

    await host.openCurrent();const source=await host.api('read',{path:'app.txt'});assert.equal(source.content,'before\n');
    const wiki=await host.api('wikiQuery',{query:'Project identity'});assert(wiki.results.length>0);checks.push('bundled Node sidecar reads source and actual OpenWiki-SDS evidence');
    const task=await runtime.invoke('createTask',{request:'Replace fixture text',criteria:['Preserve human edits']});
    const proposal=await runtime.invoke('propose',{taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'after\n',reason:'VS Code integration fixture',rulesFingerprint:source.projectRules.fingerprint});
    await host.review(proposal.id);assert(vscode.window.tabGroups.all.flatMap(g=>g.tabs).some(t=>t.input instanceof vscode.TabInputTextDiff));checks.push('proposal opens in the actual VS Code diff editor');
    let editor=await vscode.window.showTextDocument(uri,{viewColumn:vscode.ViewColumn.Two,preview:false});await editor.edit(e=>e.insert(new vscode.Position(0,0),'human '));
    await assert.rejects(host.apply(proposal.id),/editor_dirty/);assert.equal(await readFile(uri.fsPath,'utf8'),'before\n');assert(editor.document.getText().startsWith('human '));checks.push('dirty editor buffer blocks application and preserves disk and human text');
    editor=await vscode.window.showTextDocument(editor.document,{viewColumn:vscode.ViewColumn.Two,preview:false});await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');await waitFor(()=>editor.document.getText()==='before\n');assert.equal(editor.document.getText(),'before\n');await editor.document.save();
    const result=await host.apply(proposal.id);assert.equal(result.state,'applied');assert.equal(await readFile(uri.fsPath,'utf8'),'after\n');checks.push('actual editor edit and save receive verified host readback');
    editor=await vscode.window.showTextDocument(editor.document,{viewColumn:vscode.ViewColumn.Two,preview:false});await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');await waitFor(()=>editor.document.getText()==='before\n');assert.equal(editor.document.getText(),'before\n');await editor.document.save();checks.push('applied change remains in native VS Code undo history');
    const task2=await runtime.invoke('createTask',{request:'Check stale source'});const old=await runtime.invoke('read',{path:'app.txt'});
    const stale=await runtime.invoke('propose',{taskId:task2.id,path:'app.txt',expectedHash:old.hash,content:'stale\n',reason:'fixture',rulesFingerprint:old.projectRules.fingerprint});
    await editor.edit(e=>e.replace(new vscode.Range(editor.document.positionAt(0),editor.document.positionAt(editor.document.getText().length)),'human saved\n'));await editor.document.save();
    await assert.rejects(host.apply(stale.id),/source_stale/);assert.equal(await readFile(uri.fsPath,'utf8'),'human saved\n');checks.push('saved source drift refuses stale proposals');
    const copy=await runtime.invoke('exportReport',{taskId:task.id});await assert.rejects(host.handle({method:'openURI',args:[copy.uri]}),/path_scope/);
    const report=await host.api('exportReport',{taskId:task.id});await host.handle({method:'openURI',args:[report.uri]});checks.push('only host-issued report links open in VS Code');
    const processResult=await host.api('run',{taskId:task.id,profile:process.platform==='win32'?'powershell':'bash',script:process.platform==='win32'?"Write-Output 'VSCODE_NUBI_OK'":"printf VSCODE_NUBI_OK"});
    let processState=processResult;for(let i=0;i<100&&['running','stopping','checking'].includes(processState.state);i++){await new Promise(r=>setTimeout(r,100));processState=await host.api('poll',{id:processResult.id});}
    assert.equal(processState.state,'completed');assert.match(processState.output,/VSCODE_NUBI_OK/);checks.push('shared owned shell executes and returns actual output in the extension host');
    const file=path.join(directory,process.env.NUBI_TEST_INSTALLED==='1'?'verification/vscode-installed.json':'verification/vscode-host.json');await writeFile(file,JSON.stringify({passed:true,installedVsix:process.env.NUBI_TEST_INSTALLED==='1',platform:process.platform,version:vscode.version,checks,scope:'Actual VS Code extension host and editors, bundled Node worker, SQLite, OpenWiki-SDS and shell. No live LLM or Windows GUI claim.'},null,2));console.log(JSON.stringify({checks}));
  }finally{await browser.close();runtime.dispose();await new Promise(r=>setTimeout(r,2000));await rm(state,{recursive:true,force:true});}
};
