import React from 'react';
import {CxButton} from '@e2e/cx-design-system';
import {DeckDisclosure,DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';

const labels={proposed:'승인 대기',starting:'실행 준비 중',started:'실행 요청됨',rejected:'실행하지 않음',stale:'근거 변경됨',attention:'실행 상태 확인 필요'};
export function SetupActions({actions,disabled,onDecision,onResult}) {
  return actions.map(action=><section key={action.id} className="nubi-recovery-card nubi-setup-card" aria-label="실행 준비 승인">
    <div className="nubi-inline"><h3>{action.title}</h3><DeckStatus>{labels[action.state]}</DeckStatus></div>
    <p>{action.reason}</p>
    {action.privilege==='administrator'&&<p><strong>관리자 권한 필요</strong> {action.privilegeReason}<br/>승인 후 Windows UAC 창을 직접 확인해 주세요. 이미 시작한 관리자 작업은 중지를 보장할 수 없습니다.</p>}
    <p><strong>예상 변경</strong> {action.effects}</p>
    <pre>{action.script}</pre>
    <p className="nubi-muted">{action.profile} / {action.workspace}</p>
    <DeckDisclosure title="실행 후 확인 방법">
      <p>{action.verification}</p>
      <p className="nubi-muted">근거: {action.references.map(r=>r.path).join(', ')}</p>
      <p className="nubi-muted">{action.privilege==='administrator'?'이 명령 하나만 관리자 권한으로 요청합니다. 누비는 일반 권한을 유지합니다.':'명령은 현재 사용자 권한으로 실행합니다.'} 설치 스크립트의 영향은 프로젝트 밖까지 이어질 수 있어요.</p>
    </DeckDisclosure>
    {action.state==='proposed'?<div className="nubi-inline">
      <CxButton variant="primary" disabled={disabled} onClick={()=>onDecision(action,'approve')}>{action.privilege==='administrator'?'관리자 권한으로 실행':'승인하고 실행'}</CxButton>
      <CxButton disabled={disabled} onClick={()=>onDecision(action,'reject')}>실행하지 않기</CxButton>
    </div>:action.resultProcessId?<CxButton disabled={disabled} onClick={()=>onResult(action.resultProcessId)}>실행 결과 보기</CxButton>:<p className="nubi-muted">{action.state==='stale'?'근거 파일이 바뀌었어요. 현재 내용으로 새 제안을 준비해 주세요.':action.state==='attention'?'이전 실행 기록을 확인해 주세요. 같은 명령을 자동으로 반복하지 않습니다.':action.state==='rejected'?'다른 방법이 필요하면 채팅에서 알려 주세요.':'실행 기록을 확인하고 있어요.'}</p>}
  </section>);
}
