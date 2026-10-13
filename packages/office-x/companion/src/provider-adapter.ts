import {streamForProvider as originalStream} from '../packages/ai-provider/src/stream';
import {chatForProvider as originalChat} from '../packages/ai-provider/src/chat';
export * from '../packages/ai-provider/src/index';
const isNubi=(provider:any,config:any)=>provider==='custom'&&config?.baseUrl==='http://nubi.workspace.local/v1';
export function streamForProvider(provider:any,config:any,...args:any[]){return isNubi(provider,config)?(globalThis as any).__nubiOfficeBridge.stream(config,...args):(originalStream as any)(provider,config,...args);}
export function chatForProvider(provider:any,config:any,...args:any[]){return isNubi(provider,config)?(globalThis as any).__nubiOfficeBridge.chat(config,...args):(originalChat as any)(provider,config,...args);}
