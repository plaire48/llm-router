import {ATTACHMENT_LIMITS} from './attachment-limits.js';

// Shared by the in-app help and the offline guide packaged with the extension.
const attachmentMB = bytes => Math.round(bytes / (1024 * 1024));
export const HELP_SECTIONS = [
  {
    id: 'start', title: '처음 시작하기', icon: 'message',
    lead: '페이지를 열고 누비에게 할 일을 알려주세요.',
    paragraphs: [
      'AI Pro나 ChatGPT로 로그인하세요. FabriX는 연결 정보를 등록하세요.',
      '입력창의 모델 이름을 누르면 제공자와 모델을 바꿀 수 있습니다.',
      '날짜와 시간은 PC 설정을 따릅니다. 다른 시간대가 필요하면 요청에 함께 알려주세요.',
      'Enter로 전송하고 Shift+Enter로 줄을 바꿉니다.',
      '작업 중 Enter는 대기열에 넣습니다. 손잡이로 순서를 바꾸고 위쪽 화살표로 현재 작업에 반영하세요.',
    ],
    examples: ['현재 페이지의 핵심만 정리해줘.', '이 페이지에서 메일 초안만 작성해줘.'],
  },
  {
    id: 'page', title: '페이지 읽기와 자동화', icon: 'link',
    lead: '요청한 작업을 실행하고 결과까지 확인합니다.',
    paragraphs: ['페이지 연결 없이 바로 요청하세요. 첫 사용에는 사이트 접근을 허용해 주세요.'],
    points: [
      {title: '실행 전에 계획만 검토', detail: '/plan 뒤에 할 일을 적으세요. 현재 화면과 관련 자료를 읽어 절차와 필요한 정보를 정리합니다. 입력하거나 클릭하지 않습니다. 검토 후 새 메시지로 실행을 요청하세요.'},
      {title: '읽고 실행하고 확인', detail: '필요한 내용을 찾아 입력, 클릭, 이동합니다. 링크, 토글, 드래그와 자동완성도 조작합니다. 계획 아래에서 진행 상황과 실행 기록을 확인하세요.'},
      {title: '작성 중인 내용은 현재 탭에서', detail: '기본은 같은 창의 누비 탭 그룹입니다. 미저장 입력을 이어 수정하려면 설정에서 ‘현재 탭에서 작업’을 선택하세요. 탭 사이의 로그인과 저장 데이터는 공유됩니다.'},
      {title: '등록과 배포는 승인 후', detail: '초안을 먼저 입력하고 결과를 확인합니다. 연필 아이콘으로 수정할 수 있으며, 수정창을 닫아도 초안은 남습니다. 서식은 페이지 편집기가 지원하는 범위에서 적용합니다.'},
      {title: '필요한 정보는 질문으로', detail: '한 번에 한 항목씩 답하세요. 선택지를 누르거나 아래에 직접 입력할 수 있습니다. 긴 답변은 입력란을 펼쳐 Ctrl+Enter 또는 ⌘+Enter로 보냅니다. 답변 초안은 새로고침해도 남습니다.'},
      {title: '사용자 마우스는 그대로', detail: 'AI 작업 위치를 별도로 표시합니다. 같은 페이지의 선택과 스크롤은 바뀔 수 있습니다. 확장 관리 등 브라우저 내부 페이지는 조작할 수 없습니다.'},
      {title: '사이트 위키로 기억', detail: '/wiki로 확인한 화면을 문서로 저장하세요. 설정의 사이트 위키에서 자동 갱신을 켜면 완료한 작업의 화면 정보만 승인 없이 갱신합니다. 업무 규칙은 유지하며, 바뀐 본문은 재확인 전까지 검색에서 제외합니다. 되돌리기 아이콘으로 이전 관찰을 복원할 수 있습니다.'},
      {title: '요청한 내용만 모델에 전달', detail: '페이지 이동만으로 전송하지 않습니다.'},
    ],
    controls: [
      {icon: 'link', label: '현재 페이지 연결', description: '작업할 페이지를 직접 지정하거나 해제합니다.'},
      {icon: 'linkExternal', label: '전체 화면', description: '같은 대화를 넓은 창에서 이어갑니다.'},
    ],
  },
  {
    id: 'attachments', title: '파일 첨부', icon: 'file',
    lead: '이미지와 문서를 참고해 답변하고 작업합니다.',
    controls: [{icon: 'file', label: '파일 첨부', description: '파일을 선택합니다. 전송 전에는 제거할 수 있습니다.'}],
    paragraphs: ['이미지, PDF, Word(docx), UTF-8 텍스트를 첨부하세요. 파일을 끌어놓거나 이미지와 긴 글을 붙여넣을 수도 있습니다.'],
    points: [
      {title: '긴 문서도 필요한 부분부터', detail: '요약 후에도 원문을 다시 찾습니다. 문서는 텍스트만 읽으며 그림, 도표, 스캔 문서는 해석하지 않습니다. 이미지는 현재 제공자의 이미지 지원 모델로 연결합니다.'},
      {title: `한 번에 ${ATTACHMENT_LIMITS.count}개, 총 ${attachmentMB(ATTACHMENT_LIMITS.batchBytes)} MB`, detail: `이미지는 파일당 ${attachmentMB(ATTACHMENT_LIMITS.imageBytes)} MB·2천만 화소, 문서와 텍스트는 ${attachmentMB(ATTACHMENT_LIMITS.documentBytes)} MB까지입니다. PDF는 ${ATTACHMENT_LIMITS.documentPages.toLocaleString('ko-KR')}쪽, 추출 본문은 ${ATTACHMENT_LIMITS.textChars / 10000}만 자·${attachmentMB(ATTACHMENT_LIMITS.extractedBytes)} MB까지 읽습니다.`},
      {title: '대화와 함께 보관', detail: '대화를 삭제하면 첨부도 삭제됩니다. 보관 한도는 80개 또는 80 MB입니다.'},
    ],
    examples: ['이 화면 이미지를 참고해 현재 페이지의 소개글을 작성해줘.'],
  },
  {
    id: 'project', title: 'OpenWiki 폴더', icon: 'code',
    lead: '문서를 참고해 브라우저에서 작업하세요.',
    controls: [{icon: 'code', label: 'OpenWiki 폴더', description: '설정에서 참고할 폴더를 선택하거나 해제합니다.'}],
    paragraphs: [
      '설정에서 openwiki 폴더나 이를 포함한 프로젝트를 선택하세요. 서버 실행은 필요 없습니다.',
      '필요한 문서를 찾아 선택한 모델에 발췌를 전달하고, 현재 페이지의 초안 작성과 입력에 활용합니다.',
      '폴더 설정은 저장됩니다. 브라우저가 권한을 다시 요청하면 설정에서 읽기를 허용하세요.',
      '폴더에서는 Wiki 문서만 읽습니다. 서버 연결에서는 OpenWiki가 질문에 맞는 근거를 찾아 전달하며 원본 소스도 조회할 수 있습니다.',
    ],
    examples: ['OpenWiki의 상품 설명을 참고해서 현재 페이지의 소개글을 채워줘.'],
  },
  {
    id: 'history', title: '대화 보관과 이어가기', icon: 'clockRewind',
    lead: '새 대화를 시작해도 이전 대화와 초안은 남습니다.',
    controls: [
      {icon: 'clockRewind', label: '대화 이력', description: '대화 검색, 이어가기, 이름 변경과 삭제를 합니다.'},
      {icon: 'plus', label: '새 대화', description: '대화 이력 안의 + 버튼으로 새로 시작합니다.'},
    ],
    paragraphs: [
      '다시 열면 마지막 대화가 복원됩니다. 로그인 없이 읽을 수 있고, 전송하려면 연결이 필요합니다.',
      '일시적인 연결 오류는 잠시 기다린 뒤 다시 시도합니다. 도구 오류는 현재 화면을 확인하고 수정합니다. 채팅창을 닫아도 작업은 계속됩니다. 직접 중지하거나 브라우저 실행이 끊긴 작업은 이어가기 아이콘으로 재개합니다.',
      '대화는 이 브라우저에만 저장됩니다. 삭제하면 첨부 이미지도 함께 삭제됩니다.',
    ],
  },
  {
    id: 'images', title: '이미지와 캡처', icon: 'image',
    lead: '원하는 이미지를 설명하면 페이지에서 찾아줍니다.',
    examples: ['이 페이지의 제품 사진을 찾아 다운로드해줘.', '이 페이지 전체를 캡처해줘.'],
    controls: [{icon: 'download', label: '이미지 다운로드', description: '파일을 저장합니다. 이미지를 누르면 확대됩니다.'}],
    paragraphs: [
      '브라우저 탭만 캡처합니다. 이미지 확인이 필요하면 현재 제공자의 이미지 지원 모델로 자동 전환합니다.',
      '전체 페이지를 요청하면 아래쪽 내용까지 캡처합니다. 내부 스크롤 영역이나 아직 불러오지 않은 내용은 이동하며 따로 확인합니다.',
      '진행 상황에서 캡처한 단계를 누르면 화면이 펼쳐집니다. 확대와 다운로드도 그 자리에서 할 수 있습니다.',
      '클릭 대상을 찾기 어려우면 화면을 다시 보고 판단합니다. 선택이 필요하면 후보를 보여주고 묻습니다.',
      '이미지와 SVG는 파일당 20 MiB까지 지원합니다. 전체 80장 또는 80 MiB까지 보관하며, 가득 차면 불필요한 대화를 삭제하세요.',
    ],
  },
  {
    id: 'skills', title: '스킬 등록과 공유', icon: 'layers',
    lead: '반복할 작업을 스킬로 저장하고 공유하세요.',
    controls: [
      {icon: 'layers', label: '스킬 선택', description: '입력창에서 필요한 스킬을 선택합니다.'},
      {icon: 'plus', label: '스킬 등록', description: '이름, 사용 목적과 지침을 저장합니다.'},
      {icon: 'upload', label: '스킬 가져오기', description: '스킬 ZIP, SKILL.md 폴더 또는 JSON을 확인하고 저장합니다.'},
      {icon: 'download', label: '스킬 내보내기', description: '저장한 스킬은 대화의 파일 카드에서도 ZIP으로 내려받습니다.'},
    ],
    paragraphs: [
      '자동 모드에서는 필요한 스킬을 찾습니다. /를 입력하면 직접 선택할 수 있습니다.',
      '작업으로 만들기는 완료한 업무에서 초안을 만듭니다. 부족한 기준은 질문으로 확인하며, 검토 후 저장하세요.',
      '저장한 스킬은 현재 Chrome 프로필의 누비에 보관합니다. ZIP 다운로드 위치는 Chrome 설정을 따릅니다.',
      '폴더에 포함한 scripts/*.browser.js는 브라우저 도구로 실행합니다. Python과 Node 실행, PC 라이브러리 설치는 지원하지 않습니다. 코드 블록과 다른 스크립트는 참고 자료입니다.',
    ],
  },
  {
    id: 'integrations', title: '도구 연결과 티켓 보관', icon: 'link',
    lead: '설정에서 MCP 서버와 저장 폴더를 연결하세요.',
    points: [
      {title: 'MCP 연결', detail: 'HTTP/HTTPS의 Streamable HTTP를 지원합니다. 주소와 필요한 인증 헤더를 입력하고 연결을 테스트하세요. stdio와 구형 SSE는 지원하지 않습니다.'},
      {title: '도구 실행 전 확인', detail: '보낼 내용을 채팅에서 확인하고 실행합니다. 연결과 헤더는 브라우저 종료 시 삭제됩니다.'},
      {title: '화면에 보이는 티켓 보관', detail: '표시된 내용과 출처를 수집합니다. 숨긴 댓글이나 다른 페이지는 포함하지 않습니다.'},
      {title: '첨부 파일 정리', detail: '같은 사이트에서 확인한 링크의 파일을 최대 5 MB까지 저장합니다. 수정된 기존 파일은 덮어쓰지 않습니다. 문서 내용까지 읽으려면 채팅에 첨부하세요.'},
    ],
    examples: ['현재 JSM 티켓과 첨부 파일을 저장 폴더에 정리해줘.'],
  },
  {
    id: 'usage', title: '모델과 사용량', icon: 'chartColumn',
    lead: '확장에서 쓴 토큰과 계정 잔여 한도를 확인하세요.',
    controls: [{icon: 'chartColumn', label: '사용량', description: 'ChatGPT 잔여 한도와 제공자별 토큰 사용량을 확인합니다.'}],
    paragraphs: [
      '설정의 계정 아이콘이나 모델 창에서 로그아웃합니다. 선택한 제공자만 해제하고 대화는 남깁니다. 브라우저 종료 시 모든 로그인 정보가 삭제됩니다.',
      '원형 아이콘은 현재 대화가 차지하는 공간입니다. ≈는 추정치이며 누적 토큰과는 다릅니다.',
      '긴 대화는 자동으로 요약합니다. 원형 아이콘에서 요약을 확인하거나 직접 압축할 수 있습니다. 원본 대화는 남습니다.',
      '사용량에는 응답에 보고된 토큰만 집계합니다. 미집계는 0을 뜻하지 않습니다.',
    ],
  },
  {
    id: 'trouble', title: '잘 안될 때', icon: 'alertCircle',
    questions: [
      {title: '페이지를 읽지 못해요', answer: 'Chrome 확장 관리에서 사이트 접근을 허용하세요. 대상 페이지로 이동한 뒤 연결 아이콘을 눌러 다시 연결하세요.'},
      {title: '응답이 중단됐어요', answer: '답변 아래 이어가기나 재시도 아이콘을 누르세요. 채팅창을 닫아도 작업은 계속되지만, Chrome 종료나 확장 업데이트 시에는 중단될 수 있습니다.'},
      {title: '모델이 보이지 않아요', answer: 'AI Pro 모델 선택창을 열면 최신 목록을 가져옵니다. 새로고침 아이콘으로 다시 조회할 수 있습니다. 인증 오류가 표시되면 다시 연결하세요.'},
      {title: '브라우저 코드 실행이 실패해요', answer: '작업 목록을 펼쳐 원인을 확인하세요. 누비가 수정 후 결과까지 확인하면 복구됨으로 표시합니다.'},
      {title: 'FabriX 도구 응답 오류가 나요', answer: '응답 형식을 한 번 자동 교정합니다. 계속 실패하면 설정의 연결 진단을 확인하세요.'},
      {title: '디버깅 표시줄이 보여요', answer: '브라우저 조작과 캡처 도구를 쓸 때 표시될 수 있습니다. 완료 후 해제되며, 표시줄에서 취소하면 작업도 멈춥니다. 로그인에는 사용하지 않습니다.'},
      {title: '자세한 실행 기록은 어디에 있나요?', answer: '설정에서 디버그 모드를 켜세요. 진행 상황에 전체 기록과 실행 진단이 표시됩니다. 끄면 기본 진행과 결과만 표시합니다.'},
      {title: '연결 오류가 계속돼요', answer: '설정 → 연결 진단에서 진단을 복사하세요. 로그인 정보와 대화 원문은 포함되지 않습니다.'},
    ],
  },
];

export function helpMarkdown() {
  const sections = HELP_SECTIONS.map(section => [
    `## ${section.title}`, section.lead,
    section.controls?.map(item => `- **${item.label}**: ${item.description}`).join('\n'),
    section.paragraphs?.join('\n\n'),
    section.points?.map(item => `- **${item.title}**: ${item.detail}`).join('\n'),
    section.examples?.map(example => `> ${example}`).join('\n\n'),
    section.questions?.map(item => `### ${item.title}\n\n${item.answer}`).join('\n\n'),
  ].filter(Boolean).join('\n\n'));
  return `# nubi 도움말\n\n앱에서는 설정의 물음표 아이콘으로 열 수 있습니다.\n\n## 설치와 업데이트\n\n1. 설치 ZIP을 압축 해제합니다.\n2. chrome://extensions에서 개발자 모드를 켭니다.\n3. 압축해제된 확장 프로그램 로드로 manifest.json이 있는 폴더를 선택합니다.\n\n업데이트는 기존 설치 폴더의 파일을 교체하고 확장 관리에서 새로고침합니다. Chrome 125 이상을 사용하세요.\n\n${sections.join('\n\n')}\n`;
}
