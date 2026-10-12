import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import React,{useState,useRef} from 'react';
import {CxButton, CxNotice, CxTextarea, CxField, Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {A2A_ERRORS,ROLE_NAMES} from '../../nubi-a2a/contract.mjs';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {TASK_SKILLS,TASK_ERRORS} from '../../nubi-a2a/tasks.mjs';
// Pairing and the requests other apps send live in the header's agent connection (2026-10-01); a conversation
// sends its own requests and shows the tasks bound to it.
export function Collaboration({task,rows=[],jobs=[],links=[],api,refresh,disabled,onTask,onConnect}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [request,setRequest]=useState(task.request),[skill,setSkill]=useState('web-lookup');
  const pending=useRef(false),attempts=useRef({});
  async function act(action,recipient,id){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    try{
      if(['request','task_request'].includes(action))attempts.current[recipient]||=crypto.randomUUID();
      const value=await api('collaboration',{action,taskId:task.id,recipient,id,requestId:attempts.current[recipient],...(action==='task_request'?{skill,request}: {})});
      if(['request','task_request'].includes(action))delete attempts.current[recipient];await refresh();if(value.localTaskId)onTask?.(value.localTaskId);
    }catch(e){setError(TASK_ERRORS[e.message]||A2A_ERRORS[e.message]||'작업 연결을 확인하지 못했어요. 새로고침해 주세요.');}finally{pending.current=false;setBusy(false);}
  }
  return <DeckDisclosure title="다른 누비와 작업" icon="link"><div className="nubi-collaboration-intro"><AgentMark size={40} mood={busy?'working':error?'sad':'idle'} lively/><p className="nubi-muted">소스와 Wiki를 다른 누비와 함께 활용합니다.</p></div>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    <CxField label="브라우저에 맡길 작업"><CxSelect value={skill} disabled={busy} onChange={e=>{setSkill(e.target.value);delete attempts.current.browser;}}>{Object.entries(TASK_SKILLS.browser).map(([id,item])=><option key={id} value={id}>{item.name}</option>)}</CxSelect></CxField>
    <CxField label="요청" hint="브라우저에서 수락한 뒤 실행합니다. 최종 저장과 제출은 해당 앱의 승인을 따릅니다."><CxTextarea value={request} maxLength={8000} rows={3} disabled={busy} onChange={e=>{setRequest(e.target.value);delete attempts.current.browser;}}/></CxField>
    {!links.some(link=>link.role==='browser')&&<p className="nubi-muted">브라우저 누비와 아직 연결하지 않았어요. 보낸 작업은 <CxButton className="nubi-text-button" onClick={onConnect}>에이전트 연결</CxButton>에서 연결한 뒤 받을 수 있어요.</p>}
    <div className="nubi-task-actions"><CxButton disabled={busy||disabled||!request.trim()||request.length>8000} onClick={()=>act('task_request','browser')}><Icon name="link" size={18}/>작업 보내기</CxButton></div>
    <DeckDisclosure title="검토 초안 전달"><div className="nubi-task-actions">{Object.entries(ROLE_NAMES).filter(([role])=>role!=='office').map(([role,label])=><CxButton key={role} disabled={busy||disabled} onClick={()=>act('request',role)}>{label} 검토 초안 요청</CxButton>)}</div><p className="nubi-muted">초안 전달과 실제 앱의 실행 성공은 따로 확인합니다.</p></DeckDisclosure>
    <CxButton disabled={busy} onClick={()=>act('status')}>결과 새로고침</CxButton>
    {jobs.map(job=><DeckDisclosure key={job.id} title={`${job.recipient==='desktop'?'Workspace 수신':'브라우저'} ${ {submitted:'수락 대기',working:'진행 중',completed:'결과 받음',failed:'확인 필요',canceled:'취소됨',rejected:'거절됨',stale:'조건 변경'}[job.state]||'상태 확인'}`}>
      <p>{job.request}</p>{job.recipient==='desktop'&&job.state==='submitted'&&<p className="nubi-muted">에이전트 연결에서 수락하면 이 대화에서 시작할 수 있어요.</p>}{job.recipient==='desktop'&&job.state==='working'&&job.localTaskId===task.id&&<CxButton disabled={busy||disabled||task.state!=='review'||task.resultReview?.status!=='ready'} onClick={()=>act('task_deliver',undefined,job.id)}>확인한 답변 보내기</CxButton>}{job.result?<><p className="nubi-muted">{job.result.verification==='host_checked'?'수신 앱이 확인한 결과입니다.':'전달받은 답변입니다. 독립 검증은 미확인입니다.'}</p><MessageBody content={job.result.summary} role="assistant"/></>:<p className="nubi-muted">{job.note}</p>}
      {job.requester==='desktop'&&['submitted','working'].includes(job.state)&&<CxButton disabled={busy} onClick={()=>act('task_cancel',undefined,job.id)}>작업 취소</CxButton>}
    </DeckDisclosure>)}
    {rows.map(row=><DeckDisclosure key={row.id} title={`${ROLE_NAMES[row.recipient]} ${row.state===3?'결과 받음':row.state===5?'취소됨':'검토 대기'}`}>
      {row.result?<><p className="nubi-muted">전달받은 초안입니다. 실제 실행 결과는 별도로 확인합니다.</p><MessageBody content={row.result.text} role="assistant"/></>:<CxButton disabled={busy||row.state!==6} onClick={()=>act('cancel',undefined,row.id)}>전달 취소</CxButton>}
    </DeckDisclosure>)}
  </DeckDisclosure>;
}
