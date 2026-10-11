// A small input window holds little beside the fixed part of a request, and
// tool definitions are its largest part: about 7,500 tokens for the 36 tools of
// a host without app control. Measured with an input limit of 18,700 tokens,
// about 3,000 were left for the work. Below LEAN_INPUT_TOKENS a request offers
// the tools most tasks start with and a way to the rest (user decision
// 2026-09-29). The shared browser harness draws its line at 32,000 tokens for
// its larger schemas; at 27,000 tokens Desktop keeps about 12,000 for the work,
// so its line is lower. The tools of the workflows that
// the planner chose are offered once the plan is recorded. A tool the model
// calls runs as before and is offered from then on: offering is not permission,
// and every host check still applies to every tool.
import {WORKFLOWS} from './agent-capabilities.mjs';

export const LEAN_INPUT_TOKENS=20000;

// discover_capabilities stays: the system guidance asks for it on a new task.
export const LEAN_TOOLS=Object.freeze(['update_plan','ask_user','select_tools','discover_capabilities','open_workspace_page','read_source','source_search','wiki_query','personal_mail_query','read_personal_mail','ask_openwiki','read_conversation','read_analysis_evidence']);
// Tools that no workflow names, grouped by what they are for.
const EXTRA={mail:['personal_mail_query','read_personal_mail'],'source-change':['inspect_path','propose_edit','inspect_workspace_changes'],skills:['use_skill','read_skill','list_skill_resources'],analysis:['delegate_analysis','collect_analysis','read_analysis_handoff','cancel_analysis'],documents:['analyze_documents','read_document_analysis']};
const PURPOSE={mail:'사내 메일 personal mail email attachment',skills:'프로젝트 스킬 찾기와 읽기 project skills procedure',analysis:'하위 분석 에이전트 위임과 수집 delegate parallel analysis',documents:'대용량 문서 분석 large documents'};
export const LEAN_GUIDANCE='A request offers only some tools, so its fixed part stays small. The tools of the workflows in your plan are offered once the plan is recorded. select_tools adds others by group or query; call it together with the operation that needs them.';
export const SELECT_TOOLS={type:'function',function:{name:'select_tools',description:'Offer more tools from the next request on: groups by workflow id, or a query of a few words (Korean or English) for up to five matching tools. A tool asked for in the same response runs as usual. Offering is not permission; host checks and approvals are unchanged.',
  parameters:{type:'object',additionalProperties:false,properties:{groups:{type:'array',maxItems:6,uniqueItems:true,items:{type:'string',minLength:1,maxLength:40}},query:{type:'string',minLength:1,maxLength:300}}}}};

export function createToolSet({tools,lean,planned=()=>[]}) {
  const names=new Set(tools.map(item=>item.function.name));
  const groups=Object.fromEntries([...WORKFLOWS.map(workflow=>[workflow.id,[...workflow.tools,...(EXTRA[workflow.id]||[])]]),...Object.entries(EXTRA).filter(([id])=>!WORKFLOWS.some(workflow=>workflow.id===id))]
    .map(([id,list])=>[id,[...new Set(list)].filter(name=>names.has(name))]).filter(([,list])=>list.length));
  const purpose=id=>WORKFLOWS.find(workflow=>workflow.id===id)?.description||PURPOSE[id]||'';
  const enabled=new Set(LEAN_TOOLS);
  const offered=name=>enabled.has(name)||(planned()||[]).some(id=>groups[id]?.includes(name));
  return {
    lean,
    advertised:definitions=>lean?definitions.filter(item=>offered(item.function.name)):definitions,
    observe(name){if(lean&&names.has(name))enabled.add(name);},
    select(args){
      if(!lean)return {ok:true,connected:[],matches:[],instruction:'Every tool is already offered.'};
      const list=Array.isArray(args?.groups)?args.groups:[],query=typeof args?.query==='string'?args.query:'';
      const unknown=list.filter(id=>!groups[id]);
      if(unknown.length||!list.length&&!query.trim())return {ok:false,error:'tool_group_unknown',actionIssued:false,details:{unknownGroups:unknown,groups:Object.keys(groups)},instruction:'Give groups from details.groups, a query of a few words, or both. No tool was offered.'};
      const words=query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>1);
      const text=item=>[item.function.name.replace(/_/g,' '),item.function.description||'',...Object.entries(groups).filter(([,members])=>members.includes(item.function.name)).map(([id])=>id+' '+purpose(id))].join(' ').toLowerCase();
      const matches=words.length?tools.map((item,order)=>({name:item.function.name,order,score:words.filter(word=>text(item).includes(word)).length})).filter(hit=>hit.score>0&&!enabled.has(hit.name)).sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,5).map(hit=>hit.name):[];
      const connected=[...new Set([...list.flatMap(id=>groups[id]),...matches])];
      for(const name of connected)enabled.add(name);
      return {ok:true,connected,matches,groups:Object.keys(groups),instruction:connected.length?'These tools are offered from the next request on.':'Nothing new matched. Try a group from groups or other words.'};
    },
  };
}
