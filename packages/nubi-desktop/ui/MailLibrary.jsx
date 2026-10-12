import {DESKTOP_PROVIDER_LABELS} from './provider-labels.mjs';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {CxButton, CxInput, Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {BrowserMark,PersonMark,FolderMark} from './marks.jsx';
import {ModelSelection,ProviderIcon} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {mailPassword} from '../runtime/mail-credentials.mjs';
import {mailConnectionErrors,mailConnectionDiagnostic} from './mail-connection-error.mjs';
const labels=DESKTOP_PROVIDER_LABELS;
const errors={mail_input_invalid:'아이디와 비밀번호를 확인해 주세요.',mail_model_missing:'정리할 모델을 먼저 선택해 주세요.',mail_model_changed:'선택한 모델의 연결을 확인해 주세요.',mail_check_wait:'다음 확인 시간이 되면 새 메일을 가져와요.',mail_busy:'진행 중인 작업이 끝난 뒤 다시 눌러 주세요.',mail_not_connected:'메일 계정을 먼저 연결해 주세요.',mail_source_changed:'보관한 원문이 바뀌었어요. 원문을 확인해 주세요.',mail_summary_failed:'메일을 정리하는 중 모델 응답을 받지 못했어요. 다시 시도해 주세요.',mail_storage_failed:'정리한 내용을 저장하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.',mail_file_conflict:'정리한 메일 파일이 바뀌어 저장하지 않았어요. 다시 정리해 주세요.',mail_size_limit:'메일이 너무 커요. 11 MB까지 처리할 수 있어요.',mail_missing:'메일을 찾을 수 없어요. 목록을 새로고침해 주세요.'};
Object.assign(errors,{mail_gmail_app_password_required:'Google이 앱 비밀번호를 요구했어요. 계정 비밀번호 대신 앱 비밀번호를 입력해 주세요.',mail_gmail_web_login_required:'Google에서 웹 로그인을 확인해야 해요. Gmail에 로그인한 뒤 다시 연결해 주세요.',mail_gmail_pop_disabled:'Google이 POP 사용이 꺼져 있다고 응답했어요. Gmail의 POP 설정을 확인해 주세요.',mail_gmail_credentials_invalid:'Google이 주소 또는 앱 비밀번호를 거절했어요. 앱 비밀번호를 발급한 계정과 Gmail 주소가 같은지 확인해 주세요.'});
const modelKey=value=>value?`${value.provider}:${value.model}`:'';
Object.assign(errors,{mail_storage_permission:'로그인은 확인했지만 개인 메일 폴더 권한을 설정하지 못했어요. PC 보안 정책이나 저장 위치 권한을 확인해 주세요.'});
errors.mail_gmail_app_password_format='Google에서 생성한 16자리 앱 비밀번호를 입력해 주세요. 일반 계정 비밀번호로는 연결할 수 없어요.';
const pickerError=message=>notifyWorkspaceToast(message,{error:true});
const sectionTitle=(icon,text)=><span className="nubi-mail-section-title"><span className="nubi-mail-section-icon" aria-hidden="true"><Icon name={icon} size={18}/></span><strong>{text}</strong></span>;
function MailStorage({api,status}){
  const paths=[{kind:'raw',label:'메일과 첨부 원본',path:status?.rawRoot},{kind:'wiki',label:'정리한 위키',path:status?.wikiRoot}];
  return <details className="nubi-mail-storage">
    <summary><span className="nubi-mail-field-title"><FolderMark size={16}/>저장 위치</span><Icon name="chevronDown" size={16}/></summary>
    <dl aria-label="메일 저장 경로">{paths.map(item=><div className="nubi-mail-storage-row" key={item.kind}>
      <dt>{item.label}</dt><dd><code>{item.path||(status?'경로를 확인하지 못했어요.':'불러오는 중…')}</code>
        <CopyButton label={`${item.label} 경로 복사`} resetKey={item.path} disabled={!item.path} onCopy={()=>api('copyMailStoragePath',{kind:item.kind})}/>
      </dd>
    </div>)}</dl>
  </details>;
}
export function MailLibrary({api,openWebPage,provider,onProviderLogin,onProviderAction,providerBusy=false}){
  const [status,setStatus]=useState(null),[user,setUser]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[chosen,setChosen]=useState('');
  const [modelOpen,setModelOpen]=useState(false),[connectionError,setConnectionError]=useState(null),[passwordRevision,setPasswordRevision]=useState(0);
  const [formStage,setFormStage]=useState(0),[settingsRevealed,setSettingsRevealed]=useState(false);
  const passwordInput=useRef(null);
  const modelSummary=useRef(null);
  const alive=useRef(true),pending=useRef(null),lock=useRef(false),cancelledConnect=useRef(false);
  useEffect(()=>{
    alive.current=true;let reading=false;
    const refresh=async()=>{if(reading)return;reading=true;try{const value=await api('mail',{action:'status'});if(alive.current){setStatus(value);setChosen(current=>current||modelKey(value.destination||value.activeModel));}}catch{if(alive.current)notifyWorkspaceToast('메일 설정을 읽지 못했어요. 다시 열어 주세요.',{error:true});}finally{reading=false;}};
    void refresh();const timer=setInterval(refresh,3000);
    return()=>{alive.current=false;clearInterval(timer);if(pending.current)void api('mail',{action:'cancelConnect',requestId:pending.current}).catch(()=>{});};
  },[api]);
  const models=(status?.catalogs||[]).flatMap(catalog=>catalog.models.map(item=>({provider:catalog.provider,model:item.id,displayName:item.label||item.id,label:`${labels[catalog.provider]||catalog.provider} / ${item.label||item.id}`})));
  const destination=models.find(item=>modelKey(item)===chosen),autoWiki=status?.autoWiki===true;
  const selectedServer='company',gmailTest=false;
  const connectionBusy=busy||status?.connecting===true;
  const userReady=!!user.trim()&&user.length<=320&&!/[\r\n\0]/.test(user)&&(!gmailTest||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.trim()));
  let passwordReady=false;
  try{passwordReady=!!password&&password.length<=2048&&(gmailTest||!/[\r\n\0]/.test(password))&&!!mailPassword(selectedServer,password);}catch{}
  useEffect(()=>{if(userReady)setFormStage(stage=>Math.max(stage,passwordReady?2:1));},[selectedServer,userReady,passwordReady]);
  useEffect(()=>{if(status?.connected)setSettingsRevealed(true);},[status?.connected]);
  const showSettings=settingsRevealed||status?.connected||!!status?.destination||status?.counts?.received>0;
  async function act(operation){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const value=await operation();if(alive.current){setStatus(value);setConnectionError(null);}return value;}
    catch(error){if(alive.current&&!(error.message==='mail_cancelled'&&cancelledConnect.current)){if(Object.hasOwn(mailConnectionErrors,error.message))setConnectionError(error.message);else notifyWorkspaceToast(errors[error.message]||('메일 설정을 완료하지 못했어요.'+(/^mail_[a-z_]+$/.test(error.message)?` (${error.message})`:'')),{error:true});}}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function connect(event){
    event.preventDefault();if(connectionBusy||!userReady||!passwordReady)return;setConnectionError(null);cancelledConnect.current=false;await act(async()=>{const normalizedPassword=mailPassword(selectedServer,password),requestId=crypto.randomUUID();pending.current=requestId;
      try{const value=await api('mail',{action:'connect',requestId,user,password:normalizedPassword,serverProfile:selectedServer,destination:destination?{provider:destination.provider,model:destination.model}:null});if(alive.current){setPassword('');if(value?.connected)notifyWorkspaceToast(gmailTest?'Gmail을 연결했어요.':'메일을 연결했어요.',{success:true});}return value;}finally{pending.current=null;if(alive.current){setPassword('');setPasswordRevision(value=>value+1);}}});
  }
  async function cancelConnection(){
    cancelledConnect.current=true;
    try{const value=await api('mail',{action:'disconnect'});if(alive.current){setStatus(value);setPassword('');}}
    catch{if(alive.current)notifyWorkspaceToast('연결 취소를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.',{error:true});}
  }
  async function selectModel(name,selectedProvider){
    const item=models.find(item=>item.provider===selectedProvider&&item.model===name);if(!item)return false;
    const value=await act(()=>api('mail',{action:'setModel',destination:{provider:item.provider,model:item.model}}));
    if(value&&alive.current){setChosen(modelKey(item));setModelOpen(false);requestAnimationFrame(()=>modelSummary.current?.focus({preventScroll:true}));}return !!value;
  }
  async function providerAction(action,input={}){
    if(!onProviderAction)return false;
    const result=await onProviderAction(action,input);
    if(result===false)return false;
    const value=await api('mail',{action:'status'});if(alive.current)setStatus(value);return true;
  }
  const modelData={activeProvider:provider?.provider||'aipro',settings:{modelId:''},catalog:{models:[]},
    catalogs:Object.fromEntries((status?.catalogs||[]).map(catalog=>[catalog.provider,{models:catalog.models.map(item=>({...item,name:item.id,displayName:item.label||item.id}))}])),
    selectedModels:status?.destination?{[status.destination.provider]:status.destination.model}:{},
    connections:Object.fromEntries((provider?.providers||[]).map(item=>[item.id,{present:item.connected}])),
    pending:provider?.pending?{provider:provider.pending,phase:provider.pendingPhase||'waiting'}:null,
    report:{provider:provider?.provider,error:provider?.loginError}};
  const activity=status?.connecting?'메일 서버 연결 확인 중':status?.readingAttachments?'첨부 읽는 중':status?.summarizing?'메일 정리 중':status?.checking?'새 메일 확인 중':null;
  const selectedModel=status?.destination||destination;
  const selectedCatalogModel=models.find(item=>modelKey(item)===modelKey(selectedModel));
  const selectedConnected=selectedModel&&provider?.providers?.some(item=>item.id===selectedModel.provider&&item.connected);
  const modelSummaryLabel=selectedModel?selectedCatalogModel?.displayName||selectedModel.model:'모델 선택';
  const connectionCode=connectionBusy?null:connectionError||status?.error;
  const failure=Object.hasOwn(mailConnectionErrors,connectionCode)?mailConnectionErrors[connectionCode]:null;
  return <div className="nubi-mail-library nubi-mail-settings">
    <section className="nubi-mail-section" aria-label="메일 계정 설정">
      {status?.connected&&<header className="nubi-mail-section-heading">{sectionTitle('mail',status.serverProfile==='gmail_test'?'Gmail 연결됨':'회사 메일 연결됨')}<ActionButton action="logout" iconOnly label="메일 로그아웃" title="메일 로그아웃" disabled={busy} onClick={()=>act(()=>api('mail',{action:'disconnect'}))}/></header>}
      {!status?.connected?<form className="nubi-mail-form" aria-label="메일 계정" noValidate onSubmit={connect}>
        <div className="nubi-mail-account-fields">

          <label htmlFor="nubi-mail-user"><span className="nubi-mail-field-title"><PersonMark size={16}/>{gmailTest?'Gmail 주소':'아이디'}</span><CxInput id="nubi-mail-user" type={gmailTest?'email':'text'} value={user} onChange={event=>setUser(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&!passwordReady){event.preventDefault();if(userReady)passwordInput.current?.focus();}}} autoFocus autoComplete="off" required maxLength={320} disabled={connectionBusy}/></label>
          {formStage>=1&&<label htmlFor="nubi-mail-password"><span id="nubi-mail-password-title" className="nubi-mail-field-title"><Icon name="logIn" size={16}/>{gmailTest?'앱 비밀번호':'비밀번호'}</span><CxInput key={passwordRevision} ref={passwordInput} id="nubi-mail-password" type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="off" required maxLength={2048} disabled={connectionBusy} aria-labelledby="nubi-mail-password-title" aria-describedby={gmailTest?'nubi-mail-password-help':undefined}/>{gmailTest&&<small id="nubi-mail-password-help" className="nubi-muted">Google에서 생성한 16자리 코드</small>}</label>}
        </div>
        <details className="nubi-mail-help nubi-mail-server-info"><summary>연결 정보</summary><p><code>pop3.samsung.net:995</code> / SSL/TLS</p></details>
        {(formStage>=2||status?.connecting)&&<div className="nubi-mail-connect-actions"><CxButton type="submit" variant="primary" className="nubi-mail-connect" disabled={connectionBusy||!status||!userReady||!passwordReady}>{status?.connecting?<span className="status-spinner" aria-hidden="true"/>:<Icon name="logIn" size={16}/>}<span>{status?.connecting||pending.current?'메일 연결 중…':'메일 연결'}</span></CxButton>
          {status?.connecting&&<ActionButton action="cancel" label="연결 취소" onClick={cancelConnection}/>}
        </div>}
        {formStage>=1&&gmailTest&&openWebPage&&<details className="nubi-mail-help"><summary>앱 비밀번호 발급 방법</summary><p className="nubi-muted">Google 계정에서 앱 비밀번호를 발급한 뒤 위에 입력해 주세요. 일반 계정 비밀번호로는 연결할 수 없어요.</p><CxButton type="button" className="nubi-text-button" disabled={busy} onClick={()=>act(async()=>{await openWebPage('https://myaccount.google.com/apppasswords');return api('mail',{action:'status'});})}><BrowserMark size={16}/>Google 앱 비밀번호 열기</CxButton></details>}
      </form>:null}
      {failure&&<details className="nubi-mail-connection-error" key={connectionCode}>
        <summary><Icon name="alertCircle" size={16}/><strong role="status" title={failure.title}>{failure.title}</strong><Icon name="chevronDown" size={16}/></summary>
        <p>{failure.detail}</p><div className="nubi-mail-error-code"><code>{connectionCode}</code><CopyButton label="연결 오류 복사" text={mailConnectionDiagnostic(connectionCode)}/></div>
      </details>}
    </section>
    {showSettings&&<><section className="nubi-mail-section nubi-mail-organize" aria-label="자동 정리 설정"><div className="nubi-mail-switch-row"><div>{sectionTitle('sliders','자동 정리')}<small>끄면 새 수집과 정리를 멈춰요.</small></div>
      <button type="button" role="switch" aria-label="메일 자동 정리" aria-checked={autoWiki} className="nubi-ios-switch" disabled={connectionBusy||!status} onClick={()=>act(()=>api('mail',{action:'setAutoWiki',enabled:!autoWiki,destination:destination?{provider:destination.provider,model:destination.model}:null}))}><span aria-hidden="true"/></button>
    </div><details className="nubi-mail-help"><summary>수집 범위</summary><p>다시 켜면 서버에 남은 미수신 메일과 첨부를 가져와요. 기존 자료는 보존해요.</p></details></section>
    {status&&<details className="nubi-mail-model-disclosure" open={modelOpen} onToggle={event=>setModelOpen(event.currentTarget.open)}>
      <summary ref={modelSummary} aria-label={`정리할 모델: ${selectedModel?`${labels[selectedModel.provider]} ${modelSummaryLabel}${selectedConnected?'':' 연결 필요'}`:modelSummaryLabel}`}>
        <span className="nubi-mail-model-value">{selectedModel?<ProviderIcon provider={selectedModel.provider}/>:<Icon name="list" size={16}/>}<span>{modelSummaryLabel}</span>{selectedModel&&!selectedConnected&&<small>연결 필요</small>}</span><Icon name="chevronDown" size={16}/>
      </summary>
      <ModelSelection embedded autoRefresh={false} title={<span className="visually-hidden">정리할 모델</span>} data={modelData} initialProvider={status.destination?.provider||provider?.provider||'aipro'} showProviderNames providerLabels={labels} disabled={busy||providerBusy} loading={providerBusy} onProviderSelect={()=>Promise.resolve(true)} onSelect={selectModel} onRefresh={options=>providerAction('refresh',{provider:options?.provider})} onLogin={onProviderLogin} onLogout={selected=>providerAction('disconnect',{provider:selected})} onCancelLogin={()=>providerAction('cancel')} onError={pickerError}/>
    </details>}
    {activity&&<p className="nubi-mail-activity" role="status"><span className="status-spinner" aria-hidden="true"/>{activity}</p>}
    {status?.connected&&autoWiki&&status.watchPaused&&<CxButton disabled={busy||status.checking} onClick={()=>act(()=>api('mail',{action:'resumeWatch'}))}><Icon name="refresh" size={16}/>수집 재개</CxButton>}
    {(status?.counts.attachmentAttention>0||status?.counts.attention>0)&&<CxButton disabled={busy||!autoWiki||status.readingAttachments||status.summarizing} onClick={()=>act(()=>api('mail',{action:'retry'}))}><Icon name="refresh" size={16}/>읽기와 정리 다시 시도</CxButton>}
    <MailStorage api={api} status={status}/></>}
  </div>;
}
