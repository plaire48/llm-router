import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ActionButton, CxButton, CxField, CxInput, CxTextarea, CxNotice} from '@e2e/cx-design-system';
import {ERROR_TEXT} from '../core.js';
import './approval.css';
import {InteractionSurface, ApprovalPreview} from './InteractionSurface.jsx';

export function ActionApproval({question, disabled, canApprove, onApprove, onReject, onRead, onEdit}) {
  const answer = question.answer, editableDraft = question.hasEditableDraft !== false;
  const [editor, setEditor] = useState(null), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const actionLock = useRef(false), readLock = useRef(false), fieldNodes = useRef(new Map()), focusField = useRef(null), alive = useRef(true);
  const dirty = editor?.some(field => field.value !== field.original);
  const blocked = disabled || loading || saving || acting;
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {if (answer) setEditor(null);}, [answer]);
  useLayoutEffect(() => {
    if (!editor || !focusField.current) return;
    const field = fieldNodes.current.get(focusField.current);
    field?.focus({preventScroll:true}); field?.scrollIntoView({block:'nearest'}); focusField.current = null;
  }, [editor]);
  async function decide(action) {
    if (actionLock.current || blocked) return;
    actionLock.current = true; setActing(true); setError('');
    try {await action();}
    catch (cause) {if (alive.current) setError(ERROR_TEXT[cause.message] || ERROR_TEXT.approval_changed);}
    finally {actionLock.current = false; if (alive.current) setActing(false);}
  }
  function approve() {
    if (actionLock.current || blocked || !canApprove || answer) return;
    // Start inside the click gesture. Awaiting RPC/contains first loses the
    // Chrome user activation required by optional permissions.
    const permission = question.requiredPermission === 'downloads'
      ? chrome.permissions.request({permissions: ['downloads']}) : Promise.resolve(true);
    void decide(async () => {
      if (!await permission) throw new Error('download_permission');
      await onApprove();
    });
  }
  async function edit(preview) {
    if (readLock.current || blocked || !canApprove || answer) return;
    readLock.current = true; setLoading(true); setError('');
    try {
      // Display excerpts are never used as editable originals or write targets.
      const fields = await onRead();
      if (!fields.length) throw new Error('draft_edit_unavailable');
      if (!alive.current) return;
      const matching = preview?.id ? fields.find(field => field.id === preview.id) : fields.filter(field => field.label === preview?.label).length === 1 ? fields.find(field => field.label === preview.label) : null;
      if (preview?.id && !matching) throw new Error('approval_changed');
      focusField.current = (matching || fields[0]).id;
      setEditor(fields.map(field => ({...field, original: field.value})));
    } catch (cause) {if (alive.current) setError(ERROR_TEXT[cause.message] || ERROR_TEXT.approval_changed);}
    finally {readLock.current = false; if (alive.current) setLoading(false);}
  }
  async function apply() {
    if (actionLock.current || blocked || !canApprove || !dirty) return;
    actionLock.current = true; setSaving(true); setError('');
    const fields = editor.filter(field => field.value !== field.original).map(({id, value}) => ({id, value}));
    try {if (await onEdit(fields)) {if (alive.current) setEditor(null);} else if (alive.current) setError('반영하지 못했습니다. 수정 내용은 유지됩니다.');}
    catch (cause) {if (alive.current) setError(ERROR_TEXT[cause.message] || ERROR_TEXT.approval_changed);}
    finally {actionLock.current = false; if (alive.current) setSaving(false);}
  }
  const status = answer?.state === 'changed' ? '페이지가 바뀌어 실행하지 않았습니다.' : answer?.state === 'unknown' ? '실행 결과 확인이 필요합니다.' : answer?.optionId === 'reject' ? editableDraft ? '취소했습니다. 초안은 유지됩니다.' : '취소했습니다.' : answer?.optionId === 'approve' ? '승인했습니다.' : '수정 요청을 반영합니다.';
  return <InteractionSurface className="action-approval" aria-label="최종 반영 승인" data-answered={!!answer} aria-busy={blocked}
    title={answer ? status : question.text} headingClassName="approval-heading"
    icon={answer ? answer.state === 'unknown' || answer.state === 'changed' ? 'alertCircle' : answer.optionId === 'reject' ? 'xClose' : 'check' : 'file'}>
    {(question.preview?.length > 0 || question.summary || question.pageTitle || editor) && <ApprovalPreview title={editableDraft ? '초안 보기' : '내용 확인'} label={editableDraft ? '작성한 초안' : '실행할 내용'}>{question.pageTitle && <p className="approval-page">{question.pageTitle}</p>}
      {question.summary && <p>{question.summary}</p>}
      {question.targetLabel && question.targetLabel !== question.action && <p>{question.targetLabel}</p>}
      {editor && !answer ? <div className="approval-editor-fields" role="group" aria-label="초안 편집">{editor.map((field, index) => <div className="interaction-editor-field" key={field.id}><CxField label={field.label}>{React.createElement(field.multiline ? CxTextarea : CxInput, {
        ref: node => {if (node) fieldNodes.current.set(field.id,node); else fieldNodes.current.delete(field.id);}, value:field.value,maxLength:400000,...(field.multiline ? {rows:5} : {}),disabled:blocked,
        onChange:event=>setEditor(current=>current.map((item,i)=>i===index?{...item,value:event.target.value}:item)),
      })}</CxField></div>)}</div> : <dl>{question.preview?.map((field,index)=><div key={field.id || index}><dt>{field.label}</dt><dd>{!answer && editableDraft && field.editable !== false ? <button type="button" className="approval-edit-value" aria-label={`${field.label} 편집`} title="클릭하여 편집" disabled={blocked || !canApprove} onClick={()=>edit(field)}>{field.value || '내용 입력'}{question.action !== '실행' && field.value.length >= 240 ? '…' : ''}</button> : <>{field.value}{question.action !== '실행' && field.value.length >= 240 ? '…' : ''}</>}</dd></div>)}</dl>}
    </ApprovalPreview>}
    {!answer && editableDraft && !editor && !question.preview?.some(field=>field.editable !== false) && <CxButton disabled={blocked || !canApprove} onClick={()=>edit()}>초안 입력</CxButton>}
    {!answer && <div className="approval-actions">
      {editor && <ActionButton action="undo" label="수정 전으로 되돌리기" disabled={blocked || !dirty} onClick={()=>setEditor(current=>current.map(field=>({...field,value:field.original})))}/>}
      <ActionButton action="cancel" iconOnly label="취소" disabled={blocked} onClick={()=>decide(onReject)}/>
      <CxButton variant="primary" disabled={blocked || !canApprove} busy={saving || acting} onClick={dirty ? apply : approve}>{dirty ? '수정 반영' : question.buttonLabel || question.action}</CxButton>
    </div>}
    {loading && <p className="reply-note" role="status">원문 확인 중</p>}
    {error && <CxNotice tone="danger">{error}</CxNotice>}
  </InteractionSurface>;
}
