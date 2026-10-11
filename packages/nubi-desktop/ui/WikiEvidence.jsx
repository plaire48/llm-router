import {DriftLabel} from './DriftLabel.jsx';
import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';

const labels={source_matched:'출처 버전 일치',source_changed:'코드 변경됨',document_changed:'문서 변경됨',unavailable:'출처 확인 필요',unverified:'최신성 미확인'};
const tone={source_matched:'done',source_changed:'warn',document_changed:'warn',unavailable:'warn'};
// Wiki results (user decision 2026-09-30): the title and its freshness first, then the passage, then where it is.
export function WikiEvidence({packet,onOpen}){
  return <section className="nubi-wiki-evidence" aria-label="위키 검색 결과">
    <h3><Icon name="bookmark" size={16}/>위키 근거 {packet.results.length}개</h3>
    {!packet.results.length&&<p className="nubi-muted">관련 문서를 찾지 못했어요. 업무 용어나 파일 이름으로 다시 찾아보세요.</p>}
    {packet.results.map(row=><CxButton key={row.evidenceId} className="nubi-search-result" onClick={()=>onOpen(row.path)}><Icon name="file" size={16}/>
      <span className="nubi-result-head"><DriftLabel as="strong">{row.title}</DriftLabel><span className="nubi-pill" data-tone={tone[row.freshness]}>{labels[row.freshness]||labels.unverified}</span></span>
      <span className="nubi-wiki-excerpt">{row.excerpt.length>280?row.excerpt.slice(0,280)+'…':row.excerpt}</span>
      <small className="nubi-result-path">{row.path}:{row.provenance.start}–{row.provenance.end}{row.relation?` / ${row.relation.label}에서 연결`:''}</small>
    </CxButton>)}
    {(packet.truncated||packet.retrieval.incomplete||packet.retrieval.graphUnavailable)&&<p className="nubi-muted">일부 자료만 확인했어요. 범위를 좁혀 검색해 주세요.</p>}
  </section>;
}
