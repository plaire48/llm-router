import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile(new URL('../vendor/genoffice-source.json', import.meta.url)));
for (const [path, expected] of Object.entries(manifest.files)) {
  const actual=createHash('sha256').update(await readFile(new URL(`../vendor/genoffice/${path}`,import.meta.url))).digest('hex');
  if(actual!==expected)throw new Error(`Upstream source changed: ${path}`);
}
console.log(`Verified ${Object.keys(manifest.files).length} upstream files: ${manifest.commit}`);
const nubi=JSON.parse(await readFile(new URL('../vendor/nubi-workspace-source.json',import.meta.url)));
for(const {path,sha256} of nubi.files){
 const actual=createHash('sha256').update(await readFile(new URL(`../vendor/nubi/${path}`,import.meta.url))).digest('hex');
 if(actual!==sha256)throw Error(`Nubi source changed: ${path}`);
}
console.log(`Verified ${nubi.files.length} Nubi working-tree files: ${nubi.observedHead}`);

for(const adaptation of nubi.adaptations||[]){
 const actual=createHash('sha256').update(await readFile(new URL('../'+adaptation.path,import.meta.url))).digest('hex');
 if(actual!==adaptation.sha256)throw Error('Nubi adaptation changed: '+adaptation.path);
}
