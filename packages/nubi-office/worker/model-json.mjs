// Where a complete object fails to parse, in the model's own words: the character, the text around it, and for a text
// where a key was expected, that it needs its key. Measured 2026-10-01 (gpt-5.6-sol): a plan wrote its later steps as
// {"id":"2","기본 보고 정보 입력","kind":"write"} three times in a row under a refusal that did not say where.
function breakOf(text) {
  try {JSON.parse(text); return '';} catch (error) {
    const at = /position (\d+)/.exec(error.message); if (!at) return '';
    const position = +at[1], near = text.slice(Math.max(0, position - 60), position + 20);
    const key = /Expected ':' after property name|Expected property name/.test(error.message) ? ' A text stands where a key was expected: every value of an object needs its key, as in "title": "…".' : '';
    return ` The JSON breaks at character ${position}, near «${near}».${key}`;
  }
}
// Accept a single complete JSON object, including ordinary Markdown wrapping.
// Never evaluate scripts, repair truncated values, or choose between two objects.
export function modelJson(content, code = 'response_invalid') {
  const invalid = (broken = '') => {throw Object.assign(new Error(code), {issue: 'Return one complete JSON object, with no missing fields or truncated values.' + (broken ? breakOf(broken) : '')});};
  if (typeof content !== 'string' || content.length > 64000) invalid();
  const clean = content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').trim();
  try {return JSON.parse(clean);} catch {}
  if (/^<think>/i.test(clean)) invalid();
  const objects = [];let depth = 0, start = -1, string = false, escape = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (string) {if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') string = false; continue;}
    if (c === '"' && depth) {string = true; continue;}
    if (c === '{') {if (!depth) start = i; depth++;}
    if (c === '}' && depth && --depth === 0) objects.push(clean.slice(start, i + 1));
  }
  if (depth || objects.length !== 1) invalid();
  try {return JSON.parse(objects[0]);} catch {invalid(objects[0]);}
}
