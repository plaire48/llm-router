import React, {useState} from 'react';
import {ActionButton, CxButton,  CxInput, CxNotice, DetailPanel, Icon, SearchInput} from '@e2e/cx-design-system';
import {DeckField, DeckConfirmation} from './DeckSurfaces.jsx';
import {ProviderIcon} from './ChatControls.jsx';
import {ERROR_TEXT, PROVIDER_LABELS} from '../core.js';

const dateLabel = value => new Date(value).toLocaleDateString('ko-KR', {month: 'long', day: 'numeric'});
export function ConversationHistory({conversations, disabled, onAction, onClose, providerLabels = PROVIDER_LABELS}) {
  const [query, setQuery] = useState(''), [editor, setEditor] = useState(null), [removing, setRemoving] = useState(null);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const visible = conversations.filter(item => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function perform(type, value, close = false) {
    if (saving || disabled) return;
    setSaving(true); setError('');
    try {await onAction(type, value); setEditor(null); setRemoving(null); if (close) onClose({focusComposer: true});}
    catch (e) {setError(ERROR_TEXT[e.message] || '저장하지 못했습니다. 다시 시도해 주세요.');}
    finally {setSaving(false);}
  }
  return <DetailPanel title="대화 이력" variant="modal" className="deck-dialog conversation-history" hideHelp busy={saving} onClose={() => {if (!saving) onClose();}}>
    <div className="history-toolbar"><SearchInput><label className="visually-hidden" htmlFor="conversation-search">대화 검색</label><CxInput id="conversation-search" type="search" placeholder="대화 검색" value={query} onChange={e => setQuery(e.target.value)}/></SearchInput><ActionButton action="add" className="icon-commit" label="새 대화" disabled={disabled || saving} onClick={() => perform('NEW_CHAT', {}, true)}/></div>
    {error && !removing && <CxNotice tone="danger">{error}</CxNotice>}
    {disabled && <p className="history-hint" role="status">작업이 끝나면 전환할 수 있습니다.</p>}
    <div className="history-list" role="group" aria-label="저장된 대화">
      {!visible.length && <div className="history-empty"><Icon name={query ? 'search' : 'message'} size={24}/><p>{query ? '검색 결과가 없습니다.' : '대화를 시작하면 여기에 남습니다.'}</p></div>}
      {visible.map(item => <div className="history-row" data-current={item.current} key={item.id}>
        {editor?.id === item.id ? <form className="history-editor" onSubmit={e => {e.preventDefault(); perform('RENAME_CONVERSATION', {id: item.id, title: editor.title});}}>
          <DeckField icon="message" label="대화 이름"><CxInput autoFocus value={editor.title} maxLength={80} required onChange={e => setEditor({...editor, title: e.target.value})}/></DeckField>
          <div className="history-editor-actions"><ActionButton action="cancel" label="취소" disabled={saving} onClick={() => {setEditor(null); setError('');}}/><ActionButton action="save" iconOnly className="icon-commit" label="저장" type="submit" busy={saving} disabled={disabled || !editor.title.trim()}/></div>
        </form> : <>
          <CxButton className="history-select" aria-current={item.current ? 'true' : undefined} aria-label={`${item.title} 열기`} disabled={disabled || saving} onClick={() => perform('SELECT_CONVERSATION', {id: item.id}, true)}>
            <span className="history-title">{item.title}</span><span className="history-meta"><span role="img" title={providerLabels[item.provider]} aria-label={providerLabels[item.provider]}><ProviderIcon provider={item.provider}/></span><time dateTime={new Date(item.updatedAt).toISOString()}>{dateLabel(item.updatedAt)}</time></span>
          </CxButton>
          <div className="history-actions"><ActionButton action="edit" label={`${item.title} 이름 변경`} disabled={disabled || saving} onClick={() => {setEditor({id: item.id, title: item.title}); setError('');}}/><ActionButton action="delete" label={`${item.title} 삭제`} disabled={disabled || saving} onClick={() => {setRemoving(item); setError('');}}/></div>
        </>}
      </div>)}
    </div>
    {removing && <DeckConfirmation title="대화를 삭제할까요?" message={`‘${removing.title}’의 대화와 첨부 이미지가 삭제됩니다.`} confirmLabel="삭제" busy={saving} onCancel={() => {if (!saving) {setRemoving(null); setError('');}}} onConfirm={() => perform('DELETE_CONVERSATION', {id: removing.id})}>{error && <CxNotice tone="danger">{error}</CxNotice>}</DeckConfirmation>}
  </DetailPanel>;
}
