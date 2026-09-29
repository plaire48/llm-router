import React, {useEffect,useRef,useState} from 'react';
import {ActionButton,CxField,CxInput,CxNotice,notifyToast} from '@e2e/cx-design-system';
import {DeckSectionLabel} from './DeckSurfaces.jsx';
import {mcpConfig,mcpPermission,MCP_ERRORS} from '../mcp-config.js';
import './integrations.css';
const fresh = () => ({name:'',url:'',headers:[]});
export function McpSettings({rpc,disabled,onBusy}) {
  const [servers,setServers] = useState([]), [draft,setDraft] = useState(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const alive = useRef(true), pending = useRef(false), form = useRef(null);
  useEffect(() => {alive.current=true; rpc('MCP_STATUS').then(result => {if (alive.current) setServers(result.servers);}).catch(() => {if (alive.current) setError('연결 정보를 불러오지 못했습니다.');}); return () => {alive.current=false;};},[rpc]);
  async function connect(event) {
    event?.preventDefault();
    if (pending.current || disabled || !form.current.reportValidity()) return;
    try {
      const connection = mcpConfig(draft);
      // Host grant must run on the user's click, before awaiting network or storage.
      const granted = chrome.permissions.request({origins:[mcpPermission(connection.url)]});
      pending.current=true; setBusy(true); onBusy(true); setError('');
      if (!await granted) throw new Error('mcp_permission');
      if (!alive.current) return;
      const result = await rpc('MCP_CONNECT',{connection,replaceId:draft.id});
      if (alive.current) {setServers(result.servers);setDraft(null);notifyToast('연결과 도구 목록을 확인했습니다.');}
    } catch (cause) {if (alive.current) setError(MCP_ERRORS[cause.message] || '연결하지 못했습니다. 다시 시도해 주세요.');}
    finally {pending.current=false;if (alive.current) setBusy(false);onBusy(false);}
  }
  async function remove(id) {
    if (pending.current || disabled) return;
    pending.current=true;setBusy(true);onBusy(true);setError('');
    try {const result = await rpc('MCP_REMOVE',{id}); if (alive.current) {setServers(result.servers); if (draft?.id === id) setDraft(null);notifyToast('연결을 해제했습니다.');}}
    catch {if (alive.current) setError('연결을 해제하지 못했습니다. 다시 시도해 주세요.');}
    finally {pending.current=false;if (alive.current) setBusy(false);onBusy(false);}
  }
  const blocked=disabled || busy;
  return <details className="integration-settings"><summary><DeckSectionLabel icon="link" tone="violet">MCP 연결</DeckSectionLabel></summary><div className="integration-content">
    {servers.map(server => <div className="connection-row" key={server.id}><span className="integration-name">{server.name}</span><div className="integration-actions"><ActionButton action="edit" iconOnly label={`${server.name} 연결 편집`} disabled={blocked} onClick={() => {setDraft({...server,headers:server.headerNames.map(name => ({name,value:''}))});setError('');}}/><ActionButton action="logout" iconOnly label={`${server.name} 연결 해제`} disabled={blocked} onClick={() => remove(server.id)}/></div></div>)}
    {!draft ? <div className="integration-actions"><ActionButton action="add" iconOnly className="icon-commit" label="MCP 연결 추가" disabled={blocked || servers.length >= 8} onClick={() => {setDraft(fresh());setError('');}}/></div> : <form className="integration-form" ref={form} onSubmit={connect}>
      <CxField label="이름" required><CxInput required value={draft.name} maxLength={80} disabled={blocked} onChange={e => setDraft({...draft,name:e.target.value})}/></CxField>
      <CxField label="서버 주소" required><CxInput type="url" required value={draft.url} placeholder="https://example.com/mcp" maxLength={2000} autoComplete="off" spellCheck={false} disabled={blocked} onChange={e => setDraft({...draft,url:e.target.value})}/></CxField>
      <details className="deck-subsection" open={draft.headers.length ? true : undefined}><summary>헤더</summary><div className="integration-headers">{draft.headers.map((header,index) => <div className="integration-header" key={index}><CxField label={`헤더 ${index+1} 이름`}><CxInput value={header.name} placeholder="Authorization" maxLength={100} autoComplete="off" spellCheck={false} disabled={blocked} onChange={e => setDraft({...draft,headers:draft.headers.map((row,i) => i === index ? {...row,name:e.target.value} : row)})}/></CxField><CxField label={`헤더 ${index+1} 값`}><CxInput type="password" value={header.value} placeholder="Bearer …" maxLength={4096} autoComplete="new-password" disabled={blocked} onChange={e => setDraft({...draft,headers:draft.headers.map((row,i) => i === index ? {...row,value:e.target.value} : row)})}/></CxField><ActionButton action="delete" iconOnly label={`헤더 ${index+1} 삭제`} disabled={blocked} onClick={() => setDraft({...draft,headers:draft.headers.filter((_,i) => i !== index)})}/></div>)}<div className="integration-actions"><ActionButton action="add" iconOnly label="헤더 추가" disabled={blocked || draft.headers.length >= 12} onClick={() => setDraft({...draft,headers:[...draft.headers,{name:'',value:''}]})}/></div></div></details>
      {draft.id && draft.headerNames?.length > 0 && <p className="reply-note">인증 헤더를 다시 입력해 주세요.</p>}
      <div className="integration-actions"><ActionButton action="cancel" iconOnly label="MCP 연결 취소" disabled={busy} onClick={() => {setDraft(null);setError('');}}/><ActionButton action="login" iconOnly className="icon-commit" label="연결 테스트 후 저장" title="연결 테스트 후 저장" busy={busy} disabled={disabled} onClick={connect}/></div>
    </form>}
    <p className="reply-note">브라우저를 종료하면 연결 정보가 삭제됩니다.</p>
    {error && <CxNotice tone="danger">{error}</CxNotice>}
  </div></details>;
}
