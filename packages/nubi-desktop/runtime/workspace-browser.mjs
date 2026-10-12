import {randomUUID} from 'node:crypto';

export function workspacePageUrl(value){
  if(typeof value!=='string'||value.length>2048)throw Error('browser_url_invalid');
  let url;try{url=new URL(value);}catch{throw Error('browser_url_invalid');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('browser_url_invalid');
  return url.href;
}

// A page-opening bridge, not browser automation or an authenticated page reader.
export function installWorkspaceBrowser(service){
  if(typeof process.send!=='function')return;
  const pending=new Map();
  process.on('message',message=>{
    const reply=message?.workspacePageReply,item=pending.get(reply?.id);if(!item)return;
    clearTimeout(item.timer);pending.delete(reply.id);
    reply.error?item.reject(Error(/^[a-z_]+$/.test(reply.error)?reply.error:'browser_unavailable')):item.resolve({opened:reply.opened===true,...(typeof reply.tabId==='string'?{tabId:reply.tabId}:{}),userInteractionRequired:true});
  });
  process.on('disconnect',()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('browser_unavailable'));}pending.clear();});
  service.openWorkspacePage=async({url,authentication=false})=>{
    const id=randomUUID(),target=workspacePageUrl(url);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('browser_unavailable'));},15000);
      pending.set(id,{resolve,reject,timer});
      process.send({workspacePageRequest:{id,url:target,authentication:authentication===true}},error=>{if(!error)return;const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);reject(Error('browser_unavailable'));}});
    });
  };
  service.closeWorkspaceAuthPage=async tabId=>{
    if(typeof tabId!=='string')return;
    process.send({workspaceAuthPageClose:{tabId}});
  };
}
