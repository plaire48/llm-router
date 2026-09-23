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
