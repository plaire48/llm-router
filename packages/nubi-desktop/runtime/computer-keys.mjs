// Keyboard input for the connected window (user decision 2026-09-30: every mouse and keyboard operation,
// each one approved). press_keys sends named keys and shortcuts; type_text types literal text. Refused here,
// before anything reaches the app: keys that act on Windows rather than on the app (the Windows key, Alt with
// Tab, Esc, F4 or Space and Ctrl with Esc whatever Shift does, every Ctrl+Alt combination), paste shortcuts
// (the user's clipboard is not the agent's to insert), and a key that moves focus or commits anywhere but last:
// what follows it would reach a control nobody checked, such as a password field.
const NAMED=new Set(['enter','tab','esc','space','backspace','delete','insert','home','end','pageup','pagedown','up','down','left','right',...Array.from({length:12},(_,index)=>'f'+(index+1))]);
const ALIASES={escape:'esc',return:'enter',del:'delete',ins:'insert',pgup:'pageup',pgdn:'pagedown',arrowup:'up',arrowdown:'down',arrowleft:'left',arrowright:'right',control:'ctrl',ctl:'ctrl'};
const MODIFIERS=['ctrl','shift','alt'],SYSTEM_KEYS=new Set(['win','windows','meta','cmd','super','lwin','rwin']);
const ALT_SYSTEM=new Set(['tab','esc','f4','space']),PASTE=new Set(['ctrl+v','shift+insert','ctrl+shift+v']);
const MOVES_FOCUS=new Set(['tab','shift+tab','ctrl+tab','ctrl+shift+tab','enter','esc','f6','shift+f6']);
export const KEY_LIMITS=Object.freeze({keys:200,tokens:10,text:1000});

// Returns {keys, tokens} in the grammar of winapp send-keys, or {problem, token} when the keys are refused.
// A letter or digit alone, or with Shift only, is text: type_text types it.
export function parseKeys(keys){
  if(typeof keys!=='string'||!keys.trim()||keys.length>KEY_LIMITS.keys)return {problem:'keys_invalid'};
  const raw=keys.trim().toLowerCase().split(/\s+/);
  if(raw.length>KEY_LIMITS.tokens)return {problem:'keys_too_many'};
  const tokens=[];
  for(const token of raw){
    const parts=token.split('+').map(part=>ALIASES[part]||part);
    if(parts.some(part=>SYSTEM_KEYS.has(part)))return {problem:'keys_system',token};
    const key=parts.at(-1),modifiers=parts.slice(0,-1);
    if(parts.some(part=>!part)||new Set(modifiers).size!==modifiers.length||modifiers.some(part=>!MODIFIERS.includes(part)))return {problem:'keys_invalid',token};
    const single=/^[a-z0-9]$/.test(key);
    if(!NAMED.has(key)&&!single)return {problem:'keys_invalid',token};
    if(single&&!modifiers.some(part=>part!=='shift'))return {problem:'keys_text',token};
    const normal=[...MODIFIERS.filter(part=>modifiers.includes(part)),key].join('+'),alt=modifiers.includes('alt'),ctrl=modifiers.includes('ctrl');
    if(alt&&ALT_SYSTEM.has(key)||ctrl&&key==='esc'||ctrl&&alt)return {problem:'keys_system',token};
    if(PASTE.has(normal))return {problem:'keys_clipboard',token};
    tokens.push(normal);
  }
  const moves=tokens.findIndex(token=>MOVES_FOCUS.has(token));
  if(moves>=0&&moves<tokens.length-1)return {problem:'keys_focus_not_last',token:tokens[moves]};
  return {keys:tokens.join(' '),tokens};
}

// Text typed as it is. Enter, Tab and other keys are pressed with press_keys, never typed as characters.
export function textProblem(text){
  if(typeof text!=='string'||!text.length||text.length>KEY_LIMITS.text)return 'text_invalid';
  if(/[\u0000-\u001f\u007f]/u.test(text))return 'text_control_character';
  // The text is an argument of the command line: a leading dash would read as an option, a leading @ as a file of them.
  if(text.startsWith('-'))return 'text_leading_dash';
  if(text.startsWith('@'))return 'text_leading_at';
  return null;
}

// Whether typed text shows in the value read back afterwards. Typing inserts at the caret, so the value may hold
// more than the text; spacing and digit grouping that an app adds are ignored.
// Text that is only spacing and digit grouping cannot be told apart this way and never counts as present.
export function typedTextPresent(value,text){
  const plain=item=>String(item??'').normalize('NFC').replace(/[\s,]/g,'');
  return typeof value==='string'&&plain(text).length>0&&plain(value).includes(plain(text));
}
