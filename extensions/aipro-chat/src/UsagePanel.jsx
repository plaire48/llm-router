import React, {useEffect, useRef, useState} from 'react';
import {DetailPanel, ActionButton, Icon} from '@e2e/cx-design-system';
import {formatTokens} from '../usage.js';
import {ACCOUNT_USAGE_TTL, fetchAccountUsage, freshAccountUsage} from '../account-usage.js';
import {ERROR_TEXT, PROVIDER_LABELS} from '../core.js';
import {providerSession} from '../provider-sessions.js';
import {AgentTabs} from './AgentTabs.jsx';
import {ProviderIcon} from './ChatControls.jsx';

function periodLabel(seconds, index) {
  if (!seconds) return `한도 ${index + 1}`;
  if (seconds % 86400 === 0) return `${seconds / 86400}일`;
  if (seconds % 3600 === 0) return `${seconds / 3600}시간`;
  return `${Math.round(seconds / 60)}분`;
}
const localTime = value => new Date(value).toLocaleString('ko-KR', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
function ProviderUsage({provider, stats, active, labels=PROVIDER_LABELS}) {
  const missing = Math.max(0, stats.calls - stats.measured - stats.pending);
  return <details className="usage-provider" data-active={!!active}>
    <summary aria-label={`${labels[provider]} 토큰 상세`}><ProviderIcon provider={provider}/><h3>{labels[provider]}</h3><div className="usage-total"><strong>{stats.measured ? formatTokens(stats.total) : stats.calls ? '—' : '0'}</strong><span>토큰</span></div><Icon name="chevronDown" size={16}/></summary>
    <div className="usage-provider-detail"><p className="usage-caption">{formatTokens(stats.calls)}회 호출</p>
    <dl className="usage-breakdown">
      <div><dt>입력</dt><dd>{formatTokens(stats.inputReports ? stats.input : stats.calls ? null : 0)}</dd></div>
      <div><dt>출력</dt><dd>{formatTokens(stats.outputReports ? stats.output : stats.calls ? null : 0)}</dd></div>
    </dl>
    {!!(stats.cached || stats.reasoning) && <div className="usage-caption usage-subsets">{stats.cached > 0 && <span>입력 중 캐시 {formatTokens(stats.cached)}</span>}{stats.reasoning > 0 && <span>출력 중 추론 {formatTokens(stats.reasoning)}</span>}</div>}
    {(missing > 0 || stats.pending > 0) && <p className="usage-caption">{[missing > 0 && `${formatTokens(missing)}회 미집계`, stats.pending > 0 && `${formatTokens(stats.pending)}회 집계 중`].filter(Boolean).join(', ')}</p>}
    </div>
  </details>;
}
export function UsagePanel({showActionLabels = false,data, rpc, onClose, loadAccountUsage, scopeLabel = '이 확장에서 사용한 토큰', afterAccount, providerLabels=PROVIDER_LABELS}) {
  const [period, setPeriod] = useState('today'), [loading, setLoading] = useState(false);
  const controller = useRef(null), generation = useRef(0);
  const connection = data.connections?.chatgpt || (data.auth.provider === 'chatgpt' ? data.auth : {});
  const canRead = connection.present && !connection.rejected && !connection.expired;
  const account = data.accountUsage;
  async function load(force = false) {
    if (!canRead || (!force && freshAccountUsage(account))) return;
    const version = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort('timeout'), 15000);
    const credentialReceivedAt = connection.receivedAt;
    setLoading(true);
    try {
      // Native hosts keep credentials in their own process. They provide only
      // the normalized quota result; the extension's session flow stays intact.
      if (loadAccountUsage) {await loadAccountUsage({force, signal:abort.signal}); return;}
      const prepare = async force => {
        await rpc('PREPARE_CREDENTIAL', {provider: 'chatgpt', credentialReceivedAt, force});
        if (abort.signal.aborted) throw new Error('quota_network');
        const {credential} = providerSession(await chrome.storage.session.get(['credential', 'providerSessions']), 'chatgpt');
        if (credential?.receivedAt !== credentialReceivedAt) throw new Error('no_credential');
        return credential;
      };
      let credential = await prepare(false), result;
      try {result = await fetchAccountUsage(credential, abort.signal);}
      catch (error) {
        // Match the router: one refresh after an unexpected 401. A 403 quota
        // refusal must not reject a login that can still send chat messages.
        if (error.status !== 401 || !credential.refreshToken || abort.signal.aborted) throw error;
        credential = await prepare(true);
        result = await fetchAccountUsage(credential, abort.signal);
      }
      if (version === generation.current) await rpc('SAVE_ACCOUNT_USAGE', {credentialReceivedAt, ...result});
    } catch (error) {
      if (version === generation.current && (!abort.signal.aborted || abort.signal.reason === 'timeout')) {
        if (!loadAccountUsage) await rpc('SAVE_ACCOUNT_USAGE', {credentialReceivedAt, error: error.message.startsWith('quota_') ? error.message : 'quota_unavailable', status: error.status || 0}).catch(() => {});
      }
    } finally {clearTimeout(timeout); if (version === generation.current) setLoading(false);}
  }
  useEffect(() => {
    setLoading(false);
    load();
    return () => {generation.current++; controller.current?.abort();};
  }, [connection.receivedAt, canRead]);
  const stats = data.usage?.[period];
  const windows = canRead ? [...(account?.data?.windows || []), ...(account?.data?.individualLimit ? [{id: 'individual', label: '개인 한도', ...account.data.individualLimit}] : [])] : [];
  const credits = canRead ? account?.data?.credits : null;
  const stale = account?.data && (account.error || Date.now() - account.fetchedAt > ACCOUNT_USAGE_TTL);
  return <DetailPanel title={showActionLabels?<span className="nubi-panel-title"><Icon name="chartColumn" size={18}/>사용량</span>:"사용량"} variant="modal" className="deck-dialog usage-dialog" hideHelp onClose={onClose}>
    <section className="usage-account" aria-label="계정 잔여 한도">
      <div className="usage-row"><h3>{providerLabels.claude&&<ProviderIcon provider="chatgpt"/>}ChatGPT 잔여 한도</h3><ActionButton action="refresh" iconOnly={!showActionLabels} label={showActionLabels?'새로고침':'계정 한도 새로고침'} aria-label="계정 한도 새로고침" title={account?.fetchedAt ? `계정 한도 새로고침\n${localTime(account.fetchedAt)} 조회` : '계정 한도 새로고침'} busy={loading} disabled={!canRead} onClick={() => load(true)}/></div>
      {loading && !account?.data && <p className="usage-caption" role="status">조회 중</p>}
      {!canRead && <p className="usage-caption">{connection.present ? 'ChatGPT에 다시 연결해 주세요.' : 'ChatGPT 로그인 후 확인할 수 있습니다.'}</p>}
      {canRead && account?.error && <p className="usage-caption" role="status">{stale ? '조회 실패. 이전 결과입니다.' : ERROR_TEXT[account.error]}</p>}
      {stale && !account.error && <p className="usage-caption">이전 조회 결과입니다. 새로고침하세요.</p>}
      {windows.map((window, index) => {
        const expired = window.resetsAt && window.resetsAt <= Date.now();
        const remaining = expired ? null : window.remaining;
        const label = window.label || periodLabel(window.seconds, index);
        return <div className="usage-window" key={window.id}>
          <div className="usage-row"><span>{label}</span><strong>{remaining === null ? expired ? '갱신 필요' : '미제공' : `${remaining.toLocaleString('ko-KR', {maximumFractionDigits: 1})}% 남음`}</strong></div>
          {remaining !== null && <div className="context-bar" role="meter" aria-label={`${label} 잔여 한도`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}><span style={{width: `${remaining}%`}}/></div>}
          {window.resetsAt && <span className="usage-caption usage-metadata">{localTime(window.resetsAt)} 초기화</span>}
        </div>;
      })}
      {credits && <div className="usage-window"><div className="usage-row"><span>크레딧</span><strong>{credits.unlimited ? '무제한' : credits.balance === null ? '미제공' : credits.balance.toLocaleString('ko-KR', {maximumFractionDigits: 2})}</strong></div></div>}
      {canRead && account?.data?.spendControlReached && <p className="usage-caption">사용 한도에 도달했습니다.</p>}
      {canRead && account?.data && !windows.length && !credits && <p className="usage-caption">제공된 한도 정보가 없습니다.</p>}
    </section>
    {afterAccount}
    <AgentTabs items={[{key: 'today', label: '오늘'}, {key: 'total', label: '전체'}]} active={period} onChange={setPeriod} label="집계 기간" idPrefix="usage-period" panelId="usage-statistics"/>
    <div id="usage-statistics" role="tabpanel" aria-labelledby={`usage-period-${period}`} tabIndex={0} className="usage-statistics">
      {stats && <div className="usage-providers">{Object.keys(providerLabels).filter(provider => stats[provider]).map(provider => <ProviderUsage labels={providerLabels} key={provider} provider={provider} stats={stats[provider]} active={data.auth.present && data.auth.provider === provider}/>)}</div>}
      {data.usageError && <p className="usage-caption" role="status">{data.usageError==='usage_save_failed'?'사용량 기록을 저장하지 못했어요. 현재 앱의 집계를 표시합니다.':'사용량 기록을 불러오지 못했어요. 다시 열어 주세요.'}</p>}
      <p className="usage-caption usage-scope" title={data.usage?.startedAt ? `${new Date(data.usage.startedAt).toLocaleDateString('ko-KR')}부터 집계` : undefined}>{scopeLabel}</p>
    </div>
  </DetailPanel>;
}
