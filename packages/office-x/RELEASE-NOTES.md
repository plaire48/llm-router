누비 Agent Office 0.6.0 Beta입니다. GenOffice의 검색·이미지·발표자료 엔진·PDF 변환을 연결하고, 새 문서 창과 오류 결과 처리를 수정했습니다.

## 달라진 점

- 웹 검색과 출처 열기, 이미지 검색·생성·수정·미디어 분석을 원본 GenOffice 서비스로 연결했습니다. **검색과 이미지 설정**에서 서비스를 선택합니다. 채팅용 Claude 로그인과 이미지 서비스 인증은 별개입니다.
- PowerPoint: 원본 `generate_deck`, `regenerate_slide`, PPTX 파서·작성 엔진·작업 레지스트리·품질 검사를 연결했습니다. 실제 슬라이드 재조회와 PNG 렌더링을 수행합니다. 현재 발표자료에 적용하거나 새 파일에 작성할 수 있습니다.
- Word와 Excel: 실제 Office PDF 내보내기와 페이지 이미지 렌더링을 연결했습니다. 원본 PDF 엔진으로 PDF를 DOCX·PPTX·XLSX로 변환합니다. Markdown·HTML을 현재 Word 본문에 가져오거나 새 문서로 엽니다.
- 변경 전에 전체 문서 스냅샷을 Windows DPAPI로 암호화합니다. **복원**은 선택한 스냅샷을 새 창에 열고 내용을 재조회하며, 현재 문서는 유지합니다. 복원 목록은 현재 작업창 세션에 한정됩니다.
- 생성 위치가 애매하면 **현재 문서 / 새 문서**를 먼저 선택합니다. 새 문서를 활성화하고 그 창의 Agent에 진행 상황·승인·결과를 이어 표시합니다. 창 표시가 늦어도 완료 결과를 다시 전달합니다.
- 문서 생성이 검증된 뒤 Claude 후속 응답이 실패하면 두 결과를 구분합니다. 일부 형식 오류는 문서 도구를 호출하지 않는 텍스트 응답으로 한 번 마무리하며, 생성·수정은 반복하지 않습니다.
- Office 호출의 InvariantCulture 사용을 수정했습니다. `TYPE_E_INVDATAREAD / 0x80028018` 호출 전 실패와 `0x800A03EC` 적용 여부 미확인을 구분합니다. 값이 입력됐다는 증거가 없으면 입력 완료로 표시하지 않습니다. 실패한 요청의 쓰기는 중지하고, 새 요청에서 실제 문서를 다시 읽습니다.
- 누비 Workspace의 폰트·색상·Claude 모델 선택·대화·승인 흐름을 Excel·Word·PowerPoint에서 공유합니다.

## 설치

Office 앱을 닫고 `Nubi-Office-X-0.6.0-Setup.exe`를 실행하세요. 기존 Office X 설치를 업데이트합니다. 각 앱의 **누비 Agent → 누비 Agent 열기**를 사용하세요. 이전 `누비 / Nubi` 메뉴는 별도 추가 기능입니다.

Node와 PDF 처리 엔진을 포함한 압축 단일 EXE입니다. Windows 10 이상, Office 2016, 관리자 권한이 필요합니다. WebView2가 없으면 인터넷으로 설치합니다. Beta EXE는 배포용 코드 서명이 없으며 VSTO manifest는 미리보기 서명입니다.

## 검증 범위

GenOffice 원본 842개 파일과 누비 원본 88개 파일의 해시를 확인했습니다. 네이티브 계약 테스트 68개, Agent·UI 단위 테스트 62개, GenOffice 원본 Agent·Provider·PPTX·PDF·pipeline 테스트 2,829개가 통과했습니다. 원본 엔진으로 실제 PPTX 생성과 PDF의 DOCX·PPTX·XLSX 변환을 검사했습니다. 원본 PPTX 코퍼스 검사 1개는 준비된 코퍼스가 없어 제외했습니다. 모의 호스트에서 기존 채팅 14개, 문단 변경 2개, 생성·수정 6개, 새 오류·대상·복원·설정 흐름 8개를 확인했습니다. 세 앱의 화면 스타일은 12개 조건에서 77개 속성이 일치합니다.

Windows 빌드·설치 결과는 첨부 `installer-build.json`, `install-smoke.json`에 기록합니다. **실제 Office 2016 COM 실행, 실제 Claude 계정, 창 전환과 모든 문서 서식의 보존은 이 빌드 환경에서 검증하지 못했습니다.** 설치 폴더의 `Test-OfficeRuntime.ps1`은 Office가 설치된 PC에서 새 임시 문서의 입력·렌더링·전체 스냅샷 복원을 검사합니다.

전체 GenOffice Electron 편집기, Genspark 계정·클라우드 기능, Workspace A2A는 이번 추가 기능에 포함하지 않습니다. 원본 엔진과 Office 실행 경로의 대응 및 제한은 `docs/genoffice-capabilities.md`에 명시했습니다.
