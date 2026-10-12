import React, {useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
const labels={ready:'확인할 내용이 남아 있어요',revise:'보완할 결과가 있어요',failed:'결과 검토를 마치지 못했어요',interrupted:'결과 검토가 중단됐어요',cancelled:'결과 검토가 중지됐어요'};
const checkLabels={supported:'근거 확인',pending:'승인 또는 진행 대기',unknown:'미확인'};
function ReviewCheck({check}) {
  return <li className="nubi-review-check" data-check={check.state}>
    <strong className="nubi-review-check-heading"><Icon name={check.state==='supported'?'check':check.state==='pending'?'clock':'alertCircle'} size={16}/>{checkLabels[check.state]||'미확인'}</strong>
    <p>{check.detail}</p>
  </li>;
}
export function AnalysisReviewProgress({review,running}){
  const [expanded,setExpanded]=useState(null);
  const active=running&&review.state==='running',open=expanded??active;
  const checks=review.checks||[],unresolved=checks.filter(check=>check.state!=='supported');
  const supported=review.state==='ready'&&checks.length>0&&checks.every(check=>check.state==='supported')&&!review.omittedHandoffs&&!review.omittedUnresolvedHandoffs&&!review.nextStep;
  if(supported)return <details className="nubi-review-evidence" aria-label="확인한 근거"><summary><Icon name="check" size={14}/>확인한 근거 {checks.length}개<Icon name="chevronDown" size={14}/></summary><ol>{checks.map(check=><li key={check.requirementId}>{check.detail}</li>)}</ol></details>;
  return <section className="nubi-document-progress nubi-result-review" aria-label="분석 결과 검토" data-state={review.state} data-tone={active?'active':['failed','interrupted'].includes(review.state)?'danger':'warning'}>
    <div className="nubi-document-progress-heading" role="status"><Icon name={active?'search':'alertCircle'} size={18}/><strong>{active?'답변과 근거를 대조하고 있어요':labels[review.state]||'검토 응답 미확인'}</strong></div>
    {!active&&unresolved.length>0&&<ul className="nubi-review-open-items" aria-label="남은 확인">{unresolved.map(check=><ReviewCheck key={check.requirementId} check={check}/>)}</ul>}
    {review.nextStep&&<p className="nubi-review-next"><strong>다음 단계</strong><span>{review.nextStep}</span></p>}
      {review.omittedUnresolvedHandoffs>0&&<p className="nubi-document-attention">제외된 분석 중 미해결 분담 {review.omittedUnresolvedHandoffs}개</p>}
    <details open={open} onToggle={event=>{if(event.target===event.currentTarget&&event.currentTarget.open!==open)setExpanded(event.currentTarget.open);}}>
      <summary>확인 항목<Icon name="chevronDown" size={14}/></summary>
      {review.round>1&&<p className="nubi-muted">검토 {review.round}회</p>}
      {review.advisoryCount>0&&<p>하위 분석 {review.advisoryCount}개를 검토 입력에 포함했습니다.</p>}
      {review.omittedHandoffs>0&&<p className="nubi-document-attention">문맥 한도로 제외한 하위 분석 {review.omittedHandoffs}개</p>}
      <ol>{checks.filter(check=>active||check.state==='supported').map(check=><ReviewCheck key={check.requirementId} check={check}/>)}</ol>
      {!checks.length&&!active&&<p>검토 결과가 없어 완료 여부를 판단하지 않았습니다.</p>}
    </details>
  </section>;
}
