import {readFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function prepareAppIcon(){
  const source=path.resolve(root,'../../extensions/aipro-chat/design/brand/bird-master.png');
  const bytes=await readFile(source);
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)<256||bytes.readUInt32BE(20)<256)throw Error('app_icon_resolution');
  const directory=path.join(root,'electron-app/resources');
  await mkdir(directory,{recursive:true});
  const target=path.join(directory,'nubi.png');await copyFile(source,target);
  return target;
}
