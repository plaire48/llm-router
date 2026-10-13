# 0.6.0 변경

검색·이미지·발표자료 엔진·PDF 변환·렌더링·전체 문서 복원을 연결했다. 현재/새 문서 선택, 새 창으로 Agent 연결, Claude 후속 응답 실패와 문서 결과 구분, COM 호출 문화권과 입력 미확인 판정을 수정했다. 원본 GenOffice 842개, 누비 88개 파일을 유지한다. 네이티브 계약 68개, 단위 테스트 62개, 원본 Agent·Provider 609개, 모의 UI 새 흐름 8개 및 기존 22개 흐름이 통과했다. 현재 범위는 [기능 대응](genoffice-capabilities.md)을 따른다. 실제 Office와 실제 모델은 미검증이다.

# 0.5.0 변경

현재 범위는 [GenOffice 기능 대응](genoffice-capabilities.md)을 따릅니다. 공통 Office 개체 실행, 새 문서 생성, 저장/PDF 도구를 추가했습니다. 선택 영역·혼합 글꼴·자동 크기 때문에 전체 편집을 거절하던 동작을 수정했습니다. 원본 99개 파일, 누비 88개 파일의 해시를 확인했습니다. Agent 관련 단위 테스트 45개, 네이티브 계약 테스트 66개와 생성/수정 UI 6개 흐름이 통과했습니다. 실제 COM과 실제 모델은 미검증입니다.

아래는 이전 버전의 기록이며 현재 기능 제한으로 해석하지 않습니다.

# Office X 0.4.0 구현 결과

확인일: 2026-10-13. 개발 호스트는 macOS arm64다. Windows 실행 완료를 의미하지 않는다.

## 구현 내용

- GenOffice agent-core·ai-provider 원본 85개 파일을 유지한다. 실제 AgentLoop·composeSkills가 실행·취소·문맥 압축·검증을 담당한다. 추가 GenOffice Skill을 연결할 확장 지점을 유지했다.
- 현재 누비 Workspace와 공통 인증·모델 목록·로그인 화면·모델 선택·입력창·스크롤·응답 시간·브랜드 토큰을 공유하는 원본 88개 파일·자산을 재사용했다. 기존 누비 저장소는 수정하지 않았다.
- AI Pro·ChatGPT·FabriX·Claude 연결, 모델 검색·변경·갱신, 추론 수준과 연결 해제를 구현했다. Claude는 누비의 공식 CLI 어댑터를 사용하며 문서 작업은 GenOffice가 처리한다.
- VSTO WinForms 컨테이너 안의 WebView2 채팅에 Markdown·표·코드, 실시간 답변, 중지, 복사, 실제 응답 시간, 새 대화, 최근 20개 대화 이력, 최신 메시지 이동을 연결했다. 대화는 현재 작업창 메모리에만 보관한다.
- 인증 정보는 Office X 전용 Windows DPAPI 저장소를 통해 복원한다. Claude 계정 인증은 CLI 소유이며 Office X에는 모델 등 메타데이터만 보관한다. 인증 정보는 채팅 UI로 전달하지 않는다.
- 요청별 문서·시트·범위 고정, 셀별 변경 승인, 원본 재검사, 동일 변경안 재실행 방지, 부분 실패 내역, 수식·계산값 재조회를 유지했다. 모델 없는 C1:E4 문서 도구 확인도 제공한다.

- Workspace의 최종 스타일 계층까지 재사용해 폰트 스택·15/16/14px 계층·배경·제공자 포인트색을 맞췄다. 로그인과 모델 선택 화면을 포함해 좁은 작업창에서 확인했다.

## 실행한 검증

| 항목 | 결과 | 증거 범위 |
| --- | --- | --- |
| TypeScript typecheck | 통과 | Office X 런타임·GenOffice 타입 |
| Office X 연결·대화 테스트 | 22/22 | 실제 AgentLoop와 모의 제공자·네이티브 |
| GenOffice agent-core 원본 테스트 | 183/183 | 원본 회귀 테스트 |
| GenOffice ai-provider 원본 테스트 | 426/426 | 원본 회귀 테스트 |
| 기존 직접 연결 stdio 통합 | 통과 | localhost 모의 SSE 모델·모의 Office |
| 누비 인증/연결 통합 | 통과 | 실제 localhost 콜백, 모의 교환·모델 조회, 취소 경합·복원·로그아웃·저장 실패 |
| 누비 인증 → GenOffice stdio | 통과 | 모의 인증 복원 후 실제 워커·도구 호출·후속 대화, 실행 중 모델 변경 거부 |
| Claude → GenOffice 통합 | 통과 | 모의 CLI 로그인·모델·추론 수준·복원·도구 제안. CLI 자체 도구와 MCP 비활성화 인자 확인 |
| 브라우저 UI | Excel 14개 흐름과 Word/PPT 각 승인 흐름 통과, pageerror 0 | 모의 WebView2 호스트. 로그인·모델 검색·IME·승인·대화 전환·Claude·자동 스크롤·320px 폭 |
| C# 공통 문서 실행기 | 49/49 | 모의 port로 충돌·계산값·취소·부분 실패·재실행 방지 |
| C# ExcelHost net472 컴파일 | 통과, 경고·오류 0 | WebView2·DPAPI 참조 포함. Windows 실행은 아님 |
| 원본 해시 검사 | GenOffice 85/85, 누비 88/88 | 복사한 원본 변경 없음 |
| 실행 엔진 구성 검사 | 통과 | GenOffice AgentLoop; 누비 runAgent와 pi-agent-core 불포함 |

서로 다른 검증 수치를 실제 모델·Office 성공률로 합산하지 않는다. `verification/*.png` 화면의 모델·문서·결과는 fixture이며 실제 계정 연결 증거가 아니다. 재현은 README의 명령과 `tests/ui.browser.js`를 따른다.

## 남은 실환경 검증

Windows VSTO 진입점 로드, WebView2 작업창, DPAPI 실제 저장·복원, Excel 2016 32/64비트 COM 읽기·적용·계산·닫힘, 실제 AI Pro/ChatGPT/FabriX/Claude 로그인과 모델 작업, NASCA 저장·재개방은 아직 검증하지 않았다. Windows 빌드와 설치 검사 결과는 릴리스의 installer-build.json 및 install-smoke.json에서 확인한다. 게시자 서명과 누비 Workspace A2A 활성화는 포함하지 않는다.

현재 문서 수정은 Excel 빈 셀의 곱셈 수식, Word 여러 문단, PowerPoint 여러 텍스트 상자의 문단 교체를 지원한다. 전체 GenOffice 편집 기능, 전체 문서 보존, 자동 저장·복구가 구현됐다는 의미는 아니다. 기능 확대는 GenOffice Skill과 VSTO 문서 어댑터를 추가하는 방식으로 진행할 수 있다.
