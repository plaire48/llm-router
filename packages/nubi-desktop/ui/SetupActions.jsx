import React from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {DeckDisclosure,DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {TerminalMark} from './marks.jsx';
import {TerminalBlock} from './TerminalBlock.jsx';
import {ApprovalBar} from './ApprovalBar.jsx';

const labels={proposed:'승인 대기',starting:'실행 준비 중',started:'실행 요청됨',rejected:'실행하지 않음',stale:'근거 변경됨',attention:'실행 상태 확인 필요'};
// A command waiting for approval (user decision 2026-09-30): the command, where it runs and what it changes stay whole,
// laid out to read at a glance: a terminal tile, the command in its shell as a terminal, and the approval as the one
// filled button.
export function SetupActions({actions,proposals=[],disabled,onDecision,onAlways,onResult}) {
  // A command proposed with its fix runs once the fix is applied (2026-09-30): until then the run button waits.
  return actions.map(action=>{const admin=action.privilege==='administrator',waiting=(action.afterProposals||[]).some(id=>proposals.some(p=>p.id===id&&p.state==='proposed'));return <section key={action.id} className="nubi-recovery-card nubi-setup-card" aria-label="실행 준비 승인">
    <div className="nubi-action-head"><span className="nubi-action-tile" data-tone={admin?'orange':'blue'} aria-hidden="true"><TerminalMark/></span><div><h3>{action.title}</h3><p>{action.reason}</p></div><DeckStatus>{labels[action.state]}</DeckStatus></div>
    {admin&&<p className="nubi-action-warning"><Icon name="alertCircle" size={18}/><span><strong>관리자 권한 필요</strong> {action.privilegeReason}<br/>승인 후 Windows UAC 창을 직접 확인해 주세요. 이미 시작한 관리자 작업은 중지를 보장할 수 없습니다.</span></p>}
    <TerminalBlock profile={action.profile} workspace={action.workspace} command={action.script} label="실행할 명령"/>
    <p className="nubi-action-effect"><strong>예상 변경</strong> {action.effects}</p>
    <DeckDisclosure title="실행 후 확인 방법" icon="clipboardCheck">
      <p>{action.verification}</p>
      <p className="nubi-muted">근거: {action.references.map(r=>r.path).join(', ')}</p>
      <p className="nubi-muted">{admin?'이 명령 하나만 관리자 권한으로 요청합니다. 누비는 일반 권한을 유지합니다.':'명령은 현재 사용자 권한으로 실행합니다.'} 설치 스크립트의 영향은 프로젝트 밖까지 이어질 수 있어요.</p>
    </DeckDisclosure>
    {action.state==='proposed'?<ApprovalBar approveLabel={admin?'관리자 권한으로 실행':'실행'} disabled={disabled} approveDisabled={waiting} onApprove={()=>onDecision(action,'approve')} onReject={()=>onDecision(action,'reject')} onAlways={!admin&&onAlways?()=>onAlways(action):undefined}>{waiting&&<span className="nubi-approval-note"><Icon name="infoCircle" size={16}/>수정안을 반영하면 실행할 수 있어요</span>}</ApprovalBar>
    :action.resultProcessId?<div className="nubi-approval-bar"><CxButton className="nubi-text-button" disabled={disabled} onClick={()=>onResult(action.resultProcessId)}><Icon name="eye" size={16}/>실행 결과 보기</CxButton></div>:<p className="nubi-muted">{action.state==='stale'?'근거 파일이 바뀌었어요. 현재 내용으로 새 제안을 준비해 주세요.':action.state==='attention'?'이전 실행 기록을 확인해 주세요. 같은 명령을 자동으로 반복하지 않습니다.':action.state==='rejected'?'다른 방법이 필요하면 채팅에서 알려 주세요.':'실행 기록을 확인하고 있어요.'}</p>}
  </section>;});
}
