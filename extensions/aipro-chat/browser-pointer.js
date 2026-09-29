import {POINTER_THEME} from './generated/browser-pointer-theme.js';

// Static presentation helper. It never dispatches input, focuses a control,
// reads a field value or returns page data to the model.
export function pointerPresentation(input, options) {
  try {
  let target = input instanceof Element ? input : null;
  let config = options || input;
  const key = '__nubiActionPointerV1';
  const previous = globalThis[key];
  if (config.operation === 'settle') return previous?.owner === config.owner ? previous.settle() : undefined;
  if (config.operation === 'idle' && previous?.owner === config.owner && previous.connected()) {previous.touch(); return;}
  if (config.operation === 'clear') {if (!config.owner || previous?.owner === config.owner) previous?.dispose(); return;}
  if (config.operation === 'touch') {if (previous?.owner === config.owner) previous.touch(); return;}
  if (config.operation === 'park') {if (previous?.owner === config.owner && previous.id !== config.keepId) previous.park(); return;}
  if (config.operation === 'finish') {
    if (previous?.id === config.id) previous.finish(config.failed);
    return;
  }
  if (!['arm', 'idle'].includes(config.operation) || !/^[a-f0-9-]{36}$/i.test(config.id) || Date.now() > config.until || !document.documentElement) return;
  if (previous?.owner === config.owner && previous.connected()) {previous.arm(target, config); return;}
  previous?.dispose();
  const theme = config.theme, lifetime = new AbortController();
  let abort = new AbortController();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const host = document.createElement('nubi-action-pointer');
  host.setAttribute('aria-hidden', 'true'); host.inert = true;
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'all:initial;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;pointer-events:none!important;z-index:2147483647!important;overflow:hidden!important;';
  const root = host.attachShadow({mode: 'closed'});
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host, * { pointer-events: none !important; box-sizing: border-box; }
    .target { position: fixed; border: 1px solid ${theme.blue}99; border-radius: 8px; background: transparent; box-shadow: 0 0 0 2px ${theme.soft}99; }
    .cursor { position: fixed; left: 0; top: 0; width: 24px; height: 28px; }
    .shape { position: absolute; inset: 0; width: 24px; height: 28px; filter: drop-shadow(0 1px 2px ${theme.cursorInk}30); transform-origin: var(--hotspot-x, 3px) var(--hotspot-y, 2px); }
    :host([data-pressed]) .shape { transform: scale(.94); }
    .halo { position: absolute; left: -13px; top: -14px; width: 32px; height: 32px; border: 1px solid ${theme.blue}66; border-radius: 50%; background: ${theme.soft}80; opacity: 0; }
    :host([data-phase="drag"][data-pressed]) .halo { opacity: 1; border: 2px dashed ${theme.ink}; background: ${theme.soft}99; }
    .wheel { display: none; position: absolute; left: 17px; top: 16px; width: 18px; height: 26px; padding: 3px; border: 1px solid ${theme.blue}66; border-radius: 9px; background: ${theme.surface}; color: ${theme.ink}; }
    :host([data-phase="scroll"]) .wheel { display: block; }
    .ring { position: fixed; width: 24px; height: 24px; border: 1.5px solid ${theme.blue}; border-radius: 50%; background: ${theme.soft}66; }
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
  const cursor = document.createElement('div'); cursor.className = 'cursor'; cursor.style.display = 'block';
  // Resting position before the first action, not a claimed browser input.
  cursor.style.transform = `translate(${Math.max(3, innerWidth - 40)}px, ${Math.max(2, innerHeight - 48)}px)`;
  const halo = document.createElement('div'); halo.className = 'halo';
  const arrow = svgNode('svg', {viewBox: '0 0 24 28', class: 'shape arrow'});
  // An independently drawn compact pointer. Its tip stays at (3, 2),
  // the actual browser input hotspot. No page or OS cursor is replaced.
  const arrowPath = 'M3 2Q2 1.7 2.4 3L8.7 22Q9.3 24 10.5 22.2L14 15.7L21 12.3Q23.2 11.3 21 10.4L4 2.2Q3.4 2 3 2Z';
  const paintShape = (svg, d, fill = theme.cursorInk) => {
    // Dark outer edge keeps the white outline readable on a white page.
    for (const [stroke, width] of [[theme.cursorInk, 3.5], [theme.surface, 2.5]]) {
      svg.append(svgNode('path', {d, fill, stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
    }
  };
  paintShape(arrow, arrowPath);
  const shapes = {arrow};
  const addShape = (name, path, fill) => {
    const shape = svgNode('svg', {viewBox:'0 0 24 28', class:`shape ${name}`});
    paintShape(shape, path, fill); shape.style.display = 'none'; shapes[name] = shape;
  };
  addShape('pointer', 'M8 14V4C8 1 12 1 12 4V10Q14 8 16 11Q18 9 20 12V19Q20 24 16 24H11Q9 24 7 21L3 16Q1 13 4 12L8 15Z');
  addShape('text', 'M8 4H16M12 4V24M8 24H16', 'none');
  // Add the dark inner stroke to preserve the I-beam against bright pages.
  shapes.text.append(svgNode('path', {d:'M8 4H16M12 4V24M8 24H16', fill:'none', stroke:theme.cursorInk, 'stroke-width':'1.5', 'stroke-linecap':'round'}));
  addShape('grab', 'M6 14V7Q6 4 9 5V4Q11 1 13 4V6Q16 3 17 7V9Q20 6 21 10V18Q21 24 16 25H11Q8 24 6 21L2 16Q0 13 3 12Z');
  addShape('grabbing', 'M5 15V11Q5 8 8 9Q9 6 12 9Q14 6 17 9Q20 8 21 12V18Q21 24 16 25H11Q8 24 6 21L3 17Q1 14 4 13Z');
  addShape('blocked', 'M12 5A9 9 0 1 0 12 23A9 9 0 1 0 12 5M6 8L18 20', 'none');
  shapes.blocked.append(svgNode('path', {d:'M12 5A9 9 0 1 0 12 23A9 9 0 1 0 12 5M6 8L18 20', fill:'none', stroke:theme.cursorInk, 'stroke-width':'1.5'}));
  const wheel = svgNode('svg', {viewBox: '0 0 12 20', class: 'wheel'});
  wheel.append(svgNode('path', {d: 'M3 6L6 3L9 6M6 3V17M3 14L6 17L9 14', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
  cursor.append(halo, ...Object.values(shapes), wheel);
  const ring = document.createElement('div'); ring.className = 'ring'; ring.hidden = true;
  root.append(outline, ring, cursor); document.documentElement.append(host);
  // Manual, inert popover keeps feedback above page dialogs without stealing
  // focus or changing hit testing. Plain fixed positioning is the fallback.
  try {host.showPopover();} catch {host.removeAttribute('popover');}
  let timer, pulseTimer, animation, movedAt = 0, parked = false;
  const dispose = () => {
    clearTimeout(timer); clearTimeout(pulseTimer); abort.abort(); lifetime.abort(); animation?.cancel(); host.remove();
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
  const cursorShape = path => {
    const element = path.find(node => node instanceof Element);
    if (!element) return 'arrow';
    // Read only the native cursor keyword. Never load a site's cursor URL or
    // use visual state as permission, actionability or completion evidence.
    const keyword = getComputedStyle(element).cursor.split(',').at(-1).trim();
    if (['not-allowed', 'no-drop'].includes(keyword) || path.some(node => node instanceof Element && node.matches(':disabled, [aria-disabled="true"]'))) return 'blocked';
    if (config.kind === 'drag') return host.hasAttribute('data-pressed') ? 'grabbing' : 'grab';
    if (['pointer', 'text', 'grab', 'grabbing'].includes(keyword)) return keyword;
    if (!['auto', 'default'].includes(keyword)) return 'arrow';
    if (element.isContentEditable || element.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], input[type="tel"], input[type="number"]')) return 'text';
    if (path.some(node => node instanceof Element && node.matches('a[href], button, [role="button"], [role="link"], summary'))) return 'pointer';
    return 'arrow';
  };
  const show = event => {
    if (!event.isTrusted || !host.isConnected || document.hidden) return;
    // HTML drag-and-drop takes over the pointer stream with pointercancel.
    // Keep tracking dragover/drop; dragend clears a cancelled or finished drag.
    if (event.type === 'pointercancel') {if (config.kind !== 'drag') host.removeAttribute('data-pressed'); return;}
    if (event.type === 'dragend') {host.removeAttribute('data-pressed'); host.dataset.phase = 'idle'; return;}
    const path = event.composedPath();
    if (target && !path.some(node => node === target || node instanceof Node && target.contains(node) || node instanceof HTMLLabelElement && node.control === target)) return;
    parked = false; host.style.visibility = 'visible'; outlineTarget(); host.dataset.phase = config.kind === 'drag' ? 'drag' : config.kind === 'input' ? 'input' : event.type === 'pointerdown' || event.type === 'pointerup' ? 'click' : config.kind === 'click' ? 'move' : config.kind;
    const inputBox = config.kind === 'input' && target?.isConnected ? target.getBoundingClientRect() : null;
    const x = inputBox ? Math.max(2, Math.min(innerWidth - 2, inputBox.left + inputBox.width / 2)) : event.clientX;
    const y = inputBox ? Math.max(2, Math.min(innerHeight - 2, inputBox.top + inputBox.height / 2)) : event.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // Interpolate only between delivered move events, never invent extra
    // browser input. Press/release must point to the exact hit immediately.
    if (event.type === 'pointerdown') host.setAttribute('data-pressed', '');
    if (event.type === 'pointerup' || event.type === 'drop') host.removeAttribute('data-pressed');
    const shape = cursorShape(path);
    const [hotX, hotY] = shape === 'arrow' ? [3, 2] : shape === 'pointer' ? [10, 2] : [12, 14];
    host.dataset.cursor = shape;
    for (const [name, node] of Object.entries(shapes)) node.style.display = name === shape ? 'block' : 'none';
    cursor.style.setProperty('--hotspot-x', `${hotX}px`); cursor.style.setProperty('--hotspot-y', `${hotY}px`);
    halo.style.left = `${hotX - 16}px`; halo.style.top = `${hotY - 16}px`;
    const moving = event.type === 'pointermove' || !!inputBox;
    cursor.style.transition = !motion.matches && moving ? `transform ${theme.travel}ms ${theme.ease}` : 'none';
    if (moving) movedAt = Date.now();
    cursor.style.display = 'block'; cursor.style.transform = `translate(${x - hotX}px, ${y - hotY}px)`;
    if (event.type === 'wheel') wheel.style.transform = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? 'rotate(90deg)' : '';
    if (event.type === 'pointerdown') {
      ring.hidden = false; ring.style.left = `${x - 12}px`; ring.style.top = `${y - 12}px`;
      animation?.cancel();
      if (!motion.matches) animation = ring.animate([{transform: 'scale(.7)', opacity: 1}, {transform: 'scale(1.35)', opacity: 0}], {duration: theme.pulse, fill: 'forwards', easing: theme.ease});
      clearTimeout(pulseTimer); pulseTimer = setTimeout(() => {ring.hidden = true; animation?.cancel();}, theme.pulse);
    }
  };
  const touch = () => {clearTimeout(timer); timer = setTimeout(dispose, 30000);};
  const park = () => {abort.abort(); parked = true; outline.hidden = true; ring.hidden = true; host.style.visibility = 'hidden';};
  const arm = (nextTarget, next) => {
    abort.abort(); abort = new AbortController(); target = nextTarget; config = next;
    parked = !nextTarget && parked; animation?.cancel(); clearTimeout(pulseTimer); ring.hidden = true;
    host.removeAttribute('data-pressed'); host.style.visibility = document.hidden || parked ? 'hidden' : 'visible';
    const types = config.operation === 'idle' ? [] : config.kind === 'input' ? ['input', 'keydown', 'change'] : config.kind === 'scroll' ? ['wheel'] : ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', ...(config.kind === 'drag' ? ['dragover', 'drop', 'dragend'] : [])];
    for (const type of types) document.addEventListener(type, show, {capture: true, passive: true, signal: abort.signal});
    window.addEventListener('scroll', outlineTarget, {capture: true, passive: true, signal: abort.signal});
    globalThis[key].id = config.id;
    // Re-enter the top layer in the same synchronous turn so a newly opened
    // dialog cannot cover the retained marker. No DOM replacement or focus.
    try {if (host.matches(':popover-open')) host.hidePopover(); host.showPopover();} catch { /* Fixed fallback remains usable. */ }
    outlineTarget(); host.dataset.phase = config.operation === 'idle' ? 'idle' : 'target'; touch();
  };
  document.addEventListener('visibilitychange', () => {
    host.style.visibility = document.hidden || parked ? 'hidden' : 'visible';
  }, {signal: lifetime.signal});
  window.addEventListener('pagehide', dispose, {once: true, signal: lifetime.signal});
  globalThis[key] = {id: config.id, owner: config.owner, dispose, arm, park, touch, connected: () => host.isConnected,
    settle: () => new Promise(resolve => setTimeout(resolve, motion.matches ? 0 : Math.max(0, theme.travel - (Date.now() - movedAt)))), finish: () => {
    // Keep the last delivered position through model/read waits. Idle listeners
    // are removed so ordinary user input never animates the agent marker.
    abort.abort(); host.removeAttribute('data-pressed');
    outline.hidden = true;
    host.dataset.phase = 'idle'; touch();
  }};
  arm(target, config);
  } catch { /* An unavailable visual layer must not surface as a page/action error. */ }
}

async function settlePresentation(operations) {
  let timer;
  try {await Promise.race([Promise.allSettled(operations), new Promise(resolve => {timer = setTimeout(resolve, 250);})]);}
  finally {clearTimeout(timer);}
}

// Read-only tasks must not attach the debugger just to show a cursor. The same
// MAIN-world presentation is reused by Playwright once real input is needed.
export async function keepActionPointer(task, allowedURL, cancelled = () => false) {
  if (!globalThis.chrome?.scripting || cancelled()) return;
  task.pointerStopped = false;
  task.pointerTabIds ||= new Set(); task.pointerTabIds.add(task.tabId);
  const renew = async () => {
    const tabId = task.tabId;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (task.pointerStopped || cancelled() || !tab || !allowedURL(tab.url) ||
      task.workspace && (tab.windowId !== task.workspace.windowId || !task.workspace.tabIds.includes(tabId))) return;
    await chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'MAIN', func: pointerPresentation,
      args: [{operation: 'touch', owner: task.id}]});
    if (task.pointerStopped || cancelled() || task.tabId !== tabId) return;
    await chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, world: 'MAIN', func: pointerPresentation,
      args: [{operation: 'idle', id: crypto.randomUUID(), owner: task.id, until: Date.now() + 250, theme: POINTER_THEME}]});
  };
  if (!task.pointerNavigation) {
    task.pointerNavigation = (tabId, change) => {
      if (tabId === task.tabId && change.status === 'complete') void settlePresentation([renew()]);
    };
    chrome.tabs.onUpdated.addListener(task.pointerNavigation);
    task.pointerHeartbeat = setInterval(() => {void settlePresentation([renew()]);}, 10000);
    task.pointerHeartbeat.unref?.();
  }
  await settlePresentation([renew()]);
}

export async function settlePointerTravel(task, handle) {
  await settlePresentation([Promise.resolve().then(() => handle.evaluate(pointerPresentation, {operation: 'settle', owner: task.id}))]);
}

export async function clearActionPointer(task) {
  if (task) task.pointerStopped = true;
  if (task?.pointerNavigation) chrome.tabs.onUpdated.removeListener(task.pointerNavigation);
  if (task) task.pointerNavigation = null;
  clearInterval(task?.pointerHeartbeat); if (task) task.pointerHeartbeat = null;
  const pages = [...task?.pointerPages || []]; task?.pointerPages?.clear();
  const tabs = [...task?.pointerTabIds || []]; task?.pointerTabIds?.clear();
  await settlePresentation([...tabs.map(tabId => Promise.resolve().then(() => chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'MAIN', func: pointerPresentation, args: [{operation: 'clear', owner: task.id}]}))), ...pages.map(page => Promise.resolve().then(async () => {
    if (!page.isClosed()) await settlePresentation(page.frames().map(frame => Promise.resolve().then(() => frame.evaluate(pointerPresentation, {operation: 'clear', owner: task.id}))));
  }))]);
}

export async function withActionPointer(task, handle, kind, action, cancelled = () => false) {
  if (cancelled()) throw new Error('cancelled');
  const page = task.page, id = crypto.randomUUID();
  task.pointerPages ||= new Set(); task.pointerPages.add(page);
  let receivers = [];
  try {receivers = handle ? [handle] : page.frames();} catch { /* Presentation is optional. */ }
  const presentation = config => settlePresentation(receivers.map(receiver => Promise.resolve().then(() => receiver.evaluate(pointerPresentation, config))));
  await presentation({operation: 'arm', id, kind, owner: task.id, until: Date.now() + 250, theme: POINTER_THEME});
  // Only the targeted frame keeps its marker; re-arming the same frame never
  // removes its DOM or last cursor position.
  if (handle && typeof page.frames === 'function') await settlePresentation(page.frames().map(frame => Promise.resolve().then(() => frame.evaluate(pointerPresentation, {operation:'park', owner:task.id, keepId:id}))));
  if (!task.pointerHeartbeat && task.id && typeof page.frames === 'function') {
    task.pointerHeartbeat = setInterval(() => {
      void settlePresentation([...task.pointerPages].flatMap(current => {
        try {return current.isClosed() ? [] : current.frames().map(frame => Promise.resolve().then(() => frame.evaluate(pointerPresentation, {operation:'touch', owner:task.id})));}
        catch {return [];}
      }));
    }, 10000);
    task.pointerHeartbeat.unref?.();
  }
  let failed = true;
  try {
    if (cancelled()) throw new Error('cancelled');
    const result = await action(); failed = false; return result;
  } finally {
    await presentation({operation: 'finish', id, failed: failed || cancelled()});
    if (typeof page.frames === 'function') await settlePresentation(page.frames().map(frame => Promise.resolve().then(() => frame.evaluate(pointerPresentation, {operation:'finish', id, failed:failed || cancelled()}))));
  }
}
