import test from 'node:test';
import assert from 'node:assert/strict';
import {changePromptShortcuts, decodePromptShortcuts, promptShortcutOptions, readPromptShortcuts, savePromptShortcut, MAX_PROMPT_SHORTCUTS} from '../prompt-shortcuts.js';
import {skillCommandOptions, resolveSkillCommand} from '../skill-command.js';

test('saved prompt picker is namespaced beside skill commands and only returns text', () => {
  const skill = {id:'custom-review', name:'검토', description:'스킬 절차'};
  const items = savePromptShortcut([], {name:'검토', text:'표를 확인하고 핵심만 알려줘.'}, () => 'one');
  assert.equal(items[0].slug, '검토');
  assert.deepEqual(promptShortcutOptions(items, '/p:검토').map(option => option.command), ['p:검토']);
  assert.equal(promptShortcutOptions(items, '/')[0].shortcut.text, '표를 확인하고 핵심만 알려줘.');
  assert.equal(skillCommandOptions([skill], '/')[2].command, '검토');
  assert.equal(resolveSkillCommand([skill], '/검토 보고서').skill.id, skill.id);
  assert.equal(promptShortcutOptions(items, '/p:검토 ' ).length, 0);
});

test('editing preserves command and exact multiline text, while duplicate names and capacity are rejected', () => {
  const first = savePromptShortcut([], {name:'연구', text:'  첫째\n둘째  '}, () => 'a');
  const second = savePromptShortcut(first, {name:'연구!', text:'다른 요청'}, () => 'b');
  assert.equal(second[1].slug, '연구-2');
  const edited = savePromptShortcut(second, {id:'a', name:'심층 검토', text:'  첫째\n둘째  '});
  assert.equal(edited[0].slug, '연구');
  assert.equal(edited[0].text, '  첫째\n둘째  ');
  assert.throws(() => savePromptShortcut(edited, {name:'연구!', text:'중복'}), /prompt_shortcut_duplicate/);
  assert.throws(() => savePromptShortcut(edited, {id:'missing', name:'새 이름', text:'값'}), /prompt_shortcut_missing/);
  assert.throws(() => savePromptShortcut(edited, {name:'빈 값', text:'  '}), /prompt_shortcut_fields/);
  const full = Array.from({length:MAX_PROMPT_SHORTCUTS}, (_, i) => ({id:String(i), slug:`s-${i}`, name:`이름 ${i}`, text:'내용'}));
  assert.throws(() => savePromptShortcut(full, {name:'추가', text:'내용'}), /prompt_shortcut_limit/);
});

test('invalid stored data is rejected without replacing it; write failures leave old list readable', async t => {
  const oldChrome = globalThis.chrome;
  t.after(() => {globalThis.chrome = oldChrome;});
  let saved = {version:1, items:[]}, rejectWrite = false;
  let queue = Promise.resolve();
  const locks = {request:(_name, _options, callback) => {const task = queue.then(callback); queue = task.catch(() => {}); return task;}};
  globalThis.chrome = {storage:{local:{
    get:async () => {await new Promise(resolve => setTimeout(resolve, 2)); return {promptShortcuts:saved};},
    set:async value => {if (rejectWrite) throw new Error('quota'); await new Promise(resolve => setTimeout(resolve, 2)); saved = value.promptShortcuts;}
  }}};
  await changePromptShortcuts(items => savePromptShortcut(items, {name:'확인', text:'초안을 보존해 줘'}, () => 'one'), locks);
  assert.equal((await readPromptShortcuts())[0].name, '확인');
  await Promise.all([
    changePromptShortcuts(items => savePromptShortcut(items, {name:'두 번째', text:'내용'}, () => 'two'), locks),
    changePromptShortcuts(items => savePromptShortcut(items, {name:'세 번째', text:'내용'}, () => 'three'), locks)
  ]);
  assert.deepEqual((await readPromptShortcuts()).map(item => item.id), ['one','two','three']);
  rejectWrite = true;
  await assert.rejects(changePromptShortcuts(items => items.filter(item => item.id !== 'one'), locks), /quota/);
  assert.equal((await readPromptShortcuts())[0].id, 'one');
  await assert.rejects(changePromptShortcuts(items => items.slice(1), null), /prompt_shortcut_lock_unavailable/);
  assert.throws(() => decodePromptShortcuts({version:1,items:[{...saved.items[0], text:''}]}), /prompt_shortcuts_invalid/);
  saved = {version:1,items:[saved.items[0],saved.items[0]]};
  await assert.rejects(readPromptShortcuts(), /prompt_shortcuts_invalid/);
});
