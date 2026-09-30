import React from 'react';
import {ActionButton, CxButton, CxNotice, CxTextarea, Icon} from '@e2e/cx-design-system';
import {WelcomeMark, AgentIntro} from './Welcome.jsx';

// Presentational surfaces shared by the browser extension and Office WebView2.
// Authentication, storage and tool execution are supplied by each host.
export function NubiHeaderActions({history, expand, usage, settings}) {
  return <>
    <ActionButton action="history" label="대화 이력" title="대화 이력과 새 대화" aria-haspopup="dialog" {...history}/>
    {expand && <ActionButton action="openExternal" label="전체 화면으로 열기" {...expand}/>}
    <CxButton className="composer-icon" aria-label="사용량" title="토큰 사용량과 계정 한도" aria-haspopup="dialog" {...usage}><Icon name="chartColumn" size={20}/></CxButton>
    <CxButton className="composer-icon" data-action="settings" aria-label="설정" title="설정" aria-haspopup="dialog" {...settings}><Icon name="sliders" size={20}/></CxButton>
  </>;
}

export function NubiLogin({mood, intro, error, pending, onLogin, onCancel, children}) {
  return <section className="aipro-login"><div className="aipro-login-card">
    <WelcomeMark mood={mood}/><AgentIntro {...intro}/>
    {error && <CxNotice tone="danger">{error}</CxNotice>}
    <div className="provider-options">
      {['aipro','chatgpt','fabrix'].map(provider=><CxButton key={provider} data-provider={provider} className="provider-button" variant={provider==='aipro' ? 'primary' : 'secondary'} disabled={!!pending && (provider==='fabrix' || pending.provider!==provider)} busy={pending?.provider===provider} onClick={()=>onLogin(provider)}><span className="provider-label"><img className="provider-logo" src={`./icons/${{aipro:'aipro',chatgpt:'openai',fabrix:'fabrix'}[provider]}.svg`} alt="" width="24" height="24"/><span>{pending?.provider===provider ? pending.phase==='exchanging' ? '인증 확인 중' : '로그인 대기 중' : {aipro:'AI Pro',chatgpt:'ChatGPT',fabrix:'FabriX'}[provider]}</span></span></CxButton>)}
      {pending && <ActionButton action="cancel" label="로그인 취소" onClick={onCancel}/>}
    </div>
    {children}
  </div></section>;
}

export function NubiComposerInput({inputRef,id='message-input',label='메시지',...props}) {
  return <><label className="visually-hidden" htmlFor={id}>{label}</label><CxTextarea ref={inputRef} id={id} className="aipro-message-input" rows={2} maxLength={16000} placeholder="메시지 입력" title={'Enter 전송\nShift + Enter 줄바꿈'} {...props}/></>;
}

export function NubiComposerBar({leading,tools}) {
  return <div className="composer-bottom"><div className="composer-leading">{leading}</div><div className="composer-tools">{tools}</div></div>;
}
