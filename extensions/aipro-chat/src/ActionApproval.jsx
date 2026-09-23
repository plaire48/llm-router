import React, {useEffect, useRef, useState} from 'react';
import {ActionButton, CxButton, CxField, CxInput, CxTextarea, CxNotice, DetailPanel} from '@e2e/cx-design-system';
import {ERROR_TEXT} from '../core.js';
import './approval.css';
import {InteractionSurface, ApprovalPreview} from './InteractionSurface.jsx';

export function ActionApproval({question, disabled, canApprove, onApprove, onReject, onRead, onEdit}) {
  const answer = question.answer;
  const editableDraft = question.hasEditableDraft !== false;
  const [editor, setEditor] = useState(null), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false), [acting, setActing] = useState(false);
  const actionLock = useRef(false);
  const dirty = editor?.some(field => field.value !== field.original);
  useEffect(() => {if (answer) {setEditor(null); setEditorOpen(false);}}, [answer]);
  function closeEditor() {
    if (saving) return;
    setEditorOpen(false); setError('');
  }
  async function decide(action) {
    if (actionLock.current || disabled) return;
    actionLock.current = true; setActing(true); setError('');
    try {await action();}
    catch (cause) {setError(ERROR_TEXT[cause.message] || ERROR_TEXT.approval_changed);}
    finally {actionLock.current = false; setActing(false);}
  }
  async function edit() {
    if (editor) {setEditorOpen(true); return;}
    setLoading(true); setError('');
    try {const fields = await onRead(); if (!fields.length) throw new Error('draft_edit_unavailable'); setEditor(fields.map(field => ({...field, original: field.value}))); setEditorOpen(true);}
    catch (cause) {setError(ERROR_TEXT[cause.message] || ERROR_TEXT.approval_changed);}
    finally {setLoading(false);}
  }
  async function apply() {
    if (saving) return;
    const fields = editor.filter(field => field.value !== field.original).map(({id, value}) => ({id, value}));
    if (!fields.length) {setEditor(null);return;}
    setSaving(true);setError('');
    try {if (await onEdit(fields)) setEditor(null);else setError('반영하지 못했습니다. 수정 내용은 유지됩니다.');}
    catch (cause) {setError(ERROR_TEXT[cause.message] || ERROR_TEXT.approval_changed);}
    finally {setSaving(false);}
  }
  const status = answer?.state === 'changed' ? '페이지가 바뀌어 실행하지 않았습니다.' : answer?.state === 'unknown' ? '실행 결과 확인이 필요합니다.' : answer?.optionId === 'reject' ? editableDraft ? '취소했습니다. 초안은 유지됩니다.' : '취소했습니다.' : answer?.optionId === 'approve' ? '승인했습니다.' : '수정 요청을 반영합니다.';
  return <><InteractionSurface className="action-approval" aria-label="최종 반영 승인" data-answered={!!answer} aria-busy={acting}
    title={answer ? status : question.text} headingClassName="approval-heading"
    icon={answer ? answer.state === 'unknown' || answer.state === 'changed' ? 'alertCircle' : answer.optionId === 'reject' ? 'xClose' : 'check' : 'file'}
    headingAction={!answer && editableDraft && <ActionButton action="edit" label="초안 수정" disabled={disabled || loading || acting || !canApprove} busy={loading} onClick={edit}/>}>
    {(question.preview?.length > 0 || question.summary || question.pageTitle) && <ApprovalPreview title={editableDraft ? '초안 보기' : '내용 확인'} label={editableDraft ? '작성한 초안' : '실행할 내용'}>{question.pageTitle && <p className="approval-page">{question.pageTitle}</p>}
      {question.summary && <p>{question.summary}</p>}
      {question.targetLabel && question.targetLabel !== question.action && <p>{question.targetLabel}</p>}
      <dl>{question.preview?.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{field.value}{field.value.length >= 240 ? '…' : ''}</dd></div>)}</dl>
    </ApprovalPreview>}
    {!answer && <div className="approval-actions"><ActionButton action="cancel" iconOnly label="취소" disabled={disabled || acting} onClick={() => decide(onReject)}/><CxButton variant="primary" disabled={disabled || !canApprove || acting} busy={acting} onClick={dirty ? edit : () => decide(onApprove)}>{dirty ? '수정 계속' : question.buttonLabel || question.action}</CxButton></div>}
    {error && !editorOpen && <CxNotice tone="danger">{error}</CxNotice>}
  </InteractionSurface>
    {editor && editorOpen && <DetailPanel title="초안 수정" variant="modal" className="deck-dialog approval-editor" hideHelp busy={saving} onClose={closeEditor}
      footer={<><ActionButton action="undo" label="수정 전으로 되돌리기" disabled={saving || !dirty} onClick={() => setEditor(current => current.map(field => ({...field, value: field.original})))}/><ActionButton action="save" iconOnly className="icon-commit" label="반영" title="수정한 초안 반영" busy={saving} disabled={saving || disabled || !dirty} onClick={apply}/></>}>
      <div className="approval-editor-fields">{editor.map((field, index) => <div className="interaction-editor-field" key={field.id}><CxField label={field.label}>{React.createElement(field.multiline ? CxTextarea : CxInput, {value: field.value, maxLength: 400000, ...(field.multiline ? {rows: 7} : {}), disabled: saving, onChange: event => setEditor(current => current.map((item, i) => i === index ? {...item, value: event.target.value} : item))})}</CxField></div>)}</div>
      {error && <CxNotice tone="danger">{error}</CxNotice>}
    </DetailPanel>}
  </>;
}
