export const displayLabel=value=>String(value||'').replace(/[·•]/g,' ').replace(/\s+/g,' ').trim();
export const labels={aipro:'AI Pro',chatgpt:'ChatGPT',fabrix:'FabriX',claude:'Claude'};
export function modelData(state={}){
  const catalog=models=>({models:(models||[]).map(m=>({...m,name:m.id,displayName:displayLabel(m.label||m.id)}))});
  return {activeProvider:state.provider||'aipro',settings:{modelId:state.model||''},catalog:catalog(state.models),
    catalogs:Object.fromEntries((state.catalogs||[]).map(c=>[c.provider,catalog(c.models)])),
    selectedModels:Object.fromEntries((state.catalogs||[]).map(c=>[c.provider,c.model])),
    connections:Object.fromEntries((state.providers||[]).map(p=>[p.id,{present:p.connected,receivedAt:p.connectionId}])),
    pending:state.pending?{provider:state.pending,phase:state.pendingPhase}:null,report:{provider:state.provider,error:state.loginError}};
}
