// This module is bundled inside static, serializable functions at build time.
// No page/model-provided JavaScript is evaluated by the observer.
import {computeAccessibleName, getRole} from 'dom-accessibility-api';
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
// A wrapped inline link can have several hit areas. Playwright normally uses
// its first quad; a cover over that line must not hide a clear second line.
// Return an element-relative position only when live hit testing reaches this
// exact target. Playwright still performs its normal actionability checks.
export function pointerPosition(el) {
  const box = el.getBoundingClientRect(), style = getComputedStyle(el);
  const root = el.getRootNode(), hitRoot = typeof root.elementFromPoint === 'function' ? root : el.ownerDocument;
  for (const rect of [...el.getClientRects()].slice(0, 32)) {
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    if (right - left < 2 || bottom - top < 2) continue;
    for (const [rx, ry] of [[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75]]) {
      const x = left + (right-left)*rx, y = top + (bottom-top)*ry;
      let hit = hitRoot.elementFromPoint(x, y);
      while (hit?.shadowRoot?.elementFromPoint) {
        const child = hit.shadowRoot.elementFromPoint(x, y);
        if (!child || child === hit) break;
        hit = child;
      }
      let node = hit;
      while (node && node !== el && !node.matches?.(`${controls},${handlers}`)) node = parent(node);
      if (node === el) return {x:x-box.left-(parseFloat(style.borderLeftWidth)||0), y:y-box.top-(parseFloat(style.borderTopWidth)||0)};
    }
  }
  return null;
}

