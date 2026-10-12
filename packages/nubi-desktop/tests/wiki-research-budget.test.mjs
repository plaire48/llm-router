// User decision 2026-10-12: a Wiki question answered partially in time beats a complete answer after twenty minutes
// (S30 case D2 ran 158 research calls past the evaluation limit). The host refuses researcher calls past the budget;
// OpenWiki's planner and synthesis still run and report the partial coverage. OpenWiki's code is not changed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,fixtureReview} from './fixtures.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
import {git} from '../runtime/files.mjs';
import {createResearchBudget,isResearcherCall,WIKI_RESEARCH_BUDGET} from '../runtime/wiki-research-budget.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const researcher=[{role:'system',content:"You are OpenWiki's read-only evidence researcher. Answer the original question."},{role:'user',content:'q'}];
const planner=[{role:'system',content:'Plan OpenWiki research. Return ONLY JSON'},{role:'user',content:'q'}];
const synthesis=[{role:'system',content:"You are OpenWiki's read-only evidence researcher. Answer.\nSynthesize the supplied researcher findings. Compare contradictions."},{role:'user',content:'q'}];
const scope={role:'research',taskId:'wiki-1',signal:new AbortController().signal};

test('a run keeps to its budget: researcher calls past it are refused, also for a later question; planning and synthesis still run',()=>{
  let clock=0;const budget=createResearchBudget({calls:2,ms:1000,now:()=>clock});
  assert.equal(isResearcherCall(researcher),true);assert.equal(isResearcherCall(synthesis),false);assert.equal(isResearcherCall(planner),false);
  budget.admit(scope,planner);budget.admit(scope,researcher);budget.admit(scope,researcher);
  assert.throws(()=>budget.admit(scope,researcher),error=>error.message==='research_budget'&&error.retryable===false);
  budget.admit(scope,synthesis);
  assert.equal(budget.consume(),true);assert.equal(budget.consume(),false,'read once per answer');
  // The calls are the run's: a second question does not start afresh.
  assert.throws(()=>budget.admit({...scope,taskId:'wiki-2'},researcher),/research_budget/);budget.admit({...scope,taskId:'wiki-2'},synthesis);assert.equal(budget.spent(),2);
  // The time is the question's: a later question of a long task is not refused for the age of the first.
  const slow=createResearchBudget({calls:100,ms:1000,now:()=>clock});
  slow.admit(scope,researcher);clock=1000;assert.throws(()=>slow.admit(scope,researcher),/research_budget/,'the time budget');
  assert.throws(()=>slow.admit(scope,synthesis),/research_budget/,'after the time, synthesis too: OpenWiki joins the reports it has');
  slow.admit({...scope,taskId:'wiki-2'},researcher);clock=1500;slow.admit({...scope,taskId:'wiki-2'},researcher);clock=2000;assert.throws(()=>slow.admit({...scope,taskId:'wiki-2'},researcher),/research_budget/);
  // Document analysis workers and the main agent are not Wiki questions.
  const other=createResearchBudget({calls:0});other.admit({role:'research',taskId:'analysis-1'},researcher);other.admit({role:'actor'},researcher);assert.equal(other.consume(),false);
  assert.deepEqual(WIKI_RESEARCH_BUDGET,{ms:8*60*1000,calls:120});
});

test('a Wiki question past the budget comes back partial with the host note, and the run still ends in review',async t=>{
  const {service,root}=await fixture(t,{scriptedReview:true});
  await mkdir(path.join(root,'openwiki','operations'),{recursive:true});
  await writeFile(path.join(root,'openwiki','operations','export.md'),'# Export\n\n'+'The nightly export runs at 02:00 by the export worker.\n'.repeat(40));
  await git(root,['add','-A']);await git(root,['commit','-qm','wiki']);
  service.researchBudgetOptions={calls:1,ms:Infinity};
  const call=(name,args)=>({content:'',calls:[{id:'call-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  let leader=0,delivered,researcherCalls=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const first=messages[0].content,prompt=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    if(first.startsWith(REVIEW_PROMPT))return fixtureReview(messages);
    if(prompt.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode:'focused',questions:['When does the nightly export run?']})};
    if(prompt.includes('Synthesize'))return {content:JSON.stringify({status:'partial',answer:'일부 범위만 읽었습니다.',findings:[],uncertainties:['The research stopped early.']})};
    if(!first.startsWith('You are Nubi Desktop')){researcherCalls++;return call('search_wiki',{query:'nightly export'});}
    if(leader++===0)return call('ask_openwiki',{wiki:'external',question:'야간 내보내기는 언제 실행돼?'});
    delivered??=messages.findLast(message=>message.role==='tool').content;
    return {content:'일부만 확인했어요. 야간 내보내기 시각은 원본을 더 봐야 합니다.',calls:[]};
  }};
  const task=await service.createTask({request:'야간 내보내기는 언제 실행돼?'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  const answer=JSON.parse(delivered);
  assert.equal(researcherCalls,1,'the second researcher call was refused before reaching the model');
  assert.notEqual(answer.status,'complete');
  assert.match(answer.desktop.note,/^The host's research budget cut this question \(/);
});
