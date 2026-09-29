// This module is bundled inside static, serializable functions at build time.
// No page/model-provided JavaScript is evaluated by the observer.
import {computeAccessibleName, getRole} from 'dom-accessibility-api';
import {paginationView} from './browser-pagination.js';
import {publicSourceURL} from './browser-public-url.js';
import {rankEvidence, evidenceExcerpt} from './evidence-search.js';
import {describeControl, inViewport, pageInformation, scrollGeometry} from './browser-information.js';

const clean = (value, limit = 180) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
const parent = el => el.parentElement || el.getRootNode()?.host;
const controls = 'button,input,textarea,select,a[href],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="tab"],[role="option"],[role="combobox"],[aria-checked],[aria-pressed],[aria-expanded],[tabindex],summary';
const handlers = '[onclick],[onmousedown],[onpointerup],[onpointerdown],[ondragover],[ondrop]';
const hoverHandlers = '[onmouseenter],[onmouseover],[onpointerenter],[onpointerover]';
function activation(el) {
  if (el.matches(controls)) return 'semantic';
  if (el.matches('html,body,iframe,label') || el.isContentEditable) return null;
  if (el.matches('[draggable="true"]')) return 'drag';
  if (el.matches(handlers)) return 'handler';
  if (el.matches(hoverHandlers) || el.hasAttribute('aria-haspopup')) return 'hover';
  // Cursor inheritance must not create a ref for every label inside a card.
  // This is a candidate signal, never proof that the requested action ran.
  const owner = parent(el);
  if (getComputedStyle(el).cursor === 'grab' && (!owner || getComputedStyle(owner).cursor !== 'grab')) return 'drag';
  if (getComputedStyle(el).cursor === 'pointer' && (!owner || getComputedStyle(owner).cursor !== 'pointer') && !el.closest(`${controls},${handlers}`)) return 'pointer';
  return null;
}
export function clickTarget(el) {
  if (el.matches('input[type="checkbox"],input[type="radio"]')) {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (!el.getClientRects().length || rect.width < 2 || rect.height < 2 || style.opacity === '0' || style.pointerEvents === 'none') {
      const label = [...el.labels || []].find(node => {
        const box = node.getBoundingClientRect();
        return node.control === el && box.width > 2 && box.height > 2 && !node.closest('[hidden],[inert],[aria-hidden="true"]') && getComputedStyle(node).visibility !== 'hidden';
      });
      if (label) return label;
    }
  }
  if (el.getClientRects().length) return el;
  if (getComputedStyle(el).display !== 'contents') return el;
  // A display:contents link has no box. Click one visible non-interactive
  // descendant belonging to this exact link; never force or run el.click().
  return [...el.querySelectorAll('*')].slice(0, 200).find(child => {
    const rect = child.getBoundingClientRect();
    if (!rect.width || !rect.height || child.closest('[hidden],[inert],[aria-hidden="true"]') || getComputedStyle(child).visibility === 'hidden') return false;
    for (let node = child; node && node !== el; node = parent(node)) if (node.matches(`${controls},${handlers}`)) return false;
    return true;
  }) || el;
}
// What a pointer at (x, y) would press: the nearest control or handler around
// the element hit there. A label of the target is reported as that label.
function hitAt(el, hitRoot, x, y) {
  let hit = hitRoot.elementFromPoint(x, y);
  while (hit?.shadowRoot?.elementFromPoint) {
    const child = hit.shadowRoot.elementFromPoint(x, y);
    if (!child || child === hit) break;
    hit = child;
  }
  let node = hit;
  while (node && node !== el && !node.matches?.(`${controls},${handlers}`) && !(node.localName === 'label' && node.control === el)) node = parent(node);
  return {hit, owner: node || null};
}
// Points of each visible box of the target (or of `near`), middle first. The
// points near the ends reach the sender of a mail row when tools shown on hover
// cover its middle.
function* pointSamples(el, near = el) {
  const root = el.getRootNode(), hitRoot = typeof root.elementFromPoint === 'function' ? root : el.ownerDocument;
  for (const rect of [...near.getClientRects()].slice(0, 32)) {
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    if (right - left < 2 || bottom - top < 2) continue;
    for (const [rx, ry] of [[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.1,.5],[.9,.5]]) {
      const x = left + (right-left)*rx, y = top + (bottom-top)*ry;
      yield {x, y, ...hitAt(el, hitRoot, x, y)};
    }
  }
}
// A wrapped inline link can have several hit areas. Playwright normally uses
// its first quad; a cover over that line must not hide a clear second line.
// Return an element-relative position only when live hit testing reaches this
// exact target. Playwright still performs its normal actionability checks.
// With `near` (the covered target when this is what takes its click), a point
// over that target comes first, where a person would click.
export function pointerPosition(el, near) {
  const box = el.getBoundingClientRect(), style = getComputedStyle(el);
  for (const {x, y, owner} of near?.nodeType === 1 && near !== el ? [...pointSamples(el, near), ...pointSamples(el)] : pointSamples(el))
    if (owner === el) return {x:x-box.left-(parseFloat(style.borderLeftWidth)||0), y:y-box.top-(parseFloat(style.borderTopWidth)||0)};
  return null;
}
// The row, list item or repeated box a control belongs to.
const ITEMS = 'tr,li,article,[role="row"],[role="listitem"],[role="option"],[role="treeitem"],[role="article"]';
function itemOf(el) {
  const cache = {};
  for (let node = el, depth = 0; node && depth < 8; node = parent(node), depth++)
    if (node.matches?.(ITEMS) || repeatedItem(node, cache)) return node;
  return null;
}
const words = value => new Set(clean(value).toLowerCase().split(/[\s,.:;!?()[\]{}"'·|/-]+/).filter(word => word.length >= 2));
// A covering link is often hidden from assistive technology; its label still says what it does.
const labelOf = node => clean(computeAccessibleName(node, {hidden: true}));
// When no point of the target is clear: the one element that a pointer meets at
// every visible point of it, if that element stands for the target. A label of
// the target, a control that fills it, a link stretched over its row that opens
// the same thing, or the row itself drawn over it (a row's ::after layer, or a
// link that takes no pointer events, so the row handles the click, as browser-use
// and agent-browser also accept). Reported from a mail app, where such a layer
// covered the subject and every click was refused. A control that covers only
// part of the target, such as a delete button shown on hover, never qualifies.
export function pointerCover(el) {
  let owner, top, count = 0;
  for (const sample of pointSamples(el)) {
    if (!sample.hit || top !== undefined && sample.hit !== top) top = null;
    else if (top !== null) top = sample.hit;
    owner = count && owner !== sample.owner ? null : sample.owner; count++;
  }
  if (!count) return null;
  const item = itemOf(el), usable = node => !node.closest('[inert]') && !node.matches(':disabled') && !node.closest('[aria-disabled="true"]') && !secret(node, labelOf(node));
  if (top && top !== el && top.contains(el) && item?.contains(top) && !top.matches(BUTTONS) && !top.isContentEditable && usable(top)) return top;
  // Hidden from assistive technology is common for such a link; it is still what
  // the pointer meets. Inert or disabled controls never take the click.
  if (!owner || owner === el || !usable(owner)) return null;
  if (owner.localName === 'label') return owner.control === el ? owner : null;
  if (owner.matches('input,textarea,select') || owner.isContentEditable) return null;
  if (el.contains(owner)) return owner;
  if (!item?.contains(owner) || !owner.matches('a[href],[role="link"]')) return null;
  // An unnamed link opens the row only when the target is not a link of its own.
  const href = el.closest('a[href]')?.href, name = labelOf(owner);
  if (href && owner.href === href || !href && !name) return owner;
  if (!name) return null;
  // Most of the link's words are the target's own ("10월 교육 일정 안내 열기"
  // over "10월 교육 일정 안내"); one shared word ("메일 삭제") is not enough.
  const own = words(inspectTarget(el).name), its = [...words(name)];
  return its.filter(word => own.has(word)).length * 2 > its.length ? owner : null;
}
// What covers the target, for the model, when no point of it is clear.
export function pointerBlocker(el) {
  const first = pointSamples(el).next().value;
  if (!first?.hit) return {kind: 'outside_view'};
  const node = first.owner || first.hit, item = itemOf(el);
  let kind = el.contains(node) ? 'inside_target' : item?.contains(node) ? 'same_row' :
    node.closest('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]') ? 'dialog' : '';
  for (let layer = first.hit; !kind && layer && layer !== layer.ownerDocument.body; layer = parent(layer))
    if (['fixed', 'sticky'].includes(getComputedStyle(layer).position)) kind = 'fixed_bar';
  const box = first.hit.getBoundingClientRect();
  kind ||= box.width * box.height >= innerWidth * innerHeight * .8 ? 'page_cover' : 'other';
  const name = clean(labelOf(node) || ownText(node, 60), 60);
  return {kind, tag: node.localName, role: getRole(node) || '', ...(name && !secret(node, name) ? {name} : {})};
}

function hoverSurfaces(el) {
  const roots = new Set([el.getRootNode(), el.ownerDocument]);
  return [...roots].flatMap(root => [...root.querySelectorAll('[role="menu"],[role="listbox"],[role="tooltip"],[role="dialog"],[popover]')].slice(0, 128));
}
function revealedSurface(node) {
  return !!node?.isConnected && !hidden(node) && node.getAttribute('aria-busy') !== 'true' && getComputedStyle(node).opacity !== '0';
}
// Retained as a local JSHandle only, never serialized to model context. The
// baseline avoids mistaking an already-open unrelated popup for a hover result.
export function prepareHoverReveal(el) {
  return {el, visible: new Set(hoverSurfaces(el).filter(revealedSurface))};
}
// Wait for visible evidence, not another input. Portals commonly mount outside
// the trigger subtree without aria-controls. A newly visible surface is only
// a reason to re-observe, never proof of ownership or completion.
export async function waitForHoverReveal({el, visible}) {
  const root = el.getRootNode(), until = Date.now() + 1500;
  let previous = null;
  while (el.isConnected) {
    const lookup = id => root.getElementById?.(id) || el.ownerDocument.getElementById(id);
    const ids = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    const described = (el.getAttribute('aria-describedby') || '').split(/\s+/).slice(0, 8).map(lookup).filter(node => node?.getAttribute('role') === 'tooltip');
    const candidate = [...ids.map(lookup), ...described].find(revealedSurface) || hoverSurfaces(el).find(node => !visible.has(node) && revealedSurface(node));
    if (candidate && candidate === previous) return;
    previous = candidate;
    if (Date.now() >= until) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
function hidden(el) {
  const target = clickTarget(el);
  if (target !== el && target.matches('label') && target.control === el) return hidden(target);
  for (let node = el; node; node = parent(node)) {
    if (node.matches('[hidden],[inert],[aria-hidden="true"]')) return true;
    // Chromium can expose layout boxes inside a closed details element.
    // Only its first summary is rendered; boxes alone are not visible evidence.
    if (node.matches('details:not([open])') && node !== el && !node.querySelector(':scope > summary')?.contains(el)) return true;
  }
  return !target.getClientRects().length || ['hidden', 'collapse'].includes(getComputedStyle(el).visibility);
}
const accessible = el => clean(computeAccessibleName(el));
function activeElement(root = document) {
  let el = root.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
function keyboardState(el) {
  const focused = activeElement(el.ownerDocument);
  const readonly = !!el.readOnly || el.getAttribute('aria-readonly') === 'true';
  const editable = !readonly && !el.matches(':disabled') && !el.closest('[aria-disabled="true"]') &&
    (el.isContentEditable || el.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],input[type="number"]'));
  return {focused: focused === el || el.isContentEditable && el.contains(focused), editable};
}
function widgetRelations(el) {
  const root = el.getRootNode();
  // IDREFs are scoped to their own document/shadow root, never guessed selectors.
  const find = id => root.getElementById?.(id);
  const controls = [...new Set(`${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean))].slice(0, 8).flatMap(id => {
    const node = find(id);
    if (!node || secret(node, accessible(node))) return [];
    return [{id: clean(id), role: getRole(node), visible: !hidden(node)}];
  });
  const activeId = el.getAttribute('aria-activedescendant'), active = activeId ? find(activeId) : null;
  const activeInfo = active && !hidden(active) && !active.isContentEditable && !active.matches('input,textarea,select') && !active.querySelector('input,textarea,select,[contenteditable]') ? inspectTarget(active) : null;
  return {...(controls.length ? {controls} : {}),
    ...(['none', 'inline', 'list', 'both'].includes(el.getAttribute('aria-autocomplete')) ? {autocomplete: el.getAttribute('aria-autocomplete')} : {}),
    ...(activeInfo && !activeInfo.secret ? {activeDescendant: {id: clean(active.id), role: activeInfo.role, name: activeInfo.name, ...controlState(active)}} : {})};
}
// One-way mark of what a field holds now, so that the host can tell whether a
// later observation of the same field holds the same. The value itself is
// never read out of the page, and the mark never reaches the model.
export function valueMark(el) {
  const value = el.matches('input[type="checkbox"],input[type="radio"]') ? String(!!el.checked)
    : el.tagName === 'SELECT' ? [...el.selectedOptions].map(option => option.value).join('\n')
    : el.isContentEditable ? String(el.innerText ?? '') : String(el.value ?? '');
  let low = 0xdeadbeef ^ value.length, high = 0x41c6ce57 ^ value.length;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    low = Math.imul(low ^ code, 2654435761); high = Math.imul(high ^ code, 1597334677);
  }
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909);
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909);
  return `${Math.min(value.length, 9999999)}:${(high >>> 0).toString(16).padStart(8, '0')}${(low >>> 0).toString(16).padStart(8, '0')}`;
}
// Which field of its document this is, for the host only. An id that is unique in
// the document, else the name with its position among fields of that name, else the
// position among all fields. Hidden fields count too: a field that appears later must
// not renumber the ones after it, and a filtered or shortened list must not either.
const FIELD_ELEMENTS = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
// Every field of the document with its place and a one-way mark of what it
// holds, for the host only. An observation returns at most 180 controls, and a
// time sheet has more fields than that; "leave the other cells alone" has to
// cover all of them. Hidden, file and secret fields are left out.
export function fieldMarks() {
  const cache = new Map(), marks = [];
  for (const el of document.querySelectorAll(FIELD_ELEMENTS)) {
    if (marks.length >= 400) break;
    if (el.matches('input[type="hidden"],input[type="file"],input[type="password"]') || secret(el, String(el.getAttribute('aria-label') || ''))) continue;
    const place = fieldPlace(el, cache);
    if (place) marks.push([place, valueMark(el)]);
  }
  return marks;
}
export function fieldPlace(el, cache) {
  const root = el.getRootNode();
  if (!root?.querySelectorAll) return null;
  let fields = cache?.get(root);
  if (!fields) {fields = [...root.querySelectorAll(FIELD_ELEMENTS)]; cache?.set(root, fields);}
  const id = el.id, name = el.getAttribute('name');
  // A field inside a shadow root is told apart from a field of the same id outside it.
  const host = root.host ? `${root.host.tagName.toLowerCase()}${root.host.id ? '#' + root.host.id : ''}>` : '';
  if (id && fields.filter(item => item.id === id).length === 1) return `${host}id:${id}`.slice(0, 300);
  if (name) return `${host}name:${name}#${fields.filter(item => item.getAttribute('name') === name).indexOf(el)}`.slice(0, 300);
  const at = fields.indexOf(el);
  return at < 0 ? null : `${host}at:${at}`;
}
export function controlState(el) {
  const result = {};
  const native = el.matches('input[type="checkbox"],input[type="radio"]');
  for (const key of ['checked', 'pressed', 'expanded', 'selected']) {
    const value = el.getAttribute(`aria-${key}`);
    if (['true', 'false', 'mixed'].includes(value)) result[key] = value === 'mixed' ? value : value === 'true';
  }
  if (native) result.checked = el.indeterminate ? 'mixed' : !!el.checked;
  // The applied tab, filter or navigation entry is often marked only this way.
  const current = el.getAttribute('aria-current');
  if (['page', 'step', 'location', 'date', 'time', 'true', 'false'].includes(current)) result.current = current !== 'false';
  const key = Object.hasOwn(result, 'checked') ? 'checked' : Object.hasOwn(result, 'pressed') ? 'pressed' : null;
  if (key) Object.assign(result, {state: result[key], stateKind: key, stateSource: native ? 'native' : `aria-${key}`});
  const hint = el.getAttribute('data-state');
  if (['on', 'off', 'checked', 'unchecked', 'indeterminate', 'open', 'closed'].includes(hint)) result.stateHint = hint;
  else if (!key) {const [word] = classStates(el); if (word) result.stateHint = word;}
  return result;
}
// State words in class names ("btn_star on", "row starred", "mail-unread").
// Measured on a mail list whose star only turned yellow: with no state to read,
// the review asked for it again and a second click turned the star off.
const STATE_WORD = /(?:^|[-_])(on|off|active|selected|checked|starred|important|flagged|pinned|marked|favou?rite|liked|unread|read|done|completed|current|expanded|collapsed|opened|closed)$/i;
function classStates(node) {
  const found = [];
  for (const token of node?.classList || []) {
    const word = token.length <= 32 && STATE_WORD.exec(token)?.[1].toLowerCase();
    if (word && !found.includes(word)) found.push(word);
    if (found.length >= 3) break;
  }
  return found;
}
// The state words a control shows only in its class names or data-state, and
// those of the row, list item or repeated box it sits in: the words the
// observation gives as stateHint and row state. verify_page reads them live.
// Measured (W-02, candidate 40): a star that only added "starred" to its row
// could not be checked, and the model tried five other ways.
export function stateWords(el) {
  const own = classStates(el), hint = el.getAttribute('data-state');
  if (['on', 'off', 'checked', 'unchecked', 'indeterminate', 'open', 'closed'].includes(hint) && !own.includes(hint)) own.push(hint);
  const cache = new WeakMap();
  for (let node = parent(el); node; node = parent(node)) {
    const role = getRole(node) || (repeatedItem(node, cache) ? 'item' : null);
    if (['row', 'listitem', 'item'].includes(role)) return {own, row: classStates(node)};
  }
  return {own, row: []};
}
function secret(el, name) {
  const hint = `${el.type} ${el.name} ${el.id} ${name} ${el.autocomplete}`;
  return el.matches('input[type="file"],input[type="password"]') || /password|passwd|비밀번호|인증번호|일회용|토큰|시크릿|카드번호|보안코드|api[ _-]?key|secret|cc-|one-time-code|\b(?:otp|token|cvv|cvc|pin)\b/i.test(hint) ||
    (el.matches('input,textarea,select') || el.isContentEditable) && /\bcard\b/i.test(hint);
}
export {secret as isSensitiveElement};
// Visible words of an element outside its fields. Field values are not text
// nodes, and a textarea's or an editor's text and a select's options are left out.
// Words not shown are left out too: tools a mail row shows only on hover.
function ownText(el, limit = 120) {
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {acceptNode: node =>
    node.parentElement?.closest('textarea,select,[contenteditable]:not([contenteditable="false"]),script,style,template') ||
    node.parentElement?.checkVisibility?.({visibilityProperty: true}) === false ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
  let length = 0;
  for (let node = walker.nextNode(); node && length < limit * 2; node = walker.nextNode()) {
    const text = node.data.replace(/\s+/g, ' ').trim();
    if (text) {parts.push(text); length += text.length + 1;}
  }
  return clean(parts.join(' '), limit);
}
// What a link or a row says, words not shown included and buttons left out.
// Tools that a mail row shows under the pointer change its visible name; this
// stays the same through that, and still tells a reused row apart.
const BUTTONS = 'button,input,select,textarea,summary,[role="button"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="tab"],[aria-pressed]';
function itemText(el) {
  if (el.matches(BUTTONS) || el.isContentEditable) return '';
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {acceptNode: node => {
    const owner = node.parentElement?.closest(`${BUTTONS},[contenteditable]:not([contenteditable="false"]),script,style,template`);
    return owner && el.contains(owner) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  }});
  let length = 0;
  for (let node = walker.nextNode(); node && length < 400; node = walker.nextNode()) {
    const text = node.data.replace(/\s+/g, ' ').trim();
    if (text) {parts.push(text); length += text.length + 1;}
  }
  return clean(parts.join(' '), 200);
}
export function inspectTarget(el) {
  const accessibleName = accessible(el) || (el.matches('input[type="checkbox"],input[type="radio"]') && clickTarget(el) !== el ? clean(computeAccessibleName(el, {hidden: true})) : '');
  // A clickable mail row holds a checkbox. Its words still name it; only the
  // fields inside are left out, so no field value becomes part of the name.
  const text = activation(el) && !el.matches('input,textarea,select') && !el.isContentEditable ? (el.querySelector('input,textarea,select,[contenteditable]') ? ownText(el) : clean(el.innerText || el.textContent)) : '';
  const name = accessibleName || clean(el.placeholder || el.title) || text || clean(el.name || el.id);
  return {name, accessibleName, itemText: itemText(el), role: getRole(el), type: el.isContentEditable ? 'contenteditable' : el.type,
    disabled: el.matches(':disabled') || !!el.closest('[aria-disabled="true"]'),
    secret: secret(el, name), hidden: hidden(el), connected: el.isConnected, ...controlState(el), ...keyboardState(el)};
}
// Which column heading a control sits under. In a table of inputs (a weekly
// time sheet: one row per task, one column per day) the row name alone left
// every input of a row alike, and the model had to guess the day by order.
function columnOf(el, cache) {
  const cell = el.closest('td,th,[role="gridcell"],[role="cell"]');
  if (!cell || cell === el) return '';
  const table = cell.closest('table,[role="grid"],[role="treegrid"],[role="table"]');
  if (!table) return '';
  let layout = cache.get(table);
  if (layout === undefined) {
    const headers = new Map(), positions = new Map();
    const add = (index, span, text) => {for (let i = index; i < index + span; i++) headers.set(i, [...(headers.get(i) || []), text].slice(-2));};
    if (table.tagName === 'TABLE') {
      // Column positions follow merged cells: a cell spanning rows keeps its
      // column taken in the rows below, as the browser lays the table out.
      const rows = [...table.rows].slice(0, 2000), taken = [];
      const headerRows = new Set(table.tHead?.rows.length ? [...table.tHead.rows] : rows.slice(0, 3).filter(row => row.cells.length && [...row.cells].every(c => c.tagName === 'TH')));
      rows.forEach((row, r) => {
        let column = 0;
        for (const c of row.cells) {
          while (taken[r]?.has(column)) column++;
          const span = Math.max(1, c.colSpan || 1), down = Math.max(1, c.rowSpan || 1);
          positions.set(c, column);
          if (headerRows.has(row)) {
            const text = c.querySelector('input,select,textarea,[contenteditable]') ? '' : clean(c.textContent, 80);
            if (text) add(column, span, text);
          }
          for (let i = 0; i < down; i++) for (let j = 0; j < span; j++) (taken[r + i] ||= new Set()).add(column + j);
          column += span;
        }
      });
    } else {
      [...table.querySelectorAll('[role="columnheader"]')].slice(0, 200).forEach((c, position) => {
        const text = clean(c.textContent, 80);
        if (text) add(Number(c.getAttribute('aria-colindex')) || position + 1, 1, text);
      });
    }
    layout = {headers, positions};
    cache.set(table, layout);
  }
  let index = layout.positions.get(cell);
  if (index === undefined) {
    const row = cell.closest('[role="row"]');
    index = Number(cell.getAttribute('aria-colindex')) || (row ? [...row.querySelectorAll('[role="gridcell"],[role="cell"],[role="rowheader"],[role="columnheader"]')].indexOf(cell) + 1 : -1);
  }
  return (layout.headers.get(index) || []).join(' / ');
}
// A list drawn with plain boxes: an element with at least two siblings of the
// same tag and class, holding words of its own. Mail lists are often built this way.
// Rows are compared by tag and first class without a state word: a starred,
// selected or unread row ("row starred") is still one of the rows ("row").
const baseClass = node => `${node.tagName}|${[...node.classList || []].find(token => !STATE_WORD.test(token)) || ''}`;
function repeatedItem(node, cache) {
  const parentNode = node.parentElement;
  if (!parentNode || !node.matches('div,li,article,section,tr') || parentNode.children.length < 3) return false;
  // Sibling counts live beside the context cache, never in it: the parent can be a context node too.
  const siblings = cache.siblings ||= new WeakMap();
  let counts = siblings.get(parentNode);
  if (!counts) {
    counts = new Map();
    for (const child of parentNode.children) {const k = baseClass(child); counts.set(k, (counts.get(k) || 0) + 1);}
    siblings.set(parentNode, counts);
  }
  return (counts.get(baseClass(node)) || 0) >= 3 && !!ownText(node, 20);
}
function contextOf(el, cache) {
  const result = [];
  for (let node = parent(el); node && result.length < 3; node = parent(node)) {
    let context = cache.get(node);
    if (context === undefined) {
      const heading = node.querySelector(':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > [role="heading"]');
      const role = getRole(node) || (heading && node.matches('section,article') ? node.localName : null) || (repeatedItem(node, cache) ? 'item' : null);
      context = null;
      if (['dialog', 'alertdialog', 'form', 'group', 'region', 'row', 'listitem', 'item', 'navigation', 'main', 'section', 'article'].includes(role)) {
        // Row/list names computed from descendants can include editable values.
        // Use authored labels or a non-editable heading/cell as the context hint.
        // A row whose first cell is plain words (a task name) is named by it. A
        // mail list row starts with a checkbox or a star instead; such a row, a
        // list item or a repeated box is named by its own words.
        const first = role === 'row' ? node.querySelector(':scope > th,:scope > td,:scope > [role="rowheader"],:scope > [role="cell"],:scope > [role="gridcell"]') : null;
        const cell = first && !first.querySelector('input,textarea,select,[contenteditable],button,a,[role="button"],[role="link"],[role="checkbox"]') && clean(first.textContent) ? first : null;
        const name = node.matches('[aria-label],[aria-labelledby],fieldset') ? accessible(node) : clean(heading?.textContent || cell?.textContent || (['row', 'listitem', 'item'].includes(role) ? ownText(node, 80) : ''));
        const state = ['row', 'listitem', 'item'].includes(role) ? classStates(node) : [];
        if (!secret(node, name)) context = {role, ...(name ? {name} : {}), ...(state.length ? {state} : {})};
      }
      cache.set(node, context);
    }
    if (context) result.push(context);
  }
  return result;
}
export function collectSnapshot(input) {
  const options = typeof input === 'object' && input ? input : null;
  const regionRef = options?.region_ref;
  const regionCache = globalThis.__nubiBrowserRegionsV1;
  const regionEntry = typeof regionRef === 'string' ? regionCache?.refs?.get(regionRef) : null;
  const regionRead = regionRef !== undefined;
  if (regionRead && (typeof regionRef !== 'string' || !/^r-[a-f0-9-]{36}-[0-9]+$/.test(regionRef) || options.query || options.nonce || options.expectedTexts)) return {error: 'region_arguments_invalid'};
  if (regionRead && (!regionEntry || regionCache.url !== location.href || !regionEntry.isConnected || regionEntry.ownerDocument !== document || hidden(regionEntry))) return {error: 'region_stale'};
  const query = clean(options?.query || (typeof input === 'string' ? input : '')).toLowerCase();
  const expectedTexts = Array.isArray(options?.expectedTexts) ? options.expectedTexts.slice(0, 8).filter(value => typeof value === 'string' && value.trim() && value.length <= 16000) : [];
  // One synchronous observation never mutates the page. Reuse visibility
  // checks across controls, text blocks and table/surface extraction only
  // within this call; a later observation must see the current DOM state.
  const visibility = new WeakMap();
  const isHidden = el => {
    if (!visibility.has(el)) visibility.set(el, hidden(el));
    return visibility.get(el);
  };
  // Focused retrieval can inspect further without enlarging model output.
  const nodeLimit = query || expectedTexts.length ? 16000 : 5000;
  if (options?.expectedURL && location.href !== options.expectedURL) return {error: 'browser_stale'};
  let skippedSubtrees = 0, domTruncated = false;
  const all = [], textNodes = [], walk = root => {
    // A closed details renders only its first summary. Its potentially huge
    // archived subtree must not consume the rendered-page observation budget
    // and hide following inputs/actions. Recompute on every fresh observation.
    const closedDetails = root.matches?.('details:not([open])');
    const summary = closedDetails ? root.querySelector(':scope > summary') : null;
    const children = closedDetails ? summary ? [summary] : [] : root.childNodes || [];
    if (closedDetails) skippedSubtrees += [...root.children].filter(node => node !== summary).length;
    for (const node of children) {
      if (all.length >= nodeLimit) {domTruncated = true; break;}
      if (node.nodeType === Node.TEXT_NODE) textNodes.push(node);
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      // Exclude entire non-rendered subtrees before they spend the observation
      // budget. Keep visually represented native toggles and display:contents.
      const labelToggle = node.matches('input[type="checkbox"],input[type="radio"]') && clickTarget(node) !== node;
      if (node.matches('script,style,noscript,template') || !labelToggle && (node.matches('[hidden],[inert],[aria-hidden="true"]') || getComputedStyle(node).display === 'none')) {skippedSubtrees++; continue;}
      all.push(node);
      // Preserve the visual surface itself, not thousands of SVG path nodes.
      if (node.matches('svg,canvas')) {skippedSubtrees++; continue;}
      if (node.shadowRoot) walk(node.shadowRoot); walk(node);
    }
  };
  if (regionRead) all.push(regionEntry);
  walk(regionRead ? regionEntry : document.body || document.documentElement);
  const candidates = [], texts = [], regions = [], headings = [], alerts = [], focused = activeElement(), contextCache = new WeakMap(), fieldCache = new Map(), columnCache = new WeakMap();
  for (const el of all) {
    if (isHidden(el) || el.closest('script,style,noscript,template,svg,canvas')) continue;
    const rich = el.isContentEditable && el.matches('[contenteditable="true"],[contenteditable="plaintext-only"]');
    const field = el.matches('input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]),textarea,select') || rich;
    const scroll = scrollGeometry(el);
    const trigger = activation(el), interactive = field || trigger || scroll;
    // Inspect names for actionable/structural nodes only; never read field values.
    const role = getRole(el);
    const info = interactive ? inspectTarget(el) : null;
    if (secret(el, info?.name || clean(el.getAttribute('aria-label')))) continue;
    if (role === 'heading' && headings.length < 40 && !el.closest('[contenteditable]') && !el.querySelector('input,textarea,select,[contenteditable]')) headings.push({level: Number(el.getAttribute('aria-level') || el.tagName.slice(1)) || 0, name: accessible(el)});
    if (['dialog', 'alertdialog', 'form', 'navigation', 'main', 'region'].includes(role) && regions.length < 24) {
      const name = accessible(el);
      if (!secret(el, name)) regions.push({role, name, ...(el.matches('dialog:modal,[aria-modal="true"]') ? {modal: true} : {})});
    }
    if (['alert', 'status'].includes(role) && alerts.length < 12 && !el.querySelector('input,textarea,[contenteditable]')) alerts.push({role, text: clean(el.textContent, 400)});
    if (interactive) {
      const state = controlState(el);
      const kind = scroll && !field && !trigger ? 'scroll_area' : el.tagName === 'SELECT' ? 'select' : ['checkbox', 'radio'].includes(el.type) ? el.type : state.stateKind === 'checked' ? (role === 'radio' || role === 'menuitemradio' ? 'radio' : role === 'switch' ? 'switch' : 'checkbox') : state.stateKind === 'pressed' ? 'toggle' : field ? 'field' : el.matches('a[href]') ? 'link' : 'control';
      const context = contextOf(el, contextCache), name = info.name || role || kind, column = field || trigger ? columnOf(el, columnCache) : '';
      const choices = el.tagName === 'SELECT' ? [...el.options].slice(0, 80).map(o => ({value: o.value.slice(0, 200), label: clean(o.label), disabled: o.disabled || !!o.closest('optgroup[disabled]')})) : undefined;
      const destination = el.matches('a[href]') ? publicSourceURL(el.href) : null;
      const descriptor = {name, accessibleName: info.accessibleName, role, kind, tag: el.tagName.toLowerCase(),
        ...(scroll ? {scroll} : {}),
        ...describeControl(el, secret), inViewport: inViewport(clickTarget(el)),
        ...(trigger && trigger !== 'semantic' ? {activation: trigger} : {}),
        ...(el.matches(hoverHandlers) ? {hoverHint: true} : {}),
        ...(el.matches('[draggable="true"]') ? {draggable: true} : {}),
        ...(el.matches('[ondragover],[ondrop]') ? {dropTarget: true} : {}),
        ...(destination ? {destination} : {}), ...(el.matches('a[target]') ? {linkTarget: clean(el.target, 80)} : {}), ...(el.matches('a[download]') ? {download: true} : {}),
        ...(el.id ? {id: clean(el.id)} : {}), ...(el.getAttribute('data-testid') ? {testId: clean(el.getAttribute('data-testid'))} : {}),
        type: info.type, disabled: info.disabled, ...(info.focused ? {focused: true} : {}), ...(field ? {editable: info.editable} : {}),
        ...widgetRelations(el), ...(context.length ? {context} : {}), ...(column ? {column} : {}),
        ...(field || ['combobox', 'textbox', 'searchbox', 'spinbutton', 'listbox'].includes(role) ? {required: !!el.required || el.getAttribute('aria-required') === 'true', readonly: !!el.readOnly || el.getAttribute('aria-readonly') === 'true', invalid: el.getAttribute('aria-invalid') === 'true' || el.validity?.valid === false} : {}),
        ...(choices ? {options: choices} : {}),
        ...state,
        ...(el.hasAttribute('aria-haspopup') ? {haspopup: el.getAttribute('aria-haspopup')} : {}),
        ...(field ? {valueMark: valueMark(el), fieldPlace: fieldPlace(el, fieldCache)} : {})};
      candidates.push({el, descriptor, priority: context.some(c => ['dialog','alertdialog'].includes(c.role)) ? 0 : el === focused ? 1 : descriptor.inViewport ? 2 : 3});
    }
  }
  // A result may expose a publisher, title and snippet as separate links to
  // exactly the same address. Preserve alternatives without inferring a title.
  // The private full href is the key: redacted URLs may alias different items.
  const linkLabels = new Map();
  for (const {el, descriptor} of candidates) {
    if (!descriptor.destination || !el.matches('a[href]')) continue;
    const labels = linkLabels.get(el.href) || [];
    if (!labels.includes(descriptor.name) && labels.length < 4) labels.push(descriptor.name);
    linkLabels.set(el.href, labels);
  }
  for (const {el, descriptor} of candidates) {
    const labels = descriptor.destination && linkLabels.get(el.href);
    if (labels?.length > 1) descriptor.sameDestinationLabels = labels;
  }
  // Read in DOM order, including inline descendants. Collecting each parent's
  // direct text before its children turned "읽기 <b>준비</b> 완료" into
  // "읽기 완료 준비" and silently cut every long paragraph at 180 characters.
  const blocks = new Map(), textRegions = [], regionDetails = new Map(), regionHeadings = new Map();
  let previousBlock, previousRegion, mixedRegion = false, currentText = '', remainingText = 256000, textTruncated = false;
  const flush = () => {const text = clean(currentText, remainingText + 1); if (text.length > remainingText) textTruncated = true; if (remainingText && text) {texts.push(text.slice(0, remainingText)); textRegions.push(mixedRegion ? null : previousRegion);} remainingText = Math.max(0, remainingText - text.length); currentText = ''; mixedRegion = false;};
  for (const node of textNodes) {
    const container = node.parentElement;
    if (!container || isHidden(container)) continue;
    let blocked = false;
    for (let el = container; el; el = parent(el)) {
      if (el.matches('input,textarea,select,[contenteditable],script,style,noscript,template,svg,canvas') || secret(el, clean(el.getAttribute('aria-label')))) {blocked = true; break;}
    }
    if (blocked) continue;
    let block = container;
    for (let el = container; el; el = parent(el)) {
      if (!blocks.has(el)) blocks.set(el, !['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents'].includes(getComputedStyle(el).display));
      block = el; if (blocks.get(el)) break;
    }
    // A matching number does not identify its card, date or source. Preserve
    // the nearest semantic region; never treat the whole main as one card.
    let region, heading, link;
    for (let el = container; el; el = parent(el)) {
      if (!heading && el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) heading = el;
      if (!link && el.matches('a[href]')) link = el;
      if (el.matches('section,article,[role="region"]') && !el.matches('main,[role="main"]')) {region = el; break;}
    }
    region ||= block;
    if (!regionDetails.has(region)) regionDetails.set(region, {index: regionDetails.size,
      role: region.matches?.('section,article,[role="region"]') ? region.getAttribute('role') || region.localName : 'text_block'});
    const detail = regionDetails.get(region);
    // Only text nodes that passed the same visibility/privacy checks above
    // contribute heading context. Never read an ancestor's whole textContent.
    if (heading && (region === heading || region.contains(heading))) {
      if (!regionHeadings.has(region)) regionHeadings.set(region, heading);
      if (regionHeadings.get(region) === heading) detail.heading = clean(`${detail.heading || ''} ${node.textContent}`, 180);
    }
    if (link && (region === link || region.contains(link))) {
      const url = publicSourceURL(link.href);
      if (url && url.length <= 512 && !detail.links?.includes(url) && (detail.links?.length || 0) < 2) (detail.links ||= []).push(url);
    }
    if (block !== previousBlock || query && region !== previousRegion) {flush(); previousBlock = block; previousRegion = region;}
    // Preserve the unfiltered text's original whitespace and block boundaries.
    // Inline/display:contents regions can share a rendered block; assigning
    // that whole block to its first region would invent an association.
    else if (region !== previousRegion) mixedRegion = true;
    const left = Math.max(0, remainingText - currentText.length);
    if (node.textContent.length > left) textTruncated = true;
    currentText += node.textContent.slice(0, left);
  }
  flush();
  // Verify against the same filtered, rendered text BEFORE the model's overview
  // is truncated. Do not rank evidence or count hidden text/field values as proof.
  // Only booleans leave the document; expected values are never echoed.
  const scannedText = expectedTexts.length ? texts.join(' ').replace(/\s+/g, ' ').trim() : '';
  const textChecks = expectedTexts.map(expected => scannedText.includes(expected.replace(/\s+/g, ' ').trim()));
  // Keep all visible choices, prioritizing dialogs when a long background page
  // would otherwise exhaust the budget. Never turn DOM order into confidence.
  const roleWords = {switch: '스위치 토글', checkbox: '체크박스', radio: '라디오', button: '버튼', link: '링크', tab: '탭', combobox: '선택', textbox: '입력란', searchbox: '검색'};
  const ranked = query ? rankEvidence(candidates.map(({descriptor: d}, id) => ({id, name: `${d.name} ${d.accessibleName}`, context: `${(d.context || []).map(c => c.name || '').join(' ')} ${d.column || ''} ${d.description || ''}`, text: `${d.id || ''} ${d.testId || ''} ${d.role || ''} ${roleWords[d.role] || ''} ${d.validationMessage || ''}`})), query) : [];
  // Preserve DOM order when every control fits. Moving focus must not reorder
  // an otherwise unchanged observation and look like progress to recovery.
  // The host may ask for up to 400 controls and choose among them itself (by a
  // size budget and the user's request, which never enters the page).
  const limit = !query && Number.isInteger(options?.limit) ? Math.min(400, Math.max(180, options.limit)) : 180;
  // A hint (the user's request) is given only to the isolated-world reader, never to
  // a script the page could watch. When not every control fits, the controls it
  // matches come right after dialog and focused ones; it never filters.
  const hint = !query && typeof options?.hint === 'string' ? options.hint.slice(0, 1000) : '';
  const hinted = hint && candidates.length > limit ? new Map(rankEvidence(candidates.map(({descriptor: d}, id) => ({id, name: `${d.name} ${d.accessibleName}`,
    context: `${(d.context || []).map(c => c.name || '').join(' ')} ${d.column || ''}`, text: `${d.role || ''} ${d.description || ''}`})), hint).map((hit, rank) => [candidates[hit.id], rank])) : null;
  const orderOf = item => item.priority < 2 ? item.priority : hinted?.has(item) ? 2 + hinted.get(item) / 1e6 : item.priority + 1;
  const ordered = query ? ranked.map(hit => ({...candidates[hit.id], match: hit.match})) :
    candidates.length > limit ? candidates.sort((a, b) => orderOf(a) - orderOf(b)) : candidates;
  const chosen = ordered.slice(0, limit), elements = chosen.map(item => item.el);
  let detailBudget = 6000, omittedControlDetails = 0;
  const descriptors = chosen.map(({descriptor, match}) => {
    const {description, validationMessage, constraints, ...base} = descriptor;
    const details = {...(description ? {description} : {}), ...(validationMessage ? {validationMessage} : {}), ...(constraints ? {constraints} : {})};
    const size = JSON.stringify(details).length;
    if (size > detailBudget) {omittedControlDetails++; return {...base, detailsOmitted: true, ...(match ? {match} : {})};}
    detailBudget -= size; return {...base, ...details, ...(match ? {match} : {})};
  });
  const textMatches = query ? rankEvidence(texts.map((text, id) => ({id, text,
    context: regionDetails.get(textRegions[id])?.heading || ''})), query) : [];
  const excerpts = new Map(); let excerptSize = 0, excerptOmitted = false;
  for (const hit of textMatches.slice(0, 8)) for (const i of [hit.id, hit.id - 1, hit.id + 1]) {
    if (!texts[i] || excerpts.has(i) || textRegions[i] !== textRegions[hit.id]) continue;
    const snippet = evidenceExcerpt(texts[i], query);
    if (excerptSize + snippet.length + 1 > 16000) {excerptOmitted = true; continue;}
    excerpts.set(i, snippet); excerptSize += snippet.length + 1;
  }
  const orderedExcerpts = query ? [...excerpts].sort((a, b) => a[0] - b[0]) : texts.map((text, id) => [id, text]);
  const excerpt = query ? orderedExcerpts.map(([, text]) => text) : texts;
  const text = excerpt.join('\n'), returnedText = text.slice(0, 16000);
  // Offsets refer only to this returned text, not the source DOM or action IDs.
  // Context is bounded and advisory; links are observed candidates, not proof
  // that a figure belongs to a linked provider or that the link was opened.
  // getRandomValues also works on ordinary HTTP pages where randomUUID may
  // be unavailable. The opaque token grants no action or cross-frame access.
  const regionNonce = regionRead ? null : options?.nonce || (() => {
    const hex = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  })();
  const retainedRegions = new Map();
  const regionRefs = new Map(regionRead ? [...regionCache.refs].map(([ref, node]) => [node, ref]) : []);
  const textBlocks = [], contexts = []; let textOffset = 0, contextOmitted = false;
  for (const [id, snippet] of orderedExcerpts) {
    if (textOffset >= returnedText.length) {contextOmitted = true; break;}
    const regionNode = textRegions[id];
    const originalDetail = regionDetails.get(regionNode);
    const ref = regionRead ? regionRefs.get(regionNode) : originalDetail && `r-${regionNonce}-${originalDetail.index}`;
    const detail = originalDetail && {...originalDetail, ...(ref ? {region_ref: ref} : {})};
    if (!detail) {contextOmitted = true; textOffset += snippet.length + 1; continue;}
    const block = {start: textOffset, end: Math.min(returnedText.length, textOffset + snippet.length), regionIndex: detail.index};
    const context = contexts.some(item => item.index === detail.index) ? [] : [detail];
    if (JSON.stringify({textBlocks: [...textBlocks, block], textRegions: [...contexts, ...context]}).length <= 4000) {
      textBlocks.push(block); contexts.push(...context);
      if (ref) retainedRegions.set(ref, regionNode);
    } else contextOmitted = true;
    textOffset += snippet.length + 1;
  }
  const information = pageInformation(all, {query, hidden: isHidden, secret, domTruncated});
  const textPartial = textTruncated || text.length > 16000 || !!query && (textMatches.length > 8 || excerptOmitted || [...excerpts.keys()].some(i => texts[i].length > 1200));
  // Measured: a query whose words the page does not use returned four controls and
  // no text. The model took the page for empty and asked the user which page to use.
  const pageText = texts.reduce((sum, part) => sum + part.trim().length, 0);
  const unmatched = !!query && !regionRead && !returnedText.trim() && pageText > 0;
  const result = {descriptors: regionRead ? [] : descriptors, text: returnedText, textFiltered: !!query, regions, headings, alerts, ...information, page_view: paginationView(all),
    ...(unmatched ? {queryUnmatched: {pageTextCharacters: pageText, controlsObserved: candidates.length,
      instruction: 'No text of this page matched the query words. The page is not empty. Observe it again without a query, or with words that the page itself shows.'}} : {}),
    ...(expectedTexts.length ? {textChecks} : {}),
    coverage: {nodesInspected: all.length, nodeLimit, skippedSubtrees, domTruncated, textTruncated: textPartial, queryFiltered: !!query,
      controlsObserved: candidates.length, controlsReturned: regionRead ? 0 : descriptors.length, omittedControlDetails,
      // A long form lost its later rows here without saying how to reach them.
      ...(!query && !regionRead && ordered.length > chosen.length ? {controlsHint: 'Not every control was returned. To act on a table row or a field that is not listed, observe again with a query naming its row, column or label; matching controls come first.'} : {}),
      scope: 'Rendered DOM in this document and open shadow roots. Hidden content, field values, closed roots and unloaded virtual rows are not inspected. Counts describe this scan only.'},
    retrieval: {method: query ? 'lexical' : 'dom_order', ...(query ? {matchedControls: ranked.length, matchedTextBlocks: textMatches.length, filteredControls: candidates.length - ranked.length} : {}),
      textBlocks, textRegions: contexts, contextOmitted,
      instruction: 'Matches are candidates, not certainty or permission. textBlocks offsets locate excerpts in returned text; regionIndex groups only the observed nearest region, never an action ref or a label/value association. region_ref permits read_page mode=region only. Region links are observed candidates, not verified source attribution. Compare labels, dates and source within the same region; do not merge figures across regions. Missing context remains unknown. Compare name, region, frame and current state. Partial or truncated results do not prove absence; narrow the query, inspect visually or ask about an unresolved choice.'},
    truncated: domTruncated || textPartial || !regionRead && ordered.length > chosen.length,
    omittedControls: regionRead ? ordered.length : ordered.length - chosen.length,
    ...(regionRead ? {region_scope: {region_ref: regionRef, region_index: Number(regionRef.slice(regionRef.lastIndexOf('-') + 1)), read_only: true, partial: domTruncated || textPartial,
      instruction: 'Visible text reread only inside this observed DOM region. It may contain several cards or dates; region membership does not prove label/value association, freshness or completion. No action refs are granted.'}} : {})};
  if (!regionRead) globalThis.__nubiBrowserRegionsV1 = {url: location.href, refs: retainedRegions};
  if (options?.nonce) {
    const refs = new Map();
    result.descriptors = descriptors.map((descriptor, index) => {
      const ref = `c-${options.nonce}-${index}`; refs.set(ref, elements[index]); return {ref, ...descriptor};
    });
    globalThis.__nubiBrowserObservationV1 = {nonce: options.nonce, url: location.href, refs, markers: new Map()};
    return result;
  }
  return {...result, elements: regionRead ? [] : elements};
}
