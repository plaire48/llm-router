import {test} from 'node:test';
import assert from 'node:assert/strict';
import {separateFolderPicker,skillRegistrationErrors} from '../ui/skill-registration-state.mjs';

test('the skill picker offers a folder button only on hosts whose dialog cannot take files and folders together',()=>{
  assert.equal(separateFolderPicker('darwin'),false,'macOS: one picker takes both');
  assert.equal(separateFolderPicker('win32'),true,'Windows: a file picker and a folder picker');
  assert.equal(separateFolderPicker('linux'),true);
  assert.equal(separateFolderPicker(undefined),false,'a browser host keeps the single picker');
  assert.equal(separateFolderPicker(''),true,'an unknown platform string is not macOS');
});

test('every registration error the host raises has a Korean message',()=>{
  for(const code of ['skill_entry_required','skill_import_path','skill_import_limit','skill_import_duplicate','skill_import_type','skill_invalid','skill_import_changed','skill_catalog_full'])assert.match(skillRegistrationErrors[code]||'',/[가-힣]/,code);
});
