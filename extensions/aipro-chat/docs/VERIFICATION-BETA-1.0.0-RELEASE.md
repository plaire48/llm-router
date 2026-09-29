# nubi Beta 1.0.0 배포 검증

2026-09-22. 표시 버전은 **Beta 1.0.0**, Chrome 업데이트 번호는 **1.4.3**이다. 현재 구현한 기능을 검사하며, 미지원 기능과 실계정 검증은 구분한다.

## 결과

**자동 회귀 검사와 기존 설치본 업데이트 검사가 모두 통과했다.** 검사한 후보 ZIP을 그대로 배포 파일로 승격했다.

| 검사 | 확인한 범위 |
| --- | --- |
| 단위 검사 | 285개 통과 |
| CX 디자인과 빌드 | 통과 |
| 전체 Chrome 회귀 | 43개 스위트, 총 71회 통과. 핵심 14개는 새 프로필로 각각 3회 |
| OpenWiki | 빌드와 연결 서버/정적 출력/CLI 관련 34개 테스트 통과 |
| 이전 배포본 업데이트 | 1.0.2 → 1.4.3 교체 후 같은 확장 ID, 대화/초안/이력/설정 유지 |
| 새 환경 설치와 빌드 | 별도 체크아웃에서 npm ci 후 빌드, 실제 파일 415개가 검사 후보와 바이트 단위로 일치 |
| 운영 의존성 점검 | npm audit --omit=dev에서 보고된 취약점 0개 |

업데이트 검사는 GitHub의 기존 1.0.2 ZIP을 실제 Chrome에 설치하고 합성 대화/초안을 저장한 뒤 같은 경로의 파일을 교체했다. Chrome 재시작, 이력 선택과 새로고침을 확인했다. 브라우저 종료 시 인증 세션이 지워지고 대화는 유지되는 기존 정책도 확인했다. 실제 계정의 로그인 지속성을 검사한 결과는 아니다.

[작은 창](images/beta-1.0.0-release/settings-320.png)과 [큰 창](images/beta-1.0.0-release/settings-1100.png)의 설정 화면을 직접 확인했다. 계정은 `…` 안에 두고, 상단의 이력/새 대화/창 확대/사용량을 유지한다.

## 기능별 검사

| 영역 | 확인한 흐름 |
| --- | --- |
| 인증과 제공자 | AI Pro CLI 콜백/교환, ChatGPT 콜백, FabriX 연결/모델 변환, 취소/늦은 응답 거부, 로그인 디버거 미사용, 전환/로그아웃 |
| 채팅과 상태 | 스트리밍, 사이드 패널, 여러 창의 실행 소유권, 대화/이력/초안 보관, 새로고침과 선택 재개 |
| 브라우저 작업 | 페이지 자동 연결, DOM 입력/클릭/검증, iframe/shadow DOM, 별도 창/새 탭, 지연/가림/재렌더/중복 대상, 사전 검사와 부분 실행 후 복구 |
| 질문과 승인 | 객관식/서술형 답변, 질문 초안 복원, HITL 수정 후 새 승인, 오래된 승인 거부 |
| 모델과 사용량 | 모델 선택, FabriX 도구 형식 복구, API usage 집계, ChatGPT 잔여 한도 UI/캐시/오류, 컨텍스트 압축 |
| 첨부와 이미지 | 이미지/텍스트/PDF/Word 첨부와 붙여넣기, 미리보기/다운로드, 코드 강조, 브라우저 캡처와 페이지 이미지 선택 |
| OpenWiki | 실제 로컬 서버와 임시 프로젝트 검색/소스 읽기, 폴더 연결/재시작 복원, 조회 내용을 브라우저 초안에 활용 |
| CX | 모달 서체/크기, 아이콘 이름, 키보드/초점, 상단 토스트, 캐릭터 모션과 모션 감소 |

실제 Chrome 확장을 사용했으며 API/모델/인증 응답은 합성 fixture다. 일부 도구 검사는 격리된 테스트 복사본에 사이트 권한과 검사 훅을 추가한다. OpenWiki 폴더 복원은 실제 IndexedDB와 디렉토리 핸들을 사용하지만 디렉토리 fixture는 OPFS다. OS 디스크 권한, 실제 모델의 판단이나 실제 계정 성공을 대신하지 않는다.

## 남은 제한

- **브라우저 기본 확인창:** JavaScript `confirm()`은 현재 자동 취소된다. DOM 모달과 새 탭 지원과는 다르며, 확인창 처리 도구는 아직 없다. [재현 기록](evidence/beta-1.0.0-full/native-dialog-audit.json).
- **창 종료 후 실행:** 대화/체크포인트 복원과 사용자가 선택하는 이어가기를 제공한다. 창이 닫혀도 에이전트가 계속 실행되는 기능은 없다.
- **추가 실행 환경:** 외부 MCP, Python/Node 실행형 스킬, PC 파일 작성/라이브러리 설치/빌드, 사이트 파일 업로드/드래그앤드롭은 미구현이다. 현재 스킬은 지침과 허용된 브라우저 동작을 사용한다.
- **디버깅 표시줄:** 로그인과 DOM 관찰에서는 디버거를 사용하지 않는다. 일반 Playwright 조작/캡처에서는 Chrome 표시줄이 나타날 수 있다.
- **계정 한도:** AI Pro/FabriX는 응답 usage를 기록하지만 잔여 한도 API는 미확인이다.
- **실환경 확인:** 회사망 AI Pro/FabriX, ChatGPT 실계정/한도, 실제 모델의 업무 성공률, Windows/Edge, OS 파일 선택/클립보드는 별도 검증 대상이다.

전체 보완 목표는 [구현 목표](IMPLEMENTATION-GOALS.md)에 유지한다. 이번 배포는 설치 ZIP을 제공하는 GitHub Beta 릴리스이며 웹 스토어 등록이나 자동 업데이트가 아니다.

## 재현과 증거

확장 폴더에서 `npm ci`, `npm run verify:browser`를 실행한다. Playwright가 기본 Chromium을 찾지 못하면 `CHROME_BINARY`에 Chrome for Testing 실행 파일을 지정한다. OpenWiki 검사는 `packages/openwiki`의 의존성 설치와 빌드가 필요하다. 브라우저 전체 검사에는 고정된 후보 ZIP과 개별 로그가 생성된다.

- [전체 회귀 기록](evidence/beta-1.0.0-release/report.json)
- [이전 설치본 업데이트](evidence/beta-1.0.0-release/upgrade.json)
- [새 환경 빌드 대조](evidence/beta-1.0.0-release/clean-build.json)
- [운영 의존성 점검](evidence/beta-1.0.0-release/dependency-audit.json)

[설치 ZIP](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.0/nubi-beta-1.0.0.zip). 검증한 후보 ZIP을 재빌드하지 않고 복사했다. 실제 파일 415개가 검사한 dist와 일치한다.

SHA-256: `3f70ab41d796e78a354769874b80fc6e224ac1047c973bb4bf3837ebccf570c8`

[ZIP 대조](evidence/beta-1.0.0-release/archive-check.json), [추가 검사](evidence/beta-1.0.0-release/additional-checks.json), [업데이트 재현 스크립트](evidence/beta-1.0.0-release/upgrade-check.mjs). 전체 실행은 2026-09-22 11:01–11:22 KST에 수행했다. 자동 검사기의 `releaseApproved: false`는 실계정 검증이나 게시 승인을 자동 판정하지 않는다는 뜻이며 검사 결과는 `passed`다. 이번 GitHub 게시 범위는 사용자의 명시적 배포 요청을 따른다.
