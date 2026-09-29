// Drives one evaluation case through the real Desktop service without a
// screen: create the task, run the agent, answer defined questions, send the
// follow-up turns, then apply allowed proposals. Limits here are evaluation
// limits only. They are not product limits and never change the product.
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readRunMetrics} from '../runtime/run-metrics.mjs';
import {createWorkspace} from './corpus.mjs';
import {recordingProviders} from './transcript.mjs';
import {createUser,applyProposals} from './user.mjs';

// maxModelCalls bounds the main agent. maxDelegatedCalls bounds the OpenWiki agent it hands questions to:
// a review of a whole Wiki of 460,000 characters took about 150 calls (2026-09-29).
// A case may take 20 minutes: a whole-Wiki review alone ran longer than 10 (B6 case D2, 190 calls).
export const EVALUATION_LIMITS=Object.freeze({timeoutMs:1200000,maxModelCalls:80,maxDelegatedCalls:400,maxInteractions:12});
const safe=error=>/^[a-z][a-z0-9_]{1,60}$/.test(error?.message||'')?error.message:'evaluation_failed';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

export async function runCase({testCase,providers,limits={},parent,corpusDirectory}){
  const budget={...EVALUATION_LIMITS,...limits};
  if(Object.values(budget).some(value=>!Number.isSafeInteger(value)||value<1))throw new Error('evaluation_invalid_budget');
  const workspace=await createWorkspace({corpus:testCase.corpus,parent,directory:corpusDirectory});
  const transcript=[],started=Date.now();
  const recorded=recordingProviders(providers,{write:entry=>transcript.push(entry),maxModelCalls:budget.maxModelCalls,maxDelegatedCalls:budget.maxDelegatedCalls,modelLimits:testCase.modelLimits});
  const service=new ProjectService({storageRoot:workspace.stateRoot}),user=createUser(testCase);
  let taskId,error=null,needsHuman=false,asked=false,interactions=0,expired=false,timer;
  try{
    await service.open(workspace.root);service.providers=recorded;
    taskId=(await service.createTask({request:testCase.request,criteria:testCase.criteria||[]})).id;
    timer=setTimeout(()=>{expired=true;service.stopAgent({taskId}).catch(()=>{});},budget.timeoutMs);
    const turns=[...(testCase.followUps||[])];
    await service.startAgent({taskId});
    for(;;){
      await service.agent.promise;
      if(expired){error='evaluation_case_timeout';break;}
      const task=service.task(taskId);
      if(task.state==='waiting_input'&&task.question){
        asked=true;
        if(testCase.stopAtQuestion){user.log.questions.push(typeof task.question==='string'?task.question:task.question.text);break;}
        if(++interactions>budget.maxInteractions){error='evaluation_interaction_budget';break;}
        const reply=user.answer(task.question);
        if(!reply){needsHuman=true;break;}
        await service.answerAgent({taskId,...reply});continue;
      }
      // A connection request or any other wait needs a person.
      if(task.state==='waiting_input'){needsHuman=true;break;}
      if(task.state!=='review'){error=task.error||'run_'+task.state;break;}
      if(!turns.length)break;
      if(++interactions>budget.maxInteractions){error='evaluation_interaction_budget';break;}
      await service.startAgent({taskId,answer:turns.shift()});
    }
    if(!error&&!needsHuman&&service.task(taskId).state==='review')await applyProposals({service,taskId,user,root:workspace.root});
  }catch(cause){error=expired?'evaluation_case_timeout':safe(cause);}
  finally{clearTimeout(timer);}
  let task=null,metrics={events:[],summary:null};
  try{if(taskId){task=service.task(taskId);metrics=readRunMetrics(service.store,{taskId});}}catch{/* The result still reports the error below. */}
  try{service.dispose();for(let wait=0;wait<100&&service.processes?.active.size;wait++)await pause(30);service.store?.close();}catch{/* Already closed. */}
  return{
    id:testCase.id,root:workspace.root,dispose:workspace.dispose,corpusHash:workspace.corpusHash,
    state:task?.state||null,answer:task?.messages?.findLast(message=>message.role==='assistant')?.content||'',
    asked,needsHuman,error,reviewStatus:task?.resultReview?.status||null,reviewHandoff:task?.resultReview?.handoff||null,compactions:metrics.summary?.compactions||0,
    elapsedMs:Date.now()-started,modelCalls:recorded.modelCalls(),delegatedCalls:recorded.delegatedCalls(),interactions,user:user.log,transcript,metrics,
  };
}
