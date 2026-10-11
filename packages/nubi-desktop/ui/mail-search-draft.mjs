// A handoff prepares an editable request, never sends mail or starts a model.
export function mailSearchDraft(draft,query,filters={}) {
  const periods={'7':'최근 7일','30':'최근 30일',unknown:'날짜 미확인'};
  const locations={subject:'제목과 보낸 사람',metadata:'받는 사람, 참조, 날짜와 태그',body:'본문',attachment:'첨부',knowledge:'핵심 정리'};
  const conditions=[];
  if(filters.period==='custom')conditions.push(`기간 ${filters.from} ~ ${filters.to}`);
  else if(periods[filters.period])conditions.push(periods[filters.period]);
  if(filters.dateField==='fetchedAt')conditions.push('기간은 누비 수신 시각 기준');
  if(filters.senders?.length)conditions.push('보낸 사람: '+filters.senders.join(', '));
  if(filters.attachment==='with')conditions.push('첨부 있음');
  if(filters.attachment==='without')conditions.push('첨부 없음');
  if(filters.types?.length)conditions.push('첨부 형식: '+filters.types.join(', '));
  if(filters.filename)conditions.push('파일명: '+filters.filename);
  if(filters.locations?.length)conditions.push('검색 위치: '+filters.locations.map(value=>locations[value]||value).join(', '));
  if(filters.pinned)conditions.push('고정한 메일');
  if(filters.tags?.length)conditions.push('태그: '+filters.tags.join(', '));
  if(filters.states?.length)conditions.push('정리 상태: '+filters.states.map(value=>({queued:'정리 대기',saved:'정리됨',attention:'확인 필요'})[value]||value).join(', '));
  if(filters.confirmed==='yes')conditions.push('확인한 메일');
  if(filters.confirmed==='no')conditions.push('미확인 메일');
  const request=`메일에서 찾아 원문 출처와 함께 정리해 주세요: ${query.trim()}${conditions.length?'\n검색 조건: '+conditions.join(' / '):''}`;
  const result=draft.trim()?`${draft}\n\n${request}`:`/mail ${request}`;
  if(result.length>16000)throw Error('agent_input_invalid');
  return result;
}
