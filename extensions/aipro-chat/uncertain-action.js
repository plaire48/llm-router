// Runtime-only reconciliation hints. Never persisted or used as permission.
const elements = observation => (observation?.frames || []).flatMap((frame, index) =>
  (frame.elements || []).map(element => ({element, frame, index})));
const ownerIdentity = owner => ['tag', 'id', 'name', 'title'].map(key => owner?.[key] || '');
const controlIdentity = element => [element.role, element.name,
  ...['id', 'testId', 'tag', 'type'].map(key => element[key] || ''),
  (element.context || []).map(context => [context.role || '', context.name || '', context.id || ''])];
function fullControlScope(frame) {
  const coverage = frame.coverage;
  if (coverage) return !coverage.queryFiltered && !coverage.domTruncated &&
    Number.isInteger(coverage.controlsObserved) && coverage.controlsObserved === coverage.controlsReturned;
  return !frame.truncated && !frame.omittedControls && !frame.retrieval;
}
function identity(observation, ref) {
  const all = elements(observation), matches = all.filter(item => item.element.ref === ref);
  if (matches.length !== 1) return null;
  const {element, frame, index} = matches[0];
  if (!Number.isInteger(observation.tabId) || !observation.topDocumentId ||
      !(frame.documentId || index === 0) || !element.name || !element.role || !observation.url || !fullControlScope(frame)) return null;
  const control = JSON.stringify(controlIdentity(element));
  if (all.filter(item => item.frame === frame && JSON.stringify(controlIdentity(item.element)) === control).length !== 1) return null;
  return JSON.stringify([observation.tabId, observation.topDocumentId, frame.documentId || observation.topDocumentId,
    observation.url, frame.frame ?? frame.frameId ?? frame.id ?? index,
    frame.url || observation.url, ownerIdentity(frame.owner), control]);
}
export function uncertainTargets(name, args, observation) {
  if (name === 'fill_form' && args.fields?.length) return args.fields.map(field => ({ref: field.field_id,
    identity: identity(observation, field.field_id), kind: 'field_value', expected: String(field.value)}));
  const element = elements(observation).find(item => item.element.ref === args.ref)?.element;
  if (name === 'click_element' && element && (element.stateKind || ['switch', 'checkbox', 'radio'].includes(element.role) || typeof element.checked === 'boolean' || typeof element.pressed === 'boolean'))
    return [{ref: args.ref, identity: identity(observation, args.ref), kind: 'control_state'}];
  // General link/script outcomes still need task-specific evidence.
  return null;
}
export function resolvesTargets(targets, checks, observation) {
  if (!targets) return true;
  return targets.every(target => target.identity && checks.some(check => check.kind === target.kind &&
    (target.expected === undefined || check.expected === target.expected) &&
    identity(observation, check.ref) === target.identity));
}
export function sameVerifiedDocuments(before, after, checks) {
  if (!Number.isInteger(before?.tabId) || before.tabId !== after?.tabId ||
      !before.topDocumentId || before.topDocumentId !== after.topDocumentId) return false;
  return checks.every(check => {
    // Page-level assertions (for example, visible text) have no element ref.
    // Their proof is scoped to the same top-level Chrome document above.
    if (!check.ref) return true;
    const found = elements(before).filter(item => item.element.ref === check.ref);
    if (found.length !== 1) return false;
    const documentId = found[0].frame.documentId || (found[0].index === 0 ? before.topDocumentId : null);
    return documentId && (after.frames || []).some(frame => frame.documentId === documentId);
  });
}
