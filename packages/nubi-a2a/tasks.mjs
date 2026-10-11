import {fail,taskData,A2A_ERRORS} from './contract.mjs';

// nubi-task-v1: peer tasks between the desktop and browser hosts. Work starts only
// after the recipient's user accepts. Results carry facts with their provenance.
export const TASK_CONTRACT='nubi-task-v1';
export const TASK_PORTS=[47821,47822,47823,47824,47825];
export const TASK_SKILLS={
  browser:{
    'web-lookup':{name:'웹 조회',description:'웹에서 요청한 사실을 찾아 출처 URL과 인용을 함께 돌려줍니다.'},
    'web-page-check':{name:'웹 화면 확인',description:'지정한 웹 페이지를 열어 요청한 항목의 현재 상태를 확인합니다.'},
    'web-form-draft':{name:'웹 양식 초안',description:'웹 양식에 초안을 입력합니다. 저장과 제출은 브라우저 사용자의 승인을 받습니다.'}
  },
  ...Object.fromEntries(['excel','word','powerpoint'].map(host=>['office-'+host,{
    'office-document-task':{name:'Office 문서 작업',description:'연결한 Office 앱에서 문서를 분석하거나 작성하고 수정합니다. 요청 수락과 기존 문서 반영 및 저장 승인을 유지합니다.'}
  }])),
  desktop:{
    'source-search':{name:'소스 검색',description:'프로젝트 소스에서 관련 코드와 위치를 찾습니다.'},
    'knowledge-query':{name:'지식 조회',description:'데스크톱 지식 저장소에서 근거를 찾아 답합니다.'},
    'document-analysis':{name:'문서 분석',description:'데스크톱의 문서를 읽고 요청한 내용을 정리합니다.'},
    'ask-openwiki':{name:'OpenWiki 질문',description:'OpenWiki에 질문하고 출처와 함께 답합니다.'}
  }
};
export const TASK_STATES={1:'submitted',2:'working',3:'completed',4:'failed',5:'canceled',7:'rejected'};
export const TASK_ERRORS={...A2A_ERRORS,a2a_busy:'지금 작업을 마친 뒤 수락해 주세요.',a2a_cancelled:'요청한 앱에서 취소한 작업입니다.',a2a_unavailable:'누비 Workspace 연결을 확인해 주세요. 작업은 다시 실행하지 않았습니다.',a2a_state:'작업 상태가 바뀌었어요. 목록을 새로고침해 주세요.',a2a_skill:'받는 앱이 지원하지 않는 작업입니다.',a2a_task_invalid:'작업 요청 형식을 확인하지 못했어요.',a2a_result_invalid:'작업 결과 형식을 확인하지 못했어요.'};

const HASH=/^sha256:[a-f0-9]{64}$/,ID=/^[A-Za-z0-9_.:-]{1,100}$/;
export const text=(value,max,min=1)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const optional=(value,check)=>value===undefined||check(value);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
export function webUrl(value){
  if(typeof value!=='string'||value.length>2000)return false;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
export const contextId=value=>value===undefined||ID.test(value);

export function checkTask(task,requester){
  const skills=TASK_SKILLS[task?.recipient];
  if(!TASK_SKILLS[requester]||!skills||task.recipient===requester)fail('a2a_scope');
  if(!Object.hasOwn(skills,task.skill))fail('a2a_skill');
  if(task.recipient.startsWith('office-')&&requester!=='desktop')fail('a2a_scope');
  if(!text(task.request,8000)||!optional(task.context,value=>text(value,16000,0))||!optional(task.urls,value=>Array.isArray(value)&&value.length<=8&&value.every(webUrl))||!optional(task.facts,value=>Array.isArray(value)&&value.length<=20&&value.every(name=>text(name,200))))fail('a2a_task_invalid');
  return pick(task,['recipient','skill','request','context','urls','facts']);
}

// A fact names where it came from: a web URL, a desktop path, or an evidence entry.
export function checkTaskResult(result){
  const facts=result?.facts??[],evidence=result?.evidence??[],ids=new Set();
  if(!text(result?.summary,8000)||!Array.isArray(facts)||facts.length>50||!Array.isArray(evidence)||evidence.length>20||!['host_checked','not_run'].includes(result.verification)||!text(result.localRunId,200))fail('a2a_result_invalid');
  const cleanEvidence=evidence.map(item=>{
    if(!item||!optional(item.id,value=>typeof value==='string'&&ID.test(value)&&!ids.has(value))||!optional(item.url,webUrl)||!optional(item.path,value=>text(value,500))||!item.url&&!item.path||!optional(item.title,value=>text(value,300,0))||!text(item.capturedAt,40)||Number.isNaN(Date.parse(item.capturedAt)))fail('a2a_result_invalid');
    if(item.id)ids.add(item.id);
    return pick(item,['id','url','path','title','capturedAt']);
  });
  const cleanFacts=facts.map(fact=>{
    if(!fact||!text(fact.name,200)||!text(fact.value,4000)||!optional(fact.source_url,webUrl)||!optional(fact.quote,value=>text(value,1000))||!optional(fact.path,value=>text(value,500))||!optional(fact.hash,value=>HASH.test(value))||!optional(fact.evidenceId,value=>ids.has(value))||!fact.source_url&&!fact.path&&!fact.evidenceId)fail('a2a_result_invalid');
    return pick(fact,['name','value','source_url','quote','path','hash','evidenceId']);
  });
  const clean={summary:result.summary,facts:cleanFacts,evidence:cleanEvidence,verification:result.verification,localRunId:result.localRunId};
  if(JSON.stringify(clean).length>64000)fail('a2a_context_large');
  return clean;
}

export function jobSummary(task){
  const job=taskData(task,'task'),result=taskData(task,'result'),meta=task.metadata||{};
  const note=task.status?.message?.parts?.find(part=>part.content?.$case==='text')?.content.value||'';
  return {id:task.id,contextId:task.contextId,state:TASK_STATES[task.status?.state]||'unknown',requester:meta.requester,recipient:meta.recipient,skill:meta.skill,request:job?.request||'',context:job?.context,urls:job?.urls,facts:job?.facts,note,result:result||null,createdAt:meta.createdAt,updatedAt:task.status?.timestamp};
}
