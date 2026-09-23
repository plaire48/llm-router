import React from 'react';
import {CxButton} from '@e2e/cx-design-system';
import {DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';

const labels={source_matched:'출처 버전 일치',source_changed:'코드 변경됨',document_changed:'문서 변경됨',unavailable:'출처 확인 필요',unverified:'최신성 미확인'};
export function WikiEvidence({packet,onOpen}){
  return <section className="nubi-wiki-evidence" aria-label="Wiki 검색 결과">
    <h3>Wiki 근거 {packet.results.length}개</h3>
    {packet.results.length>0&&<p className="nubi-muted">문서를 열어 현재 코드와 비교하세요.</p>}
    {!packet.results.length&&<p className="nubi-muted">관련 문서를 찾지 못했어요. 업무 용어나 파일 이름으로 다시 찾아보세요.</p>}
    {packet.results.map(row=><CxButton key={row.evidenceId} className="nubi-search-result" onClick={()=>onOpen(row.path)}>
      <strong>{row.title}</strong><DeckStatus>{labels[row.freshness]||labels.unverified}</DeckStatus>
      <small>{row.path}:{row.provenance.start}–{row.provenance.end}{row.relation?` / ${row.relation.label}에서 연결`:''}</small>
      <span className="nubi-wiki-excerpt">{row.excerpt.length>280?row.excerpt.slice(0,280)+'…':row.excerpt}</span>
    </CxButton>)}
    {(packet.truncated||packet.retrieval.incomplete||packet.retrieval.graphUnavailable)&&<p className="nubi-muted">일부 자료만 확인했어요. 범위를 좁혀 검색해 주세요.</p>}
  </section>;
}
