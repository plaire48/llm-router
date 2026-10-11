import React from 'react';

export function mailDate(value,full=false){const date=value?new Date(value):new Date(NaN);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,full?undefined:{month:'numeric',day:'numeric'}):'날짜 미확인';}
export function mailLocation(hit={}){return hit.kind==='subject'?'제목과 보낸 사람':hit.kind==='metadata'?'받는 사람, 참조, 날짜와 태그':hit.kind==='knowledge'?'핵심 정리':hit.kind==='attachment'?`${hit.filename||'첨부 문서'}${hit.page?` / ${hit.page}쪽`:hit.slide?` / 슬라이드 ${hit.slide}`:hit.sheet?` / ${hit.sheet}`:''}`:'본문';}
export function MailMatchText({text='',query=''}){
  const terms=[...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a,b)=>b.length-a.length);
  if(!terms.length)return text;
  const expression=new RegExp(`(${terms.map(term=>/^[a-z0-9]{1,3}$/i.test(term)?`(?<![a-z0-9])${term}(?![a-z0-9])`:term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`,'gi');
  return String(text).split(expression).map((part,index)=>index%2?<mark key={index}>{part}</mark>:part);
}
