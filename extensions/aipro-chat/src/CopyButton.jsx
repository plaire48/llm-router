import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {ActionButton, notifyToast} from '@e2e/cx-design-system';

export function CopyButton({text, getText, label = '복사', successMessage = '복사했습니다.'}) {
  const [status, setStatus] = useState('idle');
  const timer = useRef(null), generation = useRef(0), inFlight = useRef(false), latestStatus = useRef('idle');
  const button = useRef(null), restoreFocus = useRef(false);
  const id = useId(), source = `copy-${id}`, failureId = `${id}-failure`;
  function update(next) {latestStatus.current = next; setStatus(next);}
  useEffect(() => {
    generation.current++; inFlight.current = false; update('idle'); clearTimeout(timer.current);
    return () => {
      generation.current++; clearTimeout(timer.current);
      if (latestStatus.current === 'error') notifyToast('', {source});
    };
  }, [text, source]);
  useLayoutEffect(() => {
    if (status !== 'copied' && status !== 'error') return;
    if (restoreFocus.current && document.activeElement === document.body) button.current?.focus({preventScroll: true});
    restoreFocus.current = false;
  }, [status]);
  async function copy() {
    if (inFlight.current) return;
    inFlight.current = true; clearTimeout(timer.current);
    restoreFocus.current = document.activeElement === button.current;
    const version = ++generation.current;
    update('copying');
    try {
      const value = getText ? await getText() : text;
      if (version !== generation.current) return;
      if (typeof value !== 'string') throw new Error('copy_unavailable');
      await navigator.clipboard.writeText(value);
      if (version !== generation.current) return;
      update('copied'); notifyToast(successMessage, {source});
      timer.current = setTimeout(() => update('idle'), 2000);
    } catch {
      if (version !== generation.current) return;
      update('error'); notifyToast('복사하지 못했습니다. 다시 시도해 주세요.', {error: true, source});
    } finally {if (version === generation.current) inFlight.current = false;}
  }
  return <span className="copy-control" data-copy-state={status}>
    <ActionButton ref={button} action="copy" label={status === 'copied' ? `${label} 완료` : label} title={status === 'copied' ? '복사했습니다.' : status === 'error' ? '복사 다시 시도' : label}
      className={status === 'copied' ? 'copy-complete' : ''} busy={status === 'copying'} success={status === 'copied'} aria-describedby={status === 'error' ? failureId : undefined} onClick={copy}/>
    {status === 'error' && <span id={failureId} className="copy-error">복사 실패. 다시 눌러주세요.</span>}
  </span>;
}
