// Native wheel input, one observed section per model decision. No DOM resizing,
// synthetic scrolling, write replay or scroll-to-bottom loop.
function owner(el, axis) {
  const root = el.ownerDocument.scrollingElement;
  for (let node = el; node && node !== root; node = node.parentElement || node.getRootNode()?.host) {
    const style = getComputedStyle(node);
    if (/auto|scroll/.test(axis === 'y' ? style.overflowY : style.overflowX) &&
        (axis === 'y' ? node.scrollHeight > node.clientHeight + 1 : node.scrollWidth > node.clientWidth + 1)) return node;
  }
  return root;
}
function geometry(el) {
  if (!el?.isConnected) throw new Error('browser_stale');
  const horizontal = Math.max(0, el.scrollWidth - el.clientWidth), rtl = getComputedStyle(el).direction === 'rtl';
  return {top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight,
    maxTop: Math.max(0, el.scrollHeight - el.clientHeight), maxLeft: rtl ? 0 : horizontal, minLeft: rtl ? -horizontal : 0};
}
// Find a point whose nearest scrollable ancestor is exactly this area. A
// centered hover alone can accidentally wheel a smaller nested list instead.
function wheelPoint(el, axis) {
  const parent = node => node.parentElement || node.getRootNode()?.host;
  const root = el.ownerDocument.scrollingElement, box = el.getBoundingClientRect();
  const left = el === root ? 0 : Math.max(0, box.left), top = el === root ? 0 : Math.max(0, box.top);
  const right = el === root ? innerWidth : Math.min(innerWidth, box.right), bottom = el === root ? innerHeight : Math.min(innerHeight, box.bottom);
  for (const rx of [.5, .1, .9, .03, .97]) for (const ry of [.5, .1, .9]) {
    const x = left + (right-left)*rx, y = top + (bottom-top)*ry;
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot?.elementFromPoint) {const child = hit.shadowRoot.elementFromPoint(x, y); if (!child || child === hit) break; hit = child;}
    if (!hit || hit.matches('iframe,frame')) continue;
    let nearest = root;
    for (let node = hit; node && node !== root; node = parent(node)) {
      const style = getComputedStyle(node);
      if (/auto|scroll/.test(axis === 'y' ? style.overflowY : style.overflowX) &&
          (axis === 'y' ? node.scrollHeight > node.clientHeight+1 : node.scrollWidth > node.clientWidth+1)) {nearest = node; break;}
    }
    if (nearest === el) return {x, y, localX: x-box.left-(el.clientLeft || 0), localY: y-box.top-(el.clientTop || 0)};
  }
  return null;
}
export function scrollProgress(before, after, direction, delta) {
  const vertical = ['down', 'up'].includes(direction), key = vertical ? 'top' : 'left', max = vertical ? 'maxTop' : 'maxLeft';
  const forward = ['down', 'right'].includes(direction), moved = Math.abs(after[key]-before[key]) > .5;
  const boundary = forward ? after[key] >= after[max]-1 : after[key] <= (vertical ? 0 : after.minLeft || 0)+1;
  return {before, after, requested: delta, moved, boundary, extentChanged: after[max] !== before[max] || !vertical && after.minLeft !== before.minLeft,
    status: moved ? 'moved' : boundary ? 'boundary' : 'blocked',
    instruction: moved ? 'Inspect the new observation and capture this section if needed. Boundary describes the current rendered extent only; lazy or virtual content may still change it.' : boundary ? 'No further movement in this direction. Inspect whether required content is present. Do not repeat this same scroll; wait/re-observe only when loading is evidenced.' : 'The wheel was issued but this area did not move. Inspect the new observation for an overlay, nested scroller or changed target. Choose a fresh appropriate ref; do not repeat this unchanged scroll.'};
}
export async function scrollBrowserSection(page, {handle, direction, cancelled = () => false, onIssued = () => {}}) {
  if (!['down', 'up', 'left', 'right'].includes(direction)) throw new Error('tool_arguments_invalid');
  const axis = ['down', 'up'].includes(direction) ? 'y' : 'x', forward = ['down', 'right'].includes(direction);
  const url = page.url(); let area;
  const check = () => {if (cancelled()) throw new Error('cancelled'); if (page.url() !== url) throw new Error('browser_stale');};
  try {
    check();
    area = handle ? (await handle.evaluateHandle(owner, axis)).asElement() : (await page.evaluateHandle(() => document.scrollingElement)).asElement();
    if (!area) throw new Error('browser_stale');
    if (handle) await area.scrollIntoViewIfNeeded({timeout: 2000});
    check();
    const before = await area.evaluate(geometry), max = axis === 'y' ? 'maxTop' : 'maxLeft', key = axis === 'y' ? 'top' : 'left';
    // No wheel at a known boundary: avoid scroll chaining into a parent area.
    const min = axis === 'x' ? before.minLeft : 0;
    if (forward ? before[key] >= before[max]-1 : before[key] <= min+1) return scrollProgress(before, before, direction, 0);
    const point = await area.evaluate(wheelPoint, axis);
    if (!point) throw new Error('scroll_target_required');
    if (handle) await area.hover({position: {x: point.localX, y: point.localY}, timeout: 2000});
    else await page.mouse.move(point.x, point.y);
    check();
    if (JSON.stringify(await area.evaluate(geometry)) !== JSON.stringify(before)) throw new Error('browser_stale');
    const box = await area.boundingBox(), viewport = await page.evaluate(() => ({width: innerWidth, height: innerHeight}));
    const visibleSize = !handle ? viewport[axis === 'y' ? 'height' : 'width'] : !box ? 0 : axis === 'y'
      ? Math.max(0, Math.min(viewport.height, box.y+box.height)-Math.max(0,box.y))
      : Math.max(0, Math.min(viewport.width, box.x+box.width)-Math.max(0,box.x));
    if (visibleSize < 2) throw new Error('scroll_target_required');
    const size = Math.min(axis === 'y' ? before.height : before.width, visibleSize);
    const distance = Math.min(Math.max(1, Math.floor(size * .75)), forward ? before[max]-before[key] : before[key]-min);
    const delta = (forward ? 1 : -1) * distance;
    check();
    const confirmed = await area.evaluate(wheelPoint, axis);
    if (!confirmed || Math.abs(confirmed.x-point.x) > .5 || Math.abs(confirmed.y-point.y) > .5) throw new Error('browser_stale');
    check();
    onIssued(); await page.mouse.wheel(axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
    let after = before, stable = 0;
    const until = Date.now() + 1200;
    while (Date.now() < until) {
      check(); await new Promise(resolve => setTimeout(resolve, 60)); check();
      const next = await area.evaluate(geometry);
      stable = JSON.stringify(after) === JSON.stringify(next) ? stable+1 : 0; after = next;
      if (stable >= 3 && Math.abs(after[key]-before[key]) > .5) break;
    }
    check();
    return scrollProgress(before, after, direction, delta);
  } finally {await area?.dispose().catch(() => {});}
}
