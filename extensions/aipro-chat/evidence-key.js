// Run-local comparison only: never an element locator, permission, persisted
// page identity or evidence of a successful action. Keep authored DOM IDs,
// frame ownership, coverage and actual state; ignore only observation handles.
export function evidenceKey(value, {progress = false} = {}) {
  function comparable(item) {
    if (Array.isArray(item)) return item.map(comparable);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().filter(key =>
      !['ref', 'region_ref', 'field_id', 'nonce', 'analysis_evidence_id', 'screenshot_id'].includes(key) &&
      !(key === 'id' && Array.isArray(item.frames)) &&
      !(key === 'content_ref' && item.dataKind === 'page_content') &&
      !(key === 'observedAt' && (Array.isArray(item.elements) || item.dataKind === 'page_content')) &&
      !(progress && ['focused', 'timestamp', 'at'].includes(key))
    ).map(key => [key, comparable(item[key])]));
  }
  return JSON.stringify(comparable(value));
}
