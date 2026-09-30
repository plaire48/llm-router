import React, {useLayoutEffect, useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {NubiComposerInput, NubiComposerBar} from '../../../extensions/aipro-chat/src/NubiSurfaces.jsx';

// Keep the shared Nubi composer and reserve its leading action for long requests.
// onStop: while a task runs the send button is the stop symbol, as in the browser agent (user decision 2026-09-30).
export function WorkspaceComposer({className = '', inputRef, id = 'message-input', value, onSubmit, sendDisabled, modelControl, onStop, ...inputProps}) {
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    const measure = () => {
      const more = field.scrollHeight > 181;
      setHasMore(current => current === more ? current : more);
      if (!more) setExpanded(false);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(field);
    window.addEventListener('resize', measure);
    return () => {observer?.disconnect(); window.removeEventListener('resize', measure);};
  }, [inputRef, value, expanded]);
  return <form className={`composer ${className}`} onSubmit={onSubmit}>
    <div className="nubi-composer-input" data-expanded={expanded}>
      <NubiComposerInput inputRef={inputRef} id={id} value={value} title="" {...inputProps}/>
    </div>
    <NubiComposerBar leading={<>{modelControl}{hasMore && <CxButton type="button" className="nubi-composer-more" aria-expanded={expanded} aria-controls={id} onClick={() => {
      setExpanded(current => !current);
      requestAnimationFrame(() => inputRef.current?.focus());
    }}>{expanded ? '접기' : '더 보기'}</CxButton>}</>} tools={onStop ? <CxButton type="button" className="nubi-composer-stop" aria-label="중지" title="작업 중지" onClick={onStop}><span className="stop-symbol" aria-hidden="true"/></CxButton> : <CxButton type="submit" variant="primary" aria-label="전송" title="전송" disabled={sendDisabled}><Icon name="arrowUp" size={20}/></CxButton>}/>
  </form>;
}
