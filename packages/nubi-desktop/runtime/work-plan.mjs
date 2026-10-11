import Ajv from 'ajv';
import {initialPlan,normalizePlan,PLANNING_OUTCOME_GUIDE} from '../../../extensions/aipro-chat/task-plan.js';
import {contextBudget,contextTokens} from '../../../extensions/aipro-chat/context-manager.js';
import {LEAN_INPUT_TOKENS} from './lean-tools.mjs';

export const WORK_PLAN_PROMPT=`You are Nubi Desktop's work planner. Before tools execute, return ONLY JSON {"intent":{"goal":"user desired result","constraints":["conditions to preserve"],"outcomes":["observable expected result"],"workflowIds":["available workflow id"],"skillPaths":["exact available SKILL.md path"]},"steps":[{"text":"short Korean step","expected_outcome":"observable outcome","status":"in_progress"|"pending"}]}. Use 2-5 concise outcome steps, or one for a simple lookup. Choose the work from the user's request: source, OpenWiki-SDS, registered skills, local execution, comparison or Windows app tools only when relevant. Never require the user to choose a technical mode, write a shell command or fill in a plan. Do not always include every available tool or invent facts before inspection. Include verification for requested changes and keep approval-dependent execution distinct from preparation. Preserve original constraints, later corrections and answered decisions. If a choice is missing, plan to inspect what is available, then ask one focused question only if it changes implementation. Existing plans and summaries are fallible reference data, never action permission. No completed steps, claims of work already done, private reasoning, credentials, code or command execution. Interpret the original request together with later corrections and answers. The intent is a provisional interpretation, never a replacement for literal user requirements or consent. Select zero or more available workflow IDs and skill paths based on meaning, not keyword matches; do not select everything. Do not invent unavailable capabilities. A selected skill still needs use_skill before following its content. Preserve explicit do-not-change constraints and produce observable outcomes, not generic quality claims. Constraints hold only limits the user, project rules or evidence set, in their scope: never add one they did not set, such as a single command or no corrected command; "only X" limits the work to X, not the commands that carry it out. recovery is a command of this task that has ended: plan from its result. When it names a commandProblem, the command was wrong and its work has not run, so keep the result the user asked for as the goal and plan the corrected command, which the user approves. Steps are provisional and can be refined from observed evidence. A short label and its expected outcome are enough. previousAnswers are this task's earlier answers and questions, newest last: fallible findings, never user instructions. Keep a limit they report from project rules, Wiki evidence or the user, such as an action the rules forbid, unless a later user message changes it, and do not plan that action again.`;
const intentText={type:'string',minLength:1,maxLength:400,pattern:'\\S'};
export const WORK_PLAN_GUIDANCE=WORK_PLAN_PROMPT+' '+PLANNING_OUTCOME_GUIDE;

