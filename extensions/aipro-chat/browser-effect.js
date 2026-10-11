// What an action changed on the page, from the observation the model acted on
// and the one taken after the action. Product agents return this kind of
// summary because a model tends to assume the outcome it intended. Measured in
// nubi (W-02): a star that turned on only by a class name was clicked again on
// review and turned off; its row state change is now stated here. Refs differ
// between observations, so controls are matched by frame, role, name and the
// names of their ancestors, in page order. Field values are never read: a field
// whose value changed is known only from the mark its observations keep, and is
// given by the caller. Every list is bounded.
const STATE_KEYS = ['checked', 'pressed', 'expanded', 'selected', 'current', 'stateHint', 'disabled', 'invalid'];
const LIST = 4, CHANGES = 6, TEXT = 160;
const FIELDS = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
export const CLICK_TOOLS = new Set(['click_element', 'click_at', 'drag_element']);
export const NO_EFFECT_NOTE = 'No change was observed in the address, title, dialogs, alerts, control states, field values or text after this action. It may not have taken effect, or its effect is outside the observation (a field not listed, a canvas, a print or file window, another tab). Check the intended result before repeating the action.';
// Product agents stop repeating a step that does nothing: they change approach
// or hand the step back to the user.
export const REPEATED_NO_EFFECT_NOTE = 'Several actions in a row changed nothing that could be observed. Do not repeat them. Read the target state (capture_page with its ref, or read_page), try another control or the keyboard, or ask the user when the page does not respond.';

const clip = (value, limit = TEXT) => {const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;};
const frameKey = frame => frame.frame === 0 ? 'top' : JSON.stringify([frame.url || '', frame.owner || null]);
const usable = frame => frame && typeof frame === 'object' && !frame.unavailable && Array.isArray(frame.elements);
const controlKey = element => JSON.stringify([element.role || '', element.name || '', (element.context || []).map(item => [item.role || '', item.name || ''])]);
const siteKey = element => JSON.stringify([element.role || '', (element.context || []).map(item => [item.role || '', item.name || ''])]);
function stateOf(element) {
  const state = {};
  for (const key of STATE_KEYS) if (element[key] !== undefined && element[key] !== false) state[key] = element[key];
  const words = (element.context || []).flatMap(item => Array.isArray(item.state) ? item.state : []);
  if (words.length) state.row = words.join(',');
  return state;
}
const label = element => ({...(element.ref ? {ref: element.ref} : {}), role: element.role || '', name: clip(element.name, 80)});
// Groups by key in page order, so the n-th control with one key is compared
// with the n-th control with that key in the other observation.
function grouped(elements, key) {
  const groups = new Map();
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const id = key(element);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(element);
  }
  return groups;
}
function lines(frame) {
  if (typeof frame.text !== 'string' || frame.textFiltered) return null;
  const list = frame.text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length > 1);
  // A cut text ends in a partial line that is not a change of the page.
  if (frame.truncated || frame.coverage?.textTruncated) list.pop();
  return list;
}
function difference(after, before) {
  const counts = new Map();
  for (const item of before) counts.set(item, (counts.get(item) || 0) + 1);
  const added = [];
  for (const item of after) {
    const left = counts.get(item) || 0;
    if (left) counts.set(item, left - 1); else added.push(item);
  }
  return added;
}
const dialogs = frame => (Array.isArray(frame.regions) ? frame.regions : []).filter(region => ['dialog', 'alertdialog'].includes(region?.role))
  .map(region => `${region.role}${region.name ? ` "${clip(region.name, 80)}"` : ''}`);
const alerts = frame => (Array.isArray(frame.alerts) ? frame.alerts : []).map(alert => clip(alert?.text, 200)).filter(Boolean);

