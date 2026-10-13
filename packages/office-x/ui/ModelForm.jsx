import React,{useEffect,useId,useRef,useState} from 'react';
import {CxButton,CxInput,CxNotice,DetailPanel,ActionButton,Icon,SearchInput} from '@e2e/cx-design-system';
import {ProviderIcon} from '../vendor/nubi/extensions/aipro-chat/src/ChatControls.jsx';
import {ERROR_TEXT} from '../vendor/nubi/extensions/aipro-chat/core.js';
import './model-form.css';

// Use the Workspace question-form tokens and deferred single-choice pattern.
// Browsing a provider or model never changes the active conversation model.
export function ModelForm({data,providerLabels,disabled,loading,onSelect,onRefresh,onLogin,onLogout,onCancelLogin,onClose}) {
 const [provider,setProvider]=useState(data.activeProvider),[choice,setChoice]=useState(''),[query,setQuery]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const id=useId(),rows=useRef(null),request=useRef(false),refresh=useRef(onRefresh),refreshed=useRef(null);refresh.current=onRefresh;
 const connection=data.connections?.[provider]||{},connected=connection.present&&!connection.expired&&!connection.rejected;
 const current=provider===data.activeProvider,pending=data.pending?.provider===provider;
 const catalog=data.catalogs?.[provider]||(current?data.catalog:null),models=catalog?.models||[];
 const selected=choice||data.selectedModels?.[provider]||(current?data.settings.modelId:'');
 const valid=connected&&models.some(model=>model.name===selected),blocked=saving||disabled||!!data.pending;
 const visible=models.filter(model=>`${model.displayName} ${model.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 useEffect(()=>{if(provider!=='aipro'||!connected||blocked)return;const key=`${provider}:${connection.receivedAt}`;if(refreshed.current===key)return;refreshed.current=key;Promise.resolve(refresh.current?.({provider,silent:true})).catch(()=>{});},[provider,connected,connection.receivedAt,blocked]);
 async function perform(work){if(request.current)return;request.current=true;setSaving(true);setError('');try{return await work();}catch(cause){setError(ERROR_TEXT[cause?.message]||'변경하지 못했습니다. 연결을 확인하고 다시 시도해주세요.');return false;}finally{request.current=false;setSaving(false);}}
 function browse(next){if(blocked)return;setProvider(next);setChoice('');setQuery('');setError('');}
 function keyboard(event){if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;const group=event.currentTarget,buttons=[...group.querySelectorAll('[role="radio"]:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(index<0||!buttons.length)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+buttons.length)%buttons.length;buttons[next].focus();buttons[next].click();}
 const problem=error||(!pending&&data.report?.provider===provider&&data.report.error!=='login_closed'?ERROR_TEXT[data.report.error]:'')||catalog?.errorMessage;
 const footer=<><CxButton disabled={saving} onClick={onClose}>취소</CxButton><CxButton variant="primary" busy={saving} disabled={blocked||!valid} onClick={()=>perform(async()=>{if(await onSelect(selected,provider))onClose();else setError('모델을 적용하지 못했습니다. 다시 시도해주세요.');})}>적용</CxButton></>;
 return <DetailPanel title="모델 선택" className="deck-dialog nubi-decision-dialog nubi-model-form" variant="modal" hideHelp busy={saving} initialFocus='[role="radio"][aria-checked="true"]' onClose={onClose} footer={footer}>
  <div className="nubi-question-form model-form-fields">
   {problem&&<CxNotice tone="danger">{problem}</CxNotice>}
   <fieldset className="model-form-field"><legend>계정</legend><div className="model-form-providers" role="radiogroup" aria-label="모델 제공자" onKeyDown={keyboard}>
    {Object.entries(providerLabels).map(([key,label])=><CxButton key={key} className="model-form-provider" role="radio" aria-label={label} aria-checked={provider===key} tabIndex={provider===key?0:-1} disabled={blocked} onClick={()=>browse(key)}><ProviderIcon provider={key}/><strong>{label}</strong><Icon name={provider===key?'check':'chevronRight'} size={16}/></CxButton>)}
   </div></fieldset>
   <fieldset className="model-form-field"><legend>모델</legend>
    {pending?<div className="model-form-status" role="status"><span className="status-spinner" aria-hidden="true"/>{data.pending.phase==='exchanging'?'인증 확인 중':'로그인 대기 중'}<CxButton onClick={()=>Promise.resolve(onCancelLogin()).catch(()=>{})}>로그인 취소</CxButton></div>:!connected?<div className="model-form-status"><span>{connection.expired||connection.rejected?'다시 연결해주세요.':`${providerLabels[provider]} 계정을 연결하세요.`}</span><ActionButton action="login" label="연결" disabled={blocked} onClick={()=>perform(()=>onLogin(provider))}/></div>:<>
     <SearchInput><CxInput id={`${id}-search`} aria-label="모델 검색" placeholder="모델 검색" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();rows.current?.querySelector('[role="radio"]')?.focus();}}}/></SearchInput>
     <div className="question-card question-card--compact model-form-models"><div className="question-options" role="radiogroup" aria-label="사용 가능한 모델" ref={rows} onKeyDown={keyboard}>
      {visible.map((model,index)=><CxButton key={model.name} className="question-option model-form-option" role="radio" aria-label={model.displayName} aria-checked={model.name===selected} tabIndex={model.name===selected||(!visible.some(m=>m.name===selected)&&index===0)?0:-1} disabled={blocked} title={model.name} onClick={()=>setChoice(model.name)}><span className="question-option-index" aria-hidden="true">{model.name===selected?<Icon name="check" size={14}/>:index+1}</span><span className="question-option-copy"><strong>{model.displayName}</strong>{model.contextLength>0&&<span>문맥 {Math.round(model.contextLength/1024).toLocaleString()}K</span>}</span></CxButton>)}
     </div>{!visible.length&&<p className="model-form-empty" role="status">{loading?'모델 불러오는 중':query.trim()?'검색 결과가 없습니다.':'목록을 다시 불러오세요.'}</p>}</div>
     <div className="model-form-account-actions"><ActionButton action="refresh" iconOnly={false} label="새로고침" aria-label="모델 목록 새로고침" busy={loading} disabled={blocked||loading} onClick={()=>perform(()=>onRefresh({provider}))}/>{provider==='fabrix'&&<ActionButton action="edit" iconOnly={false} label="연결 편집" disabled={blocked} onClick={()=>perform(()=>onLogin(provider))}/>}<ActionButton action="logout" iconOnly={false} label={provider==='claude'?'연결 해제':'로그아웃'} disabled={blocked} onClick={()=>perform(()=>onLogout(provider))}/></div>
    </>}
   </fieldset>
  </div>
 </DetailPanel>;
}
