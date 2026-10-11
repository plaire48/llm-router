import React,{useEffect,useRef,useState} from 'react';
import {CxButton, CxNotice, DetailPanel, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {PersonMark,FolderMark,CompanyMark} from './marks.jsx';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './ghes-account.css';

import {ghesMessages} from './ghes-account-state.mjs';
const updateLabel={unchecked:'최신 버전 확인',current:'최신 버전',update_available:'업데이트 설치',installing:'설치 중',restart_required:'누비 다시 시작',installed_verified:'설치 확인됨',attention:'다시 확인'};
const failureText=code=>ghesMessages[code]||'회사 계정을 확인하지 못했어요. 다시 시도해 주세요.';
function Avatar({profile}){const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[profile?.avatar]);
  return <span className="nubi-account-avatar" aria-hidden="true">{profile?.avatar&&!failed?<img src={profile.avatar} alt="" onError={()=>setFailed(true)}/>:profile?(profile.name||profile.login).slice(0,2).toUpperCase():<PersonMark size={20}/>}</span>;}

// Profile UI receives display identity and operation states only. Credentials,
// SAML assertions and installation paths never enter this component.
export function GhesAccount({account,updates,repositories,open,onOpen,onClose,onConnected,onCancelled,buttonRef,loginRequest=0}){
  const [state,setState]=useState({state:'guest',profile:null}),[update,setUpdate]=useState({state:'unchecked'}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(false),request=useRef(0),connected=useRef(false),previousOpen=useRef(false),handledLogin=useRef(0);
  const onConnectedRef=useRef(onConnected);onConnectedRef.current=onConnected;
  const stateRef=useRef(state);stateRef.current=state;
  const accept=async value=>{
    if(!mounted.current)return;setState(value);
    if(value.connected&&!connected.current){connected.current=true;await onConnectedRef.current?.();}
    if(!value.connected)connected.current=false;
  };
  useEffect(()=>{
    mounted.current=true;let active=true,timer;
    const read=async()=>{
      try{const value=await account('status');if(active){await accept(value);if(updates)setUpdate(await updates('status'));}}
      catch(e){if(active)setError(e.message);}
      if(active&&document.visibilityState!=='hidden')timer=setTimeout(read,stateRef.current.state==='connecting'?1500:30000);
    };
    const visibility=()=>{clearTimeout(timer);if(document.visibilityState!=='hidden')void read();};
    void read();document.addEventListener('visibilitychange',visibility);
    return()=>{active=false;mounted.current=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
  },[account,updates,open,state.state==='connecting']);
  useEffect(()=>{if(previousOpen.current&&!open)requestAnimationFrame(()=>buttonRef?.current?.focus());previousOpen.current=open;},[open,buttonRef]);
  async function action(operation){
    if(busy)return;setBusy(true);setError('');const id=++request.current;
    if(operation==='cancel'||operation==='logout')onCancelled?.();
    try{const value=await account(operation);if(id===request.current){await accept(value);if(operation==='login')setTimeout(()=>account('status').then(accept).catch(()=>{}),100);}}
    catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}
  }
  useEffect(()=>{
    if(!loginRequest||handledLogin.current===loginRequest||busy)return;
    handledLogin.current=loginRequest;void action('login');
  },[loginRequest,busy]);
  async function nativeOperation(fn){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}}
  const label=state.connected?state.profile?.name||state.profile?.login:'회사 계정';
  const updateOperation=update.state==='update_available'?'install':update.state==='restart_required'?'restart':'check';
  return <div className="nubi-account-control">
    <CxButton ref={buttonRef} className="nubi-account-button" aria-label={state.connected?`${label} 계정 메뉴`:'회사 계정 메뉴'} title={state.connected?`${label} (@${state.profile.login})`:'회사 계정 연결'} aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}><Avatar profile={state.profile}/><span>회사 계정</span></CxButton>
    {open&&<DetailPanel className="deck-dialog nubi-panel nubi-ghes-modal" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon" aria-hidden="true"><PersonMark size={18}/></span><span>회사 계정</span></span>} variant="modal" onClose={onClose}>
      {state.connected?<div className="nubi-account-profile"><Avatar profile={state.profile}/><div><h3>{label}</h3><p>@{state.profile.login}</p></div></div>:<header className="nubi-account-login-heading"><AgentMark size={48} mood="idle" lively/><div><h3>AI Workspace</h3>{state.state!=='connecting'&&<p>팀 스킬과 저장소를 연결하세요.</p>}</div></header>}
      {(error||state.error)&&<CxNotice tone="danger">{failureText(error||state.error)}</CxNotice>}
      {state.state==='connecting'?<div className="nubi-account-device" role="status">
        <p>브라우저에서 회사 SSO로 로그인한 뒤 코드를 입력해 주세요.</p>
        {state.device?<><div className="nubi-account-code"><strong>{state.device.code}</strong><ActionButton action="copy" label="로그인 코드 복사" title="로그인 코드 복사" disabled={busy} onClick={()=>action('copy')}/></div><CxButton disabled={busy} onClick={()=>action('browser')}><Icon name="linkExternal" size={16}/>로그인 페이지 열기</CxButton></>:<p>로그인 페이지를 준비하고 있어요.</p>}
        <CxButton disabled={busy} onClick={()=>action('cancel')}><Icon name="xClose" size={16}/>로그인 취소</CxButton>
      </div>:!state.connected?<div className="nubi-account-signin"><CxButton variant="primary" disabled={busy} onClick={()=>action('login')}><Icon name="githubMark" size={20}/>사내 SSO로 로그인</CxButton>{['ghes_sso_required','ghes_network'].includes(error||state.error)&&<CxButton disabled={busy} onClick={()=>action('browser')}><Icon name="linkExternal" size={16}/>회사 로그인 열기</CxButton>}{state.state==='attention'&&<CxButton disabled={busy} onClick={()=>action('retry')}><Icon name="refresh" size={16}/>연결 다시 확인</CxButton>}</div>:<>
        {(state.profile?.company||state.profile?.email)&&<section className="nubi-account-info" aria-label="기본 정보"><dl>{state.profile.company&&<div><dt title="소속"><CompanyMark size={16}/><span className="visually-hidden">소속</span></dt><dd>{state.profile.company}</dd></div>}{state.profile.email&&<div><dt title="이메일"><Icon name="mail" size={16}/><span className="visually-hidden">이메일</span></dt><dd>{state.profile.email}</dd></div>}</dl></section>}
        <details className="nubi-account-settings"><summary title="저장소와 업데이트"><Icon name="sliders" size={18}/>설정</summary>
        {repositories&&<CxButton disabled={busy} onClick={()=>nativeOperation(repositories)}><FolderMark size={18}/>회사 저장소 열기</CxButton>}
        {updates&&<section className="nubi-account-update" aria-label="누비 기능 업데이트"><div><strong>누비 기능 업데이트</strong><p>{update.installedVersion?`설치 버전 ${update.installedVersion}`:'설치 버전 확인 중'}{update.availableVersion&&update.availableVersion!==update.installedVersion?` → ${update.availableVersion}`:''}</p></div><CxButton disabled={busy||!update.supported} onClick={()=>nativeOperation(async()=>{setUpdate(await updates(updateOperation));})}><Icon name="download" size={18}/>{updateLabel[update.state]||'최신 버전 확인'}</CxButton>{update.state==='restart_required'&&<p>설치를 요청했어요. 다시 시작한 뒤 버전을 확인합니다.</p>}{update.supported===false&&<p>업데이트 설치는 Windows x64에서 지원합니다.</p>}</section>}
        </details>
        <div className="nubi-account-footer"><ActionButton action="logout" iconOnly label="로그아웃" title="로그아웃" disabled={busy} onClick={()=>action('logout')}/><div><ActionButton action="refresh" label="프로필 새로고침" title="프로필 새로고침" disabled={busy} onClick={()=>action('refresh')}/><ActionButton action="openExternal" label="GitHub 프로필 보기" title="GitHub 프로필 보기" disabled={busy} onClick={()=>action('profile')}/></div></div>
      </>}
    </DetailPanel>}
  </div>;
}
