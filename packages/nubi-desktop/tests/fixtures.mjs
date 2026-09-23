import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {git} from '../runtime/files.mjs';

export async function fixture(t) {
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-desktop-'))),root=path.join(directory,'repo');
  await mkdir(root);await git(root,['init','-q']);await git(root,['config','user.email','fixture@example.invalid']);await git(root,['config','user.name','Fixture']);
  await mkdir(path.join(root,'openwiki'));
  await writeFile(path.join(root,'app.txt'),'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n');
  await writeFile(path.join(root,'openwiki','home.md'),'# Project knowledge\n\nThe welcome screen uses app.txt.\n');
  await git(root,['add','.']);await git(root,['commit','-qm','Initial fixture']);
  const service=new ProjectService({storageRoot:path.join(directory,'state')});await service.open(root);
  t.after(async()=>{service.dispose();while(service.processes.active.size)await new Promise(r=>setTimeout(r,30));service.store.close();await rm(directory,{recursive:true,force:true});});
  return {service,root,directory};
}
