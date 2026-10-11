const {WebContentsView,session,Menu,dialog,shell}=require('electron');
const {randomUUID}=require('node:crypto');
const {writeFile}=require('node:fs/promises');

function address(input) {
 if(typeof input!=='string'||input.length>8000)throw Error('browser_url_invalid');
 const value=input.trim();if(!value||value==='about:blank')return 'about:blank';
 const local=/^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value);
 const hostname=/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(value);
 let url;try{url=new URL(local?`http://${value}`:hostname?`https://${value}`:/^[a-z][a-z\d+.-]*:/i.test(value)?value:`https://www.google.com/search?q=${encodeURIComponent(value)}`);}catch{throw Error('browser_url_invalid');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('browser_url_invalid');return url.href;
}
function displayAddress(value){
 try{const url=new URL(value);for(const key of [...url.searchParams.keys()])if(/^(code|token|access_token|id_token|refresh_token)$/i.test(key))url.searchParams.delete(key);if(/(?:^|[&#])(code|token|access_token|id_token|refresh_token)=/i.test(url.hash))url.hash='';return url.href;}catch{return value;}
}
class BrowserHost {
 constructor(window,{loginCode=()=>null,onFault=()=>{}}={}) {
  this.loginCode=loginCode;
  this.onFault=onFault;this.disposed=false;this.updateTimer=null;this.lastUpdate='';
  this.window=window;this.tabs=new Map();this.active=null;this.history=[];this.downloads=[];this.visible=false;this.bounds=null;this.find=null;
  this.session=session.fromPartition(`nubi-browser-${randomUUID()}`,{cache:true});
  this.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
  this.session.setPermissionCheckHandler(()=>false);
  this.session.on('will-download',(_event,item)=>{
   const entry={id:randomUUID(),name:item.getFilename(),state:'progressing',received:0,total:item.getTotalBytes()};this.downloads.unshift(entry);this.downloads=this.downloads.slice(0,50);
   item.setSaveDialogOptions({title:'다운로드 저장',defaultPath:item.getFilename()});
   item.on('updated',(_event,state)=>{entry.state=state;entry.received=item.getReceivedBytes();this.changed();});
   item.once('done',(_event,state)=>{entry.state=state;if(state==='completed')entry.file=item.getSavePath();this.changed();});
  });
  window.webContents.on('did-start-navigation',(_event,_url,_inPlace,mainFrame)=>{if(mainFrame)this.hide();});
  window.on('resize',()=>this.layout());window.on('closed',()=>this.dispose());
 }
 tab(id=this.active) {const row=this.tabs.get(id);if(!row||row.view.webContents.isDestroyed())throw Error('browser_tab_missing');return row;}
 publish(type='changed',extra={}) {
  if(this.disposed||this.window.isDestroyed()||this.window.webContents.isDestroyed())return;
  const state=this.status(),serialized=JSON.stringify(state);if(type==='changed'&&serialized===this.lastUpdate)return;this.lastUpdate=serialized;
  this.window.webContents.send('nubi:browser-event',{type,state,...extra});
 }
 changed() {if(this.disposed||this.updateTimer)return;this.updateTimer=setTimeout(()=>{this.updateTimer=null;this.publish();},80);}
 forget(row,{returnToApp=false}={}) {
  // Chromium may close the authentication view itself. Returning from that
  // last tab must not leave an empty browser with the old callback address.
  const closedActiveAuthentication=row.authentication&&this.active===row.id;
  if(!this.tabs.delete(row.id))return;
  if(!this.window.isDestroyed())this.window.contentView.removeChildView(row.view);
  if(this.active===row.id)this.active=[...this.tabs.keys()].at(-1)||null;
  if(!this.disposed){this.layout();this.publish('closed',{returnToApp:returnToApp||Boolean(closedActiveAuthentication&&!this.active)});}
 }
 closeTab(id,{returnToApp=false}={}) {
  const row=this.tabs.get(id);if(!row)return;
  // Remove ownership before Chromium emits destroyed; never close the app window.
  this.forget(row,{returnToApp});if(!row.view.webContents.isDestroyed())row.view.webContents.close();
  if(returnToApp&&!this.window.isDestroyed())this.window.webContents.focus();
 }
 hide() {this.visible=false;for(const row of this.tabs.values())if(!row.view.webContents.isDestroyed())row.view.setVisible(false);}
 layout() {
  if(this.disposed||this.window.isDestroyed())return;
  if(!this.visible||!this.bounds)return this.hide();
  const [w,h]=this.window.getContentSize(),b=this.bounds;
  const x=Math.max(48,Math.min(w,Math.round(b.x))),y=Math.max(64,Math.min(h,Math.round(b.y)));
  const width=Math.max(0,Math.min(w-x,Math.round(b.width))),height=Math.max(0,Math.min(h-y,Math.round(b.height)));
  for(const row of this.tabs.values()) {if(row.view.webContents.isDestroyed())continue;const active=row.id===this.active&&width>0&&height>0;row.view.setVisible(active);if(active)row.view.setBounds({x,y,width,height});}
 }
 create(url='about:blank',{authentication=false,companyLogin=false}={}) {
  if(this.tabs.size>=12)throw Error('browser_tab_limit');
  const target=address(url),view=new WebContentsView({webPreferences:{session:this.session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false}});
  const row={id:randomUUID(),view,title:'웹 페이지',url:displayAddress(target),authentication:authentication===true,companyLogin:companyLogin===true,loading:false,error:null};this.tabs.set(row.id,row);this.window.contentView.addChildView(view);view.setVisible(false);view.setBackgroundColor('#FFFFFF');this.active=row.id;
  const wc=view.webContents;
  const permitted=url=>{try{const parsed=new URL(url);return url==='about:blank'||(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password);}catch{return false;}};
  wc.on('will-navigate',(event,url)=>{if(row.authentication&&url==='nubi-workspace://auth-return'){event.preventDefault();this.closeTab(row.id,{returnToApp:true});return;}if(!permitted(url))event.preventDefault();});
  wc.on('will-redirect',(event,url)=>{if(!permitted(url))event.preventDefault();});
  wc.setWindowOpenHandler(({url})=>{if(permitted(url)&&this.tabs.size<12){this.create(url,{authentication:row.authentication,companyLogin:row.companyLogin});this.window.webContents.send('nubi:browser-event',{type:'opened',state:this.status()});}return {action:'deny'};});
  wc.on('before-input-event',(event,input)=>{
   if(input.type!=='keyDown'||!(input.control||input.meta)||input.alt)return;
   const key=input.key.toLowerCase();if(!['l','f','r','t','w'].includes(key))return;event.preventDefault();
   if(key==='l'||key==='f'){this.window.webContents.focus();this.window.webContents.send('nubi:browser-event',{type:'focus',field:key==='l'?'address':'find'});}
   else if(key==='r')wc.reload();else if(key==='t'){try{this.create();}catch(error){this.window.webContents.send('nubi:browser-event',{type:'error',error:error.message});}}else void this.request({action:'close',id:row.id}).catch(()=>{});
  });
  wc.on('page-title-updated',(_event,title)=>{row.title=title.slice(0,240);this.changed();});
  wc.on('did-start-loading',()=>{row.loading=true;row.error=null;this.changed();});
  wc.on('did-stop-loading',()=>{row.loading=false;this.changed();});
  wc.on('did-navigate',(_event,url)=>{row.url=displayAddress(url);if(!row.authentication&&url!=='about:blank'&&row.url===url){this.history=this.history.filter(item=>item.url!==url);this.history.unshift({url,title:row.title,date:Date.now()});this.history=this.history.slice(0,100);}this.changed();});
  wc.on('did-navigate-in-page',(_event,url,isMain)=>{if(isMain){row.url=displayAddress(url);this.changed();}});
  wc.on('did-fail-load',(_event,code,_description,_url,isMain)=>{if(isMain&&code!==-3){row.loading=false;row.error='browser_load_failed';this.changed();}});
  wc.on('found-in-page',(_event,result)=>{this.find={matches:result.matches,active:result.activeMatchOrdinal};this.changed();});
  wc.on('destroyed',()=>this.forget(row));
  wc.on('render-process-gone',(_event,details)=>{row.loading=false;row.error='browser_process_gone';this.onFault('browser_renderer',details);this.changed();});
  void wc.loadURL(target).catch(()=>{row.loading=false;row.error='browser_load_failed';this.changed();});this.layout();this.changed();return row;
 }
 status() {return {active:this.active,tabs:[...this.tabs.values()].filter(row=>!row.view.webContents.isDestroyed()).map(row=>({id:row.id,title:row.title,url:row.url,loginCode:row.companyLogin?this.loginCode():null,loading:row.loading,error:row.error,back:row.view.webContents.navigationHistory.canGoBack(),forward:row.view.webContents.navigationHistory.canGoForward(),zoom:Math.round(row.view.webContents.getZoomFactor()*100)})),find:this.find,history:this.history.map(item=>({...item})),downloads:this.downloads.map(({file,...item})=>item)};}
 menu({kind='main',x,y}={}) {
  const wc=this.tab().view.webContents;
  const downloadItems=this.downloads.map(item=>({label:`${item.name.slice(0,80)}${item.state==='completed'?' (폴더에서 보기)':' (다운로드 중)'}`,enabled:item.state==='completed',click:()=>shell.showItemInFolder(item.file)}));
  const historyItems=this.history.slice(0,30).map(item=>({label:(item.title||item.url).slice(0,80),click:()=>void wc.loadURL(address(item.url)).catch(()=>{})}));
  const template=kind==='downloads'?(downloadItems.length?downloadItems:[{label:'다운로드가 없어요.',enabled:false}]):[
   {label:'인쇄',enabled:this.tab().url!=='about:blank',click:()=>wc.print({silent:false})},
   {type:'separator'},
   {label:`확대/축소 ${Math.round(wc.getZoomFactor()*100)}%`,submenu:[{label:'확대',click:()=>{wc.setZoomFactor(Math.min(3,wc.getZoomFactor()+.1));this.changed();}},{label:'축소',click:()=>{wc.setZoomFactor(Math.max(.5,wc.getZoomFactor()-.1));this.changed();}},{label:'100%',click:()=>{wc.setZoomFactor(1);this.changed();}}]},
   {label:'사진으로 저장',click:async()=>{const result=await dialog.showSaveDialog(this.window,{title:'페이지 사진 저장',defaultPath:'nubi-browser.png',filters:[{name:'PNG',extensions:['png']}]});if(!result.canceled)await writeFile(result.filePath,(await wc.capturePage()).toPNG());}},
   {label:'다운로드',submenu:downloadItems.length?downloadItems:[{label:'다운로드가 없어요.',enabled:false}]},
   {label:'방문 기록',submenu:historyItems.length?historyItems:[{label:'방문 기록이 없어요.',enabled:false}]},
   {type:'separator'},
   {label:'인터넷 사용 기록 삭제',click:async()=>{const result=await dialog.showMessageBox(this.window,{type:'question',message:'브라우저 방문 기록과 쿠키를 삭제할까요?',detail:'누비 모델 연결과 프로젝트 기록은 유지됩니다.',buttons:['취소','삭제'],defaultId:0,cancelId:0});if(result.response===1){this.history=[];await this.session.clearStorageData();await this.session.clearCache();}}},
  ];
  const [w,h]=this.window.getContentSize();Menu.buildFromTemplate(template).popup({window:this.window,...(Number.isFinite(x)&&Number.isFinite(y)?{x:Math.max(0,Math.min(w,Math.round(x))),y:Math.max(0,Math.min(h,Math.round(y)))}:{})});return this.status();
 }
 async request({action='status',id,url,bounds,visible,text,forward,x,y,kind}={}) {
  if(action==='status')return this.status();
  if(action==='layout') {if(bounds){if(!['x','y','width','height'].every(key=>Number.isFinite(bounds[key])))throw Error('browser_bounds_invalid');this.bounds=bounds;}this.visible=visible===true;this.layout();return {visible:this.visible};}
  if(action==='new')this.create(url);
  else if(action==='navigate'&&!this.active)this.create(url);
  else if(action==='select'){this.tab(id);this.active=id;this.layout();}
  else if(action==='close')this.closeTab(id||this.active);
  else if(action==='menu')return this.menu({x,y,kind});
  else {
   const row=this.tab(id),wc=row.view.webContents;
   if(action==='navigate'){row.error=null;const target=address(url);row.url=displayAddress(target);void wc.loadURL(target).catch(()=>{row.error='browser_load_failed';});}
   else if(action==='back'){if(wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();}
   else if(action==='forward'){if(wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();}
   else if(action==='reload')wc.reload();
   else if(action==='stop')wc.stop();
   else if(action==='find'){if(typeof text!=='string'||text.length>1000)throw Error('input_invalid');if(text)wc.findInPage(text,{forward:forward!==false});else{wc.stopFindInPage('clearSelection');this.find=null;}}
   else throw Error('method_invalid');
  }
  return this.status();
 }
 dispose() {if(this.disposed)return;this.disposed=true;clearTimeout(this.updateTimer);for(const row of [...this.tabs.values()])this.closeTab(row.id);}
}
module.exports={BrowserHost};
