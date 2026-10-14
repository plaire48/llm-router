import React from 'react';
import {Icon} from '@e2e/cx-design-system';
export function DocumentReceipt({receipt:r}){
 const verified=r.status==='verified',rejected=r.status==='rejected';
 const label=verified?(r.saved?'저장됨':'적용됨'):rejected?'변경 안 함':'확인 필요';
 const detail=verified?(r.saved?'문서 저장과 결과를 확인했습니다.':'문서 변경을 확인했습니다. 파일은 아직 저장하지 않았습니다.'):rejected?'요청한 변경을 적용하지 않았습니다.':'일부 변경의 실제 적용 여부를 확인해야 합니다.';
 return <div className="receipt office-receipt" data-status={r.status}>
  <div className="receipt-line"><span className="receipt-state" title={detail}><Icon name={verified?(r.saved?'save':'check'):rejected?'minus':'alertCircle'} size={16}/><strong>{label}</strong></span><span className="receipt-document" title={r.document}>{r.document||'문서'}</span></div>
  {verified&&!r.saved&&<span className="visually-hidden">파일 저장 전</span>}
  {r.kind==='save_markdown'&&<div className="receipt-export">{r.destination&&<p>{r.destination}</p>}{r.warnings?.length>0&&<p>{r.warnings[0]}</p>}</div>}
 </div>;
}