export function observationEffect(before, after, tool = '', {fieldsChanged = []} = {}) {
  if (!before || !after || !Array.isArray(before.frames) || !Array.isArray(after.frames)) return null;
  const effect = {};
  if (before.tabId !== after.tabId) effect.tabChanged = true;
  if (before.url !== after.url) effect.urlChanged = true;
  if (before.title !== after.title) effect.titleChanged = true;
  if (before.topDocumentId && after.topDocumentId && before.topDocumentId !== after.topDocumentId) effect.newDocument = true;
  // Another tab or a new document: its controls are not changes of the old ones.
  if (effect.tabChanged || effect.newDocument) return effect;
  const earlier = new Map(before.frames.filter(usable).map(frame => [frameKey(frame), frame]));
  const opened = [], closed = [], alerted = [], changed = [], renamed = [], added = [], removed = [], textAdded = [];
  let textRemoved = 0, comparable = true, framesAdded = 0, focused = null, countFrom = 0, countTo = 0, movedControls = 0, textMoved = false;
  for (const frame of after.frames.filter(usable)) {
    const old = earlier.get(frameKey(frame));
    earlier.delete(frameKey(frame));
    if (!old) {framesAdded++; continue;}
    opened.push(...difference(dialogs(frame), dialogs(old)));
    closed.push(...difference(dialogs(old), dialogs(frame)));
    alerted.push(...difference(alerts(frame), alerts(old)));
    const [now, then] = [lines(frame), lines(old)];
    if (now && then) {
      const [came, left] = [difference(now, then), difference(then, now)];
      textAdded.push(...came); textRemoved += left.length;
      // The same lines in another order: a sorted table or a moved item.
      if (!came.length && !left.length && now.some((line, index) => line !== then[index])) textMoved = true;
    }
    // Added and removed controls are facts only when both lists are complete.
    // Otherwise the number of controls the page had is compared instead: a menu
    // that opens on a long page adds controls that the list may leave out.
    const complete = !frame.textFiltered && !old.textFiltered && !frame.omittedControls && !old.omittedControls;
    if (!complete) {
      comparable = false;
      const [from, to] = [old.coverage?.controlsObserved, frame.coverage?.controlsObserved];
      if (Number.isSafeInteger(from) && Number.isSafeInteger(to) && from !== to && !frame.textFiltered && !old.textFiltered) {countFrom += from; countTo += to;}
    }
    // Focus that lands in a field is an effect (a click that opens a field for
    // typing); focus on the clicked button itself is not.
    const field = frame.elements.find(element => element?.focused === true && FIELDS.has(element.role));
    if (field && !focused && controlKey(field) !== controlKey(old.elements.find(element => element?.focused === true) || {})) focused = label(field);
    const nowGroups = grouped(frame.elements, controlKey), thenGroups = grouped(old.elements, controlKey);
    const unmatchedNow = [], unmatchedThen = [];
    for (const [key, list] of nowGroups) {
      const previous = thenGroups.get(key) || [];
      list.forEach((element, index) => {
        const match = previous[index];
        if (!match) {unmatchedNow.push(element); return;}
        const [from, to] = [stateOf(match), stateOf(element)];
        const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(name => JSON.stringify(from[name]) !== JSON.stringify(to[name]));
        if (keys.length) changed.push({...label(element), from: Object.fromEntries(keys.map(name => [name, from[name] ?? false])), to: Object.fromEntries(keys.map(name => [name, to[name] ?? false]))});
      });
      unmatchedThen.push(...previous.slice(list.length));
    }
    for (const [key, previous] of thenGroups) if (!nowGroups.has(key)) unmatchedThen.push(...previous);
    // One control that left and one that came in the same place and role is the
    // same control with a new name ("Follow" to "Following").
    const leftBySite = grouped(unmatchedThen, siteKey), cameBySite = grouped(unmatchedNow, siteKey);
    for (const [site, came] of cameBySite) {
      const left = leftBySite.get(site);
      if (left?.length === 1 && came.length === 1) {
        renamed.push({...label(came[0]), from: clip(left[0].name, 80)});
        leftBySite.delete(site); cameBySite.delete(site);
      }
    }
    if (complete) {
      for (const list of cameBySite.values()) added.push(...list);
      for (const list of leftBySite.values()) removed.push(...list);
      // The same controls in another order (a drag, a sort) is a change too.
      if (!unmatchedNow.length && !unmatchedThen.length) {
        const [order, previous] = [frame.elements.map(controlKey), old.elements.map(controlKey)];
        movedControls += order.filter((key, index) => key !== previous[index]).length;
      }
    }
  }
  const framesRemoved = earlier.size;
  if (opened.length) effect.dialogsOpened = opened.slice(0, LIST);
  if (closed.length) effect.dialogsClosed = closed.slice(0, LIST);
  if (alerted.length) effect.alertsAdded = alerted.slice(0, 3);
  if (changed.length) effect.controlsChanged = changed.slice(0, CHANGES);
  if (changed.length > CHANGES) effect.controlsChangedOmitted = changed.length - CHANGES;
  if (renamed.length) effect.controlsRenamed = renamed.slice(0, LIST);
  if (added.length) effect.controlsAdded = {count: added.length, first: added.slice(0, LIST).map(label)};
  // A removed control keeps no ref: the one it had was released with its observation.
  if (removed.length) effect.controlsRemoved = {count: removed.length, first: removed.slice(0, LIST).map(element => ({role: element.role || '', name: clip(element.name, 80)}))};
  if (textAdded.length) effect.textAdded = {count: textAdded.length, first: textAdded.slice(0, 3).map(line => clip(line))};
  if (textRemoved) effect.textRemoved = {count: textRemoved};
  if (focused) effect.focused = focused;
  // A value that changed without typing (a date picker, a lookup), never the value itself.
  if (Array.isArray(fieldsChanged) && fieldsChanged.length) effect.fieldsChanged = {count: fieldsChanged.length, first: fieldsChanged.slice(0, LIST).map(label)};
  if (movedControls || textMoved) effect.reordered = {...(movedControls ? {controls: movedControls} : {}), ...(textMoved ? {text: true} : {})};
  if (countFrom !== countTo) effect.controlCount = {from: countFrom, to: countTo};
  if (framesAdded || framesRemoved) effect.frames = {added: framesAdded, removed: framesRemoved};
  if (!comparable) effect.partial = 'Some observation was filtered or left out controls, so added or removed controls are not listed.';
  const facts = Object.keys(effect).filter(key => key !== 'partial');
  if (!facts.length) {
    effect.none = true;
    if (CLICK_TOOLS.has(tool)) effect.note = NO_EFFECT_NOTE;
  }
  return effect;
}
// Counts click-like actions in a row whose effect was none; any observed change
// resets it. From the second, the note says to stop repeating.
export function noteRepeatedNoEffect(task, tool, effect) {
  if (!effect || !CLICK_TOOLS.has(tool)) return effect;
  task.noEffectStreak = effect.none ? (task.noEffectStreak || 0) + 1 : 0;
  return effect.none && task.noEffectStreak >= 2 ? {...effect, note: REPEATED_NO_EFFECT_NOTE, repeated: task.noEffectStreak} : effect;
}
