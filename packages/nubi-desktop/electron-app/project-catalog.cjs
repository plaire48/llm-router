const {readFile,writeFile,mkdir,rename,rm}=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

// Only folders successfully opened by the host enter this list. Removing a
// shortcut never touches project files, conversations or the project store.
class ProjectCatalog {
 constructor(directory){this.file=path.join(directory,'projects.json');this.queue=Promise.resolve();}
 async read(){
  let value;try{value=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code==='ENOENT')return [];throw Error('project_catalog_unavailable');}
  if(value?.version!==1||!Array.isArray(value.projects)||value.projects.some(p=>typeof p.id!=='string'||typeof p.root!=='string'||!path.isAbsolute(p.root)||typeof p.name!=='string'))throw Error('project_catalog_unavailable');
  return value.projects;
 }
 async list(){await this.queue;return this.read();}
 update(transform){
  const pending=this.queue.then(async()=>{
   const projects=transform(await this.read());
   await mkdir(path.dirname(this.file),{recursive:true});const temporary=this.file+'.'+randomUUID()+'.tmp';
   try{await writeFile(temporary,JSON.stringify({version:1,projects}),{mode:0o600});await rename(temporary,this.file);}
   finally{await rm(temporary,{force:true}).catch(()=>{});}
   return projects;
  });this.queue=pending.catch(()=>{});return pending;
 }
 remember(project){return this.update(projects=>{
  if(project.kind==='conversation')return projects;
  const previous=projects.find(p=>p.id===project.projectId);
  const entry={id:project.projectId,root:project.root,name:previous?.name||project.name,lastOpenedAt:new Date().toISOString()};
  return previous?projects.map(p=>p.id===entry.id?entry:p):[...projects,entry];
 });}
 rename(id,name){
  if(typeof name!=='string'||!name.trim()||name.trim().length>80||/[\r\n\u0000-\u001f]/.test(name))return Promise.reject(Error('project_name_invalid'));
  return this.update(projects=>{if(!projects.some(p=>p.id===id))throw Error('project_missing');return projects.map(p=>p.id===id?{...p,name:name.trim()}:p);});
 }
 remove(id){return this.update(projects=>projects.filter(p=>p.id!==id));}
 async get(id){const project=(await this.list()).find(p=>p.id===id);if(!project)throw Error('project_missing');return project;}
}
module.exports={ProjectCatalog};
