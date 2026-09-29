// Identifies the source under evaluation, so two reports can tell "same
// candidate measured twice" from "changed candidate". It hashes the files the
// runtime bundle reads (recorded by the build) plus every runtime module.
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PACKAGE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function candidateIdentity({packageRoot=PACKAGE_ROOT}={}){
  let inputs;
  try{inputs=JSON.parse(await readFile(path.join(packageRoot,'generated','source-inputs.json'),'utf8'));}catch{throw new Error('candidate_inputs_missing');}
  if(!Array.isArray(inputs)||inputs.some(item=>typeof item!=='string'))throw new Error('candidate_inputs_invalid');
  const runtime=(await readdir(path.join(packageRoot,'runtime'))).filter(name=>/\.(mjs|ts)$/.test(name)).map(name=>'runtime/'+name);
  const files=[...new Set([...inputs,...runtime])].sort(),hash=createHash('sha256');
  for(const file of files){
    let content;
    // A listed file that no longer exists means the build record is out of date.
    try{content=await readFile(path.resolve(packageRoot,file));}catch{throw new Error('candidate_inputs_stale');}
    hash.update(file).update('\0').update(createHash('sha256').update(content).digest('hex')).update('\n');
  }
  return {hash:hash.digest('hex'),files:files.length};
}
