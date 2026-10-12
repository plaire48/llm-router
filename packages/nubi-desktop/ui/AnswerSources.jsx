import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';

export function sourceLocation(source) {
  const location=source.location;
  if(location?.page)return `${location.page}쪽`;
  if(location?.slide)return `슬라이드 ${location.slide}`;
  if(location?.sheet)return location.sheet;
  return source.start?`${source.start}${source.end&&source.end!==source.start?`–${source.end}`:''}줄`:'';
}
export function AnswerSources({message,onOpen}) {
  const cited=message.sourceReferences||[],consulted=message.consultedSources||(!cited.length?(message.mailSources||[]).map((source,index)=>({...source,kind:'mail',citationId:`legacy-mail-${index}`})):[]);
  if(!cited.length&&!consulted.length)return null;
  const row=source=>{
    const name=source.filename||source.title||source.path||'제목 없음';
    const type=source.attachmentId?'첨부 파일':source.kind==='mail'?'메일':source.kind==='wiki'?'위키':'문서';
    const location=sourceLocation(source),attention=['source_changed','document_changed','unavailable'].includes(source.freshness);
    return <CxButton type="button" className="nubi-answer-source" key={source.citationId}
      aria-label={`${source.number?`출처 ${source.number}, `:''}${type}: ${name}${location?`, ${location}`:''}${attention?', 원본 확인 필요':''}, 원문 보기`}
      title={[`${type} 원문 보기`,source.title,source.filename||source.path,location,attention?'원본 확인 필요':null].filter(Boolean).join('\n')} onClick={()=>onOpen?.(source)}>
      <Icon name={source.kind==='mail'&&!source.attachmentId?'mail':source.kind==='wiki'?'bookmark':'file'} size={16}/>
      <span className="nubi-source-number" aria-hidden="true">{source.number||'–'}</span>
      <span className="nubi-source-title">{name}</span>
      <span className="nubi-source-meta">{location&&<small>{location}</small>}{attention&&<small className="nubi-source-attention"><Icon name="alertCircle" size={14}/>원본 확인 필요</small>}</span>
      <Icon name="chevronRight" size={14}/>
    </CxButton>;
  };
  return <div className="nubi-answer-sources" aria-label="답변 근거">
    {!!cited.length&&<div className="nubi-cited-sources"><span className="nubi-source-label">원문 출처</span>{cited.map(row)}</div>}
    {!!consulted.length&&<details><summary><Icon name="file" size={13}/>참고 자료 {consulted.length}개<Icon name="chevronDown" size={12}/></summary><div className="nubi-consulted-sources">{consulted.map(row)}</div></details>}
    {message.unresolvedCitations&&<small className="nubi-muted">확인하지 못한 출처가 있어요.</small>}
  </div>;
}
