import React, {useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';

// Adapt E2E Report's single-notice store and shared countdown clock. Desktop
// keeps the user's two-second duration and Nubi identity without a dependency.
let current = null, sequence = 0;
const listeners = new Set();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => current;
const emit = () => listeners.forEach(listener => listener());
export function notifyWorkspaceToast(message, {error = false, success = false} = {}) {
  const text = String(message || '').trim();
  if (!text) return;
  current = {id: ++sequence, message: text, error, success};
  emit();
}

export function WorkspaceToast() {
  const item = useSyncExternalStore(subscribe, snapshot, () => null);
  const [portalTarget, setPortalTarget] = useState(document.body);
  const [focused, setFocused] = useState(false), [hidden, setHidden] = useState(document.hidden);
  const region = useRef(null), previousFocus = useRef(null), progress = useRef(null), tip = useRef(null);
  const clock = useRef({id: null, elapsed: 0});
  const paused = focused || hidden;
  useLayoutEffect(() => {
    // CX makes other body children inert while a modal is active. Keep feedback
    // inside the top modal so its live region remains available there.
    const update = () => {
      const dialogs = [...document.querySelectorAll('[aria-modal="true"]')];
      const target = dialogs.reverse().find(node => node.isConnected && !node.closest('[inert],[hidden],[aria-hidden="true"]')) || document.body;
      setPortalTarget(currentTarget => currentTarget === target ? currentTarget : target);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['aria-modal','hidden','aria-hidden','inert']});
    update();
    return () => observer.disconnect();
  }, []);
  const dismiss = useCallback(() => {
    if (current?.id !== item?.id) return;
    const restore = region.current?.contains(document.activeElement);
    current = null; emit(); setFocused(false);
    if (restore) requestAnimationFrame(() => {
      if (previousFocus.current?.isConnected && !previousFocus.current.closest('[inert]')) previousFocus.current.focus({preventScroll: true});
    });
  }, [item?.id]);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useLayoutEffect(() => {
    setFocused(Boolean(region.current?.contains(document.activeElement) && document.activeElement.matches(':focus-visible')));
  }, [item?.id]);
  useLayoutEffect(() => {
    if (!item) return;
    if (clock.current.id !== item.id) clock.current = {id: item.id, elapsed: 0};
    const countdown = clock.current, started = performance.now(), duration = 2000, fillDuration = 1900;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const paint = elapsed => {
      const fraction = Math.min(fillDuration, elapsed) / fillDuration;
      progress.current?.setAttribute('stroke-dashoffset', String(100 * (1 - (reduced ? Math.floor(fraction * 3) / 3 : fraction))));
      tip.current?.setAttribute('transform', `rotate(${360 * fraction} 16 16)`);
      tip.current?.setAttribute('opacity', !reduced && fraction < 1 ? '1' : '0');
    };
    paint(countdown.elapsed);
    if (paused) return;
    let frame;
    const tick = () => {
      const elapsed = Math.min(duration, countdown.elapsed + performance.now() - started);
      paint(elapsed);
      if (elapsed >= duration) { dismiss(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); countdown.elapsed = Math.min(duration, countdown.elapsed + performance.now() - started); };
  }, [item?.id, paused, dismiss, portalTarget]);
  if (!item) return null;
  return createPortal(<div ref={region} className="nubi-feedback-region" aria-label="알림"
    onPointerDownCapture={() => setFocused(false)}
    onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget; setFocused(event.target.matches(':focus-visible')); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDownCapture={() => setFocused(true)}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
    <div className="nubi-feedback-toast" data-error={item.error} key={item.id}>
      <div className="nubi-feedback-message" role={item.error ? 'alert' : 'status'} aria-atomic="true">
        <svg className="nubi-feedback-icon" aria-hidden="true" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle className="nubi-feedback-track" cx="16" cy="16" r="13"/>
          <circle ref={progress} className="nubi-feedback-countdown" cx="16" cy="16" r="13" pathLength="100" strokeDasharray="100" strokeDashoffset="100" transform="rotate(-90 16 16)"/>
          <circle ref={tip} className="nubi-feedback-tip" cx="16" cy="3" r="2.5"/>
          {item.error ? <><path d="M16 10v8"/><circle cx="16" cy="22" r="1" fill="currentColor" stroke="none"/></> : item.success ? <path d="m10 16 4 4 8-9"/> : <><path d="M16 16v6"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/></>}
        </svg>
        <span>{item.message}</span>
      </div>
    </div>
  </div>, portalTarget);
}
