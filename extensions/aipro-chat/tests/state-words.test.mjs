import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// verify_page takes a state word only from its own list; the page reader
// (stateWords in browser-dom.js) returns words from class names and data-state.
// The two lists must name the same words.
test('verify_page accepts exactly the state words the page reader can return', async () => {
  const dom = await readFile(new URL('../browser-dom.js', import.meta.url), 'utf8');
  const agent = await readFile(new URL('../browser-agent.js', import.meta.url), 'utf8');
  const classPattern = /const STATE_WORD = \/\(\?:\^\|\[-_\]\)\(([^)]+)\)\$\/i;/.exec(dom)?.[1];
  assert(classPattern, 'STATE_WORD in browser-dom.js');
  const classWords = classPattern.split('|').flatMap(word => word.includes('u?') ? [word.replace('u?', 'u'), word.replace('u?', '')] : [word]);
  const dataState = /export function stateWords\(el\) \{\n\s*const own = classStates\(el\), hint = el\.getAttribute\('data-state'\);\n\s*if \(\[([^\]]+)\]/.exec(dom)?.[1];
  assert(dataState, 'data-state words in stateWords');
  const vocabulary = /const stateVocabulary = \[([^\]]+)\]/.exec(agent)?.[1];
  assert(vocabulary, 'stateVocabulary in browser-agent.js');
  const words = list => list.match(/'[a-z]+'/g).map(word => word.slice(1, -1));
  const readable = new Set([...classWords, ...words(dataState)]);
  assert.deepEqual([...new Set(words(vocabulary))].sort(), [...readable].sort());
});
