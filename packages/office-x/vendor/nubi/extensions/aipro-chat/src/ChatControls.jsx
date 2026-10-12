import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {CxButton, CxInput, CxNotice, DetailPanel, SearchInput, ActionButton, Icon} from '@e2e/cx-design-system';
import {AgentTabs} from './AgentTabs.jsx';
import {ERROR_TEXT, PROVIDER_LABELS} from '../core.js';
import {compactTokens, contextPercent, contextUsage, formatTokens} from '../usage.js';

const providerIcons = {aipro: 'aipro.svg', chatgpt: 'openai.svg', fabrix: 'fabrix.svg', claude: 'claude.svg'};
export function ProviderIcon({provider}) {
  if (provider === 'aipro-cli' || provider === 'compatible') return <Icon name="code" size={20} className="connection-logo"/>;
  return <img className="connection-logo" src={`./icons/${providerIcons[provider] || providerIcons.aipro}`} alt="" width="20" height="20"/>;
}
export function ModelPicker({data, loading, disabled, open, onOpen, onRefresh, showProviderName = false, iconOnly = false, providerLabels = PROVIDER_LABELS, renderModelLabel}) {
  const models = data.catalog?.models || [], selected = models.find(model => model.name === data.settings.modelId);
  const empty = data.catalog?.models?.length === 0 && !data.catalog.error;
  const unnamed = empty && data.catalog?.diagnostics?.summary?.received > 0;
  const modelLabel=empty ? unnamed ? '목록 확인 필요' : '모델 없음' : selected?.displayName || (data.activeProvider === 'fabrix' ? '모델 선택' : data.settings.modelId);
  return <div className="model-picker" data-icon-only={iconOnly||undefined}>
    <CxButton className="model-trigger" data-provider={data.activeProvider} data-icon-only={iconOnly||undefined} aria-label={iconOnly?`${providerLabels[data.activeProvider]} ${modelLabel||''} 모델 변경`:'모델 변경'} aria-haspopup="dialog" aria-expanded={open} title={`${providerLabels[data.activeProvider]}\n${modelLabel||'모델 선택'}\n모델 변경`} disabled={disabled} onClick={onOpen}>
      <ProviderIcon provider={data.activeProvider}/>{!iconOnly&&<><span className="model-trigger-label">{showProviderName && <strong>{providerLabels[data.activeProvider]}</strong>}{renderModelLabel ? renderModelLabel(modelLabel) : <span>{modelLabel}</span>}</span><Icon name="chevronDown" size={16}/></>}
    </CxButton>
    {loading ? <span className="status-spinner" role="status" aria-label="모델 불러오는 중"/> : (data.catalog?.error || empty) && <ActionButton action="refresh" label="모델 목록 다시 불러오기" onClick={onRefresh}/>}
  </div>;
}

