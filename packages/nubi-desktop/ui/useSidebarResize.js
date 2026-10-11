import {useLayoutEffect, useRef, useState} from 'react';
import {WORKSPACE_LAYOUT} from '../electron-app/workspace-layout.cjs';

const DEFAULT_WIDTH = WORKSPACE_LAYOUT.projects, MIN_WIDTH = WORKSPACE_LAYOUT.minimumProjects, MAX_WIDTH = 420;
const STORAGE_KEY = 'nubi-workspace-sidebar-width';
const clamp = (width, min, max) => Math.round(Math.max(min, Math.min(max, width)));
function savedWidth(storageKey, minWidth, maxWidth) {
  try {
    const width = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(width) && width > 0) return clamp(width, minWidth, maxWidth);
  } catch { /* Layout preferences do not require storage access. */ }
  return null;
}

// Drag only the sidebar overlay's edge. The conversation keeps its width;
// pointer movement updates the overlay CSS without rerendering the live agent.
export function useSidebarResize(root, {
  hostWidth, railWidth = 0, enabled, side = 'left',
  defaultWidth = DEFAULT_WIDTH, minWidth = MIN_WIDTH, maxWidth = MAX_WIDTH, reservedWidth = 360,
  storageKey = STORAGE_KEY, selector = '.nubi-sidebar', property = '--nubi-sidebar-width',
  resizingAttribute = 'data-sidebar-resizing', label = '사이드바 너비 조절'
}) {
  const [preferredWidth, setPreferredWidth] = useState(() => savedWidth(storageKey, minWidth, maxWidth));
  const drag = useRef(null);
  const max = Math.max(1, Math.min(maxWidth, hostWidth - railWidth - reservedWidth));
  const min = Math.min(minWidth, max);
  const width = clamp(preferredWidth ?? defaultWidth, min, max);
  function apply(value, handle) {
    root.current?.style.setProperty(property, `${value}px`);
    handle?.setAttribute('aria-valuenow', String(value));
    handle?.setAttribute('aria-valuetext', `${value}픽셀`);
  }
  function save(value) {
    setPreferredWidth(value);
    try { localStorage.setItem(storageKey, String(value)); } catch { /* Keep it for this window. */ }
  }
  function finish(commit) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    root.current?.removeAttribute(resizingAttribute);
    apply(commit ? current.width : current.startWidth, current.handle);
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    if (commit) save(current.width);
  }
  useLayoutEffect(() => {
    finish(false);
    apply(width);
    return () => finish(false);
  }, [width, enabled, min, max]);
  return {
    role:'separator', tabIndex:0, 'aria-label':label,
    'aria-orientation':'vertical', 'aria-valuemin':min, 'aria-valuemax':max, 'aria-valuenow':width, 'aria-valuetext':`${width}픽셀`,
    onPointerDown(event) {
      if (!enabled || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      const actual = root.current?.querySelector(selector)?.getBoundingClientRect().width || width;
      event.currentTarget.focus({preventScroll:true});
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {pointerId:event.pointerId,startX:event.clientX,startWidth:actual,width:actual,handle:event.currentTarget};
      root.current?.setAttribute(resizingAttribute, 'true');
    },
    onPointerMove(event) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const movement = (event.clientX - current.startX) * (side === 'right' ? -1 : 1);
      current.width = clamp(current.startWidth + movement, min, max);
      apply(current.width, current.handle);
    },
    onPointerUp(event) { if (drag.current?.pointerId === event.pointerId) finish(true); },
    onPointerCancel(event) { if (drag.current?.pointerId === event.pointerId) finish(false); },
    onLostPointerCapture(event) { if (drag.current?.pointerId === event.pointerId) finish(false); },
    onDoubleClick() {
      if (!enabled) return;
      const value = clamp(defaultWidth, min, max);
      apply(value); setPreferredWidth(null);
      try { localStorage.removeItem(storageKey); } catch { /* Keep it for this window. */ }
    },
    onKeyDown(event) {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); finish(false); return; }
      const step = side === 'right' ? -16 : 16;
      const next = {'ArrowLeft':width - step,'ArrowRight':width + step,'Home':min,'End':max}[event.key];
      if (next === undefined || !enabled) return;
      event.preventDefault();
      const value = clamp(next, min, max);
      apply(value, event.currentTarget); save(value);
    }
  };
}
