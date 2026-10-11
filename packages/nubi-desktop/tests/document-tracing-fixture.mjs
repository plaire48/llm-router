// Runs in a disposable child with tracing enabled in its inherited environment.
// All networking is blocked before importing the actual service entry point.
let requests=0;
globalThis.fetch=async()=>{requests++;throw Error('fixture_network_denied');};
await import('../runtime/service-entry.mjs');
const {runWikiQuestion,NubiOpenWikiModel}=await import('../generated/openwiki.mjs');
const report=id=>({status:'complete',answer:'Read fixture source.',findings:[{text:'Fixture fact.',citations:[id]}],uncertainties:[]});
const complete=async messages=>{
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  if(system.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode:'comprehensive',questions:['Read the fixture.']})};
  if(system.includes('Synthesize'))return {content:JSON.stringify(report(JSON.parse(messages.at(-1).content).evidence[0].id))};
  const last=messages.findLast(m=>m.role==='tool');
  if(last)return {content:JSON.stringify(report(JSON.parse(last.content).id))};
  return {calls:[{id:crypto.randomUUID(),function:{name:'read_wiki',arguments:JSON.stringify({documentId:'fixture',start:0,length:6000})}}]};
};
const signal=new AbortController().signal;
const result=await runWikiQuestion({question:'Read the entire fixture.',sourceComplete:true,documents:[{id:'fixture',path:'fixture.md',title:'Fixture',kind:'folder',text:'Fixture fact.'}]},{signal,modelId:'fixture',model:new NubiOpenWikiModel({complete,signal,modelId:'fixture',taskId:'fixture'})});
console.log(JSON.stringify({status:result.status,requests,tracing:process.env.LANGSMITH_TRACING??null}));
