// Creates the pinned snapshot and manifest of one corpus:
//   node eval/pin-corpus.mjs order-service
// Re-pinning changes the corpus hash. Review every answer key that uses the
// corpus afterwards: a changed source can silently invalidate it.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp,mkdtemp,mkdir,rm,writeFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CORPORA,CORPUS_DIRECTORY,fileRecords,corpusHash} from './corpus.mjs';

const exec=promisify(execFile);
const IGNORED=new Set(['node_modules','dist','.git','.DS_Store']);

export async function pinCorpus(name,{directory=CORPUS_DIRECTORY,corpora=CORPORA}={}){
  const corpus=corpora[name];if(!corpus)throw new Error('corpus_unknown');
  const stage=await mkdtemp(path.join(os.tmpdir(),'nubi-pin-'));
  try{
    for(const item of corpus.include){
      const from=path.join(corpus.source,item),to=path.join(stage,item);
      await mkdir(path.dirname(to),{recursive:true});
      await cp(from,to,{recursive:(await stat(from)).isDirectory(),filter:source=>!IGNORED.has(path.basename(source))});
    }
    const files=await fileRecords(stage);if(!files.length)throw new Error('corpus_empty');
    await mkdir(directory,{recursive:true});
    // COPYFILE_DISABLE keeps macOS from adding AppleDouble files to the archive.
    await exec('tar',['-czf',path.join(directory,name+'.tar.gz'),'-C',stage,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
    const manifest={name,schema:1,createdAt:new Date().toISOString(),files};
    await writeFile(path.join(directory,name+'.manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    return {name,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),hash:corpusHash(files)};
  }finally{await rm(stage,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const names=process.argv.slice(2);
  if(!names.length||names.some(name=>!Object.hasOwn(CORPORA,name))){console.error('사용법: node eval/pin-corpus.mjs <'+Object.keys(CORPORA).join('|')+'> ...');process.exit(2);}
  for(const name of names)console.log(JSON.stringify(await pinCorpus(name)));
  console.log('자료를 다시 고정했습니다. 이 자료를 쓰는 과제의 정답을 다시 검토해 주세요.');
}
