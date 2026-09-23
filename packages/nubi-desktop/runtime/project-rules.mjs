import path from 'node:path';
import {readSource,relativeFile,hash,fail} from './files.mjs';

// Project-local, lazy, bounded guidance. Never follow remote references or
// read another agent's home directory/configuration as an implicit authority.
export async function projectRules(root,rel='') {
  if(rel)relativeFile(rel);
  const parts=rel?path.posix.dirname(rel).split('/').filter(p=>p!=='.'):[];
  if(parts.length>20)fail('rules_limit');
  const files=[],versions=[];let bytes=0;
  for(let depth=0;depth<=parts.length;depth++){
    const directory=parts.slice(0,depth).join('/');
    for(const name of ['AGENTS.md','CLAUDE.md']){
      const file=directory?directory+'/'+name:name;
      let source;
      try{source=await readSource(root,file);}catch(error){if(error.code==='ENOENT'){versions.push({path:file,hash:null});continue;}fail('rules_unavailable');}
      bytes+=Buffer.byteLength(source.content);
      if(bytes>65536||Buffer.byteLength(source.content)>32768)fail('rules_limit');
      versions.push({path:file,hash:source.hash});
      files.push({path:file,scope:directory||'.',hash:source.hash,content:source.content});break;
    }
  }
  return {files,fingerprint:hash(JSON.stringify(versions)),scope:rel||'.',precedence:'deeper_directory_overrides_parent',authority:'project_guidance_not_execution_permission'};
}

export async function validateProjectRules(root,rel,expected) {
  if(!expected)return; // Compatibility for proposals recorded before this feature.
  if((await projectRules(root,rel)).fingerprint!==expected)fail('project_rules_changed');
}
