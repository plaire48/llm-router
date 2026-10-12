import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ClaudeConnection} from '../ui/ClaudeConnection.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {ReasoningPicker} from '../ui/ReasoningPicker.jsx';
import {ProviderIcon} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
const id=new URLSearchParams(location.search).get('provider')||'claude';
const catalog={aipro:['low','medium','xhigh'],chatgpt:['low','medium','high','xhigh','max'],claude:['low','medium','high','xhigh','max']};
function CopySample(){
 const [text,setText]=useState('첫 원문');
 return <main className="desktop-shell" style={{padding:80,display:'flex',gap:16}}>
   <CopyButton text={text} label="내용 복사"/>
   <CopyButton label="경로 복사" resetKey={text} onCopy={async()=>{window.nativeCopies=(window.nativeCopies||0)+1;await new Promise(resolve=>setTimeout(resolve,100));if(window.failNative)throw Error('copy_failed');}}/>
   <button onClick={()=>setText('바뀐 원문')}>원문 변경</button>
 </main>;
}
function Sample(){
 if(new URLSearchParams(location.search).has('copy'))return <CopySample/>;
 const setup=new URLSearchParams(location.search).get('setup');
 if(setup)return <main className="desktop-shell"><ClaudeConnection initialIssue={setup} api={async()=>{throw Error('claude_login_required');}} onConnected={()=>{}} onClose={()=>{}} openWebPage={async url=>{window.setupGuideUrl=url;}}/></main>;
 const [provider,setProvider]=useState({provider:id,model:id+'-fixture',connected:true,reasoningEffort:'medium',reasoningOptions:catalog[id]});
 const api=async(_,{input})=>{const next={...provider,reasoningEffort:input.effort};setProvider(next);return next;};
 return <main className="desktop-shell"><div className="nubi-workbench" style={{padding:'220px 100px 100px'}}><h1 style={{position:'absolute',top:50,left:100,display:'flex',alignItems:'center',gap:12,fontSize:20}}><ProviderIcon provider={id}/>{{aipro:'AI Pro',chatgpt:'OpenAI',claude:'Claude'}[id]}</h1><div className="nubi-compose-card"><ReasoningPicker provider={provider} api={api}/></div></div></main>;
}
createRoot(document.getElementById('root')).render(<Sample/>);
