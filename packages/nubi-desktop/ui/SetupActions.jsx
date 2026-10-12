import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {TerminalBlock} from './TerminalBlock.jsx';
import {ApprovalBar} from './ApprovalBar.jsx';
import {DecisionPrompt} from './DecisionPrompt.jsx';

const labels={proposed:'승인 대기',starting:'실행 준비 중',started:'실행 요청됨',rejected:'실행하지 않음',stale:'근거 변경됨',attention:'실행 상태 확인 필요'};
export function SetupActions({actions,proposals=[],processes=[],disabled,onDecision,onAlways,onResult}) {
 return actions.map(action=>{
  const admin=action.privilege==='administrator',waiting=(action.afterProposals||[]).some(id=>proposals.some(p=>p.id===id&&p.state==='proposed'));
  const process=processes.find(item=>item.id===action.resultProcessId),pending=action.state==='proposed';
  const state=action.state==='started'&&process?({queued:'결과 확인 대기',diagnosing:'결과 확인 중',review:'결과 확인됨',paused:'결과 확인 중단',waiting_input:'확인 필요',cancelled:'중지됨'}[process.recoveryState]||({checking:'실행 준비',running:'실행 중',stopping:'중지 중',completed:'명령 종료',failed:'실행 오류',cancelled:'중지됨',timed_out:'시간 초과',interrupted:'중단됨'})[process.state]):labels[action.state];
  return <section key={action.id} className="nubi-setup-summary" aria-label="실행 준비 승인">
   {pending?<DecisionPrompt id={action.id} title="이 명령을 실행할까요?" summary={action.title} icon="terminal" label="확인하고 실행" blocked={disabled||waiting}>
    <p className="nubi-decision-reason">{action.reason}</p>
    <TerminalBlock profile={action.profile} workspace={action.workspace} command={action.script} label="실행할 명령"/>
    <p className="nubi-action-effect"><strong>예상 변경</strong> {action.effects}</p>
    {admin?<p className="nubi-action-warning"><Icon name="alertCircle" size={18}/><span><strong>관리자 권한 필요</strong> {action.privilegeReason} 승인 후 Windows UAC에서 확인해 주세요. 이미 시작한 작업은 중지를 보장할 수 없습니다.</span></p>:<p className="nubi-decision-scope">현재 사용자 권한으로 실행하며 명령에 따라 프로젝트 밖에도 영향을 줄 수 있습니다.</p>}
    <ApprovalBar approveLabel={admin?'관리자 권한으로 실행':'실행'} disabled={disabled} approveDisabled={waiting} onApprove={()=>onDecision(action,'approve')} onReject={()=>onDecision(action,'reject')} onAlways={!admin&&onAlways?()=>onAlways(action):undefined}/>
   </DecisionPrompt>:<div className="nubi-command-receipt"><Icon name="code" size={18}/><strong title={action.title}>{action.title}</strong><span role="status">{state}</span>{action.resultProcessId&&<CxButton className="nubi-text-button" onClick={()=>onResult(action.resultProcessId)}><Icon name="eye" size={16}/>실행 결과 보기</CxButton>}</div>}
   {waiting&&pending&&<p className="nubi-muted">수정안을 반영하면 실행할 수 있어요.</p>}
   {!pending&&['stale','attention'].includes(action.state)&&<p className="nubi-muted">{action.state==='stale'?'근거 파일이 바뀌었어요. 현재 내용으로 새 제안을 준비해 주세요.':'이전 실행 기록을 확인해 주세요. 같은 명령을 자동으로 반복하지 않습니다.'}</p>}
   {!pending&&<DeckDisclosure title="명령 상세" icon="code"><TerminalBlock profile={action.profile} workspace={action.workspace} command={action.script} label="실행 명령"/><p>{action.effects}</p></DeckDisclosure>}
  </section>;
 });
}
