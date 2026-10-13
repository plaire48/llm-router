// Adapt the CLI envelope, retaining Nubi's original provider and CLI-owned login.
export function claudeResultFailure(event){
 if(event?.type!=='result')return null;
 if(event.subtype==='error_max_turns')return 'claude_turn_limit';
 if(event.subtype==='error_max_structured_output_retries'||event.subtype==='success'&&!event.structured_output)return 'claude_structured_output_failed';
 return null;
}
export function officeClaudeRun(run){return async(binary,args,options={})=>{
 const adapted=[...args];const index=adapted.indexOf('--max-turns');if(index>=0)adapted[index+1]='8';
 if(adapted[0]==='-p')adapted.push('--disallowedTools','mcp__*');
 let failure=null;
 try{const result=await run(binary,adapted,{...options,onEvent:event=>{failure=claudeResultFailure(event)||failure;options.onEvent?.(event);}});if(failure)throw Error(failure);return result;}
 catch(error){if(error.message==='cancelled')throw error;throw Error(failure||error.message);}
};}
