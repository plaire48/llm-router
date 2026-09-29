import test from 'node:test';
import assert from 'node:assert/strict';
import {validEditorFormat, matchesEditorFormat} from '../browser-editor.js';
import {executeScript} from '../script-sandbox.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {scriptFailure} from '../script-feedback.js';

test('style proof requires one complete match and every run, not just a bold substring', () => {
  const bold = {style: {bold: true, fontSize: '18px', fontFamily: '"Noto Sans KR", sans-serif'}};
  const mixed = {matchCount: 1, runs: [bold, {style: {...bold.style, bold: false}}], truncated: false};
  assert.equal(matchesEditorFormat(mixed, {bold: true}), false);
  const state = {...mixed, runs: [bold, bold]};
  assert.equal(matchesEditorFormat(state, {bold: true, fontSize: '18px', fontFamily: 'Noto Sans KR,sans-serif'}), true);
  for (const change of [{truncated: true}, {matchCount: 0}, {matchCount: 2}, {runs: []}]) assert.equal(matchesEditorFormat({...state, ...change}, {bold: true}), false);
  for (const invalid of [null, {}, [], {bold: 'true'}, {fontSize: ''}, {css: 'color:red'}, {block: 'div'}, {textAlign: 'unknown'}]) assert.equal(validEditorFormat(invalid), false);
});

test('static editor errors preserve their recovery category through Playwright wrapping', () => {
  for (const reason of ['editor_ambiguous', 'editor_text_missing', 'editor_selection_lost', 'editor_too_large']) {
    assert.equal(scriptFailure(new Error(`elementHandle.evaluate: Error: ${reason}\n    at editorOperation (page)`)).reason, reason);
  }
  assert.equal(scriptFailure(new Error('elementHandle.evaluate: Error: untrusted_custom_text')).reason, 'script_failed');
});

test('editor reads and guarded selection cross the existing VM contract without page JS', async () => {
  const calls = [], digest = 'a'.repeat(64);
  const result = await executeScript(`const state=await browser.ref("body").editorState("핵심 문장"); return await browser.ref("body").selectText("핵심 문장", {expectedDigest:state.digest});`, async call => {
    calls.push(call); return call.method === 'editorState' ? {digest} : {selected: true};
  });
  assert.equal(result.ok, true); assert.equal(result.value.selected, true);
  assert.deepEqual(calls[1], {chain: [['ref', ['body']]], method: 'selectText', args: ['핵심 문장', {expectedDigest: digest}]});
  const check = browserTools({}, BUILTIN_SKILLS[0]).find(tool => tool.function.name === 'verify_page').function.parameters.properties.checks.items;
  assert(check.properties.kind.enum.includes('text_style')); assert.equal(check.properties.format.additionalProperties, false);
  assert.equal(check.properties.format.properties.bold.type, 'boolean');
});
