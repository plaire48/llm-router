import React,{useState} from 'react';
import {DetailPanel,CxButton,Icon} from '@e2e/cx-design-system';
import {ProviderIcon} from '../../../extensions/aipro-chat/src/ChatControls.jsx';

const errors={claude_models_unavailable:'Claude 모델 목록을 받지 못했어요. 다시 연결해 주세요.',claude_cli_missing:'Claude Code를 먼저 설치해 주세요.',claude_cli_update:'Claude Code를 최신 버전으로 업데이트해 주세요.',claude_login_required:'Claude Code에서 한 번 로그인해 주세요.',claude_cli_timeout:'Claude Code 응답이 늦어요. 다시 확인해 주세요.'};
export function ClaudeConnection({api,onConnected,onClose,openWebPage,initialIssue=null}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[issue,setIssue]=useState(initialIssue);
  const missing=issue==='claude_cli_missing',update=issue==='claude_cli_update';
  async function connect(){setBusy(true);setError('');try{await api('provider',{action:'login',input:{provider:'claude'}});await onConnected();}catch(cause){if(['claude_cli_missing','claude_cli_update','claude_login_required'].includes(cause.message))setIssue(cause.message);setError(errors[cause.message]||'Claude Code 연결을 확인하지 못했어요.');}finally{setBusy(false);}}
  return <DetailPanel className="deck-dialog nubi-panel claude-connection" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon" data-provider="claude"><ProviderIcon provider="claude"/></span>Claude Code 연결</span>} variant="modal" hideHelp onClose={onClose} footer={<CxButton variant="primary" busy={busy} disabled={busy} onClick={connect}><Icon name="logIn" size={16}/>{missing||update?'연결 확인':'로그인'}</CxButton>}>
    <p><strong>{missing?'Claude Code 설치가 필요합니다.':update?'Claude Code 업데이트가 필요합니다.':'Claude 계정으로 연결해 주세요.'}</strong></p>
    <ol className="claude-setup-steps">
      <li hidden={!missing&&!update}><div className="claude-setup-heading"><strong><Icon name="download" size={18}/>{update?'업데이트':'설치'}</strong>{openWebPage&&<CxButton disabled={busy} onClick={async()=>{try{await openWebPage('https://code.claude.com/docs/en/setup');}catch{setError('설치 안내를 열지 못했어요. 다시 시도해 주세요.');}}}><Icon name="linkExternal" size={16}/>공식 설치 안내</CxButton>}</div><p className="usage-caption">{update?'최신 버전으로 업데이트한 뒤 다시 연결해 주세요.':'Claude Code CLI는 누비에 포함되어 있지 않습니다.'}</p></li>
    </ol>
    <p className="usage-caption">{missing?'설치 후 연결 확인을 눌러 주세요.':update?'업데이트 후 연결 확인을 눌러 주세요.':'누비 안에서 로그인 페이지가 열립니다.'}</p>
    {error&&<p className="claude-connection-error" role="alert">{error}</p>}
  </DetailPanel>;
}
export function ClaudeAccountUsage({data,now=Date.now()}) {
  const connected=data.connections?.claude?.present,quota=data.claudeAccountUsage;
  return <section className="usage-account claude-account" aria-label="Claude 잔여 한도">
    <div className="usage-row"><h3><ProviderIcon provider="claude"/>Claude 잔여 한도</h3></div>
    {!connected?<p className="usage-caption">Claude Code 연결 후 확인할 수 있습니다.</p>:!quota?.windows?.length?<p className="usage-caption">아직 한도 정보가 없습니다. Claude 응답 후 갱신됩니다.</p>:quota.windows.map(item=>{
      const expired=item.resetsAt&&item.resetsAt<=now,stale=now-item.fetchedAt>300000,remaining=expired||stale?null:item.remaining;
      return <div className="usage-window" key={item.id}><div className="usage-row"><span>{item.label}</span><strong>{remaining==null?expired||stale?'갱신 필요':'미제공':`${remaining.toLocaleString('ko-KR',{maximumFractionDigits:1})}% 남음`}</strong></div>
        {remaining!=null&&<div className="context-bar" role="meter" aria-label={`Claude ${item.label} 잔여 한도`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}><span style={{width:`${remaining}%`}}/></div>}
        {item.resetsAt&&<span className="usage-caption usage-metadata">{new Date(item.resetsAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 초기화</span>}
      </div>;
    })}
    {connected&&quota?.windows?.length>0&&<p className="usage-caption">Claude 응답 기준 {new Date(quota.fetchedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</p>}
  </section>;
}
