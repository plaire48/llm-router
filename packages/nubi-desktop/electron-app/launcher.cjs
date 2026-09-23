const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const {app}=require('electron');
process.env.THEIA_CONFIG_DIR ||= path.join(os.homedir(),'.nubi-desktop','ide');
process.env.NUBI_STORAGE_ROOT ||= path.join(os.homedir(),'.nubi-desktop');
// A bundled, versioned driver is used only on Windows. Per-action hash checks remain mandatory.
if(process.platform==='win32'&&!process.env.NUBI_WINAPP_PATH){
  const driver=path.join(process.resourcesPath,'winapp');
  const manifest=JSON.parse(fs.readFileSync(path.join(driver,'manifest.json'),'utf8'));
  process.env.NUBI_WINAPP_PATH=path.join(driver,'winapp.exe');
  process.env.NUBI_WINAPP_SHA256=manifest.sha256;
}
if(!process.argv.some(arg=>arg.startsWith('--hostname')))process.argv.push('--hostname=127.0.0.1');
if(!process.argv.some(arg=>arg.startsWith('--port')))process.argv.push('--port=0');
app.setName('누비 workspace');
if(process.platform==='win32'){
  app.setAppUserModelId('nubi.workspace');
  const icon=app.isPackaged?path.join(process.resourcesPath,'nubi-icon.png'):path.resolve(__dirname,'../../../extensions/aipro-chat/design/brand/bird-master.png');
  app.on('browser-window-created',(_event,window)=>window.setIcon(icon));
}
require('./lib/backend/electron-main.js');
