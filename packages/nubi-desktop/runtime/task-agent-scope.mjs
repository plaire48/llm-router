// Each conversation owns its controller, timing and tool context. Mutable host
// resources (store, processes, write locks, provider and project) stay shared.
const ROOT=Symbol('taskAgentRoot'),TASK=Symbol('taskAgentTask'),WRAPPED=Symbol('taskAgentWrapped');
export function taskAgentScope(service,taskId){
  const root=service[ROOT]||service;
  if(!taskId)return root;
  if(service[TASK]===taskId)return service;
  return new Proxy(root,{
    get(target,key,receiver){if(key===ROOT)return root;if(key===TASK)return taskId;if(key==='agent')return target.agentForTask(taskId);return Reflect.get(target,key,receiver);},
    set(target,key,value){return Reflect.set(target,key,value,target);}
  });
}
export function installTaskAgentScopes(ProjectService){
  for(const name of ['startAgent','answerAgent','stopAgent','regenerateAnswer','agentInput','resumeAgent','diagnoseProcess','applyCommandRepair']){
    const method=ProjectService.prototype[name];if(!method||method[WRAPPED])continue;
    const wrapped=function(args={}){const root=this[ROOT]||this;const taskId=args.taskId||(['diagnoseProcess','applyCommandRepair'].includes(name)?root.store?.get((name==='diagnoseProcess'?'process:':'command-repair:')+args.id)?.taskId:null);return method.call(taskAgentScope(root,taskId),args);};
    wrapped[WRAPPED]=true;ProjectService.prototype[name]=wrapped;
  }
}
