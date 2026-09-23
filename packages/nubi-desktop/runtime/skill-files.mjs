import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {fail} from './files.mjs';

export const SKILL_RESOURCE_BYTES=10*1024*1024;

export async function skillBytes(file,max) {
  const before=await lstat(file);
  if(!before.isFile()||before.isSymbolicLink())fail('skill_import_path');
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const info=await handle.stat();
    if(!info.isFile()||info.dev!==before.dev||info.ino!==before.ino)fail('skill_import_changed');
    if(info.size>max)fail('skill_import_limit');
    const chunks=[];let size=0;
    for await (const chunk of handle.createReadStream({autoClose:false})) {
      size+=chunk.length;if(size>max)fail('skill_import_limit');chunks.push(chunk);
    }
    const after=await handle.stat();
    if(size!==info.size||after.mtimeMs!==info.mtimeMs||after.size!==info.size)fail('skill_import_changed');
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

