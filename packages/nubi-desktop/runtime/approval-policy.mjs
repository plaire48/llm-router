// Automatic approval (user decision 2026-09-30: three modes and "always allow", as in Codex and Claude Code).
// The mode is kept for each project:
//   ask       every proposal waits for the user;
//   edits     file proposals are applied as they come;
//   commands  file proposals, and the project's own check commands: a test, build, lint or check script that the
//             manifest declares, run by its package manager with nothing else on the line.
// A command the user allowed runs by itself in every mode. Administrator commands and app control always wait for
// the user. Commands run without isolation, so no other command is automatic.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fail} from './files.mjs';

export const APPROVAL_MODES=Object.freeze(['ask','edits','commands']);
const KEY='setting:approvals',ALLOWED_LIMIT=100;
const CHECK_SCRIPT=/^(?:test|tests|build|lint|check|typecheck|type-check|verify|validate)(?:[:-][\w.-]+)?$/i;
// A name that also says it ships, changes files or data, or runs on is never a check, whatever it starts with:
// lint:fix rewrites files that no proposal showed.
const NOT_A_CHECK=/deploy|publish|release|push|upload|migrat|install|seed|drop|reset|clean|start|serve|watch|fix|format|write|update/i;
const OPERATORS=/[;&|<>`$()\\\r\n]/;
const plain=script=>typeof script==='string'?script.trim():'';

export function approvalPolicy(store){
  const value=store.get(KEY);
  return {mode:APPROVAL_MODES.includes(value?.mode)?value.mode:'ask',allowedCommands:Array.isArray(value?.allowedCommands)?value.allowedCommands:[]};
}
export function setApprovalMode(store,mode){
  if(!APPROVAL_MODES.includes(mode))fail('approval_mode_invalid');
  store.set(KEY,{...approvalPolicy(store),mode});return approvalPolicy(store);
}
export const commandAllowed=(policy,{profile,script})=>policy.allowedCommands.some(item=>item.profile===profile&&item.script===plain(script));
// "Always allow" keeps the exact command for its shell. It never covers an administrator command.
export function allowCommand(store,{profile,script,privilege}){
  if(privilege==='administrator')fail('approval_administrator');
  if(typeof profile!=='string'||!profile||!plain(script)||plain(script).length>16000)fail('approval_command_invalid');
  const policy=approvalPolicy(store);
  if(!commandAllowed(policy,{profile,script})){
    if(policy.allowedCommands.length>=ALLOWED_LIMIT)fail('approval_command_limit');
    store.set(KEY,{...policy,allowedCommands:[...policy.allowedCommands,{profile,script:plain(script),addedAt:new Date().toISOString()}]});
  }
  return approvalPolicy(store);
}
export function removeAllowedCommand(store,{profile,script}){
  const policy=approvalPolicy(store);
  store.set(KEY,{...policy,allowedCommands:policy.allowedCommands.filter(item=>!(item.profile===profile&&item.script===plain(script)))});
  return approvalPolicy(store);
}

// A check command of the project. npm runs only its test script without `run`. Watch modes never end on their own.
export function checkCommand(script,scripts={}){
  const text=plain(script);
  if(!text||OPERATORS.test(text)||/watch/i.test(text))return false;
  const match=/^(npm|pnpm|yarn)(?:\.cmd)?\s+(?:(run|run-script)\s+)?([\w:.-]+)(?:\s+--(?:\s+[\p{L}\p{N}_:./=@,+-]+)*)?$/iu.exec(text);
  if(!match)return false;
  const [,manager,run,name]=match;
  if(manager.toLowerCase()==='npm'&&!run&&name!=='test')return false;
  return Object.hasOwn(scripts,name)&&CHECK_SCRIPT.test(name)&&!NOT_A_CHECK.test(name);
}
async function manifestScripts(root){
  try{const value=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));return value?.scripts&&typeof value.scripts==='object'&&!Array.isArray(value.scripts)?value.scripts:{};}
  catch{return {};}
}

// What the host may carry out now without the user: the file proposals to apply, or else one command to run.
// Nothing while the agent runs, a question waits or a command is running.
export async function autoApprovals(service,{taskId}){
  const task=service.task(taskId),policy=approvalPolicy(service.store),none={mode:policy.mode,proposals:[],command:null};
  if(service.agent?.running||task.question||task.state!=='review'||service.setupBusy||service.processes?.active.size||service.processes?.pending.size)return none;
  const state=service.state(),open=state.proposals.filter(p=>p.taskId===taskId&&p.state==='proposed').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  if(policy.mode!=='ask'&&open.length){
    // The newest proposal of each file, as the editor applies them.
    const seen=new Set(),proposals=[];for(const p of open)if(!seen.has(p.path)){seen.add(p.path);proposals.push(p.id);}
    return {...none,proposals};
  }
  const scripts=policy.mode==='commands'?await manifestScripts(await service.target(taskId)):{};
  const waiting=action=>(action.afterProposals||[]).some(id=>service.store.get('proposal:'+id)?.state==='proposed');
  const commands=[...(state.setupActions||[]).filter(v=>v.taskId===taskId&&v.state==='proposed'&&v.privilege!=='administrator'&&!waiting(v)).map(value=>({kind:'setup',value})),
    ...(state.commandRepairs||[]).filter(v=>v.taskId===taskId&&v.state==='proposed').map(value=>({kind:'repair',value}))]
    .sort((a,b)=>String(a.value.createdAt).localeCompare(String(b.value.createdAt)));
  for(const {kind,value} of commands){
    const reason=commandAllowed(policy,value)?'allowed':policy.mode==='commands'&&checkCommand(value.script,scripts)?'check':null;
    if(reason)return {...none,command:{kind,id:value.id,fingerprint:value.fingerprint,script:value.script,reason}};
  }
  return none;
}

export function installApprovalPolicy(ProjectService){
  ProjectService.prototype.approvalPolicy=function(){this.ready();return approvalPolicy(this.store);};
  ProjectService.prototype.setApprovalMode=function({mode}){this.ready();return setApprovalMode(this.store,mode);};
  // Always allow the command of a proposal the user sees, then approve it as usual.
  ProjectService.prototype.allowCommand=function({kind='setup',id}){
    this.ready();const value=this.store.get((kind==='repair'?'command-repair:':'setup-action:')+id);
    if(!value)fail('approval_command_invalid');
    return allowCommand(this.store,value);
  };
  ProjectService.prototype.removeAllowedCommand=function({profile,script}){this.ready();return removeAllowedCommand(this.store,{profile,script});};
  ProjectService.prototype.autoApprovals=function({taskId}){this.ready();return autoApprovals(this,{taskId});};
}
