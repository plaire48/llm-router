import React, {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton, Icon} from '@e2e/cx-design-system';

// Custom CX glyphs retain the same named action and keyboard hint everywhere.
export function WorkspaceIconAction({icon, label, title = label, visibleLabel=label, indicator, iconOnly=['panelLeft','panelLeftClose','sliders','search','xClose','refresh'].includes(icon), ref: forwardedRef, className = '', onFocus, onBlur, onPointerDown, ...props}) {
  const anchor = useRef(null), id = useId(), [hint, setHint] = useState(null);
  useEffect(() => {
    if (!hint) return;
    const hide = () => setHint(null);
    window.addEventListener('resize', hide);
    document.addEventListener('scroll', hide, true);
    return () => {window.removeEventListener('resize', hide); document.removeEventListener('scroll', hide, true);};
  }, [hint]);
  useEffect(() => {if (props.disabled) setHint(null);}, [props.disabled]);
  return <><CxButton {...props} ref={node => {anchor.current = node; if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node;}}
    className={`nubi-icon-button ${className}`.trim()} data-icon-only={iconOnly||undefined} aria-label={label} title={title}
    aria-describedby={[props['aria-describedby'], hint ? id : null].filter(Boolean).join(' ') || undefined}
    onFocus={event => {if (event.currentTarget.matches(':focus-visible')) {const box = anchor.current.getBoundingClientRect(); setHint({left:Math.max(8, Math.min(box.left, innerWidth - 192)), top:box.bottom + 44 <= innerHeight ? box.bottom + 8 : Math.max(8, box.top - 36)});} onFocus?.(event);}}
    onBlur={event => {setHint(null); onBlur?.(event);}}
    onPointerDown={event => {setHint(null); onPointerDown?.(event);}}><Icon name={icon} size={18}/>{indicator}{!iconOnly&&<span className="nubi-action-label">{visibleLabel}</span>}</CxButton>
    {hint && createPortal(<span className="nubi-keyboard-hint" id={id} role="tooltip" style={hint}>{title}</span>, anchor.current.closest('.cx-panel-backdrop') || document.body)}
  </>;
}
