import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
// Monaco carries a vendored sanitizer. An npm override alone does not replace it.
export function patchedMonacoSanitizer(){
  let replacements=0;
  return {name:'nubi-patched-monaco-sanitizer',setup(build){
    build.onStart(()=>{replacements=0;});
    build.onResolve({filter:/dompurify\/dompurify\.js$/},args=>{
      if(!args.importer.replaceAll('\\','/').includes('/@theia/monaco-editor-core/'))return;
      replacements++;return {path:require.resolve('dompurify')};
    });
    build.onEnd(result=>{
      if(!result.errors.length&&replacements===0)return {errors:[{text:'Monaco sanitizer hook was not used. Review the upstream import before shipping.'}]};
    });
  }};
}
export function assertPatchedSanitizerInputs(metafile){
  const inputs=Object.keys(metafile.inputs).map(p=>p.split(path.sep).join('/'));
  if(inputs.some(p=>p.endsWith('/dompurify/dompurify.js'))||!inputs.some(p=>/\/dompurify\/dist\/purify\./.test(p)))throw Error('sanitizer_bundle_unverified');
}
