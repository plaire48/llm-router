import {randomUUID} from 'node:crypto';

// An IPC capability owned by the service, not a callable service method.
export function installConnectionVault(service,channel=process){
 if(typeof channel.send!=='function')return;
 const pending=new Map();
 channel.on('message',message=>{const reply=message?.connectionSecretReply,item=pending.get(reply?.id);if(!item)return;clearTimeout(item.timer);pending.delete(reply.id);reply.error?item.reject(Error('secret_unavailable')):item.resolve(reply.value??null);});
 channel.on('disconnect',()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('secret_unavailable'));}pending.clear();});
 const request=(operation,key,value)=>new Promise((resolve,reject)=>{
  const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('secret_unavailable'));},15000);
  pending.set(id,{resolve,reject,timer});channel.send({connectionSecretRequest:{id,operation,key,...(value!==undefined?{value}:{})}},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(Error('secret_unavailable'));}});
 });
 service.connectionVault={get:key=>request('get',key),set:(key,value)=>request('set',key,value),delete:key=>request('delete',key)};
}
