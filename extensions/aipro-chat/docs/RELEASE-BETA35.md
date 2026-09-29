# nubi Beta 1.0.0 — beta35

Chrome 업데이트 번호 **1.4.38**. 기존 `beta34`는 보존하고 이번 변경을 새 ZIP으로 배포한다.

## 변경

- 누비의 답변은 길이에 관계없이 말풍선 없는 본문으로 읽는다. 사용자 메시지는 기존의 옅은 파란색을 유지한다.
- 빈 대화는 캐릭터, 청록 제목과 입력창을 가운데 묶는다. 대화를 시작하면 입력창이 아래로 이동한다. 낮은 창에서는 캐릭터가 잘리지 않도록 크기를 조절한다.
- 입력창의 보조 아이콘에서 불필요한 버튼 테두리를 줄이고, 설정 아이콘과 이력/삭제 아이콘의 의미를 통일한다. 설정 목록은 얇은 구분선으로 정리한다.
- 기준 HTML의 배경 그라데이션과 공통 Nubi/CX 색상 토큰은 유지한다. 새 UI 라이브러리나 추가 필수 권한은 없다.
- 스크립트가 입력할 수 없는 버튼에 `fill`을 요청하면, 실제 쓰기가 없는 오류를 미확정 쓰기로 기록하지 않는다. 원래 작업의 다음 정상 입력으로 복구할 수 있다.

## 설치와 업데이트

ZIP을 풀고 `chrome://extensions`에서 개발자 모드의 **압축해제된 확장 프로그램 로드**를 선택한다. 기존 사용자는 **같은 설치 폴더**의 파일을 교체하고 확장을 새로고침한다. 폴더를 바꾸면 확장 ID와 저장된 대화가 달라질 수 있다. 웹 스토어 배포본은 아니다.

## 검증 범위

전체 브라우저 게이트 **232/232단계 통과**(반복 회귀 3회, 포커스 복원 3회 포함). Chrome에서 합성 사이트와 제어된 모델 응답으로 화면·기능을 검사했다. 전면 Chrome에서 생성한 새 탭·팝업의 탭 포커스 복원을 확인하며, 다른 앱이 전면에 있을 때 그 앱의 OS 포커스까지 복원했다고 주장하지 않는다. 공개 `beta34` ZIP에서 업데이트할 때 같은 설치 폴더의 확장 ID, 대화, 초안, 모델 선택 보존을 확인했다. 후보 ZIP의 700개 파일은 검증한 빌드와 동일하다. SHA-256: `c6b3f842e7af29f97e760e8157ce45dfea11b0ebf2489784b07b5c62adae158b`. 실제 회사 계정, Qwen 업무 정확도, Windows Chrome/Edge와 실서비스 저장 결과는 이 검증으로 입증되지 않는다.

공개 사이트 50개 과제의 시작 화면을 실제 누비 도구로 확인했다. YouTube 검색 5개는 읽혔고 Google 검색은 자동화 확인 화면에서 멈췄다. 별도로 네이버의 고난도 읽기 전용 과제 50개를 10개 영역에 정의했다. 네이버 시작 검색 10곳은 모두 실제 Chrome과 누비 `read_page`에서 열렸으며, 그중 5곳은 일부 제어 요소가 잘려 `partialFrames`에 기록됐다. 두 조사 모두 **실모델의 과제 완수 점수가 아니다**. 자세한 목표와 판정 근거는 `docs/NAVER-50-EVALUATION.md`, 실제 결과는 `verification/naver-sites-2026-09-25T15-03-23-333Z/report.json`에 있다.

## 파일

- [설치 ZIP](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.35/nubi-beta-1.0.0.zip) · [SHA256SUMS](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.35/SHA256SUMS)
- [전체 브라우저 검증](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.35/verification.json) · [업데이트 보존 검사](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.35/upgrade.json)
- [네이버 50개 과제](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.35/naver-50-tasks.md) · [실사이트 조사](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.35/naver-50-report.json) · [실제 화면 캡처](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.35/naver-page-capture.png)
