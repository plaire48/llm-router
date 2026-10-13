// Office-only CLI envelope adapter. The original Nubi provider stays immutable.
export function claudeResultFailure(event){
 if(event?.type!=='result')return null;
 if(event.subtype==='error_max_turns')return 'claude_turn_limit';
 if(event.subtype==='error_max_structured_output_retries'||event.subtype==='success'&&!event.structured_output)return 'claude_structured_output_failed';
 return null;
}
export function officeClaudeRun(run){return async(binary,args,options={})=>{
 const adapted=[...args];const index=adapted.indexOf('--max-turns');if(index>=0)adapted[index+1]='8';
 if(adapted[0]==='-p'){
  adapted.push('--disallowedTools','mcp__*');
  const schemaIndex=adapted.indexOf('--json-schema');
  try{
   const catalog=JSON.parse(options.input||'{}').hostActionCatalog;
   if(schemaIndex>=0&&Array.isArray(catalog)&&catalog.length){
    const schema=JSON.parse(adapted[schemaIndex+1]);
    // Real CLI models repeatedly double-encode arrays inside JSON-string args.
    // Constrain the proposal at generation, then use the original wire decoder.
    schema.properties.calls.items={oneOf:catalog.map(t=>({type:'object',additionalProperties:false,required:['name','arguments'],properties:{name:{type:'string',enum:[t.function.name]},arguments:t.function.parameters}}))};
    adapted[schemaIndex+1]=JSON.stringify(schema);
    const promptIndex=adapted.indexOf('--system-prompt');
    if(promptIndex>=0)adapted[promptIndex+1]+=' For this Office schema, calls[].arguments MUST be a JSON object, with nested arrays and objects of the declared types. Do not JSON-encode arguments or array fields as strings.';
   }
  }catch{/* An invalid input/schema is still rejected by the original provider. */}
 }
 let failure=null;
 try{const result=await run(binary,adapted,{...options,onEvent:event=>{
   if(event?.type==='result'&&event.subtype==='success'){
    let value=event.structured_output;
    if(!value&&typeof event.result==='string')try{value=JSON.parse(event.result.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1'));}catch{}
    if(value&&typeof value.content==='string'&&Array.isArray(value.calls))event={...event,structured_output:{...value,calls:value.calls.map(c=>c&&c.arguments&&typeof c.arguments==='object'&&!Array.isArray(c.arguments)?{...c,arguments:JSON.stringify(c.arguments)}:c)}};
   }
   failure=claudeResultFailure(event)||failure;options.onEvent?.(event);
  }});if(failure)throw Error(failure);return result;}
 catch(error){if(error.message==='cancelled')throw error;throw Error(failure||error.message);}
};}
