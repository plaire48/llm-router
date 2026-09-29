import assert from 'node:assert/strict';

// Deterministic transport fixture. The production DeepAgents graph, tools,
// source access, citation validation and provider adapter still execute.
export function wikiAgentCompletion(body) {
  const system=body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  if(!system.includes('Plan OpenWiki research') && !system.includes("OpenWiki's read-only evidence researcher"))return null;
  assert((body.tools || []).every(t=>['search_wiki','read_wiki'].includes(t.function.name)));
  const json=value=>({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]});
  const report=ids=>({status:'complete',answer:'위키의 근거를 확인했습니다.',findings:[{text:'요청한 내용의 원문을 확인했습니다.',citations:ids.slice(0,3)}],uncertainties:[]});
  if(system.includes('Plan OpenWiki research'))return json({mode:'focused',questions:['요청과 관련한 원문 확인']});
  if(system.includes('Synthesize'))return json(report(JSON.parse(body.messages.findLast(m=>m.role==='user').content).evidence.map(e=>e.id)));
  const read=body.messages.findLast(m=>m.role==='tool');
  if(read)return json(report([JSON.parse(read.content).id]));
  const task=JSON.parse(body.messages.find(m=>m.role==='user').content);
  return {choices:[{message:{content:'',tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_wiki',arguments:JSON.stringify({documentId:task.assignment.documentIds[0],start:0,length:6000})}}]},finish_reason:'tool_calls'}]};
}
