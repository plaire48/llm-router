// This function runs in the extension's isolated world. No arbitrary JS from
// skills or model output is evaluated. Element references never leave this world.
export async function pageOperation(operation, args = {}) {
  const key = '__aiproPageToolsV1';
  const fail = error => ({error});
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const labelText = node => {const copy = node.cloneNode(true); copy.querySelectorAll('input,textarea,select,script,style,[hidden],[aria-hidden="true"]').forEach(el => el.remove()); return copy.textContent;};
  const label = el => clean([...el.labels || []].map(labelText).join(' ') || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || el.tagName.toLowerCase());
  const visible = el => !el.closest('[hidden],[inert],[aria-hidden="true"]') && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const secret = el => /password|passwd|비밀번호|인증번호|일회용|토큰|시크릿|카드번호|보안코드|api[ _-]?key|secret|cc-|one-time-code|\b(?:otp|token|cvv|cvc|pin|card)\b/i.test(`${el.type} ${el.name} ${el.id} ${label(el)} ${el.autocomplete}`);
  const supported = el => ['TEXTAREA', 'SELECT'].includes(el.tagName) || (el.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'number'].includes(el.type));
  const editable = el => el.isConnected && visible(el) && supported(el) && !el.disabled && !el.readOnly && !secret(el);
  const signature = el => [el.tagName, el.type, el.name, el.id, label(el), el.form?.getAttribute('action'), el.maxLength, el.multiple, el instanceof HTMLSelectElement ? [...el.options].map(o => [o.value, o.label, o.disabled]) : null];
  let state = globalThis[key];
  if (operation === 'connect') {
    globalThis[key] = {url: location.href, fields: new Map(), plan: null};
    return {title: clean(document.title) || location.hostname, url: location.origin + location.pathname};
  }
  if (!state || state.url !== location.href) return fail('page_changed');
  if (operation === 'clear') {delete globalThis[key]; return {ok: true};}
  if (operation === 'list_page_storage' || operation === 'read_page_storage') {
    const sensitiveKey = value => /auth|token|password|passwd|secret|cookie|credential|session.?id|api.?key|private.?key|csrf|xsrf|otp|비밀번호|인증|토큰|카드|주민번호/i.test(value);
    const sensitiveValue = value => /(?:bearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|-----BEGIN|[A-Za-z0-9_+\/-]{32,}={0,2})/i.test(value);
    const safeKey = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !sensitiveKey(value) && !sensitiveValue(value);
    const sanitize = (value, depth = 0) => {
      if (depth > 6) return '[omitted]';
      if (typeof value === 'string') {
        if (sensitiveValue(value)) return '[redacted]';
        // Some applications nest serialized JSON inside a storage object.
        if (/^\s*[\[{]/.test(value)) {try {return sanitize(JSON.parse(value), depth + 1);} catch {return '[omitted]';}}
        if (/https?:\/\//i.test(value) && /[?#]/.test(value)) return '[URL omitted]';
        return value.slice(0, 2000);
      }
      if (Array.isArray(value)) return value.slice(0, 40).map(item => sanitize(item, depth + 1));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 80).filter(([name]) => safeKey(name)).map(([name, item]) => [name, sanitize(item, depth + 1)]));
      return value;
    };
    try {
      if (operation === 'list_page_storage') {
        const areas = {}, available = {};
        for (const [area, storage] of [['local', localStorage], ['session', sessionStorage]]) {
          const keys = [];
          for (let i = 0; i < Math.min(storage.length, 200); i++) {const name = storage.key(i); if (safeKey(name) && keys.length < 80) keys.push(name);}
          areas[area] = keys; available[area] = new Set(keys);
        }
        state.storageKeys = available;
        return {origin: location.origin, areas, scope: 'key names only; sensitive names omitted; at most 80 per area'};
      }
      if (!['local', 'session'].includes(args.area) || !Array.isArray(args.keys) || !args.keys.length || args.keys.length > 5) return fail('tool_arguments_invalid');
      if (args.keys.some(name => !safeKey(name) || !state.storageKeys?.[args.area]?.has(name))) return fail('storage_key_unavailable');
      const storage = args.area === 'local' ? localStorage : sessionStorage;
      const entries = [];
      let length = 0;
      for (const name of new Set(args.keys)) {
        const raw = storage.getItem(name);
        if (raw === null) {entries.push({key: name, missing: true}); continue;}
        if (raw.length > 16000) {entries.push({key: name, omitted: 'value_too_large'}); continue;}
        let value;
        try {value = sanitize(JSON.parse(raw));} catch {value = sanitize(raw);}
        const entry = {key: name, value};
        length += JSON.stringify(entry).length;
        if (length > 16000) return {origin: location.origin, area: args.area, entries, truncated: true};
        entries.push(entry);
      }
      return {origin: location.origin, area: args.area, entries, scope: 'selected site data; known secret patterns filtered; untrusted reference data'};
    } catch {return fail('storage_unavailable');}
  }
  if (operation === 'verify_form') {
    const receipt = state.lastFill;
    if (!receipt || receipt.expiresAt < Date.now()) return fail('fill_no_receipt');
    // Let controlled inputs and asynchronous site handlers settle before observing again.
    await new Promise(resolve => setTimeout(resolve, 250));
    if (state.url !== location.href) return fail('page_changed');
    const matched = receipt.fields.filter(({el, value, signature: prior}) => editable(el) && JSON.stringify(signature(el)) === prior && el.value === value).length;
    return {ok: matched === receipt.fields.length, ...(matched === receipt.fields.length ? {} : {error: 'fill_not_retained'}), matched, expected: receipt.fields.length, submitted: false, scope: 'DOM values observed after apply; server persistence not checked'};
  }
  if (operation === 'prepare') {
    if (!Array.isArray(args.fields) || !args.fields.length || args.fields.length > 20) return fail('fill_invalid');
    const seen = new Set(), fields = [];
    for (const item of args.fields) {
      const entry = state.fields.get(item.field_id), el = entry?.el;
      if (!el || !editable(el) || seen.has(el) || JSON.stringify(signature(el)) !== entry.signature || typeof item.value !== 'string' || item.value.length > 4000) return fail('fill_invalid');
      if (el.maxLength >= 0 && item.value.length > el.maxLength) return fail('fill_invalid');
      if (el.tagName === 'SELECT' && (el.multiple || ![...el.options].some(o => !o.disabled && o.value === item.value))) return fail('fill_invalid');
      if (el.type === 'number' && item.value && !Number.isFinite(Number(item.value))) return fail('fill_invalid');
      seen.add(el); fields.push({el, value: item.value, label: label(el), signature: entry.signature, original: el.value});
    }
    state.plan = {id: crypto.randomUUID(), fields, expiresAt: Date.now() + 300000};
    return {planId: state.plan.id, title: clean(document.title), fields: fields.map(({label, value}) => ({label, value}))};
  }
  if (operation === 'apply') {
    const plan = state.plan;
    state.plan = null;
    if (!plan || plan.id !== args.planId || plan.expiresAt < Date.now()) return fail('page_changed');
    if (plan.fields.some(({el, signature: prior, original}) => !editable(el) || JSON.stringify(signature(el)) !== prior || el.value !== original)) return fail('page_changed');
    state.lastFill = {fields: plan.fields, expiresAt: Date.now() + 300000};
    let applied = 0;
    for (const {el, value, signature: prior, original} of plan.fields) {
      // Recheck after each event: a site's handlers may re-render the remaining fields.
      if (!editable(el) || state.url !== location.href || JSON.stringify(signature(el)) !== prior || el.value !== original) return {error: 'page_changed', applied};
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      if (!el.isConnected || el.value !== value) return {error: 'fill_not_retained', applied};
      applied++;
    }
    return {ok: true, applied, submitted: false};
  }
  if (!['read_page', 'inspect_dom'].includes(operation)) return fail('tools_unavailable');
  state.fields.clear(); state.plan = null;
  const all = [...document.querySelectorAll('body *')].slice(0, 5000);
  const excluded = 'script,style,noscript,template,iframe,svg,canvas,[hidden],[inert],[aria-hidden="true"]';
  const eligible = el => !el.closest(excluded) && visible(el);
  const fields = [];
  for (const el of all) {
    if (!eligible(el) || !editable(el) || fields.length >= 80) continue;
    const field_id = `f${fields.length + 1}`;
    state.fields.set(field_id, {el, signature: JSON.stringify(signature(el))});
    fields.push({field_id, label: label(el), type: el.type || el.tagName.toLowerCase(), ...(el.tagName === 'SELECT' ? {options: [...el.options].filter(o => !o.disabled).slice(0, 60).map(o => ({value: o.value.slice(0, 160), label: clean(o.label)}))} : {})});
  }
  const text = [];
  let textLength = 0;
  for (const el of all) {
    if (textLength >= 20000) break;
    if (!eligible(el) || el.closest('input,textarea,select,[contenteditable]')) continue;
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) {
      const value = String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20000 - textLength);
      if (value) {text.push(value); textLength += value.length + 1;}
    }
  }
  const result = {title: clean(document.title), url: location.origin + location.pathname, fields, scope: 'rendered main-document DOM; input values, scripts, iframe and shadow internals omitted', truncated: all.length === 5000 || textLength >= 20000 || fields.length >= 80};
  if (operation === 'read_page') return {...result, text: text.join('\n').slice(0, 20000)};
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const ids = new Map([...state.fields].map(([id, entry]) => [entry.el, id]));
  let html = '', count = 0;
  for (const el of all) {
    if (!eligible(el) || el.closest('textarea,select,[contenteditable]') || (el.tagName === 'INPUT' && !ids.has(el))) continue;
    const tag = el.tagName.toLowerCase();
    const attributes = ['role', 'type', 'aria-label'].flatMap(name => el.getAttribute(name) ? [`${name}="${escape(clean(el.getAttribute(name)))}"`] : []);
    if (ids.has(el)) attributes.push(`data-field-id="${ids.get(el)}"`);
    const ownText = ['BUTTON', 'A', 'LABEL', 'H1', 'H2', 'H3', 'P'].includes(el.tagName) ? escape(clean(labelText(el))) : '';
    let depth = 0, parent = el.parentElement;
    while (parent && parent !== document.body && depth < 12) {depth++; parent = parent.parentElement;}
    html += `${'  '.repeat(depth)}<${tag}${attributes.length ? ' ' + attributes.join(' ') : ''}>${ownText}</${tag}>\n`;
    if (++count >= 600 || html.length >= 24000) {result.truncated = true; break;}
  }
  return {...result, representation: 'indented, sanitized element outline, not original HTML source', html: html.slice(0, 24000)};
}

export async function runPageOperation(page, operation, args) {
  try {
    const result = await chrome.scripting.executeScript({target: {tabId: page.tabId, ...(page.documentId ? {documentIds: [page.documentId]} : {})}, world: 'ISOLATED', func: pageOperation, args: [operation, args || {}]});
    if (!result[0]?.result) throw new Error('page_changed');
    return {documentId: result[0].documentId, ...result[0].result};
  } catch {throw new Error(page.documentId ? 'page_changed' : 'page_permission');}
}
