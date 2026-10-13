import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,realpathSync,statSync} from 'node:fs';
import {join,extname,basename} from 'node:path';
const mimeByExt:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.mp3':'audio/mpeg','.wav':'audio/wav'};
export class Artifacts {
 private rows=new Map<string,{path:string;mime:string;name:string}>();
 constructor(readonly root:string){mkdirSync(root,{recursive:true,mode:0o700});}
 put(bytes:Uint8Array,extension:string,name?:string,mime?:string){if(!/^\.[a-z0-9]+$/.test(extension)||bytes.length>200*1024*1024||bytes.length===0)throw Error('artifact_invalid');const id=randomUUID();const path=join(this.root,id+extension);writeFileSync(path,bytes,{mode:0o600});const row={path,mime:mime||mimeByExt[extension]||'application/octet-stream',name:name||id+extension};this.rows.set(id,row);return {id,...row};}
 register(path:string,name?:string){const real=realpathSync(path);if(realpathSync(this.root)!==realpathSync(join(path,'..')))throw Error('artifact_unavailable');if(statSync(real).size>200*1024*1024)throw Error('artifact_too_large');const id=randomUUID(),row={path:real,name:name||basename(real),mime:mimeByExt[extname(real)]||'application/octet-stream'};this.rows.set(id,row);return {id,...row};}
 get(id:string){const r=this.rows.get(id);if(!r||realpathSync(join(r.path,'..'))!==realpathSync(this.root))throw Error('artifact_unavailable');return r;}
 public(row:{id:string;name:string;mime:string}){return {artifactId:row.id,name:row.name,mime:row.mime};}
}
