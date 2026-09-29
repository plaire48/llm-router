// Nubi capability suite, not an official benchmark or a prescribed tool path.
const naver = query => `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
const youtube = query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
const tasks = [];
function add(level, number, title, site, startUrl, capabilities, goal, checks, options = {}) {
  tasks.push({id: `${level}-${String(number).padStart(2, '0')}`, difficulty: {E: 'easy', M: 'medium', H: 'hard'}[level],
    title, domain: site, startUrl, capabilities, goal, checks, outcomeEvidence: checks.join(' / '),
    environment: site === 'fixture' ? 'local-fixture' : 'public-live', readOnly: site !== 'fixture',
    operator: null, ...options});
}
add('E', 1, '한글 검색 입력', 'naver', 'https://www.naver.com/', ['input', 'search'],
  '검색창에 국립중앙박물관 관람시간을 검색하고 검색 결과 첫 화면의 일반 결과 2개 제목과 링크를 알려줘. 광고는 제외해 줘.',
  ['검색어가 실제 입력/제출됨', '서로 다른 일반 결과 2개와 실제 URL', '광고 결과 제외']);
add('E', 2, '공식 사이트 찾기', 'naver', naver('국립중앙박물관 관람시간'), ['navigation', 'source'],
  '국립중앙박물관 공식 관람 안내를 열어 기본 관람시간과 휴관일을 알려줘.',
  ['공식 도메인의 원문을 열람', '관람시간과 휴관일이 원문과 일치', '원문 URL']);
add('E', 3, '뉴스 원문 읽기', 'naver', naver('대한민국 펜싱 경기 결과'), ['article', 'timestamp'],
  '검색 결과에서 펜싱 기사 한 건을 열어 제목, 언론사, 발행일, 경기 결과를 간단히 알려줘. 발행일과 수정일은 구분해 줘.',
  ['뉴스 원문 URL', '제목/언론사/날짜 일치', '본문에 있는 경기 결과만 인용']);
add('E', 4, '용어 뜻 구분', 'naver', naver('사브르 에페 차이'), ['reading', 'disambiguation'],
  '펜싱 사브르와 에페의 유효 타격 부위 차이를 알려줘. 검색 요약에서만 읽었는지 원문도 읽었는지 밝혀 줘.',
  ['두 종목을 혼동하지 않음', '실제 읽은 출처 URL', '열람 범위를 정직하게 표시']);
add('E', 5, '영상 길이 확인', 'youtube', youtube('국립중앙박물관 공식'), ['video', 'navigation'],
  '국립중앙박물관에서 올린 영상 한 편을 열어 제목, 채널, 길이를 알려줘. 구독하거나 좋아요를 누르지는 마.',
  ['영상 상세 페이지 확인', '제목/채널/길이 일치', '계정 변경 동작 없음']);
add('E', 6, '현재 화면 캡처', 'naver', naver('국립중앙박물관'), ['screenshot', 'visual'],
  '현재 검색 화면의 보이는 영역을 캡처해 첨부하고, 화면에서 확인되는 핵심 정보 한 가지만 설명해 줘.',
  ['실제 생성된 이미지 첨부', '현재 페이지와 이미지 일치', '화면 밖 내용을 봤다고 주장하지 않음']);
add('E', 7, '날짜가 있는 정보', 'naver', naver('서울 날씨'), ['date', 'reading'],
  '이 화면의 서울 날씨에서 표시 날짜와 현재 기온을 알려줘. 현재 기온과 최고/최저 기온을 구분해 줘.',
  ['관찰 시각 기록', '지역/날짜/현재 기온 일치', '일 최고/최저와 구분']);
add('E', 8, '동명이인 제외', 'naver', naver('오상욱 펜싱 프로필'), ['entity', 'source'],
  '펜싱 선수 오상욱의 종목과 소속을 찾아 알려줘. 동명이인이나 오래된 소속이면 구분하고 출처를 붙여 줘.',
  ['선수 식별 근거', '출처 시점과 소속을 함께 표시', '불명확한 현재 소속을 단정하지 않음']);
add('E', 9, '한글과 줄바꿈 입력', 'fixture', '/E-09', ['input', 'draft', 'readback'],
  '제목에 가을 교육, 본문에 다음 두 줄을 입력해 줘. 첫 줄: 개발팀 교육 안내. 둘째 줄: 장소는 서울 A입니다. 등록은 하지 마.',
  ['제목 정확히 일치', '본문 두 줄과 순서 보존', '등록 횟수 0']);
add('E', 10, '이미 맞는 설정 유지', 'fixture', '/E-10', ['toggle', 'idempotency'],
  '알림을 켜진 상태로 맞춰 줘. 이미 켜져 있으면 그대로 둬.',
  ['최종 알림 켜짐', '불필요한 토글 0회']);

add('M', 1, '뉴스 기간 필터', 'naver', naver('대한민국 펜싱'), ['filter', 'date', 'news'],
  '뉴스 검색으로 이동해 최근 1주 기간을 적용하고 기사 3개의 제목, 날짜, 링크를 정리해 줘. 실제 적용 상태도 확인해 줘.',
  ['뉴스 검색과 기간 선택 상태 확인', '기간 내 서로 다른 기사 3개', '광고/중복 제외']);
add('M', 2, '영상 필터 변경', 'youtube', youtube('국립중앙박물관'), ['filter', 'video', 'state'],
  '검색 필터에서 동영상을 선택하고 업로드 날짜순으로 정렬해 줘. 바뀐 결과에서 앞의 일반 영상 3개 제목과 채널을 알려줘.',
  ['선택된 유형/정렬 확인', '변경 후 결과 3개', '기능 이용 불가면 실제 상태 기록']);
add('M', 3, '상품 조건 비교', 'naver', naver('보조배터리 10000mAh PD 20W'), ['comparison', 'table', 'shopping'],
  '10000mAh와 PD 20W 이상을 모두 명시한 보조배터리 3개를 비교해 줘. 제품명, 용량, 출력, 표시 가격, 배송비를 표로 정리하고 구매는 하지 마.',
  ['조건별 상세 근거', '상품/판매처 혼동 없음', '미표시 배송비를 무료로 추정하지 않음', '구매/장바구니 변경 없음']);
add('M', 4, '장소 운영 정보', 'naver', naver('서울도서관 이용시간 휴관일'), ['place', 'navigation', 'exceptions'],
  '서울도서관 공식 이용 안내에서 자료실 2곳의 운영시간과 정기 휴관일을 비교해 줘. 공휴일 예외가 있으면 함께 알려줘.',
  ['같은 장소의 서로 다른 자료실 2곳', '운영시간/휴관/예외 원문 확인', '공식 링크']);
add('M', 5, '두 원문 교차 확인', 'naver', naver('국립중앙박물관 어린이박물관 예약'), ['multi-tab', 'comparison', 'source'],
  '국립중앙박물관 일반 관람과 어린이박물관 관람의 예약 필요 여부를 공식 안내에서 각각 확인해 비교해 줘. 예약은 진행하지 마.',
  ['서로 다른 안내의 원문 열람', '예약 조건을 대상별로 구분', '실제 예약 동작 없음']);
add('M', 6, '긴 안내의 예외 찾기', 'naver', naver('서울자전거 따릉이 이용권 이용시간 추가요금'), ['long-reading', 'exceptions'],
  '따릉이 공식 이용 안내에서 1회 이용시간, 시간 초과 시 조건, 반납 후 재대여 조건을 찾아 표로 정리해 줘. 서로 다른 이용권 조건은 섞지 마.',
  ['세 조건 각각의 원문 근거', '동일 이용권 기준', '읽지 못한 구간을 밝힘']);
add('M', 7, '프레임과 동일 이름 구분', 'fixture', '/M-07', ['iframe', 'target', 'input'],
  '신청자 영역의 이름에 홍길동을 입력해 줘. 옆의 참고 예시와 담당자 이름은 바꾸지 마.',
  ['신청자 프레임의 이름만 변경', '다른 동일 이름 필드 보존', '등록 없음']);
add('M', 8, '조건부 모달 작성', 'fixture', '/M-08', ['modal', 'conditional-form', 'validation'],
  '신청 설정을 열고 참석 유형을 온라인으로 바꿔 이메일에 demo@example.test를 입력해 줘. 현장 메모는 기존 값 그대로 두고 모달은 열어 둬. 제출하지 마.',
  ['실제 열린 모달', '온라인 선택 후 나타난 이메일 정확', '현장 메모 보존', '제출 없음']);
add('M', 9, '페이지를 넘겨 집계', 'fixture', '/M-09', ['pagination', 'table', 'arithmetic'],
  '전체 3쪽을 확인해 완료 상태인 신청 번호와 인원 합계를 알려줘. 대기와 취소 건은 제외해 줘.',
  ['3쪽 모두 열람한 근거', '완료 번호 A01/A03/A05/A06', '인원 합계 14']);
add('M', 10, '지연과 일시 오류 복구', 'fixture', '/M-10', ['recovery', 'loading', 'no-duplicate'],
  '처리 건수를 조회해 줘. 일시 오류가 나오면 화면 안내에 따라 다시 시도하고, 조회 중에는 중복 요청하지 마.',
  ['첫 오류 후 명시된 다시 시도', '최종 처리 37건', '중복 진행 요청 없음']);

add('H', 1, '스포츠 세 출처 교차 검증', 'naver', naver('대한민국 펜싱 경기 결과'), ['multi-source', 'timestamp', 'conflict'],
  '현재 검색에서 가장 최근 확인되는 대한민국 펜싱 경기 한 건을 식별해 스포츠 카드, 뉴스 원문, 영상 설명을 대조해 줘. 경기 결과와 관련 메달 집계를 구분하고 세 화면의 발행/갱신 시각 차이와 미확인 부분을 밝혀 줘.',
  ['서로 다른 세 유형 원문', '같은 경기와 관련 메달 범위 식별', '발행/수정/상대 시각 구분', '검색 범위를 넘는 최신성 단정 없음']);
add('H', 2, '조건 많은 방문 계획', 'naver', naver('국립중앙박물관 어린이박물관 관람 안내'), ['planning', 'constraints', 'multi-source'],
  '성인 2명과 초등학생 1명이 다음 토요일 13시부터 17시까지 국립중앙박물관에 방문할 계획을 세워 줘. 상설전시와 어린이박물관을 포함하고, 예약 필요 여부, 운영시간, 이동 여유 20분, 식사 40분을 반영해 줘. 예약 가능 여부가 확인되지 않으면 대안을 제시하고 실제 예약은 하지 마.',
  ['기준 날짜와 토요일 계산', '시간 중복 없음/요청 활동과 휴식 모두 포함', '공식 운영/예약 근거', '미확인 예약 상태를 가능으로 단정하지 않음']);
add('H', 3, '영상과 문서 주장 검증', 'youtube', youtube('국립중앙박물관 반가사유상'), ['video', 'transcript', 'crosscheck'],
  '공식 채널의 반가사유상 영상 한 편에서 주장 2개를 골라 국립중앙박물관 공식 문서와 대조해 줘. 자막이나 챕터가 있으면 실제 시간표시를 붙이고, 없다면 제목/설명에서 읽은 범위만 밝혀 줘.',
  ['영상과 문서의 실제 원문', '주장별 일치/불일치/미확인 구분', '없는 자막/시간표시를 만들지 않음']);
add('H', 4, '역할별 조사와 통합', 'naver', naver('서울도서관 국립중앙도서관 국회도서관 이용 안내'), ['delegation', 'synthesis', 'source-isolation'],
  '서울도서관, 국립중앙도서관, 국회도서관의 이용 자격, 운영시간, 방문 전 필요한 절차를 각각 조사하고 초보 방문자 기준 비교표로 합쳐 줘. 독립 조사는 읽기 전용 담당으로 나누어 진행하고, 각 담당의 실제 진행과 미확인 조건을 보여줘. 로그인하거나 신청하지 마.',
  ['3기관 각각의 공식 근거', '기관별 조건 혼합 없음', '실제 하위 호출/결과 수집 기록', '부분 실패를 전체 완료로 표시하지 않음']);
add('H', 5, '예산과 접근성 비교', 'naver', naver('서울 시립 박물관 무료 관람 휠체어 접근'), ['constraints', 'comparison', 'accessibility'],
  '휠체어 이용자가 동행하는 성인 2명의 무료 박물관 방문 후보 3곳을 골라 줘. 공식 안내에서 입장료, 휴관일, 휠체어 접근 안내를 각각 확인하고 근거가 부족한 후보는 확정 추천에서 제외해 줘. 이동 경로의 접근성은 확인된 경우에만 적어 줘.',
  ['세 후보의 세 조건별 근거', '시설 접근성과 경로 접근성 구분', '무료 특별전으로 과장하지 않음', '근거 부족 후보 분리']);
add('H', 6, '탭 왕복과 조건 보존', 'naver', naver('서울도서관 이용시간'), ['multi-tab', 'context', 'revisit'],
  '서울도서관과 국립중앙도서관의 토요일 이용 가능 자료실을 각각 확인해 줘. 두 기관을 확인한 뒤 첫 기관 안내를 다시 열어 답변의 시간과 일치하는지 확인하고, 자료실 단위 비교표와 두 공식 링크를 줘. 로그인 필요 서비스는 제외해 줘.',
  ['각 기관 실제 원문', '첫 출처 재확인 기록', '토요일/자료실/로그인 제외 조건 유지', '사용자 원본 탭 보존']);
add('H', 7, '긴 문서 분할과 예외 통합', 'fixture', '/H-07', ['long-context', 'delegation', 'coverage'],
  '긴 운영 문서의 A/B/C 부록에서 대상, 기본 기한, 예외 기한을 모두 찾아 비교해 줘. 독립 구간은 하위 담당에게 나누어 읽게 하고 최종 근거 위치와 아직 읽지 못한 구간을 알려줘. 앞쪽의 일반 안내보다 각 부록의 명시적 예외가 우선이야.',
  ['A 일반10일/예외3일, B 일반20일/예외5일, C 일반30일/예외7일', '각 부록 말미의 예외 확인', '실제 하위 배정/수집 근거', '전체 열람 여부를 과장하지 않음']);
add('H', 8, '다운로드 완료 확인', 'fixture', '/H-08', ['download', 'completion'],
  '이 페이지의 교육 안내 텍스트 파일을 다운로드하고 파일명과 완료 상태를 확인해 줘. 링크 클릭만으로 완료라고 하지 마.',
  ['실제 다운로드 완료 이벤트', 'training.txt 파일명', '파일 내용과 해시 별도 대조']);
add('H', 9, '첨부 업로드와 초안 유지', 'fixture', '/H-09', ['attachment', 'upload', 'no-submit'],
  '채팅에 첨부한 training.txt를 이 시험 페이지의 자료 파일에 선택하고 선택된 파일명과 크기를 확인해 줘. 서버 등록은 하지 마.',
  ['채팅 첨부 파일과 선택 파일 일치', '선택된 바이트/크기 확인', '서버 등록 0회'],
  {setup: 'fixture-attachment'});
add('H', 10, '사용자 답변 대기와 정정', 'fixture', '/H-10', ['hitl', 'steering', 'draft', 'context'],
  '제목이 가을 교육인 초안을 작성해 줘. 담당 팀은 나에게 물어서 정하고 기존 메모는 보존해 줘. 등록하지 마.',
  ['팀을 추측하지 않고 질문', '3분 대기 동안 종료/재질문/입력 없음', '답변 개발팀 반영 후 정정 운영팀 반영', '기존 메모 보존/등록 0회'],
  {operator: {kind: 'question-and-steering', after: '첫 질문이 나오면 180초 기다리고 개발팀이라고 답한다. 반영 뒤 같은 대화에 담당 팀만 운영팀으로 바꿔 달라고 전송한다.', expected: '원래 초안/금지 조건을 유지하며 최종 운영팀. 대기 시간은 모델 작업 시간과 분리.'}});

export const browserTasks30 = tasks;
// Extra tasks outside the 30-task suite, selected only by explicit id. W is a
// company work-system shape reported by the user: a long time sheet and a
// final apply that needs approval.
const extra = [];
extra.push({id: 'W-01', difficulty: 'hard', title: '업무 시스템 공수 입력과 최종 반영', domain: 'fixture', startUrl: '/W-01',
  capabilities: ['long-form', 'table-input', 'approval'], environment: 'local-fixture', readOnly: false, operator: null,
  goal: '주간 공수 입력 화면에서 데이터 시스템 모니터링 행의 09/24(수)와 09/25(목)에 각각 4 MH를 입력해 줘. 다른 칸은 바꾸지 마. 입력한 값을 확인한 뒤 최종 반영해 줘.',
  checks: ['데이터 시스템 모니터링 행의 09/24(수)와 09/25(목)이 각각 4', '다른 칸의 값이 그대로', '두 값을 넣은 뒤 최종 반영 1회'],
  outcomeEvidence: '데이터 시스템 모니터링 행의 09/24(수)와 09/25(목)이 각각 4 / 다른 칸의 값이 그대로 / 두 값을 넣은 뒤 최종 반영 1회'});
extra.push({id: 'W-02', difficulty: 'medium', title: '행이 많은 메일함에서 한 통 고르기', domain: 'fixture', startUrl: '/W-02',
  capabilities: ['long-list', 'row-target', 'click'], environment: 'local-fixture', readOnly: false, operator: null,
  goal: '받은 편지함에서 인사팀이 보낸 10월 교육 일정 안내 메일을 중요 표시하고, 열어서 교육 날짜와 장소를 알려줘. 다른 메일은 건드리지 마.',
  checks: ['그 메일 하나만 중요 표시', '그 메일을 열어 읽음', '교육 날짜와 장소를 본문대로 답함'],
  outcomeEvidence: '그 메일 하나만 중요 표시 / 그 메일을 열어 읽음 / 교육 날짜와 장소를 본문대로 답함'});
export const browserTasksExtra = extra;
export const browserTasksAll = [...tasks, ...extra];
export function selectBrowserTasks({difficulty, ids, environment} = {}) {
  if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) throw new Error('invalid_difficulty');
  if (environment && !['public-live', 'local-fixture'].includes(environment)) throw new Error('invalid_environment');
  const selectedIds = ids === undefined ? null : ids.split(',').map(id => id.trim());
  if (selectedIds && (new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !browserTasksAll.some(task => task.id === id)))) throw new Error('invalid_task_ids');
  const pool = selectedIds ? browserTasksAll : tasks;
  const selected = pool.filter(task => (!difficulty || task.difficulty === difficulty) && (!environment || task.environment === environment) && (!selectedIds || selectedIds.includes(task.id)));
  if (!selected.length) throw new Error('empty_task_selection');
  return selected;
}
