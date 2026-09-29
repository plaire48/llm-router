import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightCode} from '../src/code-highlight.js';
const source = result => result.lines.map(line => line.map(token => token.text).join('')).join('\n');
test('JavaScript aliases distinguish keywords, strings and multiline comments without changing source', () => {
  const text = '/* 첫 줄\n둘째 줄 */\nconst message = "안녕하세요";\n\nconsole.log(message);';
  const result = highlightCode(text, 'js');
  assert.equal(result.label, 'JavaScript'); assert.equal(source(result), text);
  assert(result.lines[0][0].className.includes('hljs-comment'));
  assert(result.lines[1][0].className.includes('hljs-comment'));
  assert(result.lines.flat().some(t => t.className.includes('hljs-keyword')));
  assert(result.lines.flat().some(t => t.className.includes('hljs-string')));
});
test('Python, JSON, HTML and SQL keep original indentation, unicode and blank lines', () => {
  for (const [hint, text] of [['py', 'def greet(name):\n\treturn f"안녕 {name}"\n'], ['json', '{\n  "name": "누비",\n  "count": 3\n}'], ['html', '<script>alert("x")</script>\n<img src=x onerror="alert(1)">'], ['sql', 'SELECT name\nFROM users WHERE id = 1;']]) {
    const result = highlightCode(text, hint); assert.equal(source(result), text);
    assert(result.lines.flat().some(t => t.className));
    assert(result.lines.flat().every(t => typeof t.text === 'string'));
  }
});
test('incomplete streamed code remains readable and exact', () => {
  const text = 'const message = `안녕하세요 ${name}`;\n/* 이어지는 주석 */';
  for (const length of [1, 5, 18, 26, text.length]) assert.equal(source(highlightCode(text.slice(0, length), 'javascript')), text.slice(0, length));
});
test('unknown languages and explicit text stay plain while unlabelled code can be detected', () => {
  for (const hint of ['unknown-language', 'text']) {
    const result = highlightCode('const message = "안녕하세요";', hint);
    assert.equal(source(result), 'const message = "안녕하세요";'); assert(result.lines.flat().every(t => !t.className));
  }
  const detected = highlightCode('def greet(name):\n    return "hello " + name');
  assert.equal(detected.label, 'Python'); assert(detected.lines.flat().some(t => t.className));
});
test('large blocks avoid costly highlighting and DOM expansion without truncating input', () => {
  assert.equal(highlightCode('x'.repeat(60001), 'js').lines, null);
  assert.equal(highlightCode('a\n'.repeat(2001), 'js').lines, null);
  assert.equal(source(highlightCode('', 'js')), '');
});
