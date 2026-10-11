import stringify from 'fast-json-stable-stringify';
// Stable object keys only. Preserve array order, field values and IDs so
// storage serialization cannot invalidate a grant or hide a real change.
export const canonicalJSON = value => stringify(value);
