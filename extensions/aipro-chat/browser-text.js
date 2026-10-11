// Static helpers only. User/model JavaScript never runs in the page realm.
export function editableText(el) {
  if (!el.isConnected) throw new Error('browser_stale');
  if (el.isContentEditable) {
    // Chrome innerText inserts extra blank lines for mixed text/div/br editor
    // content. Use its native selected-text serialization and immediately
    // restore selection/focus. Nothing goes through the clipboard.
    const selection = getSelection();
    const ranges = Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange());
    const {anchorNode, anchorOffset, focusNode, focusOffset} = selection;
    const root = el.getRootNode(), focused = root.activeElement || document.activeElement;
    try {
      const range = document.createRange(); range.selectNodeContents(el);
      selection.removeAllRanges(); selection.addRange(range);
      return selection.toString().replace(/\u00a0/g, ' ');
    } finally {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
      if (ranges.length === 1 && anchorNode?.isConnected && focusNode?.isConnected) selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
      if (focused?.isConnected && focused !== (root.activeElement || document.activeElement)) focused.focus({preventScroll: true});
    }
  }
  if (el.matches('textarea,input[type="text"],input:not([type]),input[type="search"],input[type="email"],input[type="url"],input[type="tel"]')) return el.value;
  throw new Error('fill_invalid');
}
export async function textDigest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const compact = value => String(value).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
// Adds text at the start or the end of a field and keeps what it already held.
// A reply or forward is written above the quoted original and the signature;
// a fill would erase both (reported from a company mail: a forward lost its
// "----- Original Message -----" part). An editor may split the inserted lines
// into its own blocks, so the check compares text with whitespace collapsed.
export async function insertText(handle, page, text, position, cancelled) {
  if (typeof text !== 'string' || !text || text.length > 16000 || !['start', 'end'].includes(position)) throw new Error('fill_invalid');
  if (!await handle.evaluate(el => el.isConnected && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true')) throw new Error('browser_stale');
  const raw = await handle.evaluate(el => el.isContentEditable ? el.innerText : el.value);
  const before = await handle.evaluate(editableText);
  if (before.length + text.length > 400000) throw new Error('fill_invalid');
  if (cancelled()) throw new Error('cancelled');
  await handle.focus();
  await handle.evaluate((el, {raw, position}) => {
    const root = el.getRootNode(), focused = root.activeElement;
    if (!el.isConnected || !(focused === el || el.contains(focused)) || (el.isContentEditable ? el.innerText : el.value) !== raw) throw new Error('browser_stale');
    if (el.isContentEditable) {
      const range = document.createRange(); range.selectNodeContents(el); range.collapse(position === 'start');
      // Keep the caret inside the first or last text, not beside a block.
      let edge = el;
      while (position === 'start' ? edge.firstChild : edge.lastChild) edge = position === 'start' ? edge.firstChild : edge.lastChild;
      if (edge.nodeType === Node.TEXT_NODE) {range.setStart(edge, position === 'start' ? 0 : edge.textContent.length); range.collapse(true);}
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    } else {const at = position === 'start' ? 0 : el.value.length; el.setSelectionRange(at, at);}
  }, {raw, position});
  if (cancelled()) throw new Error('cancelled');
  await page.keyboard.insertText(text);
  const [added, kept] = [compact(text), compact(before)];
  let after = '', verified = false;
  for (let i = 0; i < 2; i++) {
    if (cancelled()) throw new Error('cancelled');
    after = compact(await handle.evaluate(editableText));
    verified = position === 'start' ? after.startsWith(added) && after.endsWith(kept) : after.startsWith(kept) && after.endsWith(added);
    if (!verified) break;
    if (!i) await new Promise(resolve => setTimeout(resolve, 150));
  }
  return {ok: verified, verified, inserted: text.length, position, kept: before.length,
    ...(verified ? {} : {error: 'fill_not_retained'}),
    scope: 'Inserted visible text only; the text the field already held was kept. Verify_page and visible save confirmation are still required.'};
}
export async function appendText(handle, page, text, options, cancelled) {
  if (typeof text !== 'string' || !text || text.length > 4000 || !Number.isSafeInteger(options?.expectedLength) || options.expectedLength < 0 ||
    options.expectedDigest != null && !/^[a-f0-9]{64}$/.test(options.expectedDigest)) throw new Error('fill_invalid');
  if (!await handle.evaluate(el => el.isConnected && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true')) throw new Error('browser_stale');
  const raw = await handle.evaluate(el => el.isContentEditable ? el.innerText : el.value);
  const before = await handle.evaluate(editableText);
  if (before.length !== options.expectedLength || options.expectedDigest && await textDigest(before) !== options.expectedDigest) throw new Error('browser_stale');
  const rich = await handle.evaluate(el => el.isContentEditable);
  const expected = before + (rich ? text.replace(/\u00a0/g, ' ') : text);
  if (expected.length > 400000) throw new Error('fill_invalid');
  if (cancelled()) throw new Error('cancelled');
  await handle.focus();
  await handle.evaluate((el, raw) => {
    const root = el.getRootNode(), focused = root.activeElement;
    if (!el.isConnected || !(focused === el || el.contains(focused)) || (el.isContentEditable ? el.innerText : el.value) !== raw) throw new Error('browser_stale');
    if (el.isContentEditable) {
      const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
      // A caret after a final block is outside its text and Chrome inserts an
      // extra paragraph there. Keep it inside the terminal text when present.
      let end = el;
      while (end.lastChild) end = end.lastChild;
      if (end.nodeType === Node.TEXT_NODE) range.setStart(end, end.textContent.length);
      range.collapse(true);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    } else el.setSelectionRange(el.value.length, el.value.length);
  }, raw);
  if (cancelled()) throw new Error('cancelled');
  await page.keyboard.insertText(text);
  let verified = false;
  for (let i = 0; i < 2; i++) {
    if (cancelled()) throw new Error('cancelled');
    verified = await handle.evaluate(editableText) === expected;
    if (!verified) break;
    if (!i) await new Promise(resolve => setTimeout(resolve, 150));
  }
  return {ok: verified, verified, appended: text.length, length: expected.length,
    ...(verified ? {digest: await textDigest(expected)} : {error: 'fill_not_retained'}),
    scope: 'Appended visible text only (contenteditable non-breaking spaces normalized). Verify_page and visible save confirmation are still required.'};
}
// Formatted text for a rich editor (an editable element or a design-mode frame
// body). The editor receives it the way a user's paste arrives, so its own
// document model, undo history and saving see it; an editor that ignores paste
// gets the browser's insertHTML command. Only text structure is kept: paragraphs,
// line breaks, emphasis, lists, headings, quotes, code, links and tables, with no
// style, script, handler or media. Parsed in an inert template, never run.
// Self-contained: Playwright serializes it into the editor's frame.
export async function richEditorHTML(el, {html, position = null, dryRun = false}) {
  if (!el.isConnected || !el.isContentEditable) throw new Error('fill_format_unsupported');
  const doc = el.ownerDocument, win = doc.defaultView;
  const template = doc.createElement('template');
  template.innerHTML = html;
  const allowed = new Set(['P', 'BR', 'DIV', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'DEL', 'INS', 'SUB', 'SUP', 'CODE', 'PRE', 'BLOCKQUOTE',
    'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'HR']);
  const dropped = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO',
    'CANVAS', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE', 'HEAD', 'TITLE']);
  const clean = parent => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) continue;
      if (node.nodeType !== Node.ELEMENT_NODE || dropped.has(node.tagName.toUpperCase())) {node.remove(); continue;}
      clean(node);
      if (!allowed.has(node.tagName.toUpperCase())) {node.replaceWith(...node.childNodes); continue;}
      for (const {name, value} of [...node.attributes]) {
        const keep = node.tagName === 'A' && name === 'href' && /^(?:https?:|mailto:)/i.test(value.trim()) || ['TD', 'TH'].includes(node.tagName) && ['colspan', 'rowspan'].includes(name) && /^[1-9]\d?$/.test(value);
        if (!keep) node.removeAttribute(name);
      }
    }
  };
  clean(template.content);
  const safe = template.innerHTML;
  // The lines a reader sees, for the clipboard's plain text and for the check.
  const blocks = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE', 'UL', 'OL', 'HR']);
  const lines = []; let line = '';
  const flush = () => {const value = line.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); if (value) lines.push(value); line = '';};
  const walk = (node, pre) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {const parts = pre ? child.data.split('\n') : [child.data]; parts.forEach((part, index) => {if (index) flush(); line += part;});}
      else if (child.tagName === 'BR') flush();
      else {
        const block = blocks.has(child.tagName);
        if (block) flush();
        if (['TD', 'TH'].includes(child.tagName) && line.trim()) line += ' ';
        walk(child, pre || child.tagName === 'PRE');
        if (block) flush();
      }
    }
  };
  walk(template.content, false); flush();
  const text = lines.join('\n');
  if (!text) throw new Error('fill_invalid');
  if (dryRun) return {text, lines: lines.length};
  const formatting = root => ({paragraphs: root.querySelectorAll('p').length, listItems: root.querySelectorAll('li').length,
    bold: root.querySelectorAll('strong,b,[style*="font-weight"]').length, italic: root.querySelectorAll('em,i').length,
    links: root.querySelectorAll('a[href]').length, tables: root.querySelectorAll('table').length, headings: root.querySelectorAll('h1,h2,h3,h4,h5,h6').length});
  const compact = value => String(value).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const before = compact(el.innerText), countsBefore = formatting(el), added = compact(text);
  // The caret goes where the text belongs: the whole content, or inside the
  // first or last text so a paste does not open an extra block beside it.
  el.focus({preventScroll: true});
  const selection = el.getRootNode().getSelection?.() || win.getSelection();
  const range = doc.createRange(); range.selectNodeContents(el);
  if (position) {
    range.collapse(position === 'start');
    let edge = el;
    while (position === 'start' ? edge.firstChild : edge.lastChild) edge = position === 'start' ? edge.firstChild : edge.lastChild;
    if (edge.nodeType === Node.TEXT_NODE) {range.setStart(edge, position === 'start' ? 0 : edge.textContent.length); range.collapse(true);}
  }
  selection.removeAllRanges(); selection.addRange(range);
  // Editors with their own model (ProseMirror, Quill, CKEditor) follow the page
  // selection on its selectionchange event, which runs after this task.
  await new Promise(resolve => setTimeout(resolve, 50));
  // Every character arrives in order; an editor may still change the spaces
  // between blocks or table cells as it lays them out.
  const bare = value => value.replace(/\s+/g, '');
  const holds = () => {
    const now = bare(el.innerText.replace(/\u00a0/g, ' ')), [add, kept] = [bare(added), bare(before)];
    return position === 'start' ? now.startsWith(add) && now.endsWith(kept) : position === 'end' ? now.startsWith(kept) && now.endsWith(add) : now === add;
  };
  const settle = async limit => {for (const started = Date.now(); Date.now() - started < limit;) {if (holds()) return true; await new Promise(resolve => setTimeout(resolve, 50));} return holds();};
  const data = new win.DataTransfer();
  data.setData('text/html', safe); data.setData('text/plain', text);
  let handled = false;
  try {
    const anchor = selection.anchorNode;
    const target = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement || el;
    handled = !target.dispatchEvent(new win.ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true, composed: true}));
  } catch { /* No constructible clipboard event: the command below inserts. */ }
  // An editor that took the paste is never given the text a second time.
  let verified = handled ? await settle(2000) : false, method = 'paste';
  if (!handled) {
    method = 'insert_html';
    if (!doc.execCommand('insertHTML', false, safe)) throw new Error('fill_format_unsupported');
    verified = await settle(600);
  }
  const after = formatting(el), expected = formatting(template.content);
  const arrived = Object.fromEntries(Object.keys(expected).map(key => [key, position ? Math.max(0, after[key] - countsBefore[key]) : after[key]]));
  const lost = Object.keys(expected).filter(key => expected[key] > 0 && arrived[key] < expected[key] && key !== 'paragraphs');
  return {ok: verified, verified, method, characters: text.length, lines: lines.length, ...(position ? {position, kept: before.length} : {}),
    formatting: arrived, ...(lost.length ? {formattingLost: lost} : {}), ...(verified ? {} : {error: 'fill_not_retained'})};
}