export function ModelSelection({title='모델 선택', data, initialProvider, loading, disabled, onProviderSelect, onSelect, onRefresh, onLogin, onLogout, onCancelLogin, onClose, showProviderNames = false, providerLabels = PROVIDER_LABELS, embedded = false, autoRefresh = true, selectWhileLoading = false, onError, showActionLabels = false}) {
  const [provider, setProvider] = useState(initialProvider || data.activeProvider);
  const [query, setQuery] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const rows = useRef(null), providerTabs = useRef(null), restoreTabFocus = useRef(false);
  const connection = data.connections?.[provider] || {present: false};
  const connected = connection.present && !connection.expired && !connection.rejected;
  const current = provider === data.activeProvider, pending = data.pending?.provider === provider;
  const catalog = data.catalogs?.[provider] || (current ? data.catalog : null), models = catalog?.models || [];
  const selectedModel = data.selectedModels?.[provider] ?? data.settings.modelId;
  const searchable = models.length > 0;
  const visible = models.filter(model => !searchable || `${model.displayName} ${model.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const blocked = saving || disabled || !!data.pending;
  const refreshCallback = useRef(onRefresh), refreshedConnection = useRef(null);
  const refreshFocus = useRef(null), wasLoading = useRef(loading);
  refreshCallback.current = onRefresh;
  function refreshModels(options) {
    refreshFocus.current = document.activeElement;
    return refreshCallback.current({...options,provider});
  }
  useLayoutEffect(() => {
    const settled = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (!settled) return;
    const previous = refreshFocus.current;
    refreshFocus.current = null;
    // Disabled controls can lose focus while the catalog is loading. Restore
    // it only if the user has not moved to another control in the meantime.
    if (blocked || document.activeElement !== document.body) return;
    const panel = rows.current?.closest('[role="dialog"]');
    const fallback = panel?.querySelector('#model-search') || rows.current?.querySelector('.model-option[aria-pressed="true"]') || rows.current?.querySelector('.model-option');
    const target = previous?.isConnected && !previous.disabled && previous !== document.body ? previous : fallback;
    target?.focus({preventScroll: true});
  }, [loading, blocked]);
  useEffect(() => {
    if (!autoRefresh || provider !== 'aipro' || !current || !connected) {refreshedConnection.current = null; return;}
    const key = `${provider}:${connection.receivedAt}`;
    if (disabled || pending || refreshedConnection.current === key) return;
    refreshedConnection.current = key;
    // A populated cache can still be incomplete. Refresh once each time the
    // AI Pro picker is opened or its connection changes, without a toast.
    Promise.resolve(refreshModels({silent: true})).catch(() => {});
  }, [provider, current, connected, connection.receivedAt, disabled, pending, autoRefresh]);
  useLayoutEffect(() => {
    // Switching briefly disables native buttons. Restore keyboard focus only
    // after React commits the enabled tab, rather than racing an animation frame.
    if (!blocked && restoreTabFocus.current) {
      restoreTabFocus.current = false;
      providerTabs.current?.querySelector('[aria-selected="true"]')?.focus({preventScroll: true});
    }
  }, [provider, blocked]);
  async function changeProvider(next) {
    if (blocked) return false;
    restoreTabFocus.current = providerTabs.current?.contains(document.activeElement);
    setSaving(true); setError('');
    try {
      const status = data.connections?.[next];
      if (status?.present && !status.expired && !status.rejected) await onProviderSelect(next);
      setProvider(next); setQuery('');
      return true;
    } catch (cause) {setError(ERROR_TEXT[cause.message] || ERROR_TEXT.storage_failed); return false;}
    finally {setSaving(false);}
  }
  async function select(name) {
    setSaving(true); setError('');
    try {if (await onSelect(name,provider)) {if(!embedded)onClose?.();} else setError('모델을 변경하지 못했습니다. 다시 선택하세요.');}
    finally {setSaving(false);}
  }
  async function connect() {
    setSaving(true); setError('');
    try {await onLogin(provider);}
    catch (cause) {setError(ERROR_TEXT[cause.message] || ERROR_TEXT.storage_failed);}
    finally {setSaving(false);}
  }
  async function disconnect() {
    setSaving(true); setError('');
    try {await onLogout(provider);}
    catch (cause) {setError(ERROR_TEXT[cause.message] || ERROR_TEXT.storage_failed);}
    finally {setSaving(false);}
  }
  const problem = error || (pending || !connected ? data.report.provider === provider && data.report.error !== 'login_closed' && ERROR_TEXT[data.report.error] : current ? catalog?.errorMessage || ERROR_TEXT[catalog?.error] : '');
  useEffect(()=>{if(problem&&onError)onError(problem);},[problem,onError]);
  const accountActions=(connected || connection.present) && <div className="provider-account-actions" role="group" aria-label="모델 연결 관리">
        {connected && (current || data.catalogs) && <ActionButton action="refresh" iconOnly={!showActionLabels} label={showActionLabels?'새로고침':'모델 목록 새로고침'} aria-label="모델 목록 새로고침" busy={loading} disabled={blocked || loading} onClick={() => refreshModels()}/>}
        {connected && provider === 'fabrix' && <ActionButton action="edit" iconOnly={!showActionLabels} label={showActionLabels?'연결 편집':'FabriX 연결 편집'} aria-label="FabriX 연결 편집" disabled={blocked} onClick={connect}/>}
        {connection.present && <ActionButton action="logout" iconOnly={!showActionLabels} label={showActionLabels?(provider==='claude'?'연결 해제':'로그아웃'):`${providerLabels[provider]} ${provider==='claude'?'연결 해제':'로그아웃'}`} aria-label={`${providerLabels[provider]} ${provider==='claude'?'연결 해제':'로그아웃'}`} disabled={blocked} onClick={disconnect}/>}
    </div>;
  const content=<>
    <div className="provider-toolbar">
    <AgentTabs provider containerRef={providerTabs} items={Object.entries(providerLabels).map(([key, label]) => ({key, label: <span className={`provider-tab-icon${showProviderNames ? ' with-name' : ''}`} title={label}><ProviderIcon provider={key}/><span className={showProviderNames ? 'provider-tab-name' : 'visually-hidden'}>{label}</span></span>}))} active={provider} onChange={changeProvider} label="모델 제공자" idPrefix="provider-tab" panelId="provider-model-panel" disabled={blocked}/>
    </div>
    <div key={provider} className="provider-model-panel" role="tabpanel" id="provider-model-panel" aria-labelledby={`provider-tab-${provider}`}>
      {problem && !onError && <CxNotice tone="danger">{problem}</CxNotice>}
      {pending ? <div className="provider-connect-state" role="status"><span className="status-spinner" aria-hidden="true"/><span>{data.pending.phase === 'exchanging' ? '인증 확인 중' : '로그인 대기 중'}</span><ActionButton action="cancel" label="로그인 취소" onClick={onCancelLogin}/></div> : !connected ? <div className="provider-connect-state">{(connection.expired || connection.rejected) && <p>다시 연결해 주세요.</p>}<ActionButton action="login" className="provider-connect-button" data-provider={provider} label="연결" title={`${providerLabels[provider]} 연결`} disabled={blocked} onClick={connect}/></div> : <>
        {searchable && <div className="model-search-row"><SearchInput><CxInput id="model-search" aria-label="모델 검색" placeholder="모델 검색" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => {if (e.key === 'ArrowDown') {e.preventDefault(); rows.current?.querySelector('button:not(:disabled)')?.focus();}}}/></SearchInput></div>}
        {loading && !searchable && <div className="model-catalog-status" role="status">목록 불러오는 중</div>}
        <div className="model-options" ref={rows} role="group" aria-label="사용 가능한 모델" onKeyDown={e => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          const buttons = [...rows.current.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
          if (index < 0) return;
          e.preventDefault();
          buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }}>
          {visible.map(model => <CxButton key={model.name} className="model-option" aria-pressed={model.name === selectedModel} aria-label={model.displayName} title={`${model.displayName}${provider === 'fabrix' ? '' : `\n${model.name}`}\n컨텍스트 ${formatTokens(model.contextLength)} 토큰\n최대 입력 ${formatTokens(model.maxInputTokens)} 토큰`} disabled={blocked || (loading && !selectWhileLoading)} onClick={() => select(model.name)}>
            {showActionLabels&&<Icon name="layers" size={18}/>}<span className="model-option-text">{model.displayName}</span>
            {model.name === selectedModel && <Icon name="check" size={18}/>}
          </CxButton>)}
          {!visible.length && <p className="model-empty" role="status">{loading ? '모델 불러오는 중' : query.trim() ? '검색 결과가 없습니다.' : catalog?.error ? '목록을 다시 불러오세요.' : catalog?.diagnostics?.summary?.received > 0 ? '모델 이름을 읽지 못했습니다.' : '사용 가능한 모델이 없습니다.'}</p>}
        </div>
      </>}
    </div>
  </>;
  if(embedded)return <section className="model-dialog nubi-mail-model-picker" aria-label="정리할 모델"><header className="nubi-mail-section-heading">{title}{accountActions}</header>{content}</section>;
  return <DetailPanel title={title} variant="modal" className="deck-dialog model-dialog" busy={saving} hideHelp footer={accountActions} initialFocus={connected ? searchable ? '#model-search' : '.model-option[aria-pressed="true"]' : '#model-provider-tabs [aria-selected="true"]'} onClose={() => {if (!saving) onClose();}}>
    {content}
  </DetailPanel>;
}

export function ContextMeter({dialogTitle='컨텍스트', messages, draft, model, busy, partial, promptContext, memory, stats, task, onCompact, usageInfo, showActionLabels = false, showTokenCount = false}) {
  const [open, setOpen] = useState(false);
  const estimatedInfo = useMemo(() => contextUsage(messages, draft, model, busy, partial, promptContext), [messages, draft, model, busy, partial, promptContext]);
  const info = usageInfo || estimatedInfo;
  const estimated = info.kind === 'estimated';
  const percent = contextPercent(info);
  const source = info.source ?? (info.kind === 'measured' ? '마지막 요청 실측' : estimated ? busy ? '생성 중 추정' : '전송 전 추정' : '새 대화');
  const title = [source, `${formatTokens(info.used)} / ${info.capacity ? `${formatTokens(info.capacity)} 토큰` : '한도 미제공'}`].filter(Boolean).join('\n');
  const progress = Math.min(100, Math.max(0, (info.ratio || 0) * 100));
  const ringLabel = info.ratio === null ? '—' : String(Math.round(progress));
  return <>
    <CxButton className="context-trigger" data-token-count={showTokenCount || undefined} aria-label="컨텍스트 사용량" aria-haspopup="dialog" aria-expanded={open} title={title} onClick={() => setOpen(true)}>
      <svg className="context-ring" viewBox="0 0 40 40" aria-hidden="true"><circle className="context-track" cx="20" cy="20" r="15"/><circle cx="20" cy="20" r="15" pathLength="100" strokeDasharray={`${progress} 100`} transform="rotate(-90 20 20)"/><text x="20" y="20" textAnchor="middle" dominantBaseline="middle">{ringLabel}</text></svg>{showTokenCount&&<span className="context-token-count">{estimated?'≈':''}{compactTokens(info.used)}</span>}{showActionLabels&&<span className="nubi-action-label">문맥</span>}
    </CxButton>
    {open && <DetailPanel title={dialogTitle} variant="modal" className="deck-dialog context-dialog" hideHelp onClose={() => setOpen(false)}>
      <div className="context-summary">
        {source && <span className="context-source">{source}</span>}
        <div className="context-total"><Icon name="chartColumn" size={20} className="context-total-icon"/><strong>{estimated ? '≈ ' : ''}{formatTokens(info.used)}</strong><span>/ {formatTokens(info.capacity)} 토큰</span></div>
        {info.capacity && Number.isFinite(info.used) && <div className="context-bar" role="progressbar" aria-label="컨텍스트 비율" aria-valuemin={0} aria-valuemax={info.capacity} aria-valuenow={Math.min(info.used, info.capacity)} aria-valuetext={`${estimated ? '추정 ' : ''}${percent}`}><span style={{width: `${progress}%`}}/></div>}
      </div>
      {Number.isSafeInteger(info.compactAt) && <div className="context-memory-row context-compaction-policy"><span>{info.compactLabel || '자동 요약'}</span><strong>{formatTokens(info.compactAt)} 토큰</strong></div>}
      {info.compactNote && <p className="context-note">{info.compactNote}</p>}
      <details className="context-memory"><summary>토큰 상세</summary><dl className="context-details">
        <div><dt>모델</dt><dd>{model?.displayName || model?.name}</dd></div>
        <div><dt>{info.compactAt ? '모델 컨텍스트' : '컨텍스트 한도'}</dt><dd>{info.capacity ? `${formatTokens(info.capacity)} 토큰` : '미제공'}</dd></div>
        {model?.maxContextLength && <div><dt>모델 최대 컨텍스트</dt><dd>{formatTokens(model.maxContextLength)} 토큰</dd></div>}
        {model?.contextSource === 'bundled' && <div><dt>한도 출처</dt><dd>내장 모델 정보</dd></div>}
        <div><dt>최대 입력</dt><dd>{model?.maxInputTokens ? `${formatTokens(model.maxInputTokens)} 토큰` : '미제공'}</dd></div>
        {model?.maxOutputTokens && <div><dt>최대 출력</dt><dd>{formatTokens(model.maxOutputTokens)} 토큰</dd></div>}
        {Number.isSafeInteger(info.usage?.prompt_tokens) && <div><dt>입력</dt><dd>{formatTokens(info.usage.prompt_tokens)} 토큰</dd></div>}
        {Number.isSafeInteger(info.usage?.completion_tokens) && <div><dt>출력</dt><dd>{formatTokens(info.usage.completion_tokens)} 토큰</dd></div>}
        {info.usage?.completion_tokens_details && <div><dt>출력 중 추론</dt><dd>{formatTokens(info.usage.completion_tokens_details.reasoning_tokens)} 토큰</dd></div>}
      </dl><p className="context-note" data-usage-kind={info.kind}>{info.note || (info.kind === 'measured' ? '마지막 요청의 입력과 출력입니다.' : estimated ? '지침, 대화, 초안을 합산한 추정치입니다.' : '메시지를 입력하면 표시됩니다.')}</p></details>
      {onCompact && <div className="context-memory-row"><strong title="대화가 길어지면 핵심 내용을 남깁니다.">자동 압축</strong><CxButton aria-label="지금 대화 압축" title="지금 대화 압축" disabled={busy || messages.filter(m => m.role === 'user' && !m.contextOnly).length < 2} onClick={() => {setOpen(false); onCompact();}}><Icon name="minimize" size={20}/></CxButton></div>}
      {stats?.count > 0 && <p className="context-note">{stats.count}회 정리{stats.beforeTokens != null && stats.afterTokens != null ? ` (${compactTokens(stats.beforeTokens)} → ${compactTokens(stats.afterTokens)} 추정)` : ''}</p>}
      {(memory?.summary || task?.summary) && <details className="context-memory"><summary>기억한 내용</summary><p>{(task?.summary || memory.summary).goal}</p>{['constraints', 'decisions', 'pending'].map(key => (task?.summary || memory.summary)[key]?.length > 0 && <div key={key}><strong>{{constraints: '지킬 조건', decisions: '결정한 내용', pending: '남은 작업'}[key]}</strong><ul>{(task?.summary || memory.summary)[key].map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}</details>}
    </DetailPanel>}
  </>;
}
