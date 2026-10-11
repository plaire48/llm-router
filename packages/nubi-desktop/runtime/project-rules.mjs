import path from 'node:path';
import {readSource,relativeFile,hash,fail} from './files.mjs';

// Project-local, lazy, bounded guidance. Never follow remote references or
// read another agent's home directory/configuration as an implicit authority.
// A rules file past the budget is shown in part, with the omitted headings and
// a note to read the rest: refusing it blocked every read and run in a project
// whose AGENTS.md had grown past 32 KiB (2026-10-07). The hash and the
// fingerprint still cover the whole file, so edits are checked against the disk.
export const RULES_LIMITS={fileBytes:32768,totalBytes:65536,headings:40};
const NAMES=['AGENTS.md','CLAUDE.md'];
const HEADING=/^#{1,6}\s+\S/;

// The longest prefix within the byte budget: whole lines, or characters when
// the first line alone is longer. Never splits a character.
function cutChars(content,budget){let bytes=0,end=0;for(const char of content){const size=Buffer.byteLength(char);if(bytes+size>budget)break;bytes+=size;end+=char.length;}return content.slice(0,end);}
function cutLines(content,budget){
  let bytes=0,end=0;
  for(const line of content.split(/(?<=\n)/)){const size=Buffer.byteLength(line);if(bytes+size>budget)break;bytes+=size;end+=line.length;}
  return end?content.slice(0,end):cutChars(content,budget);
}
function bounded(content,budget){
  const totalBytes=Buffer.byteLength(content);
  if(totalBytes<=budget)return {content};
  const shown=cutLines(content,budget),shownLines=(shown.match(/\n/g)||[]).length,lines=content.split('\n');
  const headings=lines.slice(shownLines).flatMap((line,index)=>HEADING.test(line)?[{line:shownLines+index+1,heading:line.trim().slice(0,80)}]:[]);
  return {content:shown,truncated:true,shownLines,totalLines:lines.length,shownBytes:Buffer.byteLength(shown),totalBytes,
    omittedHeadings:headings.slice(0,RULES_LIMITS.headings),...(headings.length>RULES_LIMITS.headings?{moreHeadings:headings.length-RULES_LIMITS.headings}:{}),
    note:'Shown in part. Read the omitted lines with read_source(path, start, end) before relying on rules there.'};
}

export async function projectRules(root,rel='') {
  if(rel)relativeFile(rel);
  const parts=rel?path.posix.dirname(rel).split('/').filter(p=>p!=='.'):[];
  const files=[],versions=[];let bytes=0;
  for(let depth=0;depth<=parts.length;depth++){
    const directory=parts.slice(0,depth).join('/');
    for(const name of NAMES){
      const file=directory?directory+'/'+name:name;
      let source;
      try{source=await readSource(root,file);}catch(error){if(error.code==='ENOENT'){versions.push({path:file,hash:null});continue;}fail('rules_unavailable');}
      const part=bounded(source.content,Math.min(RULES_LIMITS.fileBytes,Math.max(RULES_LIMITS.totalBytes-bytes,0)));
      bytes+=Buffer.byteLength(part.content);
      versions.push({path:file,hash:source.hash});
      files.push({path:file,scope:directory||'.',hash:source.hash,...part});break;
    }
  }
  return {files,fingerprint:hash(JSON.stringify(versions)),scope:rel||'.',precedence:'deeper_directory_overrides_parent',authority:'project_guidance_not_execution_permission'};
}

export async function validateProjectRules(root,rel,expected) {
  if(!expected)return; // Compatibility for proposals recorded before this feature.
  if((await projectRules(root,rel)).fingerprint!==expected)fail('project_rules_changed');
}
