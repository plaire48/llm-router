import {randomUUID} from 'node:crypto';
import {modelJson} from './model-json.mjs';
import {toolArgumentIssues} from '../../../extensions/aipro-chat/tool-validation.js';

// Expose only one call to Pi. The next model turn must consume its receipt
// before choosing another action; later calls in a batch are not executed.
function rejectTool(tool,issues,unavailable=false){
  const error=unavailable?'tool_unavailable':'tool_arguments_invalid';
  return Object.assign(new Error(error),{toolFailure:{error,tool,actionIssued:false,
    ...(issues?{issues}:{}),instruction:unavailable?
      'This tool is not available and was NOT executed. Choose only a tool declared in this request. Do not invent capabilities or broaden the scope.':
      'This tool was NOT executed. Correct only the indicated argument fields using the declared schema and observed targets. Keep completed work and existing approvals.'+
      // The shared validator names host-declared properties for missing or unsupported fields.
      (issues?.some(issue=>issue.objectSchemas?.length)?' objectSchemas lists the properties the host declared at objectSchemaPath: supply every requiredProperties name and remove fields outside allowedProperties. Each entry is a separate schema alternative, not a merged list. If schemaHintsTruncated is true, read the full declared schema.':'')}});
}
// Worksheet reads change nothing and do not depend on each other, so a reply may carry up to four of them.
// A live run sent four reads in one reply, had three discarded, and needed four rounds for four sheets.
// Every other tool stays one call per reply: its result must be seen before the next decision.
export const TOGETHER=new Set(['list_worksheets','inspect_worksheet','read_worksheet_range','get_range_data','calculate_ranges']);
export function singleToolResponse(response,tools) {
  const calls=response.calls||[],keep=calls.length>1&&calls.every(call=>TOGETHER.has(call?.function?.name))?Math.min(calls.length,4):1;
  const selected=calls.length>keep?{...response,calls:calls.slice(0,keep)}:response;
  if(!tools||!selected.calls?.length)return selected;
  for(const item of selected.calls){
    const call=item?.function,definition=tools.find(t=>t.function.name===call?.name)?.function;
    // Preflight before Pi admission: its unknown-tool/schema rejections bypass
    // execute(), so they otherwise miss Office's per-failure supervisor.
    if(!definition)throw rejectTool('unavailable_tool',null,true);
    let args;try{args=JSON.parse(call.arguments);}catch{throw rejectTool(definition.name,[{path:'',rule:'json'}]);}
    const issues=toolArgumentIssues(definition.parameters,args);
    if(issues)throw rejectTool(definition.name,issues);
  }
  return selected;
}
export function jsonToolMessages(messages, tools, {allowFinal=false}={}) {
  const instruction=' Select exactly ONE next tool using JSON {"tool":"declared_name","arguments":{...}}. Read the previous tool receipt before choosing it. No Markdown, reasoning, scripts or batch. '+(allowFinal?'Only after all requested work is verified, return {"answer":"short Korean result"}; the supervisor still checks completion. ':'Do not claim completion. ')+'Arguments must follow the declared schema. Available tools: '+JSON.stringify(tools.map(t=>t.function));
  return messages.map((m,i)=>{
    if(i===0&&m.role==='system')return {...m,content:m.content+instruction};
    if(m.role==='tool')return {role:'user',content:JSON.stringify({toolReceipt:m.content})};
    if(m.tool_calls?.length){
      const call=m.tool_calls[0].function;let args;
      try{args=JSON.parse(call.arguments);}catch{return{role:'assistant',content:JSON.stringify({rejectedTool:call.name,invalidArguments:String(call.arguments).slice(0,2000)})};}
      return {role:'assistant',content:JSON.stringify({tool:call.name,arguments:args})};
    }
    return m;
  });
}
export function jsonToolResponse(response, tools, {allowFinal=false}={}) {
  const value=modelJson(response.content,'tools_unavailable');
  if(allowFinal&&value&&Object.keys(value).length===1&&typeof value.answer==='string'&&value.answer.trim()&&value.answer.length<=4000)return{...response,content:value.answer,calls:[],finishReason:'stop'};
  const definition=tools.find(t=>t.function.name===value?.tool)?.function;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['tool','arguments'].includes(k)))throw new Error('tools_unavailable');
  if(!definition)throw rejectTool('unavailable_tool',null,true);
  if(!value.arguments||typeof value.arguments!=='object'||Array.isArray(value.arguments))throw rejectTool(definition.name,[{path:'',rule:'type'}]);
  const args={...value.arguments};
  // JSON-valued string parameters are a transport detail. Preflight and Pi
  // validate the final string, required parameters and additional properties.
  for(const key of ['chunk','sheet','plan'])if(definition.parameters.properties[key]?.type==='string'&&args[key]&&typeof args[key]==='object')args[key]=JSON.stringify(args[key]);
  return singleToolResponse({...response,content:'',calls:[{id:randomUUID(),type:'function',function:{name:value.tool,arguments:JSON.stringify(args)}}],finishReason:'tool_calls'},tools);
}
