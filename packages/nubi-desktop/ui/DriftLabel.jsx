import React, {useLayoutEffect, useRef} from 'react';

// Every clipped name uses the same physical speed, regardless of text length.
const PIXELS_PER_SECOND = 48;
export function DriftLabel({as: Element = 'span', className = '', children, ...props}) {
  const root = useRef(null), viewport = useRef(null), text = useRef(null);
  useLayoutEffect(() => {
    const node = root.current, frame = viewport.current, label = text.current;
    if (!node || !frame || !label) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation, hovering = false, focused = false;
    const stop = () => { animation?.cancel(); animation = null; delete node.dataset.drifting; };
    const start = () => {
      stop();
      if ((!hovering && !focused) || motion.matches || !label.animate) return;
      const width = label.scrollWidth, space = frame.clientWidth;
      if (!space || width <= space + 1) return;
      node.dataset.drifting = "true";
      const exit = width / (width + space);
      // Start at the resting position. Reset only when both positions are
      // outside the clipped viewport, then enter from its right edge.
      animation = label.animate([
        {transform:'translateX(0)', offset:0},
        {transform:`translateX(${-width}px)`, offset:exit},
        {transform:`translateX(${space}px)`, offset:Math.min(1, exit + .000001)},
        {transform:'translateX(0)', offset:1}
      ], {duration:(width + space) / PIXELS_PER_SECOND * 1000, iterations:Infinity, easing:'linear'});
      if (document.hidden) animation.pause();
    };
    const enter = () => { hovering = true; start(); };
    const leave = () => { hovering = false; if (!focused) stop(); };
    const focus = () => { focused = true; start(); };
    const blur = event => { if (!node.contains(event.relatedTarget)) { focused = false; if (!hovering) stop(); } };
    const visibility = () => { if (document.hidden) animation?.pause(); else animation?.play(); };
    const target = node.closest('button, a') || node;
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', leave);
    target.addEventListener('focusin', focus);
    target.addEventListener('focusout', blur);
    motion.addEventListener('change', start);
    document.addEventListener('visibilitychange', visibility);
    const observer = new ResizeObserver(start);
    observer.observe(frame); observer.observe(label);
    return () => {
      stop(); observer.disconnect();
      target.removeEventListener('pointerenter', enter); target.removeEventListener('pointerleave', leave);
      target.removeEventListener('focusin', focus); target.removeEventListener('focusout', blur);
      motion.removeEventListener('change', start); document.removeEventListener('visibilitychange', visibility);
    };
  }, [children]);
  return <Element {...props} className={`nubi-drift-label ${className}`} ref={root}><span className="nubi-drift-window" ref={viewport}><span className="nubi-drift-text" ref={text}>{children}</span></span></Element>;
}
