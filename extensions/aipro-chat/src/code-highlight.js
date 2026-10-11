import {common, createLowlight} from 'lowlight';

const highlighter = createLowlight(common);
const names = {
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  py: 'Python', python: 'Python', html: 'HTML', xml: 'XML', css: 'CSS', json: 'JSON', sql: 'SQL',
  sh: 'Shell', bash: 'Bash', shell: 'Shell', java: 'Java', c: 'C', cpp: 'C++', cs: 'C#', csharp: 'C#',
  yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown', go: 'Go', rust: 'Rust',
  text: 'Text', txt: 'Text', plaintext: 'Text', diff: 'Diff', code: 'Code',
};
const autoSubset = ['javascript', 'python', 'json', 'xml', 'css', 'sql', 'bash', 'java'];

export function highlightCode(text, hint = '') {
  const language = /^[a-z\d+#.-]{1,30}$/i.test(hint) ? hint.toLowerCase() : '';
  const label = value => names[value] || value || 'Code';
  // Keep large answers readable and copyable without blocking streaming or
  // creating thousands of syntax spans. Never truncate the original source.
  if (text.length > 60000 || text.split('\n', 2002).length > 2000) return {label: label(language), lines: null};
  let tree;
  try {
    if (language && highlighter.registered(language)) tree = highlighter.highlight(language, text);
    else if (!language && text.trim() && text.length <= 12000) tree = highlighter.highlightAuto(text, {subset: autoSubset});
  } catch { /* Incomplete or unknown syntax remains plain, readable source. */ }
  const lines = [[]];
  function visit(node, classes = []) {
    if (node.type === 'text') {
      node.value.split('\n').forEach((value, index) => {
        if (index) lines.push([]);
        if (value) lines.at(-1).push({text: value, className: classes.join(' ')});
      });
    } else {
      const next = [...classes, ...(node.properties?.className || []).filter(value => /^[\w-]+$/.test(value))];
      for (const child of node.children || []) visit(child, next);
    }
  }
  visit(tree || {type: 'text', value: text});
  return {label: label(language || tree?.data?.language), lines};
}
