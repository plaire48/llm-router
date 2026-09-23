import {POINTER_THEME} from './generated/browser-pointer-theme.js';

// Static presentation helper. It never dispatches input, focuses a control,
// reads a field value or returns page data to the model.
export function pointerPresentation(input, options) {
  const target = input instanceof Element ? input : null;
  const config = options || input;
  const key = '__nubiActionPointerV1';
  const previous = globalThis[key];
  if (config.operation === 'clear') {if (!config.owner || previous?.owner === config.owner) previous?.dispose(); return;}
  if (config.operation === 'finish') {
    if (previous?.id === config.id) previous.finish(config.failed);
    return;
  }
  if (config.operation !== 'arm' || !/^[a-f0-9-]{36}$/i.test(config.id) || Date.now() > config.until || !document.documentElement) return;
  previous?.dispose();
  const theme = config.theme, abort = new AbortController(), lifetime = new AbortController();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const host = document.createElement('nubi-action-pointer');
  host.setAttribute('aria-hidden', 'true'); host.inert = true;
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;pointer-events:none!important;z-index:2147483647!important;overflow:hidden!important;';
  const root = host.attachShadow({mode: 'closed'});
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host, * { pointer-events: none !important; box-sizing: border-box; }
    .target { position: fixed; border: 1px solid ${theme.blue}99; border-radius: 8px; background: transparent; box-shadow: 0 0 0 2px ${theme.soft}99; }
    .cursor { position: fixed; left: 0; top: 0; width: 24px; height: 28px; }
    .arrow { position: absolute; inset: 0; width: 24px; height: 28px; filter: drop-shadow(0 2px 3px ${theme.ink}40); transform-origin: 3px 2px; }
    :host([data-pressed]) .arrow { transform: scale(.9); }
    .halo { position: absolute; left: -13px; top: -14px; width: 32px; height: 32px; border: 1px solid ${theme.blue}66; border-radius: 50%; background: ${theme.soft}80; opacity: 0; }
    :host([data-phase="hover"]) .halo { opacity: 1; }
    :host([data-phase="drag"][data-pressed]) .halo { opacity: 1; border: 2px dashed ${theme.ink}; background: ${theme.soft}99; }
    .wheel { display: none; position: absolute; left: 17px; top: 16px; width: 18px; height: 26px; padding: 3px; border: 1px solid ${theme.blue}66; border-radius: 9px; background: ${theme.surface}; color: ${theme.ink}; }
    :host([data-phase="scroll"]) .wheel { display: block; }
    .ring { position: fixed; width: 30px; height: 30px; border: 2px solid ${theme.blue}; border-radius: 50%; background: ${theme.soft}66; }
    @media (prefers-reduced-motion: reduce) { .cursor { transition: none !important; } }
    [hidden] { display: none !important; }
  `);
  root.adoptedStyleSheets = [sheet];
  const outline = document.createElement('div'); outline.className = 'target'; outline.hidden = true;
  const svgNode = (name, attributes = {}) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  const cursor = document.createElement('div'); cursor.className = 'cursor'; cursor.style.display = 'none';
  const halo = document.createElement('div'); halo.className = 'halo';
  const arrow = svgNode('svg', {viewBox: '0 0 24 28', class: 'arrow'});
  const defs = svgNode('defs'), gradientId = `pointer-${config.id}`;
  const gradient = svgNode('linearGradient', {id: gradientId, x1: '0', y1: '0', x2: '1', y2: '1'});
  gradient.append(svgNode('stop', {offset: '0', 'stop-color': theme.aqua}), svgNode('stop', {offset: '1', 'stop-color': theme.blue}));
  defs.append(gradient);
  arrow.append(defs, svgNode('path', {d: 'M3 2L21 17L13 18L9 25L3 2Z', fill: `url(#${gradientId})`, stroke: theme.surface, 'stroke-width': '2', 'stroke-linejoin': 'round'}));
  const wheel = svgNode('svg', {viewBox: '0 0 12 20', class: 'wheel'});
  wheel.append(svgNode('path', {d: 'M3 6L6 3L9 6M6 3V17M3 14L6 17L9 14', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
  cursor.append(halo, arrow, wheel);
  const ring = document.createElement('div'); ring.className = 'ring'; ring.hidden = true;
  root.append(outline, ring, cursor); document.documentElement.append(host);
  // Manual, inert popover keeps feedback above page dialogs without stealing
  // focus or changing hit testing. Plain fixed positioning is the fallback.
  try {host.showPopover();} catch {host.removeAttribute('popover');}
  let timer, animation, received = false;
  const dispose = () => {
    clearTimeout(timer); abort.abort(); lifetime.abort(); animation?.cancel(); host.remove();
    if (globalThis[key]?.id === config.id) delete globalThis[key];
  };
  const outlineTarget = () => {
    if (!target?.isConnected) {outline.hidden = true; return;}
    const box = target.getBoundingClientRect();
    const x = Math.max(2, box.left), y = Math.max(2, box.top);
    const width = Math.min(innerWidth - 2, box.right) - x, height = Math.min(innerHeight - 2, box.bottom) - y;
    outline.hidden = width <= 0 || height <= 0;
    Object.assign(outline.style, {left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px`});
  };
  motion.addEventListener('change', () => {
    if (motion.matches) {animation?.cancel(); cursor.style.transition = 'none';}
  }, {signal: lifetime.signal});
  const eventTypes = config.kind === 'input' ? ['input', 'keydown', 'change'] : config.kind === 'scroll' ? ['wheel'] : ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', ...(config.kind === 'drag' ? ['dragover', 'drop', 'dragend'] : [])];
  const show = event => {
    if (!event.isTrusted || !host.isConnected || document.hidden) return;
    // HTML drag-and-drop takes over the pointer stream with pointercancel.
    // Keep tracking dragover/drop; dragend clears a cancelled or finished drag.
    if (event.type === 'pointercancel') {if (config.kind !== 'drag') dispose(); return;}
    if (event.type === 'dragend') {host.removeAttribute('data-pressed'); return;}
    const path = event.composedPath();
    if (target && !path.some(node => node === target || node instanceof Node && target.contains(node) || node instanceof HTMLLabelElement && node.control === target)) return;
    received = true; outlineTarget(); host.dataset.phase = config.kind === 'drag' ? 'drag' : config.kind === 'input' ? 'input' : event.type === 'pointerdown' || event.type === 'pointerup' ? 'click' : config.kind === 'click' ? 'move' : config.kind;
    if (!['pointermove', 'pointerdown', 'pointerup', 'wheel', 'dragover', 'drop'].includes(event.type)) return;
    const {clientX: x, clientY: y} = event;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // Interpolate only between delivered move events, never invent extra
    // browser input. Press/release must point to the exact hit immediately.
    cursor.style.transition = !motion.matches && cursor.style.display === 'block' && event.type === 'pointermove' ? `transform ${theme.travel}ms linear` : 'none';
    cursor.style.display = 'block'; cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
    if (event.type === 'pointerdown') host.setAttribute('data-pressed', '');
    if (event.type === 'pointerup' || event.type === 'drop') host.removeAttribute('data-pressed');
    if (event.type === 'wheel') wheel.style.transform = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? 'rotate(90deg)' : '';
    if (event.type === 'pointerdown') {
      ring.hidden = false; ring.style.left = `${x - 15}px`; ring.style.top = `${y - 15}px`;
      animation?.cancel();
      if (!motion.matches) animation = ring.animate([{transform: 'scale(.6)', opacity: 1}, {transform: 'scale(1.7)', opacity: 0}], {duration: theme.pulse, fill: 'forwards', easing: theme.ease});
    }
  };
  for (const type of eventTypes) document.addEventListener(type, show, {capture: true, passive: true, signal: abort.signal});
  document.addEventListener('visibilitychange', dispose, {once: true, signal: lifetime.signal});
  window.addEventListener('pagehide', dispose, {once: true, signal: lifetime.signal});
  window.addEventListener('scroll', outlineTarget, {capture: true, passive: true, signal: abort.signal});
  globalThis[key] = {id: config.id, owner: config.owner, dispose, finish: failed => {
    abort.abort(); clearTimeout(timer); cursor.style.transition = 'none'; host.removeAttribute('data-pressed');
    if (failed || !received) dispose(); else timer = setTimeout(dispose, theme.pulse + theme.feedback);
  }};
  outlineTarget(); host.dataset.phase = 'target';
  // Covers a lost execution owner or worker restart without permanent UI.
  timer = setTimeout(dispose, 8500);
}

async function settlePresentation(operations) {
  let timer;
  try {await Promise.race([Promise.allSettled(operations), new Promise(resolve => {timer = setTimeout(resolve, 250);})]);}
  finally {clearTimeout(timer);}
}

export async function clearActionPointer(task) {
  const pages = [...task?.pointerPages || []]; task?.pointerPages?.clear();
  await settlePresentation(pages.map(page => Promise.resolve().then(async () => {
    if (!page.isClosed()) await settlePresentation(page.frames().map(frame => Promise.resolve().then(() => frame.evaluate(pointerPresentation, {operation: 'clear', owner: task.id}))));
  })));
}

export async function withActionPointer(task, handle, kind, action, cancelled = () => false) {
  if (cancelled()) throw new Error('cancelled');
  const page = task.page, id = crypto.randomUUID();
  task.pointerPages ||= new Set(); task.pointerPages.add(page);
  let receivers = [];
  try {receivers = handle ? [handle] : page.frames();} catch { /* Presentation is optional. */ }
  const presentation = config => settlePresentation(receivers.map(receiver => Promise.resolve().then(() => receiver.evaluate(pointerPresentation, config))));
  await presentation({operation: 'arm', id, kind, owner: task.id, until: Date.now() + 250, theme: POINTER_THEME});
  let failed = true;
  try {
    if (cancelled()) throw new Error('cancelled');
    const result = await action(); failed = false; return result;
  } finally {
    await presentation({operation: 'finish', id, failed: failed || cancelled()});
  }
}
