// Static browser observation, bundled into browser-dom's serializable helpers.
// Page-authored descriptions are evidence, never instructions or permissions.
import {computeAccessibleDescription, computeAccessibleName, getRole} from 'dom-accessibility-api';
import {rankEvidence, evidenceExcerpt} from './evidence-search.js';
import {publicSourceURL} from './browser-public-url.js';

const clean = (value, limit = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const secretValue = value => /(?:bearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|-----BEGIN|[A-Za-z0-9_+\/-]{48,}={0,2})/i.test(value);
const parent = el => el.parentElement || el.getRootNode()?.host;

export function scrollGeometry(el) {
  if (el === document.body || el === document.documentElement || el.matches(editable)) return null;
  const style = getComputedStyle(el);
  const vertical = /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
  const horizontal = /auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
  if (!vertical && !horizontal) return null;
  const maxLeft = Math.max(0, el.scrollWidth-el.clientWidth), rtl = style.direction === 'rtl';
  return {top: Math.round(el.scrollTop), left: Math.round(el.scrollLeft), width: el.clientWidth, height: el.clientHeight,
    maxTop: Math.max(0, el.scrollHeight-el.clientHeight), maxLeft: rtl ? 0 : maxLeft, minLeft: rtl ? -maxLeft : 0};
}

function safeNode(node, secret) {
  if (node.matches(`${editable},script,style,noscript,template`) || node.querySelector(editable)) return false;
  for (let el = node; el; el = parent(el)) if (secret(el, clean(el.getAttribute('aria-label')))) return false;
  // The accessibility algorithm can follow IDREFs outside this subtree. Do
  // not follow help text through another name/owner or editable-value graph.
  if (node.matches('[aria-labelledby],[aria-owns]') || node.querySelector('[aria-labelledby],[aria-owns],script,style,[type="password"]')) return false;
  return true;
}

function authoredName(node, secret) {
  const root = node.getRootNode(), ids = (node.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
  if (ids.length > 8 || ids.some(id => {const el = root.getElementById?.(id); return el && !safeNode(el, secret);})) return '';
  const caption = node.matches('table') ? node.caption : null;
  if (caption && !safeNode(caption, secret)) return '';
  const name = clean(computeAccessibleName(node));
  return secret(node, name) || secretValue(name) ? '' : name;
}

export function describeControl(el, secret) {
  const root = el.getRootNode();
  const references = attribute => (el.getAttribute(attribute) || '').trim().split(/\s+/).filter(Boolean);
  const ids = references('aria-describedby');
  const help = ids.map(id => root.getElementById?.(id)).filter(Boolean);
  const description = ids.length <= 8 && help.every(node => safeNode(node, secret)) ? clean(computeAccessibleDescription(el), 300) : '';
  const result = description && !secretValue(description) ? {description} : {};
  if (el.validity && el.willValidate) {
    const flags = ['valueMissing', 'typeMismatch', 'patternMismatch', 'tooLong', 'tooShort', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError'];
    result.validation = {valid: el.validity.valid, issues: flags.filter(key => el.validity[key])};
  }
  if (el.getAttribute('aria-invalid') === 'true' || el.validity?.valid === false) {
    const errors = references('aria-errormessage').slice(0, 4).map(id => root.getElementById?.(id)).filter(Boolean);
    if (errors.length && errors.every(node => safeNode(node, secret))) {
      const message = clean(errors.map(node => node.textContent).join(' '), 240);
      if (message && !secretValue(message)) result.validationMessage = message;
    }
  }
  const constraints = {};
  for (const key of ['minLength', 'maxLength']) {
    if (el.hasAttribute(key.toLowerCase()) && Number.isInteger(el[key]) && el[key] >= 0) constraints[key] = el[key];
  }
  for (const key of ['min', 'max', 'step', 'pattern']) {
    const value = el.getAttribute(key);
    if (value && value.length <= 160 && !secretValue(value)) constraints[key] = value;
  }
  if (Object.keys(constraints).length) result.constraints = constraints;
  return result;
}

export function inViewport(el) {
  return [...el.getClientRects()].slice(0, 32).some(r => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight);
}

export function pageInformation(nodes, {query, hidden, secret, domTruncated}) {
  const roles = new Map(nodes.map(el => [el, getRole(el)]));
  const visible = nodes.filter(el => !hidden(el));
  // Omit entire editable cells; a label is not permission to include a value.
  const textOf = node => {
    if (!safeNode(node, secret)) return {text: '', contentOmitted: true};
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let text = '', count = 0, truncated = false;
    while (walker.nextNode()) {
      if (count++ >= 500 || text.length >= 4000) {truncated = true; break;}
      const el = walker.currentNode.parentElement;
      if (!el || hidden(el)) continue;
      let blocked = false;
      for (let owner = el; owner; owner = parent(owner)) {
        if (owner.matches('script,style,noscript,template') || secret(owner, clean(owner.getAttribute('aria-label')))) {blocked = true; break;}
        if (owner === node) break;
      }
      if (blocked) continue;
      const value = walker.currentNode.textContent, left = 4000-text.length;
      if (value.length > left) truncated = true;
      text += `${value.slice(0, left)} `;
    }
    if (secretValue(text)) return {text: '', contentOmitted: true};
    text = clean(text, 4000);
    return {text: evidenceExcerpt(text, query, 160), ...(truncated || text.length > 160 ? {textTruncated: true} : {})};
  };
  const tableSelector = 'table,[role="table"],[role="grid"],[role="treegrid"]';
  const candidates = visible.filter(el => ['table', 'grid', 'treegrid'].includes(roles.get(el)));
  const rows = visible.filter(el => roles.get(el) === 'row');
  const cells = visible.filter(el => ['cell', 'gridcell', 'columnheader', 'rowheader'].includes(roles.get(el)));
  const ownedRows = new Map(), ownedCells = new Map();
  for (const row of rows) {const table = row.closest(tableSelector); if (!ownedRows.has(table)) ownedRows.set(table, []); ownedRows.get(table).push(row);}
  for (const cell of cells) {const row = cell.closest('tr,[role="row"]'); if (!ownedCells.has(row)) ownedCells.set(row, []); ownedCells.get(row).push(cell);}
  const positive = value => /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const spans = cell => {
    const colSpan = positive(cell.getAttribute('aria-colspan')) || cell.colSpan || 1;
    // Native rowspan=0 means the remaining rows of its row group, not one row.
    const rowSpan = positive(cell.getAttribute('aria-rowspan')) ?? cell.rowSpan ?? 1;
    return {...(colSpan > 1 ? {colSpan} : {}), ...(rowSpan !== 1 ? {rowSpan} : {})};
  };
  const prepared = candidates.map((table, id) => {
    const name = authoredName(table, secret);
    // A search-result table may describe another page, even when its dates
    // conflict with this page's main card. Keep the actual enclosing link;
    // never infer a source from a nearby heading or claim the target was read.
    let enclosingLink;
    for (let owner=parent(table); owner; owner=parent(owner)) {
      if (!owner.matches('a[href]')) continue;
      const url=publicSourceURL(owner.href);
      if (url && url.length <= 512) enclosingLink={relationship:'table_inside_link',url};
      break;
    }
    const tableRows = (ownedRows.get(table) || []).map((row, index) => ({
      index: positive(row.getAttribute('aria-rowindex')) || (Number.isInteger(row.rowIndex) ? row.rowIndex + 1 : index + 1),
      cells: (ownedCells.get(row) || []).slice(0, 12).map((cell, column) => ({
        column: positive(cell.getAttribute('aria-colindex')) || (Number.isInteger(cell.cellIndex) ? cell.cellIndex + 1 : column + 1),
        role: roles.get(cell), ...textOf(cell),
        ...(cell.matches(editable) || cell.querySelector(editable) ? {valueOmitted: true} : {}),
        ...spans(cell),
      })),
      ...((ownedCells.get(row) || []).length > 12 ? {omittedCells: (ownedCells.get(row) || []).length - 12} : {}),
    }));
    const declaredRows = positive(table.getAttribute('aria-rowcount')), declaredColumns = positive(table.getAttribute('aria-colcount'));
    return {id, name, role: roles.get(table), inViewport:inViewport(table), ...(enclosingLink ? {enclosingLink} : {}), tableRows,
      ...(declaredRows ? {declaredRows} : {}), ...(declaredColumns ? {declaredColumns} : {}),
      unknownRows: table.getAttribute('aria-rowcount') === '-1'};
  });
  const hits = query ? rankEvidence(prepared.map(t => ({id: t.id, name: t.name, text: t.tableRows.flatMap(r => r.cells.map(c => c.text)).join(' ')})), query) : prepared;
  const tables = []; let remaining = 7000;
  for (const {id} of hits.slice(0, 6)) {
    const {tableRows, unknownRows, ...table} = prepared[id]; delete table.id;
    const headerIndexes = tableRows.flatMap((row, index) => row.cells.some(c => c.role === 'columnheader') ? [index] : []).slice(0, 2);
    const ranked = query ? rankEvidence(tableRows.map((row, id) => ({id, text: row.cells.map(c => c.text).join(' ')})), query).map(hit => hit.id) : tableRows.map((_, id) => id);
    const selected = [...new Set([...headerIndexes, ...ranked])].slice(0, 8).sort((a, b) => a-b);
    const chosen = [];
    for (const index of selected) {
      const row = tableRows[index], size = JSON.stringify(row).length;
      if (size > remaining) continue;
      remaining -= size; chosen.push(row);
    }
    const omittedRows = tableRows.length - chosen.length;
    tables.push({...table, rows: chosen, observedRows: tableRows.length, omittedRows,
      partial: domTruncated || omittedRows > 0 || chosen.some(r => r.omittedCells || r.cells.some(c => c.textTruncated || c.contentOmitted)) || unknownRows ||
        tableRows.some((row, index) => row.index !== index+1) ||
        !!table.declaredRows && table.declaredRows > tableRows.length ||
        !!table.declaredColumns && tableRows.some(row => row.cells.reduce((count, cell) => count+(cell.colSpan || 1), 0) < table.declaredColumns),
    });
  }
  const scrollContainers = [];
  for (const el of visible) {
    if (scrollContainers.length >= 6) break;
    const scroll = scrollGeometry(el);
    if (!scroll) continue;
    const name = authoredName(el, secret); if (secret(el, name)) continue;
    scrollContainers.push({name, role: roles.get(el), inViewport: inViewport(el), ...scroll});
  }
  const scroller = document.scrollingElement;
  return {
    pageState: {language: clean(document.documentElement.lang, 40), readyState: document.readyState,
      viewport: {width: innerWidth, height: innerHeight, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY),
        maxScrollX: Math.max(0, (scroller?.scrollWidth || innerWidth)-innerWidth), maxScrollY: Math.max(0, (scroller?.scrollHeight || innerHeight)-innerHeight)}},
    surfaces: {canvas: visible.filter(el => el.tagName === 'CANVAS').length, images: visible.filter(el => el.tagName === 'IMG').length, svg: visible.filter(el => el.localName === 'svg').length,
      embeddedFrames: visible.filter(el => el.matches('iframe,frame')).length, scrollContainers,
      pendingImages: visible.filter(el => el.tagName === 'IMG' && !el.complete).length,
      failedImages: visible.filter(el => el.tagName === 'IMG' && el.complete && !el.naturalWidth && (el.currentSrc || el.getAttribute('src'))).length},
    tables, tableCoverage: {observed: prepared.length, returned: tables.length, queryFiltered: !!query, omitted: prepared.length-tables.length,
      ...(tables.length ? {columns: 'DOM cell order or explicit aria-colindex. Preserve spans; rowSpan=0 extends to the end of its row group.'} : {})},
  };
}
