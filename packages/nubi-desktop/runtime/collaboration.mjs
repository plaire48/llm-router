import {validateWikiEvidence} from './wiki-evidence.mjs';
import {createCollaborationServer,storedTaskSummary} from '../../nubi-a2a/server.mjs';
import {CONTRACT,ROLE_NAMES,taskSummary,checkPacket,draftFromTask} from '../../nubi-a2a/contract.mjs';
import {readSource,hash,fail} from './files.mjs';

export function collaborationRows(service,taskId){return service.store.list('a2a-task:').map(row=>storedTaskSummary(row)).filter(row=>!taskId||row.sourceTaskId===taskId).slice(0,30);}
async function valid(service,packet){
  try{
    const root=await service.target(packet.sourceTaskId),task=service.task(packet.sourceTaskId);
    if(hash(JSON.stringify({request:task.request,criteria:task.criteria.map(({id,text})=>({id,text}))}))!==packet.requirementsHash)return false;
    if(hash(JSON.stringify(task.changePlan||null))!==packet.planHash)return false;
    for(const source of [...packet.sources,...packet.wiki,...packet.references])if((await readSource(root,source.path)).hash!==source.hash)return false;
    await validateWikiEvidence(service,packet.sourceTaskId,packet.wiki);return true;
  }catch{return false;}
}
async function prepare(service,taskId,recipient){
  const task=service.task(taskId),root=await service.target(taskId);
  const plan=task.changePlan,criteria=task.criteria.map(({id,text})=>({id,text}));
  const paths=[...new Set([...(plan?.targets||[]).map(t=>t.path),...(task.sources||[]).map(s=>s.path),...service.store.list('proposal:').filter(p=>p.taskId===taskId).map(p=>p.path)].filter(Boolean))];
  const sources=[],wiki=[],references=[],limitations=['참고 자료만 전달합니다. 실제 배포와 테스트 결과는 확인 전입니다.'];
  for(const path of paths.slice(0,recipient==='office'?3:4)){try{const file=await readSource(root,path);sources.push({path,hash:file.hash,excerpt:file.content.slice(0,recipient==='office'?700:1400),truncated:file.content.length>(recipient==='office'?700:1400)});}catch{limitations.push('읽지 못한 소스: '+path);}}
  if(paths.length>sources.length)limitations.push('관련 소스 중 '+sources.length+'개 파일만 포함했습니다.');
  const found=await service.wikiQuery({taskId,query:task.request.slice(0,400)});
  for(const row of found.results.slice(0,2)){
    try{await validateWikiEvidence(service,taskId,[row]);}catch{limitations.push('오래된 Wiki 근거를 제외했습니다: '+row.path);continue;}
    wiki.push({evidenceId:row.evidenceId,path:row.path,hash:row.hash,excerpt:row.excerpt.slice(0,1000),start:row.provenance.start,end:row.provenance.end,freshness:row.freshness,claimsHash:row.claimsHash,sourceReferences:row.sourceReferences,truncated:row.excerpt.length>1000});
  }
  if(!sources.length)limitations.push('변경 대상 소스가 아직 정해지지 않았습니다.');
  if(found.truncated||found.retrieval.incomplete)limitations.push('Wiki 검색 결과는 일부만 포함했습니다.');
  const packet={contract:CONTRACT,sourceTaskId:taskId,recipient,request:task.request,criteria,requirementsHash:hash(JSON.stringify({request:task.request,criteria})),sources,wiki,references,
    planHash:hash(JSON.stringify(plan||null)),changePlan:plan?{summary:plan.summary,targets:plan.targets.map(({path,reason})=>({path,reason})),checks:plan.checks}:null,limitations,createdAt:new Date().toISOString()};
  packet.digest=hash(JSON.stringify(packet));checkPacket(packet);
  // Fail clearly rather than silently truncating the user's request or criteria.
  draftFromTask({id:'preview',artifacts:[{name:'context',parts:[{content:{$case:'data',value:packet}}]}]});
  return packet;
}
export async function collaboration({action='status',taskId,recipient,id,requestId}={}){
  this.ready();
  if(action==='status')return {tasks:collaborationRows(this,taskId)};
  if(this.collaborationBusy)fail('project_busy');this.collaborationBusy=true;
  try{
    if(!this.collaborationServer)this.collaborationServer=await createCollaborationServer({records:this.store,validateContext:packet=>valid(this,packet)});
    if(action==='invite')return this.collaborationServer.invite(recipient);
    if(action==='cancel')return await this.collaborationServer.cancel(id);
    if(action==='request'){
      if(!ROLE_NAMES[recipient]||!/^[-\w]{8,100}$/.test(requestId||''))fail('input_invalid');
      const key='a2a-dispatch:'+requestId,old=this.store.get(key);
      if(old&&(old.sourceTaskId!==taskId||old.recipient!==recipient))fail('a2a_message_collision');
      const packet=old||await prepare(this,taskId,recipient);this.store.set(key,packet);
      return await this.collaborationServer.submit(packet,requestId);
    }
    fail('method_invalid');
  }finally{this.collaborationBusy=false;}
}
