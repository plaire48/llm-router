import {AI_MEDIA_PROVIDERS,AI_SEARCH_PROVIDERS,generateImageWithProvider,analyzeMediaWithProvider,testMediaProvider,type AiMediaProviderConfig} from '@genoffice/ai-provider';
import {webSearch,imageSearch,type SearchOptions} from '@genoffice/ai-search';
import {fetchRemoteImage,readBodyCapped} from '@genoffice/electron-utils/remote-image';
import {fetchWithSsrfGuard} from '@genoffice/electron-utils/safe-remote-url';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {join,extname,basename} from 'node:path';
import type {MediaBlob} from '../vendor/genoffice/packages/ai-provider/src/media-protocols';
export type ServiceSettings={search:{provider:string;apiKey:string};media:{provider:string;config:AiMediaProviderConfig}};
const defaults=():ServiceSettings=>({search:{provider:'parallel',apiKey:''},media:{provider:'custom',config:{apiKey:'',baseUrl:'',imageModel:'',analysisModel:''}}});
export class OfficeServices {
 settings=defaults();
 constructor(private persist:(key:string,value:unknown)=>Promise<void>){}
 restore(value:unknown){try{this.settings=this.valid(value);}catch{this.settings=defaults();}}
 private valid(value:any):ServiceSettings{
  if(!value||!AI_SEARCH_PROVIDERS.some(m=>m.id===value.search?.provider)||!AI_MEDIA_PROVIDERS.some(m=>m.id===value.media?.provider&&m.id!=='genspark'))throw Error('services_invalid');
  const c=value.media.config;for(const s of [value.search.apiKey,c.apiKey,c.baseUrl||'',c.imageModel,c.analysisModel])if(typeof s!=='string'||s.length>16000)throw Error('services_invalid');
  if(c.baseUrl){const u=new URL(c.baseUrl);if(u.username||u.password||u.hash||u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('services_https_required');}
  return structuredClone(value);
 }
 state(){const s=this.settings;return {search:{provider:s.search.provider,connected:!!s.search.apiKey||s.search.provider==='parallel'},media:{provider:s.media.provider,connected:!!s.media.config.apiKey,baseUrl:s.media.config.baseUrl||'',imageModel:s.media.config.imageModel,analysisModel:s.media.config.analysisModel},searchProviders:AI_SEARCH_PROVIDERS.filter(p=>p.id!=='genspark'),mediaProviders:AI_MEDIA_PROVIDERS.filter(p=>p.id!=='genspark')};}
 async configure(input:any){const old=this.settings;const candidate={search:{...input.search,apiKey:input.search.apiKey||(input.search.provider===old.search.provider?old.search.apiKey:'')},media:{provider:input.media.provider,config:{...input.media.config,apiKey:input.media.config.apiKey||(input.media.provider===old.media.provider&&(input.media.config.baseUrl||'').replace(/\/$/,'')===(old.media.config.baseUrl||'').replace(/\/$/,'')?old.media.config.apiKey:'')}}};const validated=this.valid(candidate);await this.persist('services',validated);this.settings=validated;return this.state();}
 async clear(){const next=defaults();await this.persist('services',next);this.settings=next;return this.state();}
 options():SearchOptions{const p=this.settings.search.provider,key=this.settings.search.apiKey;return {useGsk:false,prefer:(p==='genspark'?'parallel':p) as any,serperKey:p==='serper'?key:'',serplyKey:p==='serply'?key:'',tavilyKey:p==='tavily'?key:'',parallelKey:p==='parallel'?key:'',exaKey:p==='exa'?key:'',firecrawlKey:p==='firecrawl'?key:''};}
 async search(query:string,count:number,images=false){return images?imageSearch(query,count,this.options()):webSearch(query,count,this.options());}
 async generate(prompt:string,aspectRatio:string,transparent:boolean,references:MediaBlob[],signal?:AbortSignal){if(!this.settings.media.config.apiKey)throw Error('image_provider_required');return generateImageWithProvider(this.settings.media.provider as any,this.settings.media.config,{prompt,aspectRatio,transparent,references},signal);}
 async analyze(media:MediaBlob[],requirements:string,signal?:AbortSignal){if(!this.settings.media.config.apiKey)throw Error('media_provider_required');return analyzeMediaWithProvider(this.settings.media.provider as any,this.settings.media.config,{media,requirements},signal);}
 async test(){return testMediaProvider(this.settings.media.provider as any,this.settings.media.config);}
}
const mimeByExt:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.mp3':'audio/mpeg','.wav':'audio/wav'};
export class Artifacts {
 private rows=new Map<string,{path:string;mime:string;name:string}>();
 constructor(readonly root:string){mkdirSync(root,{recursive:true,mode:0o700});}
 put(bytes:Uint8Array,extension:string,name?:string,mime?:string){if(!/^\.[a-z0-9]+$/.test(extension)||bytes.length>200*1024*1024||bytes.length===0)throw Error('artifact_invalid');const id=randomUUID();const path=join(this.root,id+extension);writeFileSync(path,bytes,{mode:0o600});const row={path,mime:mime||mimeByExt[extension]||'application/octet-stream',name:name||id+extension};this.rows.set(id,row);return {id,...row};}
 register(path:string,name?:string){const real=realpathSync(path);if(realpathSync(this.root)!==realpathSync(join(path,'..')))throw Error('artifact_unavailable');if(statSync(real).size>200*1024*1024)throw Error('artifact_too_large');const id=randomUUID(),row={path:real,name:name||basename(real),mime:mimeByExt[extname(real)]||'application/octet-stream'};this.rows.set(id,row);return {id,...row};}
 get(id:string){const r=this.rows.get(id);if(!r||realpathSync(join(r.path,'..'))!==realpathSync(this.root))throw Error('artifact_unavailable');return r;}
 async image(ref:string,signal?:AbortSignal):Promise<MediaBlob>{if(this.rows.has(ref)){const r=this.get(ref);if(!r.mime.startsWith('image/'))throw Error('image_required');return {bytes:readFileSync(r.path),mime:r.mime,name:r.name};}const resp=await fetchRemoteImage(ref,{fetchImpl:(url,init)=>fetch(url,{...init,signal:signal?AbortSignal.any([signal,...(init?.signal?[init.signal]:[])]):init?.signal})});if(!resp?.ok)throw Error('image_download_failed');const bytes=await readBodyCapped(resp,25*1024*1024);return {bytes,mime:resp.headers.get('content-type')?.split(';')[0]||'image/png'};}
 async web(url:string,signal?:AbortSignal){const resp=await fetchWithSsrfGuard(url,{fetchImpl:(url,init)=>fetch(url,{...init,signal:signal?AbortSignal.any([signal,...(init?.signal?[init.signal]:[])]):init?.signal}),headers:{'User-Agent':'Nubi-Office/0.6'}});if(!resp?.ok)throw Error('page_unavailable');const bytes=await readBodyCapped(resp,1024*1024);return new TextDecoder().decode(bytes).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,30000);}
 public(row:{id:string;name:string;mime:string}){return {artifactId:row.id,name:row.name,mime:row.mime};}
}
