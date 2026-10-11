import React, {useEffect, useRef, useState} from 'react';
import {ActionButton,  CxInput, CxNotice, DetailPanel, Icon, notifyToast} from '@e2e/cx-design-system';
import {ERROR_TEXT} from '../core.js';
import {projectOrigin} from '../project-tools.js';
import {DeckField, DeckGuidance} from './DeckSurfaces.jsx';

const connectionError = cause => ERROR_TEXT[cause.message] || ({
  project_address: '이 PC에서 실행한 OpenWiki 주소를 입력해 주세요.',
  project_permission: '프로젝트 접근을 허용해 주세요.',
  page_permission: '프로젝트 접근을 허용해 주세요.',
}[cause.message]) || 'OpenWiki를 실행한 뒤 다시 연결해 주세요.';

export function ProjectConnection({project, rpc, disabled, onClose, onChanged, onBusy}) {
  const [candidate, setCandidate] = useState(null), [address, setAddress] = useState(project?.origin || '');
  const [loading, setLoading] = useState(!project), [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), pending = useRef(false), form = useRef(null);
  useEffect(() => {
    alive.current = true;
    if (!project) rpc('PROJECT_CANDIDATE').then(result => {
      if (!alive.current) return;
      const found = result?.candidate;
      if (found) {
        try {const origin = projectOrigin(found.origin); setCandidate({...found, origin}); setAddress(origin);} catch {setCandidate(null);}
      }
    }).catch(cause => {if (alive.current) setError(connectionError(cause));})
      .finally(() => {if (alive.current) setLoading(false);});
    return () => {alive.current = false;};
  }, [rpc]);

  async function changeConnection(disconnect = false) {
    if (pending.current || disabled || loading) return;
    if (!disconnect && !form.current.reportValidity()) return;
    setError('');
    try {
      // Call permissions.request before awaiting anything to retain the click gesture.
      const origin = disconnect ? null : projectOrigin(address.trim());
      const permission = disconnect ? Promise.resolve(true) : chrome.permissions.request({origins: [`${origin}/*`]});
      pending.current = true; setBusy(true); onBusy(true);
      if (!await permission) throw new Error('project_permission');
      if (!alive.current) return;
      const result = await rpc(disconnect ? 'PROJECT_DISCONNECT' : 'PROJECT_CONNECT', disconnect ? {} : {origin, ...(candidate?.origin === origin ? {tabId: candidate.tabId} : {})});
      if (!alive.current) return;
      await onChanged(result);
      notifyToast(disconnect ? '프로젝트 연결을 해제했습니다.' : '프로젝트를 연결했습니다.');
    } catch (cause) {if (alive.current) setError(connectionError(cause));}
    finally {pending.current = false; if (alive.current) setBusy(false); onBusy(false);}
  }

  const name = project?.name || candidate?.title || 'OpenWiki';
  const showAddress = editing || (!project && !candidate);
  return <DetailPanel title="프로젝트 연결" variant="modal" className="deck-dialog project-dialog" hideHelp busy={busy}
    onClose={() => {if (!pending.current) onClose();}}
    footer={<>
      {project && <ActionButton action="logout" iconOnly label="프로젝트 연결 해제" title="프로젝트 연결 해제" disabled={disabled || busy} onClick={() => changeConnection(true)}/>}
      <ActionButton action={project ? 'refresh' : 'login'} iconOnly className="icon-commit" label={project ? '프로젝트 다시 연결' : '프로젝트 연결'} title={project ? '프로젝트 다시 연결' : '프로젝트 연결'} busy={busy} disabled={disabled || loading || !address.trim()} onClick={() => changeConnection()}/>
    </>}>
    <form ref={form} className="project-connection-fields" onSubmit={event => {event.preventDefault(); changeConnection();}}>
      {loading ? <p className="project-loading" role="status"><span className="status-spinner" aria-hidden="true"/>열린 프로젝트 확인 중</p> : <>
        {(project || candidate) && <div className="project-connection-summary"><span className="project-connection-icon"><Icon name="code" size={22}/></span><span className="project-connection-name" title={name}>{name}</span><ActionButton action="edit" label="프로젝트 주소 변경" title="프로젝트 주소 변경" disabled={busy || disabled} onClick={() => {setEditing(value => !value); setError('');}}/></div>}
        {showAddress && <DeckField icon="linkExternal" label="OpenWiki 주소" required><CxInput type="url" value={address} placeholder="http://localhost:3000" autoComplete="off" spellCheck={false} required disabled={busy || disabled} onChange={event => {setAddress(event.target.value); setError('');}}/></DeckField>}
        <DeckGuidance icon="code" lead={<>필요한 문서와 코드 발췌를 <strong>선택한 모델</strong>에 전달합니다.</>}/>
        {project?.status === 'expired' && <CxNotice tone="info">연결이 만료되었습니다. 다시 연결해 주세요.</CxNotice>}
        {error && <CxNotice tone="danger">{error}</CxNotice>}
      </>}
    </form>
  </DetailPanel>;
}
