import {DeckField} from './DeckSurfaces.jsx';
import React, {useEffect, useRef, useState} from 'react';
import {CxButton,  CxInput, CxNotice, DetailPanel, ActionButton, Icon, notifyToast} from '@e2e/cx-design-system';
import {cleanFabrixCredentials} from '../fabrix.js';
import {ERROR_TEXT} from '../core.js';

export function FabrixConnection({title='FabriX 연결', initial, rpc, onClose, onConnected, onError, onNotice, showActionLabels=false, requestPermission = connection => chrome.permissions.request({origins: [`${new URL(connection.endpoint).origin}/*`]})}) {
  const [form, setForm] = useState(() => ({endpoint: initial?.endpoint || '', clientKey: initial?.clientKey || '', token: initial?.token || ''}));
  const [testing, setTesting] = useState(false), [connecting, setConnecting] = useState(false), [result, setResult] = useState(null), [error, setError] = useState('');
  const current = useRef(null), alive = useRef(true), formRef = useRef(null);
  useEffect(() => { if (error && onError) onError(error); }, [error, onError]);
  function cancel() {
    const id = current.current; current.current = null;
    if (id) rpc('CANCEL_FABRIX_TEST', {testId: id}).catch(() => {});
    setTesting(false); setResult(null);
  }
  useEffect(() => {
    alive.current = true;
    return () => {alive.current = false; const id = current.current; current.current = null; if (id) rpc('CANCEL_FABRIX_TEST', {testId: id}).catch(() => {});};
  }, [rpc]);
  function change(key, value) {cancel(); setError(''); setForm(previous => ({...previous, [key]: value}));}
  async function test() {
    if (testing || connecting || !formRef.current.reportValidity()) return;
    cancel(); setError('');
    const id = crypto.randomUUID(); current.current = id;
    try {
      const connection = cleanFabrixCredentials(form);
      // The permission prompt stays on the test button's user gesture.
      const permission = requestPermission(connection);
      setTesting(true);
      const granted = await permission;
      if (!alive.current || current.current !== id) return;
      if (!granted) throw new Error('page_permission');
      const checked = await rpc('TEST_FABRIX', {testId: id, connection});
      if (alive.current && current.current === id) setResult(checked);
    } catch (cause) {
      if (alive.current && current.current === id) setError(cause.message === 'unauthorized' ? ERROR_TEXT.fabrix_credentials : ERROR_TEXT[cause.message] || ERROR_TEXT.fabrix_network);
    } finally {if (alive.current && current.current === id) setTesting(false);}
  }
  async function connect() {
    if (!result || testing || connecting) return;
    setConnecting(true); setError('');
    try {await rpc('CONNECT_FABRIX', {testId: result.testId}); await onConnected(); (onNotice || notifyToast)('FabriX에 연결했습니다.');}
    catch (cause) {if (alive.current) {setError(ERROR_TEXT[cause.message] || ERROR_TEXT.storage_failed); if (cause.message === 'fabrix_test_expired') setResult(null);}}
    finally {if (alive.current) setConnecting(false);}
  }
  return <DetailPanel title={title} variant="modal" className="deck-dialog fabrix-dialog" hideHelp onClose={() => {if (!connecting) onClose();}} footer={<>
    {testing ? <CxButton onClick={cancel}>테스트 중지</CxButton> : <CxButton disabled={connecting} onClick={test}>연결 테스트</CxButton>}
    <ActionButton action="login" iconOnly={!showActionLabels} className="icon-commit" label="연결" title="FabriX 연결" disabled={!result || testing} busy={connecting} onClick={connect}/>
  </>}>
    <form ref={formRef} className="fabrix-fields" onSubmit={event => {event.preventDefault(); test();}}>
      <DeckField icon="linkExternal" label="Endpoint URL" required><CxInput type="url" value={form.endpoint} disabled={testing || connecting} autoComplete="off" placeholder="https://nsds-api.fabrix-s.samsungsds.com/sds/trial/api-chat" onChange={event => change('endpoint', event.target.value)}/></DeckField>
      <DeckField icon="logIn" label="x-fabrix-client" required><CxInput type="password" value={form.clientKey} disabled={testing || connecting} autoComplete="new-password" maxLength={16384} onChange={event => change('clientKey', event.target.value)}/></DeckField>
      <DeckField icon="logIn" label="x-openapi-token" required><CxInput type="password" value={form.token} disabled={testing || connecting} autoComplete="new-password" maxLength={16384} onChange={event => change('token', event.target.value)}/></DeckField>
      {testing && <p className="fabrix-test-status" data-state="running" role="status"><span className="status-spinner" aria-hidden="true"/>연결 확인 중</p>}
      {result && <p className="fabrix-test-status" data-state="done" role="status"><Icon name="check" size={14}/><span title="사용 가능한 모델 목록을 확인했습니다.">테스트 통과</span></p>}
      {error && !onError && <CxNotice tone="danger">{error}</CxNotice>}
    </form>
  </DetailPanel>;
}
