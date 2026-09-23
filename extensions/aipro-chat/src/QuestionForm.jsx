import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {ActionButton, CxButton, CxInput, CxTextarea, CxNotice, Icon} from '@e2e/cx-design-system';
import {QUESTION_TEXT_LIMIT} from '../user-question.js';
import {ERROR_TEXT} from '../core.js';
import {InteractionSurface} from './InteractionSurface.jsx';

export function QuestionForm({question, disabled, onChoose, onDraft, children, maxLength = QUESTION_TEXT_LIMIT}) {
  const [value, setValue] = useState(question.draft || ''), [writing, setWriting] = useState(!question.options.length || !!question.draft);
  const [expanded, setExpanded] = useState(question.inputMode === 'long_text' || (question.draft || '').includes('\n'));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const input = useRef(null), sending = useRef(false), revision = useRef(0), alive = useRef(true), id = useId();
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  // Focus only after React commits the newly opened or resized control.
  useLayoutEffect(() => {if (focusRequest) input.current?.focus();}, [focusRequest]);
  function focusInput() {setFocusRequest(current => current + 1);}
  const answered = !!question.answer, blocked = disabled || busy || answered;
  const multiline = expanded || value.includes('\n');
  function change(next) {
    setValue(next); setError('');
    const current = ++revision.current;
    // Save independently of the composer, including before a popup is closed.
    onDraft(next).catch(cause => {
      if (alive.current && revision.current === current && !sending.current) setError(ERROR_TEXT[cause.message] || '저장하지 못했습니다. 답변을 다시 보내주세요.');
    });
  }
  async function choose(choice) {
    if (blocked || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      if (await onChoose({questionId: question.id, ...choice}) === false && alive.current) setError('답변을 보내지 못했습니다. 다시 시도해주세요.');
    } catch (cause) {if (alive.current) setError(ERROR_TEXT[cause.message] || '답변을 보내지 못했습니다. 다시 시도해주세요.');}
    finally {sending.current = false; if (alive.current) setBusy(false);}
  }
  function submit(event) {
    event?.preventDefault();
    if (value.trim()) void choose({text: value});
  }
  function keydown(event) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {if (event.key === 'Enter') event.preventDefault(); return;}
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !multiline)) submit(event);
  }
  function write() {setWriting(true); focusInput();}
  return <InteractionSurface className="question-card" aria-label="질문" data-answered={answered} aria-busy={busy} title={question.text} titleId={`${id}-title`} headingClassName="image-question"
    headingAction={!answered && question.options.length > 0 && <ActionButton action="edit" label="직접 답변 입력" disabled={blocked} aria-expanded={writing} aria-controls={`${id}-form`} onClick={write}/>} >
    {typeof children === 'function' ? children({onChoose: choose, disabled: blocked}) : children}
    {!answered && question.kind === 'choice' && <div className="question-options" role="group" aria-labelledby={`${id}-title`}>
      {question.options.map((option, index) => <CxButton key={option.id} className="question-option" disabled={blocked} onClick={() => choose({optionId: option.id})}>
        <span className="question-option-index" aria-hidden="true">{index + 1}</span>
        <span className="question-option-copy"><strong>{option.label}</strong>{option.description && <span>{option.description}</span>}</span>
        <Icon name="arrowRight" size={16}/>
      </CxButton>)}
    </div>}
    {!answered && writing && <form className="interaction-input" id={`${id}-form`} onSubmit={submit}>
      {React.createElement(multiline ? CxTextarea : CxInput, {ref: input, value, 'aria-label': '직접 답변', 'aria-describedby': `${id}-title`,
        placeholder: multiline ? '내용을 자유롭게 적어주세요.' : '답변을 입력하세요.', maxLength, disabled: blocked,
        ...(multiline ? {rows: expanded ? 6 : 3} : {}), onChange: event => change(event.target.value), onKeyDown: keydown,
        onPaste: event => {
          const text = event.clipboardData.getData('text/plain');
          if (!multiline && /[\r\n]/.test(text)) {
            event.preventDefault();
            const field = event.currentTarget;
            change((value.slice(0, field.selectionStart) + text + value.slice(field.selectionEnd)).slice(0, maxLength));
            setExpanded(true); focusInput();
          }
        }})}
      <div className="interaction-input-actions">
        <ActionButton action={expanded ? 'collapse' : 'expand'} label={expanded ? '입력란 줄이기' : '길게 작성하기'} disabled={blocked} onClick={() => {setExpanded(current => !current); focusInput();}}/>
        {value.length > maxLength * .9 && <span className="interaction-count" role="status">{value.length.toLocaleString()} / {maxLength.toLocaleString()}</span>}
        <CxButton type="submit" variant="primary" className="question-send" aria-label="답변 보내기" title="답변 보내기 (⌘/Ctrl+Enter)" disabled={blocked || !value.trim()} busy={busy}><Icon name="arrowUp" size={18}/></CxButton>
      </div>
    </form>}
    {error && !answered && <CxNotice tone="danger">{error}</CxNotice>}
  </InteractionSurface>;
}
