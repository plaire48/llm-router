import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton,CxNotice,DetailPanel,CxInput} from '@e2e/cx-design-system';
import {NubiLogin} from '../../vendor/nubi/extensions/aipro-chat/src/NubiSurfaces.jsx';
import {ModelSelection,ModelPicker} from '../../vendor/nubi/extensions/aipro-chat/src/ChatControls.jsx';
import {ReasoningPicker} from '../../vendor/nubi/packages/nubi-desktop/ui/ReasoningPicker.jsx';
import {Services} from '../../ui/Services.jsx';
import {labels,modelData} from '../../ui/provider-view.js';
import '@e2e/cx-design-system/styles.css';
import '@e2e/cx-design-system/fonts.css';
import '../../vendor/nubi/extensions/aipro-chat/design/agent-deck.css';
import '../../vendor/nubi/extensions/aipro-chat/src/app.css';
import '../../vendor/nubi/packages/nubi-desktop/design/workspace-identity.css';
import '../../vendor/nubi/packages/nubi-desktop/design/workspace-typography.css';
import '../../vendor/nubi/packages/nubi-desktop/design/workspace-dialogs.css';
import './connection.css';
function Connection(){const [state,setState]=useState({providers:[],initializing:true}),[error,setError]=useState(''),[models,setModels]=useState(false),[busy,setBusy]=useState(false),[services,setServices]=useState(false),[fabrix,setFabrix]=useState(false),[values,setValues]=useState({endpoint:'',clientKey:'',token:''});const data=modelData(state);
 useEffect(()=>{window.nubiOffice.status().then(setState).catch(()=>setError('연결 상태를 확인하지 못했습니다.'));return window.nubiOffice.subscribe(setState);},[]);
 async function action(method,value){setError('');if(method!=='cancelLogin')setBusy(true);try{const result=await window.nubiOffice.command(method,value);setState(result);return result;}catch{setError('연결을 확인해주세요. Claude는 로그인한 Claude Code가 필요합니다.');throw Error('connection_failed');}finally{setBusy(false);}}
 const login=p=>p==='fabrix'?setFabrix(true):action('login',p).catch(()=>{});
 return <main className="desktop-shell nubi-workbench"><section className="nubi-task connection-content"><header><strong>누비 연결</strong><span>Office와 같은 계정으로 사용합니다</span></header>{error&&<CxNotice tone="danger">{error}</CxNotice>}
 {state.connected?<section className="connected"><h1>{labels[state.provider]} 연결됨</h1><ModelPicker data={data} providerLabels={labels} onOpen={()=>setModels(true)} onRefresh={()=>action('refreshModels').catch(()=>{})} disabled={busy}/>{state.reasoningOptions?.length>0&&<ReasoningPicker provider={state} disabled={busy} api={async(_,{input})=>({result:await action('reasoning',input)})}/>}<CxButton onClick={()=>setModels(true)}>계정과 모델 변경</CxButton></section>:<NubiLogin providerLabels={labels} intro={{title:'사용할 모델을 연결하세요',description:'문서를 읽고 만들고 다듬습니다'}} pending={data.pending} checkingProvider={state.initializing?'aipro':null} onLogin={login} onCancel={()=>action('cancelLogin').catch(()=>{})}/>}
 <CxButton onClick={()=>setServices(true)}>검색과 이미지 설정</CxButton><label className="preference"><input type="checkbox" checked={state.preferred!==false} onChange={e=>action('preferred',e.target.checked).catch(()=>{})}/>편집기에서 누비 모델 사용</label><p className="hint">끄면 GenOffice의 원본 서비스 설정을 사용합니다.</p>
 {services&&<Services state={state.services||{}} onClose={()=>setServices(false)} call={(method,input)=>action('services',{method,input})}/>}
 {fabrix&&<DetailPanel title="FabriX 연결" variant="modal" hideHelp onClose={()=>setFabrix(false)}><form onSubmit={async e=>{e.preventDefault();try{await action('connect',{provider:'fabrix',...values});setFabrix(false);}catch{}}}>{[['endpoint','서버 주소','url'],['clientKey','클라이언트 키','password'],['token','접속 토큰','password']].map(([key,label,type])=><label className="connection-field" key={key}>{label}<CxInput required type={type} autoComplete="off" value={values[key]} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}<CxButton type="submit" variant="primary" busy={busy}>연결</CxButton></form></DetailPanel>}
 {models&&<ModelSelection data={data} providerLabels={labels} disabled={busy} showProviderNames showActionLabels onClose={()=>setModels(false)} onLogin={login} onCancelLogin={()=>action('cancelLogin')} onProviderSelect={id=>action('select',id)} onLogout={id=>action('disconnect',id)} onRefresh={()=>action('refreshModels')} onSelect={async(id,p)=>{try{await action('select',p);await action('model',id);return true;}catch{return false;}}}/>}
 </section></main>;
}
createRoot(document.getElementById('root')).render(<Connection/>);
