import {DeckField} from './DeckSurfaces.jsx';
import React, {useEffect, useState} from 'react';
import {ActionButton, CxButton,  CxInput, CxNotice} from '@e2e/cx-design-system';
import {InteractionSurface} from './InteractionSurface.jsx';

// The values a recorded procedure types, confirmed before it runs again without
// the model. The values typed last time come from memory; after a browser
// restart they are asked again, as typed values are never saved to disk.
export function ReplayCard({message, conversationId, rpc, onRun, onClose, disabled, describeError}) {
  const [record, setRecord] = useState(null), [values, setValues] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    rpc('GET_REPLAY', {messageId: message.id, conversationId}).then(value => {
      if (!alive) return;
      setRecord(value);
      setValues(Object.fromEntries(value.inputs.map(input => {const saved = value.values[input.slot]; return [input.slot, Array.isArray(saved) ? saved.join(', ') : saved ?? ''];})));
    }).catch(e => {if (alive) setError(describeError(e.message));});
    return () => {alive = false;};
  }, [message.id, conversationId]);
  const missing = !record || record.memoryMissing || record.inputs.some(input => !String(values[input.slot] ?? '').trim());
  async function run() {
    setBusy(true); setError('');
    try {await onRun(values);} catch (e) {setError(describeError(e.message));} finally {setBusy(false);}
  }
  return <InteractionSurface className="replay-card" aria-label="모델 없이 다시 실행" title="모델 없이 다시 실행" icon="redo">
    {record && <p className="replay-summary">기록한 {record.steps}단계를 다시 실행합니다. 단계마다 대상을 다시 찾고, 페이지가 다르면 멈춥니다. 최종 반영 전에는 승인을 받습니다.{record.scripts > 0 ? ' 스크립트 단계는 기록한 내용 그대로 실행합니다.' : ''}</p>}
    {record?.memoryMissing && <CxNotice tone="warning">{describeError('replay_memory_missing')}</CxNotice>}
    {record?.inputs.length > 0 && <div className="replay-fields" role="group" aria-label="넣을 값">{record.inputs.map(input => <div className="interaction-editor-field" key={input.slot}>
      <DeckField label={input.label}><CxInput value={values[input.slot] ?? ''} maxLength={16000} disabled={busy || disabled}
        onChange={event => {const value = event.target.value; setValues(current => ({...current, [input.slot]: value}));}}/></DeckField>
    </div>)}</div>}
    <div className="approval-actions">
      <ActionButton action="cancel" iconOnly label="닫기" disabled={busy} onClick={onClose}/>
      <CxButton variant="primary" busy={busy} disabled={busy || disabled || missing} onClick={run}>실행</CxButton>
    </div>
    {error && <CxNotice tone="danger">{error}</CxNotice>}
  </InteractionSurface>;
}
