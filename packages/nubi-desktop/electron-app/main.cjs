const {app,BrowserWindow,protocol,net,ipcMain,dialog,clipboard,Menu}=require('electron');
const {fork,spawn}=require('node:child_process');
const {WorkspaceUpdater}=require('./workspace-updater.cjs');
const {readFile,writeFile,mkdir,realpath,rm}=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {ElectronHost}=require('./native-host.cjs');
const {browseLocalDirectory,readLocalFile}=require('./local-file-view.cjs');
const {startWebHost}=require('./web-host.cjs');
const {BrowserHost}=require('./browser-host.cjs');
const {TerminalHost}=require('./terminal-host.cjs');
const {shellProfiles}=require('../runtime/processes.mjs');
const {DEFAULT_TITLEBAR,applyCaptionColors}=require('./titlebar-colors.cjs');
const {importProjectZip}=require('../runtime/project-zip.mjs');
const {configureSystemTrust,disableHostedTracing}=require('../runtime/worker-environment.mjs');
const {DESKTOP_FEATURES}=require('../runtime/beta-features.mjs');
const {workspacePageUrl}=require('../runtime/workspace-browser.mjs');
const {WorkerSupervisor,restoreWindowState,windowStateOf,boundedLog,startupMailPrompt}=require('./lifecycle.cjs');
configureSystemTrust();disableHostedTracing(process.env);
require('./bundled-git.cjs').configureBundledGit({packaged:app.isPackaged,resourcesPath:process.resourcesPath});
app.setName('누비 Workspace');if(process.platform==='win32')app.setAppUserModelId('nubi.workspace');
// One running Workspace (2026-10-05): a second start, a double-click on the shortcut, brings the first window forward
// instead of opening a second window and a second worker on the same project state (project_locked).
// A storage root of its own (checks, evaluation runs) is its own instance and its own Chromium profile: it never competes
// with the running Workspace for the lock, which is keyed on userData (2026-10-07). The product start has no root and is unchanged.
if(process.env.NUBI_STORAGE_ROOT)app.setPath('userData',path.join(process.env.NUBI_STORAGE_ROOT,'app'));
const primary=app.requestSingleInstanceLock();
if(!primary)app.quit();
app.on('second-instance',()=>{if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();});
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let terminalHost,updater,installingUpdate=false;
let window,worker,host,webHost,browserHost,currentRoot=null,currentKind='project';const launchId=randomUUID();
const storage=process.env.NUBI_STORAGE_ROOT||path.join(app.getPath('userData'),'workspace');
const {ProjectCatalog}=require('./project-catalog.cjs');
const projectCatalog=new ProjectCatalog(storage);
let openingProject=false;
function recordFault(component,details={}){
 const reason=['clean-exit','abnormal-exit','killed','crashed','oom','launch-failed','integrity-failure'].includes(details.reason)?details.reason:'unexpected';
 const record={at:new Date().toISOString(),component,reason,...(Number.isInteger(details.exitCode)?{exitCode:details.exitCode}:{})};
 void mkdir(storage,{recursive:true}).then(()=>writeFile(path.join(storage,'last-host-fault.json'),JSON.stringify(record),{mode:0o600})).catch(()=>{});
}
process.on('uncaughtExceptionMonitor',()=>recordFault('main'));
function invoke(method,args={}){if(!worker)return Promise.reject(Error('host_disconnected'));return worker.invoke(method,args);}
// What the window needs to hear from the host itself (the worker restarted, or gave up): nubi:host-event.
function hostEvent(event){if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('nubi:host-event',event);}
// The window where the user left it: its bounds are saved as it moves and restored on the displays present next time.
const windowStateFile=path.join(storage,'window-state.json');let windowStateTimer=null;
async function loadWindowState(){try{return JSON.parse(await readFile(windowStateFile,'utf8'));}catch{return null;}}
function saveWindowState(){
 if(!window||window.isDestroyed())return;clearTimeout(windowStateTimer);
 windowStateTimer=setTimeout(()=>{void mkdir(storage,{recursive:true}).then(()=>writeFile(windowStateFile,JSON.stringify(windowStateOf(window)),{mode:0o600})).catch(()=>{});},500);
}
function trusted(event){if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!=='app://bundle/index.html')throw Error('ipc_scope');}
async function choose(properties,title,filters){const result=await dialog.showOpenDialog(window,{properties,title,filters});return result.canceled?null:result.filePaths[0];}
function openWorkspacePage(url,options={}){if(!browserHost||!window||window.isDestroyed())throw Error('browser_unavailable');const tab=browserHost.create(workspacePageUrl(url),options);window.webContents.send('nubi:browser-event',{type:'opened',state:browserHost.status()});return {opened:true,tabId:tab.id,userInteractionRequired:true};}
function openPageLink(url){try{openWorkspacePage(url);}catch(error){window.webContents.send('nubi:browser-event',{type:'error',error:/^[a-z_]+$/.test(error.message)?error.message:'browser_url_invalid'});}}
const {connectionVault}=require('./connection-vault.cjs');
const vault=connectionVault({directory:path.join(storage,'connections-v1'),safeStorage:require('electron').safeStorage});
function secretScope(service,key){if(service!=='nubi.workspace.electron'||key!=='nubi.ghes.code.sdsdev.co.kr')throw Error('secret_scope');}
const keyStore={
 async getPassword(service,key){secretScope(service,key);return vault.get(key);},
 async setPassword(service,key,value){secretScope(service,key);return vault.set(key,value);},
 async deletePassword(service,key){secretScope(service,key);return vault.delete(key);}
};
async function openProject(root,kind='project',{initializeWiki=true,exactRoot=false}={}){
 if(openingProject)throw Error('project_busy');openingProject=true;
 try{
 // A predecessor that is still exiting (quit or crash) holds the project store for a moment; the single-instance lock
 // rules out a live second instance, so a short retry is safe.
 let overview;for(let attempt=0;;attempt++){try{overview=await invoke('open',{root,kind,initializeWiki,exactRoot});break;}catch(error){if(error.message!=='project_locked'||attempt>=4)throw error;await new Promise(resolve=>setTimeout(resolve,600));}}currentRoot=overview.root;currentKind=kind;
 try{await mkdir(storage,{recursive:true});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:currentRoot,kind}),{mode:0o600});await projectCatalog.remember(overview);}catch{overview.projectCatalogWarning=true;}
 return overview;
 }finally{openingProject=false;}
}
const forbidden=new Set(['prepareAppUpdate','open','importSkill','connectSkillMarketplace','disconnectSkillMarketplace','initializeWiki','collaboration']);
app.whenReady().then(async()=>{
 if(!primary)return;
 const appIcon=path.join(__dirname,'nubi-icon.png');
 if(process.platform==='darwin')app.dock?.setIcon(appIcon);
 const frontend=await realpath(path.join(__dirname,'frontend'));
 protocol.handle('app',async request=>{try{const url=new URL(request.url);if(url.host!=='bundle'||request.method!=='GET'||request.initiatorOrigin&&request.initiatorOrigin!=='app://bundle')return new Response('',{status:403});const target=await realpath(path.resolve(frontend,'.'+decodeURIComponent(url.pathname)));const rel=path.relative(frontend,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))return new Response('',{status:403});return net.fetch(pathToFileURL(target).href);}catch{return new Response('',{status:404});}});
 // The service worker, restarted when it dies (lifecycle.cjs): its errors go to a bounded log for a report, never its
 // requests. The window keeps its project: the new worker opens it again before the next request is answered.
 const workerLog=boundedLog({file:path.join(storage,'worker.log')});
 worker=new WorkerSupervisor({spawn:()=>{
  const child=fork(path.join(__dirname,'backend/service-entry.mjs'),[],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NUBI_STORAGE_ROOT:storage},stdio:['ignore','ignore','pipe','ipc']});
  child.stderr.on('data',chunk=>{void workerLog(chunk);});return child;
 },onMessage:message=>{
  if(message?.connectionSecretRequest){
   const {id,operation,key,value}=message.connectionSecretRequest;
   if(typeof id!=='string'||id.length>80)return;
   // A worker can store only its provider connections, never company credentials.
   void (async()=>{try{
    if(!['provider:aipro','provider:chatgpt','provider:fabrix','provider:claude','provider:active'].includes(key)||!['get','set','delete'].includes(operation))throw Error('secret_scope');
    const result=await vault[operation](key,value);worker.send({connectionSecretReply:{id,value:result??null}});
   }catch{worker.send({connectionSecretReply:{id,error:'secret_unavailable'}});}})();return;
  }
  if(message?.workspaceAuthPageClose){const tabId=message.workspaceAuthPageClose.tabId;if(typeof tabId==='string'&&browserHost?.tabs.get(tabId)?.authentication)browserHost.closeTab(tabId,{returnToApp:true});return;}
  if(!message?.workspacePageRequest)return;const {id,url,authentication}=message.workspacePageRequest;if(typeof id!=='string')return;
  try{const result=openWorkspacePage(url,{authentication:authentication===true});worker.send({workspacePageReply:{id,...result}});}
  catch(error){worker.send({workspacePageReply:{id,error:/^[a-z_]+$/.test(error.message)?error.message:'browser_unavailable'}});}
 }});
 worker.on('fault',details=>recordFault('worker',details));
 worker.on('restarting',details=>hostEvent({type:'worker_restarting',...details}));
 worker.on('failed',details=>hostEvent({type:'worker_failed',...details}));
 worker.on('restarted',async details=>{
  try{if(currentRoot)await invoke('open',{root:currentRoot,kind:currentKind,initializeWiki:false});hostEvent({type:'worker_restarted',...details});}
  catch(error){hostEvent({type:'worker_failed',...details,error:/^[a-z_]+$/.test(error.message)?error.message:'operation_failed'});}
 });
 worker.start();
 host=new ElectronHost({keyStore,invoke,helperPath:path.join(__dirname,'git-askpass.cjs'),openBrowser:url=>openWorkspacePage(url,{authentication:true,companyLogin:host.account.device?.uri===url}),confirmWorkspaceSave:async change=>{
  const result=await dialog.showMessageBox(window,{type:'question',title:'AI Workspace에 저장',message:`${change.repository}에 변경을 저장할까요?`,detail:`브랜치: ${change.branch}\n${change.message}\n\n${change.files.slice(0,24).join('\n')}${change.files.length>24?`\n외 ${change.files.length-24}개 파일`:''}`,buttons:['저장','취소'],defaultId:1,cancelId:1,noLink:true});return result.response===0;
 }});
 const {screen}=require('electron'),windowState=restoreWindowState(await loadWindowState(),screen.getAllDisplays());
 window=new BrowserWindow({icon:appIcon,width:windowState.width,height:windowState.height,...(windowState.x!==undefined?{x:windowState.x,y:windowState.y}:{}),minWidth:620,minHeight:540,title:'누비 Workspace Beta',backgroundColor:'#F1F7FE',titleBarStyle:process.platform==='darwin'?'hiddenInset':'hidden',...(process.platform==='darwin'?{trafficLightPosition:{x:14,y:17}}:{titleBarOverlay:DEFAULT_TITLEBAR}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
 window.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)applyCaptionColors(window,DEFAULT_TITLEBAR);});
 if(windowState.maximized)window.maximize();
 for(const name of ['resize','move','maximize','unmaximize'])window.on(name,saveWindowState);
 window.on('close',()=>{clearTimeout(windowStateTimer);try{require('node:fs').mkdirSync(storage,{recursive:true});require('node:fs').writeFileSync(windowStateFile,JSON.stringify(windowStateOf(window)),{mode:0o600});}catch{}});
 window.webContents.on('will-navigate',(event,url)=>{if(url==='app://bundle/index.html')return;event.preventDefault();if(/^https?:/i.test(url))openPageLink(url);});/* Copy buttons write the clipboard from a user gesture (clipboard-sanitized-write); denying every permission made each copy fail with '복사 실패' (user report 2026-10-09). Everything else (media, notifications, location, reading the clipboard) stays denied. */window.webContents.session.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='clipboard-sanitized-write'));Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'누비 Workspace',submenu:[{label:'새로고침',role:'reload',accelerator:'CmdOrCtrl+R'},{type:'separator'},{role:'quit'}]},{label:'편집',submenu:[{role:'undo'},{role:'redo'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]}]));
 // A window whose renderer died comes back by itself; the worker, the login and the running work are not in it.
 window.webContents.on('render-process-gone',(_event,details)=>{recordFault('workspace_renderer',details);terminalHost?.dispose();if(details.reason!=='clean-exit'&&!window.isDestroyed())setTimeout(()=>{if(!window.isDestroyed())window.webContents.reload();},300);});
 let unresponsive=null;
 window.on('unresponsive',async()=>{
  if(unresponsive)return;unresponsive=new AbortController();
  try{const {response}=await dialog.showMessageBox(window,{type:'warning',message:'누비 Workspace 화면이 응답하지 않아요.',detail:'기다리면 돌아올 수 있어요. 다시 열면 화면만 새로 열고, 로그인과 진행 중인 작업은 그대로예요.',buttons:['기다리기','다시 열기'],defaultId:0,cancelId:0,noLink:true,signal:unresponsive.signal});
   if(response===1&&!window.isDestroyed())window.webContents.forcefullyCrashRenderer();}
  catch{}finally{unresponsive=null;}
 });
 window.on('responsive',()=>unresponsive?.abort());
 browserHost=new BrowserHost(window,{onFault:recordFault,loginCode:()=>{const device=host.account.device;return device&&device.expiresAt>Date.now()?device.code:null;}});
 window.webContents.setWindowOpenHandler(({url})=>{
  openPageLink(url);
  return {action:'deny'};
 });
 const dispatch=async(method,args={},source='electron')=>{try{
  if(installingUpdate&&method!=='workspaceUpdate')throw Error('update_installing');
  if(method==='workspaceUpdate'){
   if(source!=='electron')throw Error('update_desktop_only');
   updater??=new WorkspaceUpdater({account:host.account,directory:path.join(app.getPath('userData'),'updates'),version:app.getVersion()});
   if(args.action==='status')return updater.status();
   if(args.action==='check')return await updater.check();
   if(args.action==='download'){void updater.download().catch(()=>{});return updater.status();}
   if(args.action==='cancel')return updater.cancel();
   if(args.action==='install'){
    if(!app.isPackaged||process.platform!=='win32')throw Error('update_windows_only');
    if(terminalHost?.sessions.size||terminalHost?.opens.size||openingProject||host.wikis?.busy)throw Error('update_work_active');
    const installer=await updater.installer();
    if(terminalHost?.sessions.size||terminalHost?.opens.size||openingProject||host.wikis?.busy)throw Error('update_work_active');
    installingUpdate=true;
    try{await invoke('prepareAppUpdate');}catch(error){installingUpdate=false;throw error;}
    // NSIS's existing update mode skips the wizard and restarts after success.
    app.once('quit',()=>{const child=spawn(installer,['/S','--updated','--force-run'],{detached:true,stdio:'ignore',windowsHide:true,shell:false});child.on('error',()=>recordFault('update-installer',{reason:'launch-failed'}));child.unref();});
    setTimeout(()=>app.quit(),100);return {installing:true};
   }
   throw Error('method_invalid');
  }
  if(method==='titlebarAppearance'){if(source!=='electron')throw Error('titlebar_desktop_only');applyCaptionColors(window,args);return {updated:true};}
  if(method==='startupConnections'){let mail=null;try{mail=await invoke('mail',{action:'status'});}catch{}return {launchId,mailPrompt:startupMailPrompt(mail)};}
  if(method==='browser'){if(source!=='electron')throw Error('browser_desktop_only');return await browserHost.request(args);}
  if(method==='openWorkspacePage')return openWorkspacePage(args.url);
  if(!DESKTOP_FEATURES.computerUse&&method==='chooseComputerApp')throw Error('computer_beta_disabled');
  if(method==='openCurrent'){
   if(currentRoot)return await invoke('overview');
   let saved;try{saved=JSON.parse(await readFile(path.join(storage,'last-project.json'),'utf8'));}catch{return null;}
   if(!saved?.root)return null;
   // A last project whose folder is gone opens the start screen once; the stale pointer goes so the next start is clean.
   try{return await openProject(saved.root,saved.kind==='conversation'?'conversation':'project',{initializeWiki:false});}
   catch(error){if(error.message==='project_path_missing')await rm(path.join(storage,'last-project.json'),{force:true}).catch(()=>{});throw error;}
  }
  if(method==='startConversation'){const root=path.join(storage,'conversations');await mkdir(root,{recursive:true});return await openProject(root,'conversation');}
  if(method==='projectCatalog'){
   if(args.action==='rename')return await projectCatalog.rename(args.id,args.name);
   if(args.action==='remove'){if((await projectCatalog.list()).some(project=>project.id===args.id&&project.root===currentRoot))throw Error('project_active');return await projectCatalog.remove(args.id);}
   if(args.action&&args.action!=='list')throw Error('method_invalid');
   return await projectCatalog.list();
  }
  if(method==='switchProject'){const saved=await projectCatalog.get(args.id);return await openProject(saved.root);}
  if(method==='chooseFolder'){const root=await choose(['openDirectory'],'프로젝트 폴더 열기');return root?await openProject(root):{cancelled:true};}
  if(['browseLocalDirectory','readLocalFile'].includes(method)){const owner=await invoke('projectPath',{projectId:args.projectId});const value=await (method==='browseLocalDirectory'?browseLocalDirectory:readLocalFile)(args.path);if(currentRoot!==owner.path)throw Error('project_changed');return value;}
  if(method==='copyProjectPath'){const result=await invoke('projectPath',args);clipboard.writeText(result.path);return result;}
  if(method==='downloadMail'){
   const packet=await invoke('mail',{action:'download',id:args.id,kind:args.kind,attachmentId:args.attachmentId,expectedSourceHash:args.expectedSourceHash});
   const bytes=Buffer.from(packet.bytes,'base64');if(bytes.length!==packet.size||createHash('sha256').update(bytes).digest('hex')!==packet.sha256)throw Error('mail_source_changed');
   const saved=await dialog.showSaveDialog(window,{title:'메일 다운로드',defaultPath:path.join(app.getPath('downloads'),packet.filename),buttonLabel:'저장'});if(saved.canceled)return {cancelled:true};
   await writeFile(saved.filePath,bytes,{mode:0o600});if(createHash('sha256').update(await readFile(saved.filePath)).digest('hex')!==packet.sha256)throw Error('mail_download_unconfirmed');
   return {saved:true,filename:path.basename(saved.filePath)};
  }
  if(method==='mail'&&args.action==='download')throw Error('method_invalid');
  if(method==='copyMailStoragePath'){
   if(!['raw','wiki'].includes(args.kind))throw Error('mail_storage_kind_invalid');
   const status=await invoke('mail',{action:'status'}),storagePath=args.kind==='raw'?status.rawRoot:status.wikiRoot;
   if(typeof storagePath!=='string'||!path.isAbsolute(storagePath))throw Error('mail_storage_unavailable');
   clipboard.writeText(storagePath);return {path:storagePath};
  }
  if(method==='importProject'){const file=await choose(['openFile'],'프로젝트 ZIP 업로드',[{name:'ZIP',extensions:['zip']}]);if(!file)return {cancelled:true};const parent=await choose(['openDirectory'],'프로젝트를 저장할 폴더');if(!parent)return {cancelled:true};return await openProject((await importProjectZip(file,parent)).root);}
  if(method==='cloneRepository'){const parent=await choose(['openDirectory'],'프로젝트를 저장할 폴더');if(!parent)return {cancelled:true};return await openProject((await host.clone({...args,parent})).root,'project',{exactRoot:true});}
  if(method==='ghesAccount'){const state=await host.accountAction(args.operation);if(args.operation==='copy'){if(!state.device?.code)throw Error('copy_unavailable');clipboard.writeText(state.device.code);}return state;}
  if(method==='ghesRepositories')return host.listRepositories();
  if(method==='connectMarketplace')return host.connectMarketplace();
  if(method==='openTeamWorkspace')return host.openTeamWorkspace(args);
  if(method==='wikiRepository'){
   if(source!=='electron')throw Error('wiki_share_desktop_only');
   const service=host.wikiRepository;
   if(args.action==='list')return await service.list();
   if(args.action==='detail')return await service.detail(args);
   if(args.action==='progress')return service.progress;
   if(args.action==='cancel'){service.cancel();return {cancelled:true};}
   if(args.action==='stage'){const directory=await choose(['openDirectory'],'공유할 위키 문서 폴더');return directory?await service.stage(directory):{cancelled:true};}
   if(args.action==='publish')return await service.publish(args);
   if(args.action==='download'){const directory=await choose(['openDirectory'],'위키를 저장할 폴더');return directory?await service.download(args,directory):{cancelled:true};}
   throw Error('method_invalid');
  }
  if(method==='openBrowser')return openWorkspacePage(args.url);
  if(method==='chooseSkillPackage'){const folder=args.kind==='folder',mixed=!folder&&args.kind!=='zip'&&process.platform==='darwin';const file=await choose(folder?['openDirectory']:mixed?['openFile','openDirectory']:['openFile'],'스킬 등록',folder?undefined:[{name:'스킬',extensions:['zip','md']}]);return file?invoke('importSkill',{source:file,taskId:args.taskId}):{cancelled:true};}
  if(method==='chooseComputerApp'){const file=await choose(['openFile'],'Windows 앱 선택',[{name:'Windows app',extensions:['exe']}]);return file?invoke('computer',{method:'register_app',taskId:args.taskId,file}):{cancelled:true};}
  if(forbidden.has(method))throw Error('method_invalid');return await invoke(method,args);
 }catch(error){return {__nubiError:/^[a-z_]+$/.test(error.message)?error.message:'operation_failed'};}};
 terminalHost=new TerminalHost({invoke,profiles:shellProfiles,workerFile:path.join(__dirname,'terminal-worker.cjs'),notify:event=>{if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('nubi:terminal-event',event);}});
 ipcMain.handle('nubi:terminal',async(event,args)=>{trusted(event);try{if(installingUpdate)throw Error('update_installing');return await terminalHost.request(args);}catch(error){return {__nubiError:/^[a-z_]+$/.test(error.message)?error.message:'terminal_start_failed'};}});
 ipcMain.handle('nubi:request',(event,method,args={})=>{trusted(event);return dispatch(method,args);});
 ipcMain.handle('nubi:skill-file',async(event,args={})=>{trusted(event);try{
   if(typeof args.source!=='string'||!path.isAbsolute(args.source)||args.source.length>4000||args.taskId!==undefined&&args.taskId!==null&&typeof args.taskId!=='string')throw Error('skill_import_path');
   return await invoke('importSkill',{source:args.source,taskId:args.taskId});
 }catch(error){return {__nubiError:/^[a-z_]+$/.test(error.message)?error.message:'operation_failed'};}});
 // The local web host is optional: a busy port is recorded and the window still loads (2026-10-07; it hung before).
 if(process.env.NUBI_WEB_PORT){try{webHost=await startWebHost({frontend,dispatch:(method,args)=>dispatch(method,args,'web'),port:Number(process.env.NUBI_WEB_PORT)});console.log(`Nubi live workspace: ${webHost.origin}`);}catch(error){recordFault('web-host',{reason:'launch-failed',code:error.code||error.message});console.error('누비 로컬 웹을 열지 못했어요: '+(error.code||error.message));}}
 await window.loadURL('app://bundle/index.html');
});
app.on('window-all-closed',()=>app.quit());
// Quitting waits for the worker to exit (bounded by its kill grace): the worker releases the project store lock with its
// process, so a relaunch right after quit can open the same project instead of failing with project_locked.
let quitting=false;app.on('before-quit',event=>{if(quitting)return;quitting=true;event.preventDefault();terminalHost?.dispose();browserHost?.dispose();void webHost?.close();host?.dispose?.();Promise.resolve(worker?.stop()).catch(()=>{}).then(()=>vault.flush()).then(()=>app.quit());});
