import test from 'node:test';
import assert from 'node:assert/strict';
import {isInformationRequest} from '../request-intent.js';

test('lookups with citation wording or forbidden writes are information requests', () => {
  for (const goal of ['펜싱 선수 오상욱의 종목과 소속을 찾아 알려줘. 동명이인이나 오래된 소속이면 구분하고 출처를 붙여 줘.',
    '검색창에 국립중앙박물관 관람시간을 검색하고 검색 결과 첫 화면의 일반 결과 2개 제목과 링크를 알려줘. 광고는 제외해 줘.',
    '현재 페이지의 제목을 확인하고 못 찾으면 확인한 범위를 밝혀 줘. 저장하지 마.',
    '국립중앙박물관에서 올린 영상 한 편을 열어 제목, 채널, 길이를 알려줘. 구독하거나 좋아요를 누르지는 마.',
    '공개 자료에서 선수의 종목과 소속을 알려줘. 오래된 소속은 구분하고 확인한 출처만 붙여 줘.',
    '이 화면의 서울 날씨에서 표시 날짜와 현재 기온을 알려줘.', '검색 결과에서 펜싱 기사 한 건을 열어 제목, 언론사, 발행일, 경기 결과를 간단히 알려줘. 발행일과 수정일은 구분해 줘.',
    '이 문서의 작성자와 변경 이력을 알려줘.', '도서관 회원 가입 절차와 예약 방법을 조사해서 알려줘.', '선택한 폴더의 교육 안내를 찾아 설명해줘.',
    'Find the opening hours and cite the source. Do not submit anything.']) assert.equal(isInformationRequest(goal), true, goal);
});

test('requests that change a page, and unusable input, are not information requests', () => {
  for (const goal of ['제목에 가을 교육, 본문에 다음 두 줄을 입력해 줘. 등록은 하지 마.', '알림을 켜진 상태로 맞춰 줘. 설정을 변경해도 돼.',
    '메일을 열고 받는 사람, 제목, 본문을 작성해줘. 발송하지 마.', '이 글을 삭제해 줘.', '출처를 본문에 붙여 넣고 저장해 줘.', 'Save the draft and post it.',
    '자료 카드를 보관함으로 옮겨줘. 삭제하지 마.', '알림을 켜진 상태로 맞춰 줘. 이미 켜져 있으면 그대로 둬.', '담당 팀을 개발팀으로 선택해 줘.',
    '이 화면에서 계속 진행해.', '수정일을 오늘로 수정해 줘.', '작성자 이름을 입력하고 알려줘.', '직원 검색에서 Alice Kim을 선택하고 확인해줘. 보내지는 마.', '직원 검색에서 김민지를 키보드로 선택하고 부서를 알려줘.', '필터를 적용해서 결과를 알려줘.', '교육 과정을 신청하고 결과를 알려줘.', 'Move the card to the archive and tell me the result.', 'Turn on notifications.',
    '', '   ', '자료 '.repeat(1200), null, undefined, 3]) assert.equal(isInformationRequest(goal), false, String(goal).slice(0, 40));
});

test('measured lookups with joined prohibitions, requirement nouns and planning wording are information requests', () => {
  const readOnly = '\n\n읽기 전용으로 조사해 주세요. 확인한 출처 URL과 열람 범위, 확인하지 못한 부분을 구분해 주세요.';
  const local = '\n\n연결된 로컬 평가 페이지에서만 작업하세요. 요청하지 않은 등록/제출은 하지 마세요.';
  for (const goal of ['국립중앙박물관 일반 관람과 어린이박물관 관람의 예약 필요 여부를 공식 안내에서 각각 확인해 비교해 줘. 예약은 진행하지 마.' + readOnly,
    '현재 검색에서 가장 최근 확인되는 대한민국 펜싱 경기 한 건을 식별해 스포츠 카드, 뉴스 원문, 영상 설명을 대조해 줘. 세 화면의 발행/갱신 시각 차이와 미확인 부분을 밝혀 줘.' + readOnly,
    '다음 토요일 13시부터 17시까지 국립중앙박물관에 방문할 계획을 세워 줘. 예약 필요 여부, 운영시간, 이동 여유 20분, 식사 40분을 반영해 줘. 예약 가능 여부가 확인되지 않으면 대안을 제시하고 실제 예약은 하지 마.',
    '세 도서관의 이용 자격과 운영시간을 각각 조사하고 비교표로 합쳐 줘. 로그인하거나 신청하지 마.',
    '두 도서관의 토요일 이용 가능 자료실을 각각 확인해 줘. 로그인 필요 서비스는 제외해 줘.',
    '전체 3쪽을 확인해 완료 상태인 신청 번호와 인원 합계를 알려줘. 대기와 취소 건은 제외해 줘.' + local,
    '처리 건수를 조회해 줘. 일시 오류가 나오면 화면 안내에 따라 다시 시도하고, 조회 중에는 중복 요청하지 마.' + local]) assert.equal(isInformationRequest(goal), true, goal.slice(0, 40));
});

test('a prohibition never hides the operation that the request does ask for', () => {
  const local = '\n\n연결된 로컬 평가 페이지에서만 작업하세요. 요청하지 않은 등록/제출은 하지 마세요.';
  for (const goal of ['제목을 입력하고 저장하지 마. 결과를 알려줘.', '제목을 수정, 저장하지 말고 어떻게 보이는지 알려줘.', '파일을 업로드, 제출하지 말고 미리보기를 보여줘.', '신청자 영역의 이름에 홍길동을 입력해 줘. 옆의 참고 예시와 담당자 이름은 바꾸지 마.' + local,
    '이 페이지의 교육 안내 텍스트 파일을 다운로드하고 파일명과 완료 상태를 확인해 줘. 링크 클릭만으로 완료라고 하지 마.' + local,
    '제목이 가을 교육인 초안을 작성해 줘. 담당 팀은 나에게 물어서 정하고 기존 메모는 보존해 줘. 등록하지 마.' + local,
    '뉴스 검색으로 이동해 최근 1주 기간을 적용하고 기사 3개의 제목, 날짜, 링크를 정리해 줘. 실제 적용 상태도 확인해 줘.',
    '검색 필터에서 동영상을 선택하고 업로드 날짜순으로 정렬해 줘. 바뀐 결과에서 앞의 일반 영상 3개 제목과 채널을 알려줘.',
    '어린이박물관을 예약하고 예약 번호를 알려줘.', '로그인하고 예약 가능 여부를 확인해 줘.', '수정사항을 문서에 반영해 줘.', '등록하거나 제출해 줘.',
    '내용을 확인하고 페이지에 반영해줘.', '일정을 짜서 안내문에 반영해 줘.', '현재 검색 결과에서 공식 관람 안내의 제목과 링크를 확인하고 안내문에 반영할 내용을 알려줘.']) assert.equal(isInformationRequest(goal), false, goal.slice(0, 40));
});
