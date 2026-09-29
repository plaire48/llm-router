# nubi Beta 1.0.0 — beta14

2026-09-23. 표시 버전은 Beta 1.0.0, Chrome 업데이트 번호는 1.4.17입니다.

## 변경

- 설정과 중첩 펼침, 도움말의 폰트, 크기, 색상과 모션을 사용자 HTML 기준으로 통일했습니다. 핵심 문장과 필요한 상세를 구분하고 반복 설명을 줄였습니다. 아이콘의 이름과 툴팁, 승인과 보관 안내는 유지합니다.
- OpenWiki 하위 분석에서 출처 종류가 사라지는 문제와 한 파일의 여러 근거 위치가 합쳐지는 문제를 수정했습니다. 두 번 연속 요약해도 원문을 다시 찾을 수 있는 근거를 보존합니다.
- 같은 시각 기준을 지속적으로 검사하는 `verify:identity`를 추가했습니다. 새 권한이나 실행 라이브러리, A2A 기능은 추가하지 않았습니다.

## 검증

단위 검사 **497개**, 디자인 검사와 후보 빌드, 실제 Chrome 회귀 **182회**가 모두 통과했습니다. 핵심 51개 흐름은 새 프로필로 각각 3회 반복했습니다. 로그인 콜백, 모델 전환, 입력/클릭/호버/드래그, 팝업, 실패 복구, 승인/질문, 요약/하위 분석, 첨부/캡처, OpenWiki와 UI 검사를 포함합니다. [전체 기록](verification/beta14-browser.json).

- [업데이트 검사](verification/beta14-upgrade.json): 공개 beta13 ZIP의 1.4.16에서 1.4.17로 바꾼 뒤 확장 ID, 대화, 초안, 모델, 작업 위치를 유지하고 이력 선택과 새로고침을 확인했습니다.
- [별도 체크아웃 빌드](verification/beta14-build-comparison.json): 의존성을 새로 설치해 빌드한 559개 파일이 검사한 빌드와 모두 일치합니다.
- [ZIP 검사](verification/beta14-package.json): 압축 무결성과 검사한 파일의 일치, manifest, 새 권한 없음, 불필요한 파일 제외를 확인했습니다. 통과한 후보 ZIP을 재빌드하지 않고 그대로 배포합니다.
- [의존성 감사](verification/beta14-audit.json): 보고된 취약점 0개입니다.

ZIP SHA-256: `2f6b970114a63d61d3856bcc25ff8f078be6e5bb862cd0a4a4afb36fc4f1163a`

## 확인 범위

Chrome 실행과 합성 사이트/제공자 응답을 검증했습니다. 인증값이 없어 실제 Qwen 3.8 27B 평가와 회사망 SSO/API, 실제 JSM/MCP 서버의 업무 완료율은 확인하지 못했습니다. [실모델 평가 상태](verification/beta14-live-model.json). Windows Chrome/Edge와 OS 폴더 선택 화면도 별도 확인 대상입니다.

브라우저 종료나 worker 강제 종료 시에는 체크포인트에서 일시 중지하며 재관찰 후 이어갑니다. 임의 사이트의 모든 팝업과 닫힌 shadow root/canvas 조작을 보장하지 않습니다. 실제 OS 마우스 이동과 Python/Node 실행은 포함하지 않습니다.

## 설치

[설치 ZIP](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.14/nubi-beta-1.0.0.zip)을 압축 해제한 뒤 `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램 로드**로 폴더를 선택합니다. 기존 사용자는 기존 설치 폴더의 파일을 교체하고 새로고침하세요. 웹 스토어 배포본은 아닙니다.
