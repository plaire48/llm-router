import {AI_SEARCH_PROVIDERS} from '@genoffice/ai-provider';
import {webSearch,type SearchOptions} from '@genoffice/ai-search';
import {readBodyCapped} from '@genoffice/electron-utils/remote-image';
import {fetchWithSsrfGuard} from '@genoffice/electron-utils/safe-remote-url';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {join,extname,basename} from 'node:path';
export type ServiceSettings={search:{provider:string;apiKey:string}};
const defaults=():ServiceSettings=>({search:{provider:'parallel',apiKey:''}});
export class OfficeServices {
 settings=defaults();
 constructor(private persist:(key:string,value:unknown)=>Promise<void>){}
 restore(value:unknown){try{this.settings=this.valid(value);}catch{this.settings=defaults();}}
 private valid(value:any):ServiceSettings{
  if(!value||!AI_SEARCH_PROVIDERS.some(m=>m.id===value.search?.provider&&m.id!=='genspark')||typeof value.search.apiKey!=='string'||value.search.apiKey.length>16000)throw Error('services_invalid');
  return {search:{provider:value.search.provider,apiKey:value.search.apiKey}};
 }
 state(){const s=this.settings;return {search:{provider:s.search.provider,connected:!!s.search.apiKey||s.search.provider==='parallel'},searchProviders:AI_SEARCH_PROVIDERS.filter(p=>p.id!=='genspark')};}
 async configure(input:any){const old=this.settings;const candidate={search:{...input.search,apiKey:input.search?.apiKey||(input.search?.provider===old.search.provider?old.search.apiKey:'')}};const validated=this.valid(candidate);await this.persist('services',validated);this.settings=validated;return this.state();}
 async clear(){const next=defaults();await this.persist('services',next);this.settings=next;return this.state();}
 options():SearchOptions{const p=this.settings.search.provider,key=this.settings.search.apiKey;return {useGsk:false,prefer:p as any,serperKey:p==='serper'?key:'',serplyKey:p==='serply'?key:'',tavilyKey:p==='tavily'?key:'',parallelKey:p==='parallel'?key:'',exaKey:p==='exa'?key:'',firecrawlKey:p==='firecrawl'?key:''};}
 async search(query:string,count:number){return webSearch(query,count,this.options());}
}
const mimeByExt:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.mp3':'audio/mpeg','.wav':'audio/wav'};
export class Artifacts {
 private rows=new Map<string,{path:string;mime:string;name:string}>();
 constructor(readonly root:string){mkdirSync(root,{recursive:true,mode:0o700});}
 put(bytes:Uint8Array,extension:string,name?:string,mime?:string){if(!/^\.[a-z0-9]+$/.test(extension)||bytes.length>200*1024*1024||bytes.length===0)throw Error('artifact_invalid');const id=randomUUID();const path=join(this.root,id+extension);writeFileSync(path,bytes,{mode:0o600});const row={path,mime:mime||mimeByExt[extension]||'application/octet-stream',name:name||id+extension};this.rows.set(id,row);return {id,...row};}
 register(path:string,name?:string){const real=realpathSync(path);if(realpathSync(this.root)!==realpathSync(join(path,'..')))throw Error('artifact_unavailable');if(statSync(real).size>200*1024*1024)throw Error('artifact_too_large');const id=randomUUID(),row={path:real,name:name||basename(real),mime:mimeByExt[extname(real)]||'application/octet-stream'};this.rows.set(id,row);return {id,...row};}
 get(id:string){const r=this.rows.get(id);if(!r||realpathSync(join(r.path,'..'))!==realpathSync(this.root))throw Error('artifact_unavailable');return r;}
 async web(url:string,signal?:AbortSignal){const resp=await fetchWithSsrfGuard(url,{fetchImpl:(url,init)=>fetch(url,{...init,signal:signal?AbortSignal.any([signal,...(init?.signal?[init.signal]:[])]):init?.signal}),headers:{'User-Agent':'Nubi-Office/0.6'}});if(!resp?.ok)throw Error('page_unavailable');const bytes=await readBodyCapped(resp,1024*1024);return new TextDecoder().decode(bytes).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,30000);}
 public(row:{id:string;name:string;mime:string}){return {artifactId:row.id,name:row.name,mime:row.mime};}
}
