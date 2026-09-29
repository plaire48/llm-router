// Saved prompts are plain composer text. A shortcut never grants tools or starts a run.
export const PROMPT_SHORTCUTS_KEY = 'promptShortcuts';
export const MAX_PROMPT_SHORTCUTS = 20;

const slugFor = name => name.normalize('NFKC').toLocaleLowerCase().trim()
  .replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function decodePromptShortcuts(value) {
  if (value === undefined) return [];
  if (!value || value.version !== 1 || !Array.isArray(value.items) || value.items.length > MAX_PROMPT_SHORTCUTS) throw new Error('prompt_shortcuts_invalid');
  const ids = new Set(), slugs = new Set();
  return value.items.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
        typeof item.slug !== 'string' || !/^[\p{L}\p{N}_-]{1,48}$/u.test(item.slug) || slugs.has(item.slug) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 ||
        typeof item.text !== 'string' || !item.text.trim() || item.text.length > 16000) throw new Error('prompt_shortcuts_invalid');
    ids.add(item.id); slugs.add(item.slug);
    return {id:item.id, slug:item.slug, name:item.name, text:item.text};
  });
}

export function savePromptShortcut(items, input, makeId = () => crypto.randomUUID()) {
  const name = String(input?.name || '').trim(), text = String(input?.text || '');
  if (!name || name.length > 60 || !text.trim() || text.length > 16000) throw new Error('prompt_shortcut_fields');
  const duplicate = items.some(item => item.name.normalize('NFKC').toLocaleLowerCase() === name.normalize('NFKC').toLocaleLowerCase() && item.id !== input.id);
  if (duplicate) throw new Error('prompt_shortcut_duplicate');
  if (input.id) {
    const index = items.findIndex(item => item.id === input.id);
    if (index < 0) throw new Error('prompt_shortcut_missing');
    return items.map((item, i) => i === index ? {...item, name, text} : item);
  }
  if (items.length >= MAX_PROMPT_SHORTCUTS) throw new Error('prompt_shortcut_limit');
  const base = slugFor(name) || 'prompt';
  let slug = base, suffix = 2;
  while (items.some(item => item.slug === slug)) slug = `${base.slice(0, 40 - String(suffix).length - 1)}-${suffix++}`;
  return [...items, {id:makeId(), slug, name, text}];
}

export function promptShortcutOptions(items, draft) {
  const match = /^\/([^\s/]*)$/.exec(draft);
  if (!match) return [];
  const query = match[1].normalize('NFKC').toLocaleLowerCase();
  return items.filter(item => `p:${item.slug}`.includes(query) || item.name.normalize('NFKC').toLocaleLowerCase().includes(query))
    .map(shortcut => ({kind:'prompt', shortcut, command:`p:${shortcut.slug}`}));
}

export async function readPromptShortcuts() {
  const stored = await chrome.storage.local.get(PROMPT_SHORTCUTS_KEY);
  return decodePromptShortcuts(stored[PROMPT_SHORTCUTS_KEY]);
}

export async function changePromptShortcuts(change, locks = globalThis.navigator?.locks) {
  // Every extension page has the same origin. Hold its exclusive lock through
  // the read, write and readback so two panels cannot overwrite each other.
  if (!locks?.request) throw new Error('prompt_shortcut_lock_unavailable');
  return locks.request('nubi-prompt-shortcuts-v1', {mode:'exclusive'}, async () => {
    const current = await readPromptShortcuts();
    const items = change(current);
    await chrome.storage.local.set({[PROMPT_SHORTCUTS_KEY]:{version:1, items}});
    if (JSON.stringify(await readPromptShortcuts()) !== JSON.stringify(items)) throw new Error('prompt_shortcut_changed');
    return items;
  });
}