// Only wait for a relationship authored on the observed trigger. A successful
// hover does not mean a delayed portal/menu is already available to the model.
export async function waitForHoverReveal(el) {
  const ids = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!ids.length) return;
  const root = el.getRootNode(), until = Date.now() + 1500;
  while (el.isConnected) {
    if (ids.some(id => {const node = root.getElementById?.(id) || el.ownerDocument.getElementById(id);return node && !hidden(node);})) return;
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
  return !target.getClientRects().length || getComputedStyle(el).visibility === 'hidden';
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
export function controlState(el) {
  const result = {};
  const native = el.matches('input[type="checkbox"],input[type="radio"]');
  for (const key of ['checked', 'pressed', 'expanded', 'selected']) {
    const value = el.getAttribute(`aria-${key}`);
    if (['true', 'false', 'mixed'].includes(value)) result[key] = value === 'mixed' ? value : value === 'true';
  }
  if (native) result.checked = el.indeterminate ? 'mixed' : !!el.checked;
  const key = Object.hasOwn(result, 'checked') ? 'checked' : Object.hasOwn(result, 'pressed') ? 'pressed' : null;
  if (key) Object.assign(result, {state: result[key], stateKind: key, stateSource: native ? 'native' : `aria-${key}`});
  const hint = el.getAttribute('data-state');
  if (['on', 'off', 'checked', 'unchecked', 'indeterminate', 'open', 'closed'].includes(hint)) result.stateHint = hint;
  return result;
}
function secret(el, name) {
  const hint = `${el.type} ${el.name} ${el.id} ${name} ${el.autocomplete}`;
  return el.matches('input[type="file"],input[type="password"]') || /password|passwd|비밀번호|인증번호|일회용|토큰|시크릿|카드번호|보안코드|api[ _-]?key|secret|cc-|one-time-code|\b(?:otp|token|cvv|cvc|pin)\b/i.test(hint) ||
    (el.matches('input,textarea,select') || el.isContentEditable) && /\bcard\b/i.test(hint);
}
export {secret as isSensitiveElement};
export function inspectTarget(el) {
  const accessibleName = accessible(el) || (el.matches('input[type="checkbox"],input[type="radio"]') && clickTarget(el) !== el ? clean(computeAccessibleName(el, {hidden: true})) : '');
  const text = activation(el) && !el.matches('input,textarea,select') && !el.isContentEditable && !el.querySelector('input,textarea,select,[contenteditable]') ? clean(el.innerText || el.textContent) : '';
  const name = accessibleName || clean(el.placeholder || el.title) || text || clean(el.name || el.id);
  return {name, accessibleName, role: getRole(el), type: el.isContentEditable ? 'contenteditable' : el.type,
    disabled: el.matches(':disabled') || !!el.closest('[aria-disabled="true"]'),
    secret: secret(el, name), hidden: hidden(el), connected: el.isConnected, ...controlState(el), ...keyboardState(el)};
}
function contextOf(el) {
  const result = [];
  for (let node = parent(el); node && result.length < 3; node = parent(node)) {
    const heading = node.querySelector(':scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > [role="heading"]');
    const role = getRole(node) || (heading && node.matches('section,article') ? node.localName : null);
    if (!['dialog', 'alertdialog', 'form', 'group', 'region', 'row', 'listitem', 'navigation', 'main', 'section', 'article'].includes(role)) continue;
    // Row/list names computed from descendants can include editable values.
    // Use authored labels or a non-editable heading/cell as the context hint.
    const cell = role === 'row' ? node.querySelector('th,td,[role="rowheader"],[role="cell"]') : null;
    const name = node.matches('[aria-label],[aria-labelledby],fieldset') ? accessible(node) : clean(heading?.textContent || (cell && !cell.querySelector('input,textarea,select,[contenteditable]') ? cell.textContent : ''));
    if (!secret(node, name)) result.push({role, ...(name ? {name} : {})});
  }
  return result;
}
export function collectSnapshot(input) {
  const options = typeof input === 'object' && input ? input : null;
  const query = clean(options?.query || (typeof input === 'string' ? input : '')).toLowerCase();
  const expectedTexts = Array.isArray(options?.expectedTexts) ? options.expectedTexts.slice(0, 8).filter(value => typeof value === 'string' && value.trim() && value.length <= 16000) : [];
  // Focused retrieval can inspect further without enlarging model output.
  const nodeLimit = query || expectedTexts.length ? 16000 : 5000;
  if (options?.expectedURL && location.href !== options.expectedURL) return {error: 'browser_stale'};
  let skippedSubtrees = 0, domTruncated = false;
  const all = [], textNodes = [], walk = root => {
    for (const node of root.childNodes || []) {
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
  walk(document.body || document.documentElement);
  const candidates = [], texts = [], regions = [], headings = [], alerts = [], focused = activeElement();
  for (const el of all) {
    if (hidden(el) || el.closest('script,style,noscript,template,svg,canvas')) continue;
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
      const context = contextOf(el), name = info.name || role || kind;
      const choices = el.tagName === 'SELECT' ? [...el.options].slice(0, 80).map(o => ({value: o.value.slice(0, 200), label: clean(o.label), disabled: o.disabled || !!o.closest('optgroup[disabled]')})) : undefined;
      let destination;
      if (el.matches('a[href]')) try {const url = new URL(el.href); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) destination = url.origin + url.pathname;} catch { /* Non-navigation link. */ }
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
        ...widgetRelations(el), ...(context.length ? {context} : {}),
        ...(field || ['combobox', 'textbox', 'searchbox', 'spinbutton', 'listbox'].includes(role) ? {required: !!el.required || el.getAttribute('aria-required') === 'true', readonly: !!el.readOnly || el.getAttribute('aria-readonly') === 'true', invalid: el.getAttribute('aria-invalid') === 'true' || el.validity?.valid === false} : {}),
        ...(choices ? {options: choices} : {}),
        ...state,
        ...(el.hasAttribute('aria-haspopup') ? {haspopup: el.getAttribute('aria-haspopup')} : {})};
      candidates.push({el, descriptor, priority: context.some(c => ['dialog','alertdialog'].includes(c.role)) ? 0 : el === focused ? 1 : descriptor.inViewport ? 2 : 3});
    }
  }
  // Read in DOM order, including inline descendants. Collecting each parent's
  // direct text before its children turned "읽기 <b>준비</b> 완료" into
  // "읽기 완료 준비" and silently cut every long paragraph at 180 characters.
  const blocks = new Map(); let previousBlock, currentText = '', remainingText = 256000, textTruncated = false;
  const flush = () => {const text = clean(currentText, remainingText + 1); if (text.length > remainingText) textTruncated = true; if (remainingText && text) texts.push(text.slice(0, remainingText)); remainingText = Math.max(0, remainingText - text.length); currentText = '';};
  for (const node of textNodes) {
    const container = node.parentElement;
    if (!container || hidden(container)) continue;
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
    if (block !== previousBlock) {flush(); previousBlock = block;}
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
  const ranked = query ? rankEvidence(candidates.map(({descriptor: d}, id) => ({id, name: `${d.name} ${d.accessibleName}`, context: `${(d.context || []).map(c => c.name || '').join(' ')} ${d.description || ''}`, text: `${d.id || ''} ${d.testId || ''} ${d.role || ''} ${roleWords[d.role] || ''} ${d.validationMessage || ''}`})), query) : [];
  // Preserve DOM order when every control fits. Moving focus must not reorder
  // an otherwise unchanged observation and look like progress to recovery.
  const ordered = query ? ranked.map(hit => ({...candidates[hit.id], match: hit.match})) :
    candidates.length > 180 ? candidates.sort((a, b) => a.priority - b.priority) : candidates;
  const chosen = ordered.slice(0, 180), elements = chosen.map(item => item.el);
  let detailBudget = 6000, omittedControlDetails = 0;
  const descriptors = chosen.map(({descriptor, match}) => {
    const {description, validationMessage, constraints, ...base} = descriptor;
    const details = {...(description ? {description} : {}), ...(validationMessage ? {validationMessage} : {}), ...(constraints ? {constraints} : {})};
    const size = JSON.stringify(details).length;
    if (size > detailBudget) {omittedControlDetails++; return {...base, detailsOmitted: true, ...(match ? {match} : {})};}
    detailBudget -= size; return {...base, ...details, ...(match ? {match} : {})};
  });
  const textMatches = query ? rankEvidence(texts.map((text, id) => ({id, text})), query) : [];
  const excerpts = new Map(); let excerptSize = 0, excerptOmitted = false;
  for (const hit of textMatches.slice(0, 8)) for (const i of [hit.id, hit.id - 1, hit.id + 1]) {
    if (!texts[i] || excerpts.has(i)) continue;
    const snippet = evidenceExcerpt(texts[i], query);
    if (excerptSize + snippet.length + 1 > 16000) {excerptOmitted = true; continue;}
    excerpts.set(i, snippet); excerptSize += snippet.length + 1;
  }
  const excerpt = query ? [...excerpts].sort((a, b) => a[0] - b[0]).map(([, text]) => text) : texts;
  const text = excerpt.join('\n');
  const information = pageInformation(all, {query, hidden, secret, domTruncated});
  const textPartial = textTruncated || text.length > 16000 || !!query && (textMatches.length > 8 || excerptOmitted || [...excerpts.keys()].some(i => texts[i].length > 1200));
  const result = {descriptors, text: text.slice(0, 16000), textFiltered: !!query, regions, headings, alerts, ...information,
    ...(expectedTexts.length ? {textChecks} : {}),
    coverage: {nodesInspected: all.length, nodeLimit, skippedSubtrees, domTruncated, textTruncated: textPartial, queryFiltered: !!query,
      controlsObserved: candidates.length, controlsReturned: descriptors.length, omittedControlDetails,
      scope: 'Rendered DOM in this document and open shadow roots. Hidden content, field values, closed roots and unloaded virtual rows are not inspected. Counts describe this scan only.'},
    ...(query ? {retrieval: {method: 'lexical', matchedControls: ranked.length, matchedTextBlocks: textMatches.length, filteredControls: candidates.length - ranked.length,
      instruction: 'Matches are candidates, not certainty or permission. Compare name, region, frame and current state. Partial or truncated results do not prove absence; narrow the query, inspect visually or ask about an unresolved choice.'}} : {}),
    truncated: domTruncated || textPartial || ordered.length > chosen.length,
    omittedControls: ordered.length - chosen.length};
  if (options?.nonce) {
    const refs = new Map();
    result.descriptors = descriptors.map((descriptor, index) => {
      const ref = `c-${options.nonce}-${index}`; refs.set(ref, elements[index]); return {ref, ...descriptor};
    });
    globalThis.__nubiBrowserObservationV1 = {nonce: options.nonce, url: location.href, refs, markers: new Map()};
    return result;
  }
  return {...result, elements};
}
