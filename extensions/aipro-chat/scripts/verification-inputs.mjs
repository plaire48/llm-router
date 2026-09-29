import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, relative} from 'node:path';

export async function digestTree(directory) {
  const hash=createHash('sha256');
  async function visit(path) {
    for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const full=resolve(path,entry.name);
      if(entry.isDirectory())await visit(full);
      else if(entry.isFile()) {
        const data=await readFile(full);
        hash.update(JSON.stringify([relative(directory,full),data.length]));hash.update(data);
      }
    }
  }
  await visit(directory);return hash.digest('hex');
}
export const SHARED_VERIFICATION_FILES=[
  '../../packages/openwiki/src/agent/wiki-question.ts',
  '../../packages/openwiki/package.json', '../../packages/openwiki/pnpm-lock.yaml',
  '../../packages/nubi-a2a/receiver.mjs', '../../packages/nubi-a2a/client.mjs',
  '../../packages/nubi-a2a/contract.mjs', '../../packages/nubi-a2a/package.json',
  '../../packages/nubi-a2a/package-lock.json',
];
// Track build and test inputs, including source rebuilt by browser probes.
// Generated output, reports and credentials are not source inputs.
export async function verificationInputs(root) {
  const hashes={};
  const files=(await readdir(root,{withFileTypes:true}))
    .filter(entry=>entry.isFile() && /\.(?:[cm]?js|json|html|css)$/.test(entry.name)).map(entry=>entry.name);
  for(const name of [...files,...SHARED_VERIFICATION_FILES].sort())
    hashes[name]=createHash('sha256').update(await readFile(resolve(root,name))).digest('hex');
  for(const name of ['src','public','scripts','tests','design','vendor'])hashes[name]=await digestTree(resolve(root,name));
  return hashes;
}
