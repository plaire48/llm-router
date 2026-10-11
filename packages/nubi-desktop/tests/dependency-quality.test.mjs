import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);

// The editor is the standalone Monaco (electron-app/editor.jsx). Its vendored sanitizer must be the patched DOMPurify
// (GHSA of 2026-09, fixed in 3.4.15) that the package also installs; an npm override does not reach a vendored copy.
test('the standalone Monaco vendors the patched DOMPurify and its sanitizer uses it',async()=>{
  // monaco-editor exports no package.json; the package is reached from this file, as the editor bundle reaches it.
  const monaco=new URL('../node_modules/monaco-editor/',import.meta.url);
  const vendored=await readFile(new URL('esm/vs/base/browser/dompurify/dompurify.js',monaco),'utf8');
  const version=/DOMPurify (\d+\.\d+\.\d+)/.exec(vendored)?.[1];
  const installed=JSON.parse(await readFile(new URL('../node_modules/dompurify/package.json',import.meta.url),'utf8')).version;
  assert.equal(version,installed,'the vendored copy is the installed, patched version');
  const [major,minor,patch]=version.split('.').map(Number);assert.ok(major>3||major===3&&(minor>4||minor===4&&patch>=15),version);
  assert.match(await readFile(new URL('esm/vs/base/browser/domSanitize.js',monaco),'utf8'),/dompurify/);
});
test('patched transitive UUID keeps the APIs its dependents use',()=>{
  for(const parent of ['react-tooltip','trash']){
    const from=createRequire(require.resolve(parent));const uuid=from('uuid');assert.equal(uuid.version(uuid.v4()),4);
    assert.throws(()=>uuid.v5('x',uuid.v5.DNS,new Uint8Array(1)));
  }
});
