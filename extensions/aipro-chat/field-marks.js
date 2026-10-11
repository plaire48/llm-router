// Host-only record of what each observed field held when this run first saw
// it. The page reduces a value to a one-way mark; the mark is taken out of the
// observation here, before anything reaches the model or the review.
const MARK = /^\d{1,7}:[a-f0-9]{16}$/;
export const FIELD_MARK_LIMIT = 400;

// scope is the frame's complete address, kept in the host: two records of one
// screen differ only in their query. place is the field's place in its document as
// the page reports it, independent of which fields an observation returned. A
// field without a place has no record, and its check answers baseline_missing.
// baseline false: the document was still loading, so what it holds is not yet what
// the page will show. Such an observation updates nothing and starts no record.
export function takeFieldMarks(task, scope, descriptors, {baseline = true} = {}) {
  task.fieldMarks ||= new Map();
  return (Array.isArray(descriptors) ? descriptors : []).map(descriptor => {
    if (!descriptor || typeof descriptor !== 'object' || !Object.hasOwn(descriptor, 'valueMark') && !Object.hasOwn(descriptor, 'fieldPlace')) return {descriptor};
    const {valueMark, fieldPlace, ...visible} = descriptor;
    if (typeof scope !== 'string' || !scope || typeof fieldPlace !== 'string' || !fieldPlace) return {descriptor: visible};
    const fieldKey = JSON.stringify([scope, fieldPlace]);
    if (baseline && typeof valueMark === 'string' && MARK.test(valueMark)) {
      const known = task.fieldMarks.get(fieldKey);
      if (known) known.latest = valueMark;
      else if (task.fieldMarks.size < FIELD_MARK_LIMIT) task.fieldMarks.set(fieldKey, {first: valueMark, latest: valueMark});
    }
    return {descriptor: visible, fieldKey};
  });
}
// The address of a frame for the record above. A frame without an address of its
// own (about:blank, srcdoc) is told apart by the element that holds it.
export function fieldScope(frameURL, topURL, owner) {
  const own = typeof frameURL === 'string' && /^https?:/i.test(frameURL) ? frameURL : null;
  if (own) return own;
  if (typeof topURL !== 'string' || !/^https?:/i.test(topURL)) return null;
  return `${topURL}\n${JSON.stringify(['tag', 'id', 'name', 'title'].map(key => String(owner?.[key] || '').slice(0, 160)))}`;
}
// An action resolved this field as its target. Whatever the action did, the
// run can no longer claim that it left the field alone.
export function markFieldWritten(task, entry) {
  if (typeof entry?.fieldKey === 'string') (task.writtenFields ||= new Set()).add(entry.fieldKey);
}
export function fieldUnchanged(task, entry, currentMark) {
  const known = typeof entry?.fieldKey === 'string' ? task.fieldMarks?.get(entry.fieldKey) : null;
  if (!known || typeof currentMark !== 'string' || !MARK.test(currentMark)) return {passed: false, reason: 'baseline_missing'};
  if (task.writtenFields?.has(entry.fieldKey)) return {passed: false, reason: 'field_written'};
  return known.first === currentMark ? {passed: true, compared: 'first_observation'} : {passed: false, reason: 'value_changed'};
}
// Marks of every field of a frame, taken with each observation (fieldMarks in
// the page). The same record as above: the first mark of a place is its baseline.
export function recordFieldMarks(task, scope, marks) {
  task.fieldMarks ||= new Map();
  if (typeof scope !== 'string' || !scope || !Array.isArray(marks)) return;
  for (const [place, mark] of marks.slice(0, FIELD_MARK_LIMIT)) {
    if (typeof place !== 'string' || !place || typeof mark !== 'string' || !MARK.test(mark)) continue;
    const fieldKey = JSON.stringify([scope, place]), known = task.fieldMarks.get(fieldKey);
    if (known) known.latest = mark;
    else if (task.fieldMarks.size < FIELD_MARK_LIMIT) task.fieldMarks.set(fieldKey, {first: mark, latest: mark});
  }
}
// Every field of the current frames against its first mark, except the fields an
// action of this run aimed at. Only counts leave the host, never a value.
export function fieldsUnchanged(task, frames) {
  const counts = {kept: 0, changed: 0, written: 0, unobserved: 0, missing: 0}, seen = new Set();
  for (const {scope, marks} of frames) for (const [place, mark] of marks) {
    const fieldKey = JSON.stringify([scope, place]), known = task.fieldMarks?.get(fieldKey);
    seen.add(fieldKey);
    if (task.writtenFields?.has(fieldKey)) counts.written++;
    else if (!known || typeof mark !== 'string' || !MARK.test(mark)) counts.unobserved++;
    else if (known.first === mark) counts.kept++;
    else counts.changed++;
  }
  const scopes = new Set(frames.map(frame => frame.scope));
  for (const fieldKey of task.fieldMarks?.keys() || []) {
    if (!seen.has(fieldKey) && !task.writtenFields?.has(fieldKey) && scopes.has(JSON.parse(fieldKey)[0])) counts.missing++;
  }
  const passed = counts.kept > 0 && counts.changed === 0 && counts.unobserved === 0 && counts.missing === 0;
  return {passed, ...counts, compared: 'first_observation',
    ...(passed ? {} : {reason: counts.changed ? 'value_changed' : counts.missing ? 'field_missing' : counts.unobserved ? 'baseline_missing' : 'no_fields'})};
}
// The approval of a final action is carried out by a new request, and a new
// request starts a new browser task. Without this, the run after the approval had
// no baseline and no record of the cells written before it, so "leave the other
// cells alone" could not be shown after the final apply. Marks only, never values.
export function fieldBaseline(task) {
  if (!task.fieldMarks?.size) return undefined;
  return {marks: [...task.fieldMarks].slice(0, FIELD_MARK_LIMIT).map(([fieldKey, mark]) => [fieldKey, mark.first]),
    written: [...task.writtenFields || []].slice(0, FIELD_MARK_LIMIT)};
}
export function restoreFieldBaseline(task, baseline) {
  if (task.fieldMarks?.size || !Array.isArray(baseline?.marks)) return;
  task.fieldMarks = new Map();
  for (const [fieldKey, first] of baseline.marks.slice(0, FIELD_MARK_LIMIT))
    if (typeof fieldKey === 'string' && fieldKey.length <= 2000 && typeof first === 'string' && MARK.test(first)) task.fieldMarks.set(fieldKey, {first, latest: first});
  const written = Array.isArray(baseline.written) ? baseline.written.filter(fieldKey => typeof fieldKey === 'string' && fieldKey.length <= 2000).slice(0, FIELD_MARK_LIMIT) : [];
  if (written.length) task.writtenFields = new Set([...task.writtenFields || [], ...written]);
}