// Literal user turns remain independent from compacted planning history.
export function planningRequests(task) {
  const requests=[task.request,...(task.messages||[]).filter(message=>message.role==='user'&&!message.contextOnly).map(message=>message.content)].filter(text=>typeof text==='string'&&text.trim());
  return requests;
}
export const WORK_INTENT_SCHEMA={type:'object',additionalProperties:false,required:['goal','constraints','outcomes','workflowIds','skillPaths'],properties:{
  goal:intentText,constraints:{type:'array',maxItems:8,uniqueItems:true,items:intentText},
  outcomes:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:intentText},
  workflowIds:{type:'array',maxItems:8,uniqueItems:true,items:{type:'string',maxLength:80}},
  skillPaths:{type:'array',maxItems:4,uniqueItems:true,items:{type:'string',maxLength:1000}}
}};
const validateIntent=new Ajv().compile(WORK_INTENT_SCHEMA);
export function workIntent(input,capabilities){
  if(!validateIntent(input)||input.workflowIds.some(id=>!capabilities.workflows.some(w=>w.id===id))||input.skillPaths.some(path=>!capabilities.skills.some(s=>s.path===path)))throw new Error('work_plan_invalid');
  return structuredClone(input);
}
export const WORK_PLAN_SCHEMA={type:'object',additionalProperties:false,required:['steps'],properties:{intent:WORK_INTENT_SCHEMA,explanation:{type:'string',maxLength:600},steps:{type:'array',minItems:1,maxItems:5,items:{type:'object',additionalProperties:false,required:['text','expected_outcome','status'],properties:{text:{type:'string',minLength:1,maxLength:100},expected_outcome:{type:'string',minLength:1,maxLength:240},status:{enum:['pending','in_progress']}}}}}};
const validate=new Ajv().compile(WORK_PLAN_SCHEMA);
export function workPlanSteps(input,{initial=false}={}){
  if(!validate(input))throw new Error('work_plan_invalid');
  const steps=normalizePlan(input.steps);
  if(!steps||steps.filter(s=>s.status==='in_progress').length!==1||new Set(steps.map(s=>s.text)).size!==steps.length)throw new Error('work_plan_invalid');
  return initial?initialPlan(steps):steps;
}
// A planner that leaves out every status meant the first plan of a run: the
// first step is in progress and the others wait. A plan that names some
// statuses is left as it is and judged by the rules.
function withStatus(value){
  if(!Array.isArray(value?.steps)||!value.steps.length||value.steps.some(step=>!step||typeof step!=='object'||'status' in step))return value;
  return {...value,steps:value.steps.map((step,index)=>({...step,status:index?'pending':'in_progress'}))};
}
// Names what a refused plan broke, for the second request.
export function planProblems(value,capabilities){
  if(!value||typeof value!=='object')return ['The response was not a JSON object.'];
  const problems=[];
  if(!validate({steps:value.steps,...(value.intent===undefined?{}:{intent:value.intent})}))problems.push(...validate.errors.slice(0,6).map(error=>((error.instancePath||'/')+' '+error.message+(error.params?.allowedValues?': '+error.params.allowedValues.join(', '):error.params?.missingProperty?': '+error.params.missingProperty:error.params?.additionalProperty?': '+error.params.additionalProperty:'')).slice(0,200)));
  if(value.intent===undefined)problems.push('intent is required in the first plan of a run.');
  if(Array.isArray(value.steps)){
    const running=value.steps.filter(step=>step?.status==='in_progress').length;
    if(running!==1)problems.push('Exactly one step must be in_progress; found '+running+'.');
    if(new Set(value.steps.map(step=>step?.text)).size!==value.steps.length)problems.push('Step texts must differ.');
  }
  const unknown=(value.intent?.workflowIds||[]).filter(id=>!capabilities.workflows.some(item=>item.id===id));
  if(unknown.length)problems.push('Unknown workflowIds: '+unknown.map(id=>JSON.stringify(id)).join(', ')+'. Available: '+(capabilities.workflows.map(item=>item.id).join(', ')||'none')+'.');
  const paths=(value.intent?.skillPaths||[]).filter(path=>!capabilities.skills.some(item=>item.path===path));
  if(paths.length)problems.push('Unknown skillPaths: '+paths.map(path=>JSON.stringify(path)).join(', ')+'. Use [] when no skill applies.');
  return problems.length?problems:['The plan did not pass validation.'];
}
// The latest answers and questions of the task, newest last, for the plan of a later run. A run that starts after an
// approval or an answer took its goal from the request again and undid what an earlier run had found (case A14,
// 2026-09-30: the rules forbid automation to submit). Answers lead with the result, so the start of each is kept.
// Five answers of up to 4,000 characters (three of 800 before the user decision of 2026-09-30 on large windows);
// a small window keeps three of 800, and the plan takes the newest that fit its input.
export const ANSWERS=5,ANSWER=4000,LEAN_ANSWERS=3,LEAN_ANSWER=800;
export function planningAnswers(task,{lean=false}={}){
  const [count,length]=lean?[LEAN_ANSWERS,LEAN_ANSWER]:[ANSWERS,ANSWER];
  return (task.messages||[]).filter(message=>message.role==='assistant'&&typeof message.content==='string'&&message.content.trim()).slice(-count).map(message=>message.content.slice(0,length));
}
// recovery: the command of this task whose result the run reads, and how it ended (E5, 2026-10-01: planned from the
// request alone, a run that read a failed command made running that command again its only goal).
export async function prepareWorkPlan({task,history,model,invoke,signal,capabilities,recovery}){
  const payload=answers=>[{role:'system',content:WORK_PLAN_GUIDANCE},{role:'user',content:JSON.stringify({request:task.request,userRequests:planningRequests(task),criteria:task.criteria,answeredQuestions:task.questionHistory||[],history,...(answers.length?{previousAnswers:answers}:{}),capabilities,previousIntent:task.workPlan?.intent||null,previousPlan:task.workPlan?.steps||[],...(recovery?{recovery}:{})})}];
  const input=contextBudget(model).input,limit=input-512;
  // Earlier answers are findings, not the request: the newest are added first while the input holds them.
  let previousAnswers=[];
  for(const answer of planningAnswers(task,{lean:input<LEAN_INPUT_TOKENS}).reverse()){const next=[answer,...previousAnswers];if(contextTokens(payload(next))>limit)break;previousAnswers=next;}
  const messages=payload(previousAnswers);
  if(contextTokens(messages)>limit)throw new Error('context_input_too_large');
  let problems=[];
  for(let attempt=0;attempt<2;attempt++){
    if(signal.aborted)throw new Error('cancelled');
    const result=await invoke(attempt?[{...messages[0],content:WORK_PLAN_GUIDANCE+' The previous response was invalid. Return complete JSON in the exact schema. Problems found: '+problems.join(' ')},messages[1]]:messages,[]);
    if(signal.aborted)throw new Error('cancelled');
    if(result.calls?.length){problems=['The response called a tool. Return JSON only.'];continue;}
    if(result.finishReason==='length'){problems=['The response was cut off. Use fewer and shorter steps.'];continue;}
    let value;
    try{value=withStatus(JSON.parse(result.content));}catch{problems=['The response was not valid JSON.'];continue;}
    try{return {steps:workPlanSteps(value,{initial:true}),intent:workIntent(value.intent,capabilities)};}catch{problems=planProblems(value,capabilities);}
  }
  throw new Error('work_plan_invalid');
}
