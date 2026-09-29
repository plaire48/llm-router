import {Errors} from 'typebox/schema';

const rules = new Set(['type', 'required', 'additionalProperties', 'pattern', 'format', 'enum', 'const', 'anyOf', 'oneOf', 'not',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties']);
const escape = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const unescape = value => value.replaceAll('~1', '/').replaceAll('~0', '~');
const variants = schema => schema && typeof schema === 'object' ? [schema, ...['anyOf', 'oneOf', 'allOf'].flatMap(key => (schema[key] || []).flatMap(variants))] : [];

// Only names from the host's declared schema enter repair feedback. Keep union
// and intersection fragments separate: merging their required keys would
// invent a condition that no individual union branch requires.
function objectHints(candidates, path) {
  const objectSchemas = [], seen = new Set();
  let remaining = 1800, truncated = false;
  for (const candidate of candidates) {
    if (!candidate.properties && candidate.type !== 'object') continue;
    const allowedProperties = [], requiredProperties = [];
    const declared = Object.keys(candidate.properties || {});
    for (const name of declared) {
      const cost = JSON.stringify(name).length * (candidate.required?.includes(name) ? 2 : 1);
      if (name.length > 80 || allowedProperties.length >= 24 || cost > remaining) {truncated = true; continue;}
      allowedProperties.push(name); remaining -= cost;
      if (candidate.required?.includes(name)) requiredProperties.push(name);
    }
    const hint = {allowedProperties, requiredProperties,
      ...(candidate.additionalProperties === false ? {additionalProperties: false} : {})};
    const key = JSON.stringify(hint);
    if (seen.has(key)) continue;
    if (objectSchemas.length >= 4) {truncated = true; break;}
    seen.add(key); objectSchemas.push(hint);
  }
  return objectSchemas.length ? {objectSchemaPath: path, objectSchemas,
    ...(truncated ? {schemaHintsTruncated: true} : {})} : {};
}

// Error paths may contain arbitrary extra-property names supplied by the model.
// Return only schema-declared names and array positions, never those names or
// validator messages (Pi's validation errors also contain the entire input).
function safePath(schema, pointer) {
  let candidates = variants(schema);
  let resolved = true;
  const parts = [];
  for (const part of String(pointer || '').split('/').slice(1).map(unescape)) {
    const declared = candidates.filter(item => Object.hasOwn(item.properties || {}, part));
    if (declared.length) {
      parts.push(escape(part)); candidates = declared.flatMap(item => variants(item.properties[part]));
    } else if (/^(0|[1-9][0-9]{0,5})$/.test(part) && candidates.some(item => item.type === 'array')) {
      parts.push(part); candidates = candidates.flatMap(item => variants(item.prefixItems?.[Number(part)] ?? item.items));
    } else {parts.push('*'); resolved = false; break;}
    if (parts.length >= 12) {resolved = false; break;}
  }
  return {path: parts.length ? `/${parts.join('/')}` : '', candidates, resolved};
}

// Interpreter-based JSON Schema validation works under extension CSP and does
// not coerce or mutate raw model arguments. null means valid; [] is never valid.
export function toolArgumentIssues(schema, args) {
  try {
    const [valid, errors] = Errors(schema, args);
    if (valid) return null;
    const issues = [], seen = new Set();
    const add = issue => {
      const key = JSON.stringify(issue);
      if (issues.length < 4 && !seen.has(key)) {seen.add(key); issues.push(issue);}
    };
    for (const error of errors) {
      if (!rules.has(error.keyword)) continue;
      const {path, candidates, resolved} = safePath(schema, error.instancePath);
      if (error.keyword === 'required') {
        for (const key of error.params?.requiredProperties || []) {
          if (candidates.some(item => item.required?.includes(key) && Object.hasOwn(item.properties || {}, key))) add({path: `${path}/${escape(key)}`, rule: 'required', ...(resolved ? objectHints(candidates, path) : {})});
        }
      } else add({path, rule: error.keyword,
        ...(resolved && ['additionalProperties', 'anyOf', 'oneOf'].includes(error.keyword) ? objectHints(candidates, path) : {})});
      if (issues.length === 4) break;
    }
    return issues.length ? issues : [{path: '', rule: 'schema'}];
  } catch {return [{path: '', rule: 'schema'}];}
}
