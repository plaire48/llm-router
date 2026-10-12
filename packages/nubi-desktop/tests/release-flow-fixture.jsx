import React from 'react';
import {createRoot} from 'react-dom/client';
import {DriftLabel} from '../ui/DriftLabel.jsx';
import {WorkspaceUpdate,WorkspaceUpdateProgress,useWorkspaceUpdate} from '../ui/WorkspaceUpdate.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-dialogs.css';
window.fixtureUpdate={phase:'available',currentVersion:'1.1.1',release:{version:'1.1.2',size:100*1024**2,notes:'업데이트 안내'}};
window.installCalls=0;window.downloadCalls=0;
async function api(method,{action}){if(action==='download'){window.downloadCalls++;window.fixtureUpdate={...window.fixtureUpdate,phase:'downloading',percent:25,received:25*1024**2};}return window.fixtureUpdate;}
function Fixture(){const update=useWorkspaceUpdate(api,async()=>{window.installCalls++;});React.useEffect(()=>{void update.action('check');},[]);return <><div style={{width:180,margin:24}}><button id="short"><DriftLabel>index.js</DriftLabel></button><button id="long" style={{display:'flex',width:'100%'}}><DriftLabel>프로젝트별 배포 상태를 확인하는 아주 긴 파일 이름.md</DriftLabel></button></div><WorkspaceUpdate update={update}/><WorkspaceUpdateProgress update={update}/></>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
