import {readFile,readdir,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function dependencyNotices(){
 const lock=JSON.parse(await readFile('package-lock.json','utf8')),rows=[];
 for(const [path,entry] of Object.entries(lock.packages)){
  if(!path.startsWith('node_modules/')||entry.dev||entry.link)continue;
  const pkg=JSON.parse(await readFile(join(path,'package.json'),'utf8'));
  const destination=join('dist/licenses/npm',pkg.name.replaceAll('/','_'));
  await mkdir(destination,{recursive:true});
  const files=(await readdir(path)).filter(name=>/^(license|licence|copying|notice|third-party-notices)(\.|$)/i.test(name));
  for(const name of files)await copyFile(join(path,name),join(destination,name));
  rows.push({name:pkg.name,version:pkg.version,license:pkg.license||'See package terms',files});
 }
 await writeFile('dist/licenses/npm-inventory.json',JSON.stringify(rows,null,2)+'\n');
}
