// Public, read-only browser tasks. A task is a user goal, not a prescribed
// tool trajectory. Live outcomes must be graded from observed pages and URLs.
const topics = [
  {id: 'codex', query: 'OpenAI Codex app', authority: 'OpenAI'},
  {id: 'artemis', query: 'NASA Artemis program', authority: 'NASA'},
  {id: 'algorithms', query: 'MIT OpenCourseWare algorithms lecture', authority: 'MIT OpenCourseWare'},
  {id: 'linear-algebra', query: 'Khan Academy linear algebra', authority: 'Khan Academy'},
  {id: 'ocean', query: 'BBC Earth ocean documentary', authority: 'BBC Earth'},
];

const challenges = [
  {id: 'official-pair', site: 'google', goal: '공식 웹 문서와 공식 YouTube 영상을 각각 찾아 주제와 게시자를 대조해 줘.', evidence: '서로 다른 공식 URL 2개와 각 페이지의 제목·게시자'},
  {id: 'sponsor-separation', site: 'youtube', goal: '검색 결과에서 광고와 일반 영상을 구분하고 공식 게시자의 영상을 골라 줘.', evidence: '광고 여부·채널명·영상 URL과 실제 결과 화면'},
  {id: 'duration-recency', site: 'youtube', goal: '관련 영상 두 개의 길이와 게시 시점을 비교하되 누락된 값은 추정하지 마.', evidence: '서로 다른 영상 URL 2개와 각 길이·게시 시점 또는 미확인'},
  {id: 'filter-recheck', site: 'youtube', goal: '동영상 필터와 최근 업로드 필터를 적용해 결과가 어떻게 바뀌는지 확인해 줘.', evidence: '필터 전후의 실제 상태·결과 URL·선택된 필터'},
  {id: 'result-to-watch', site: 'youtube', goal: '공식 채널 검색 결과를 열어 재생 페이지의 제목과 채널이 같은지 확인해 줘.', evidence: '검색 결과 URL, 재생 URL, 제목·채널 readback'},
  {id: 'description-source', site: 'youtube', goal: '설명을 펼쳐 공식 근거 링크를 찾고 링크 목적지를 확인해 줘. 링크가 없으면 없다고 말해 줘.', evidence: '펼친 설명 범위·관찰한 링크 URL 또는 없음'},
  {id: 'chapters-captions', site: 'youtube', goal: '챕터 또는 자막에서 핵심 구간을 찾아 시간표시와 내용을 요약해 줘. 제공되지 않으면 미확인으로 남겨 줘.', evidence: '실제 구간 시간표시·자막/챕터 근거 또는 이용 불가 상태'},
  {id: 'channel-followup', site: 'youtube', goal: '같은 채널의 후속 영상을 찾아 원 영상과의 순서를 근거로 설명해 줘.', evidence: '채널 URL, 서로 다른 영상 URL 2개, 표시된 게시 순서'},
  {id: 'crosscheck-claim', site: 'google', goal: '영상 설명의 핵심 주장 하나를 공식 웹 문서에서 교차 확인하고 불일치도 밝혀 줘.', evidence: '영상 설명 원문 범위와 별도 공식 URL의 대응 문장'},
  {id: 'three-source-brief', site: 'google', goal: '공식 웹 문서와 관련 영상 둘을 읽어 3문장으로 요약하고 근거가 없는 부분은 빼 줘.', evidence: '서로 다른 URL 3개, 각 원문 근거, 미열람 범위'},
];

export const publicSiteTasks = topics.flatMap(topic => challenges.map((challenge, index) => ({
  id: `${topic.id}-${String(index + 1).padStart(2, '0')}`,
  topic: topic.query,
  authority: topic.authority,
  pattern: challenge.id,
  site: challenge.site,
  startUrl: challenge.site === 'google'
    ? `https://www.google.com/search?q=${encodeURIComponent(topic.query)}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(topic.query)}`,
  goal: `${topic.query}: ${challenge.goal}`,
  outcomeEvidence: challenge.evidence,
  readOnly: true,
})));

if (publicSiteTasks.length !== 50 || new Set(publicSiteTasks.map(task => task.id)).size !== 50) {
  throw new Error('public_site_task_catalog_invalid');
}
