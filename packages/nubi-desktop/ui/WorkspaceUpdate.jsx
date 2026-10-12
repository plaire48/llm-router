import React,{useEffect,useState,useRef} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import './workspace-update.css';
const errors={ghes_login_required:'사내 Github SSO로 로그인한 뒤 확인해 주세요.',ghes_session_expired:'사내 Github SSO에 다시 로그인해 주세요.',ghes_session_changed:'계정이 바뀌었어요. 업데이트를 다시 확인해 주세요.',update_permission:'nuri 저장소의 읽기 권한을 확인해 주세요.',update_not_published:'아직 등록된 Windows 업데이트가 없어요.',update_network:'사내망 연결을 확인하고 다시 시도해 주세요.',update_download_origin:'다운로드 서버 주소를 확인해야 해요. 관리자에게 문의해 주세요.',update_integrity:'파일을 확인하지 못했어요. 다시 다운로드해 주세요.',update_manifest_invalid:'배포 정보를 확인하지 못했어요. 관리자에게 문의해 주세요.',update_work_active:'진행 중인 작업과 터미널을 마친 뒤 다시 시도해 주세요.',editor_dirty:'수정 중인 파일을 저장한 뒤 다시 시도해 주세요.',update_windows_only:'Windows 설치판에서 업데이트할 수 있어요.'};
export function useWorkspaceUpdate(api,onInstall){
 const [state,setState]=useState(null),[error,setError]=useState(''),[opened,setOpened]=useState(false),live=useRef(true),lock=useRef(false),automatic=useRef(false),install=useRef(onInstall),phaseRef=useRef();install.current=onInstall;phaseRef.current=state?.phase;
 async function action(name){if(lock.current)return;lock.current=true;setError('');try{
  if(name==='install'){await (install.current?install.current():api('workspaceUpdate',{action:'install'}));if(live.current)setState(old=>({...old,phase:'installing'}));return;}
  const value=await api('workspaceUpdate',{action:name});if(live.current)setState(value);
 }catch(e){automatic.current=false;if(live.current)setError(errors[e.message]||'업데이트를 완료하지 못했어요. 다시 시도해 주세요.');}finally{lock.current=false;}}
 function start(){automatic.current=true;setOpened(true);void action(state?.phase==='ready'?'install':'download');}
 function close(){if(['downloading','installing'].includes(state?.phase))return;automatic.current=false;setOpened(false);}
 function cancel(){automatic.current=false;void action('cancel');}
 useEffect(()=>{live.current=true;if(window.nubi?.platform==='win32')void action('check');const timer=setInterval(()=>{if(window.nubi?.platform==='win32'&&!lock.current&&!automatic.current&&!['downloading','ready','installing'].includes(phaseRef.current))void action('check');},60*60*1000);return()=>{live.current=false;clearInterval(timer);};},[api]);
 useEffect(()=>{if(!['checking','downloading'].includes(state?.phase))return;let active=true,pending=false;const timer=setInterval(async()=>{if(pending)return;pending=true;try{const value=await api('workspaceUpdate',{action:'status'});if(active)setState(value);}catch{}finally{pending=false;}},700);return()=>{active=false;clearInterval(timer);};},[api,state?.phase]);
 useEffect(()=>{if(state?.phase==='ready'&&automatic.current){automatic.current=false;void action('install');}},[state?.phase]);
 return {state,error:error||errors[state?.error]||(state?.phase==='error'?'업데이트를 확인하지 못했어요.':''),action,start,opened,close,cancel};
}
export function WorkspaceUpdate({update,compact=false}){
 const {state,error,action,start}=update,phase=state?.phase;
 if(compact&&!['available','downloading','ready'].includes(phase))return null;
 const available=phase==='available'||phase==='ready'||phase==='error'&&state?.release;
 const label=phase==='downloading'?`다운로드 ${state.percent||0}%`:available?'업데이트':phase==='checking'?'확인 중':'업데이트 확인';
 return <section className={'nubi-workspace-update'+(compact?' is-compact':'')} aria-label="앱 업데이트">
  {!compact&&<div className="nubi-update-heading"><strong>누비 Workspace Beta</strong>{state?.currentVersion&&<span>{state.currentVersion}</span>}</div>}
  <CxButton title={label} aria-label={label} disabled={['checking','downloading','installing','unsupported'].includes(phase)} onClick={()=>available?start():void action('check')}><Icon name="download" size={16}/><span>{label}</span></CxButton>
  {!compact&&phase==='current'&&<p>최신 버전이에요.</p>}
  {!compact&&phase==='unsupported'&&<p>Windows 설치판에서 업데이트할 수 있어요.</p>}
  {!compact&&state?.release&&available&&<><span className="nubi-update-meta">새 버전 {state.release.version}</span><p>{state.release.notes}</p></>}
  {error&&!compact&&<p role="status">{error}</p>}
 </section>;
}
export function WorkspaceUpdateProgress({update}){
 const {opened,state,error,close,cancel,start}=update;if(!opened)return null;
 const busy=['downloading','installing'].includes(state?.phase),downloading=state?.phase==='downloading';
 return <DetailPanel variant="modal" className="deck-dialog nubi-panel nubi-update-dialog" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon"><Icon name="download" size={18}/></span>누비 업데이트</span>} busy={busy} onClose={close} footer={downloading?<CxButton onClick={cancel}>취소</CxButton>:state?.phase!=='installing'?<CxButton onClick={start}>{state?.phase==='ready'?'설치 후 다시 시작':'다시 시도'}</CxButton>:null}>
  <div className="nubi-update-progress" aria-live="polite"><strong>{downloading?'새 버전을 다운로드하고 있어요.':state?.phase==='installing'?'설치 후 누비가 다시 열립니다.':state?.phase==='ready'?'설치 준비가 끝났어요.':'업데이트를 확인해 주세요.'}</strong>
  {downloading&&<><div><span>{state.percent||0}%</span><span>{Math.floor((state.received||0)/1024**2)} / {Math.ceil(state.release.size/1024**2)} MB</span></div><progress aria-label="업데이트 다운로드" max={100} value={state.percent||0}/>{Number.isFinite(state.remainingSeconds)&&<span>약 {state.remainingSeconds}초 남음</span>}<p>다운로드와 검증이 끝나면 자동으로 설치하고 다시 시작해요.</p></>}
  {error&&<p role="alert">{error}</p>}
  </div>
 </DetailPanel>;
}
