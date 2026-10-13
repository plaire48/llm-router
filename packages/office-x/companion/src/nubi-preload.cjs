const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('nubiOffice',{
 openConnection:()=>ipcRenderer.invoke('nubi:open'),
 status:()=>ipcRenderer.invoke('nubi:state'),
 command:(method,value)=>ipcRenderer.invoke('nubi:command',{method,value}),
 subscribe:callback=>{const handler=(_event,state)=>callback(state);ipcRenderer.on('nubi:state',handler);return ()=>ipcRenderer.removeListener('nubi:state',handler);},
 onOpenModelForm:callback=>{const handler=()=>callback();ipcRenderer.on('nubi:open-model-form',handler);return ()=>ipcRenderer.removeListener('nubi:open-model-form',handler);}
});
