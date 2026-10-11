import {createHash} from 'node:crypto';
import {parseFrontmatter} from '@earendil-works/pi-coding-agent';
const fail=()=>{throw new Error('document_skill_package_invalid');};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function packageMetadata(content){
  if(typeof content!=='string'||Buffer.byteLength(content)>60000||!/^\uFEFF?---\r?\n/.test(content))fail();
  let frontmatter,body;try{({frontmatter,body}=parseFrontmatter(content));}catch{fail();}
  if(typeof frontmatter?.name!=='string'||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name)||frontmatter.name.length>64||typeof frontmatter.description!=='string'||!frontmatter.description.trim()||frontmatter.description.length>1024||!body.trim())fail();
  if(frontmatter.compatibility!==undefined&&(typeof frontmatter.compatibility!=='string'||frontmatter.compatibility.length>500))fail();
  return {name:frontmatter.name,description:frontmatter.description,compatibility:frontmatter.compatibility||''};
}
export function packagePath(value){
  if(typeof value!=='string'||!value||value.length>160||value.split('/').length>16||/[\\:\u0000-\u001f<>"|?*]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail();
  return value;
}
export function packageManifest(value){
  if(!Array.isArray(value)||!value.length||value.length>256)fail();
  let bytes=0;const paths=new Set();
  const files=value.map(file=>{
    if(!file||Object.keys(file).some(k=>!['path','size','sha256'].includes(k)))fail();
    packagePath(file.path);const key=file.path.toLowerCase();
    if(paths.has(key)||!Number.isSafeInteger(file.size)||file.size<0||file.size>2097152||! /^[a-f0-9]{64}$/.test(file.sha256||''))fail();
    paths.add(key);bytes+=file.size;return {...file};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(bytes>8388608||!files.some(f=>f.path==='SKILL.md'&&f.size>0&&f.size<=60000)||files.some(f=>f.path!=='SKILL.md'&&f.path.endsWith('/SKILL.md')))fail();
  for(const file of files){const parts=file.path.split('/');parts.pop();while(parts.length){if(paths.has(parts.join('/').toLowerCase()))fail();parts.pop();}}
  return {files,totalBytes:bytes,sha256:sha256(files.map(f=>`${f.path}\t${f.size}\t${f.sha256}\n`).join(''))};
}
