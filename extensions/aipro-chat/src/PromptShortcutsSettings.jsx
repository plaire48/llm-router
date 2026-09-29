import React, {useRef, useState} from 'react';
import {ActionButton, CxButton, CxField, CxInput, CxNotice, CxTextarea, Icon} from '@e2e/cx-design-system';
import {DeckSectionLabel} from './DeckSurfaces.jsx';
import {MAX_PROMPT_SHORTCUTS} from '../prompt-shortcuts.js';

const empty = {name:'', text:''};
const errorText = error => ({
  prompt_shortcut_fields:'이름과 프롬프트를 입력해 주세요.',
  prompt_shortcut_duplicate:'같은 이름의 바로가기가 있습니다.',
  prompt_shortcut_limit:`최대 ${MAX_PROMPT_SHORTCUTS}개까지 저장할 수 있습니다.`,
  prompt_shortcut_missing:'다른 창에서 삭제했습니다. 목록을 다시 확인해 주세요.',
  prompt_shortcut_changed:'다른 창에서 수정했습니다. 최신 내용을 다시 열어 주세요.',
  prompt_shortcut_lock_unavailable:'저장을 보호할 수 없습니다. Chrome을 업데이트한 뒤 다시 시도해 주세요.'
})[error?.message] || '저장하지 못했습니다. 다시 시도해 주세요.';

export function PromptShortcutsSettings({items, loadError, disabled, onSave, onDelete, onSchedule}) {
  const [editor, setEditor] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState(null);
  const nameInput = useRef(null);
  const locked = disabled || busy || !!loadError;
  function openEditor(item) {
    setDeleting(null); setError(''); setEditor(item ? {...item, source:{...item}} : {...empty});
    requestAnimationFrame(() => nameInput.current?.focus());
  }
  async function save(event) {
    event.preventDefault();
    if (locked || !editor) return;
    setBusy(true); setError('');
    try {
      await onSave({id:editor.id, name:editor.name, text:editor.text}, editor.source);
      setEditor(null);
    } catch (cause) {setError(errorText(cause));}
    finally {setBusy(false);}
  }
  async function remove(item) {
    if (locked) return;
    setBusy(true); setError('');
    try {await onDelete(item); setDeleting(null);}
    catch (cause) {setError(errorText(cause));}
    finally {setBusy(false);}
  }
  return <details className="integration-settings prompt-shortcuts-settings"><summary><DeckSectionLabel icon="layers">프롬프트 바로가기</DeckSectionLabel></summary><div className="integration-content">
    <p className="reply-note">‘/’로 찾아 초안에만 넣습니다.</p>
    {(loadError || error) && <CxNotice tone="danger">{loadError || error}</CxNotice>}
    {items.length > 0 && <div className="prompt-shortcut-list" role="list" aria-label="저장한 프롬프트">{items.map(item => <div className="prompt-shortcut-row" role="listitem" key={item.id}>
      <div className="prompt-shortcut-info"><strong>{item.name}</strong><span title={item.text}>{item.text}</span><small>/{`p:${item.slug}`}</small></div>
      <div className="integration-actions">
        {deleting === item.id ? <><CxButton disabled={locked} onClick={() => remove(item)}>삭제 확인</CxButton><ActionButton action="cancel" iconOnly label={`${item.name} 삭제 취소`} disabled={locked} onClick={() => setDeleting(null)}/></> : <>
          <CxButton className="composer-icon" aria-label={`${item.name} 예약`} title={`${item.name} 예약`} disabled={locked} onClick={() => onSchedule(item)}><Icon name="clock" size={18}/></CxButton>
          <ActionButton action="edit" iconOnly label={`${item.name} 편집`} title={`${item.name} 편집`} disabled={locked} onClick={() => openEditor(item)}/>
          <ActionButton action="delete" iconOnly label={`${item.name} 삭제`} title={`${item.name} 삭제`} disabled={locked} onClick={() => setDeleting(item.id)}/>
        </>}
      </div>
    </div>)}</div>}
    {!editor && <ActionButton action="add" label="바로가기 추가" disabled={locked || items.length >= MAX_PROMPT_SHORTCUTS} onClick={() => openEditor()}/>}
    {editor && <form className="prompt-shortcut-editor" aria-label={editor.id ? '프롬프트 바로가기 편집' : '프롬프트 바로가기 추가'} onSubmit={save}>
      <CxField label="이름" required><CxInput ref={nameInput} value={editor.name} maxLength={60} disabled={locked} onChange={event => setEditor(current => ({...current, name:event.target.value}))}/></CxField>
      <CxField label="프롬프트" required><CxTextarea rows={4} value={editor.text} maxLength={16000} disabled={locked} onChange={event => setEditor(current => ({...current, text:event.target.value}))}/></CxField>
      <div className="prompt-shortcut-actions"><ActionButton action="cancel" label="취소" disabled={busy} onClick={() => {setEditor(null); setError('');}}/><ActionButton action="save" label="저장" type="submit" busy={busy} disabled={locked || !editor.name.trim() || !editor.text.trim()}/></div>
    </form>}
  </div></details>;
}
