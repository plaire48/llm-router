import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {patchedMonacoSanitizer,assertPatchedSanitizerInputs} from '../scripts/sanitizer-plugin.mjs';
const require=createRequire(import.meta.url);

test('actual Monaco sanitizer uses patched DOMPurify and preserves safe markup without leaking hooks',async t=>{
  const entry=require.resolve('@theia/monaco-editor-core/esm/vs/base/browser/domSanitize.js');
  const result=await build({stdin:{contents:`export {sanitizeHtml} from ${JSON.stringify(entry)}`,resolveDir:process.cwd()},bundle:true,write:false,metafile:true,format:'iife',globalName:'Sanitizer',platform:'browser',plugins:[patchedMonacoSanitizer()]});
  assertPatchedSanitizerInputs(result.metafile);
  const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:result.outputFiles[0].text});
  const output=await page.evaluate(()=>{
    const clean=(s,c)=>String(Sanitizer.sanitizeHtml(s,c));
    return {safe:clean('<p>한국어 <strong>result</strong><a href="https://example.com">link</a></p>'),unsafe:clean('<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">bad</a>'),custom:clean('<span fixture-attribute="once">x</span>',{allowedAttributes:{augment:['fixture-attribute']}}),next:clean('<span fixture-attribute="must-remove">x</span>')};
  });
  assert.match(output.safe,/<strong>result<\/strong>/);assert.match(output.safe,/href="https:\/\/example.com"/);assert.doesNotMatch(output.unsafe,/onerror|<script|javascript:/);assert.match(output.custom,/fixture-attribute/);assert.doesNotMatch(output.next,/fixture-attribute/);
});
test('patched transitive UUID and diff retain the APIs used by Theia dependencies',()=>{
  for(const parent of ['react-tooltip','trash']){
    const from=createRequire(require.resolve(parent));const uuid=from('uuid');assert.equal(uuid.version(uuid.v4()),4);
    assert.throws(()=>uuid.v5('x',uuid.v5.DNS,new Uint8Array(1)));
  }
  const from=createRequire(require.resolve('mocha')),diff=from('diff');
  const patch=diff.createPatch('string','before\n','after\n');assert.equal(diff.applyPatch('before\n',patch),'after\n');
});
