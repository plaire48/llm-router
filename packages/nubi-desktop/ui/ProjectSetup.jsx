import React from 'react';
import {CxButton,CxNotice} from '@e2e/cx-design-system';
import {DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';

const titles={git_unavailable:'Git이 필요해요',not_git_repository:'Git 저장소가 아닌 폴더예요'};
const leads={git_unavailable:'누비는 Git으로 변경을 비교하고 되돌립니다. 설치를 마치면 이 폴더를 바로 열고 실행 환경 준비를 시작해요.',
  not_git_repository:'누비는 Git 저장소에서 변경을 비교하고 되돌립니다. 저장소로 만들면 이 폴더를 바로 열고 실행 환경 준비를 시작해요.'};
const failures={setup_failed:'명령이 실패했어요',setup_timeout:'명령이 시간 안에 끝나지 않았어요',shell_unavailable:'명령을 실행할 셸을 찾지 못했어요',git_not_found_after_setup:'명령은 끝났지만 Git을 찾지 못했어요'};

// A folder that cannot open yet: the fix, the exact command and one approval (user decision 2026-09-30).
// When the prepared command fails, the model can propose another one, shown the same way.
export function ProjectSetup({setup,busy,connected,onRun,onSuggest,onRetry,onClose}){
  const {plan,attempts}=setup,last=attempts.at(-1),install=setup.reason==='git_unavailable';
  return <section className="nubi-recovery-card nubi-setup-card nubi-project-setup" aria-label="프로젝트 준비">
    <div className="nubi-inline"><h3>{titles[setup.reason]}</h3>{busy&&<DeckStatus tone="active">실행 중</DeckStatus>}</div>
    <p>{leads[setup.reason]}</p>
    <p className="nubi-muted">{setup.root}</p>
    {last&&<CxNotice tone="danger">{`${failures[last.error]||'명령이 실패했어요'}${Number.isInteger(last.exitCode)?` (종료 코드 ${last.exitCode})`:''}.`}</CxNotice>}
    {last?.output&&<pre className="nubi-setup-output">{last.output.slice(-1500)}</pre>}
    {plan?.command?<>
      <p><strong>{plan.source==='model'?'누비가 찾은 다른 방법':'실행할 명령'}</strong> {plan.effects}</p>
      {plan.needsAdmin&&<p><strong>관리자 권한 필요</strong> 누비는 관리자 권한으로 실행하지 않아요. 관리자 PowerShell에서 이 명령을 직접 실행한 뒤 다시 열어 주세요.</p>}
      <pre>{plan.command}</pre>
    </>:<p>{plan?.effects||'준비한 방법을 모두 썼어요. Git을 직접 설치한 뒤 다시 열어 주세요.'}</p>}
    <div className="nubi-inline">
      {plan?.command&&!plan.needsAdmin&&<CxButton variant="primary" disabled={busy} onClick={onRun}>{install?'승인하고 설치':'승인하고 저장소 만들기'}</CxButton>}
      {install&&last&&<CxButton disabled={busy||!connected} onClick={onSuggest} title={connected?undefined:'모델에 로그인하면 누비가 다른 방법을 찾아요.'}>다른 방법 찾기</CxButton>}
      {(!plan?.command||plan.needsAdmin||last)&&<CxButton disabled={busy} onClick={onRetry}>직접 했어요, 다시 열기</CxButton>}
      <CxButton disabled={busy} onClick={onClose}>닫기</CxButton>
    </div>
  </section>;
}
