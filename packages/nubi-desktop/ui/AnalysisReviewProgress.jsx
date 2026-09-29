import React, {useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
const labels={ready:'응답 검토됨',revise:'보완할 결과가 있어요',failed:'결과 검토를 마치지 못했어요',interrupted:'결과 검토가 중단됐어요',cancelled:'결과 검토가 중지됐어요'};
const checkLabels={supported:'근거 확인',pending:'승인 또는 진행 대기',unknown:'미확인'};
export function AnalysisReviewProgress({review,running}){
  const [expanded,setExpanded]=useState(null);
  const active=running&&review.state==='running',open=expanded??active;
  const checks=review.checks||[],unknown=checks.filter(check=>check.state==='unknown').length;
  return <section className="nubi-document-progress" aria-label="분석 결과 검토" data-state={review.state}>
    <div className="nubi-document-progress-heading" role="status"><Icon name="layers" size={18}/><strong>{active?'요청과 결과를 대조하고 있어요':labels[review.state]||'검토 응답 미확인'}</strong>{review.round>1&&<span>검토 {review.round}</span>}</div>
    {unknown>0&&<p className="nubi-document-attention">아직 확인하지 못한 결과 {unknown}개</p>}
    {review.nextStep&&<p>{review.nextStep}</p>}
    <details open={open} onToggle={event=>{if(event.target===event.currentTarget&&event.currentTarget.open!==open)setExpanded(event.currentTarget.open);}}>
      <summary>검토 내용<Icon name="chevronDown" size={14}/></summary>
      {review.advisoryCount>0&&<p>하위 분석 {review.advisoryCount}개를 검토 입력에 포함했습니다.</p>}
      {review.omittedHandoffs>0&&<p className="nubi-document-attention">문맥 한도로 제외한 하위 분석 {review.omittedHandoffs}개</p>}
      {review.omittedUnresolvedHandoffs>0&&<p className="nubi-document-attention">제외된 분석 중 미해결 분담 {review.omittedUnresolvedHandoffs}개</p>}
      <ol>{checks.map(check=><li key={check.requirementId}><strong>{checkLabels[check.state]||'미확인'}</strong><p>{check.detail}</p></li>)}</ol>
      {!checks.length&&!active&&<p>검토 결과가 없어 완료 여부를 판단하지 않았습니다.</p>}
    </details>
  </section>;
}
