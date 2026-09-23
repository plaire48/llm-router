// Accept a single complete JSON object, including ordinary Markdown wrapping.
// Never evaluate scripts, repair truncated values, or choose between two objects.
export function modelJson(content, code = 'response_invalid') {
  const invalid = () => {throw Object.assign(new Error(code), {issue: 'Return one complete JSON object, with no missing fields or truncated values.'});};
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
  try {return JSON.parse(objects[0]);} catch {invalid();}
}
