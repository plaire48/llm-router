const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('nubi',{desktop:true,platform:process.platform,/* the skill picker offers a folder button where one dialog cannot take files and folders (2026-10-07) */request:(method,args)=>ipcRenderer.invoke('nubi:request',method,args),registerSkillFile:(file,taskId)=>{
 const source=webUtils.getPathForFile(file);
 if(!source)throw Error('skill_import_path');
 return ipcRenderer.invoke('nubi:skill-file',{source,taskId});
},onHostEvent:callback=>{
 if(typeof callback!=='function')throw Error('callback_invalid');
 const listener=(_event,value)=>callback(value);ipcRenderer.on('nubi:host-event',listener);
 return()=>ipcRenderer.removeListener('nubi:host-event',listener);
},onBrowserEvent:callback=>{
 if(typeof callback!=='function')throw Error('callback_invalid');
 const listener=(_event,value)=>callback(value);ipcRenderer.on('nubi:browser-event',listener);
 return()=>ipcRenderer.removeListener('nubi:browser-event',listener);
}});
