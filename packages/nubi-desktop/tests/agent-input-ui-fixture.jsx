import React from 'react';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../../nubi-vscode/design/host.css';
import '../design/workspace-identity.css';
async function api(method,args={}){
 const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});const value=await response.json();if(!response.ok)throw Error(value.error);return value;
}
createRoot(document.getElementById('root')).render(<Workbench hostLayout="integrated" workspaceView={async()=>{}} api={api} openCurrent={()=>api('overview')} chooseFolder={()=>{}} review={()=>{}} apply={()=>{}} openURI={()=>{}} openBrowser={()=>{}}/>);
