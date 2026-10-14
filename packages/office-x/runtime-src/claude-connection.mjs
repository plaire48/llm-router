import {createClaudeCode} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-code.mjs';
// Keep Claude Code in charge of OAuth and credentials. Record only allowlisted
// stage/error codes so asynchronous login cannot hide its actual failing stage.
export function createOfficeClaudeCode(deps,create=createClaudeCode){
 let diagnostic=null,stage='discovery';
 const provider=create({...deps,findBinary:async()=>{stage='discovery';return deps.findBinary();},run:async(binary,args,options)=>{
  stage=args[0]==='--help'?'capabilities':args[0]==='auth'?'authentication':args.includes('--input-format')?'catalog':'response';
  try{return await deps.run(binary,args,options);}catch(error){
   // A process crash is not proof that the user is signed out.
   if(stage==='authentication'&&error.message==='claude_cli_failed')throw Error('claude_auth_check_failed');
   throw error;
  }
 }});
 return {...provider,connect:async()=>{
  diagnostic=null;
  try{return await provider.connect();}catch(error){
   const code=error.message==='claude_models_unavailable'?'claude_catalog_unavailable':error.message;
   diagnostic={stage,code:/^[a-z_]{1,60}$/.test(code)?code:'claude_cli_failed'};
   throw Error(diagnostic.code);
  }
 },connectionDiagnostic:()=>diagnostic,clearConnectionDiagnostic:()=>{diagnostic=null;},recordConnectionFailure:(stage,error)=>{diagnostic={stage,code:/^[a-z_]{1,60}$/.test(error?.message)?error.message:'claude_login_failed'};},disconnect:()=>{diagnostic=null;return provider.disconnect();}};
}
