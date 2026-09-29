# Beta 13 이후 품질 점검

## 수정한 문제

1. `analysis-agents.js`가 OpenWiki/소스 결과의 provenance에서 `kind`를 제거했다. 주 에이전트가 `read_analysis_evidence`로 받아도 압축기의 wiki/source 검사에서 제외되어 정확한 출처가 모델 요약에만 의존했다. 이미 존재하는 wiki/source 종류만 전달하도록 수정했다.
2. `context-evidence.js`가 저장소 출처를 종류와 경로로만 중복 제거했다. 한 파일의 서로 다른 줄 범위와 버전을 읽으면 마지막 위치만 남았다. 종류, 경로, 해시, 시작/끝 줄이 모두 같은 조회만 중복 제거하도록 수정했다. 최근 12개 제한과 생략 개수는 유지한다.

본문이나 스크립트를 추가 보관하지 않는다. 과거 해시는 현재 파일 상태를 보증하지 않는다. 재조회는 기존 OpenWiki/소스 도구가 권한과 현재 내용을 확인하고, 변경된 해시는 이전 근거와 구분해야 한다. 문서 근거가 화면 동작의 성공이나 승인으로 취급되는 것은 아니다.

## 재현과 검사

수정 전 새 회귀 검사 2개가 실패했다. 같은 파일의 출처 3개가 1개로 줄었고, 연구 담당의 근거에서 `kind: wiki`가 빠졌다. 수정 후 하위 분석과 컨텍스트 관련 검사 39개가 통과했다.

추가 회귀는 실제 Pi 실행에 합성 모델 응답을 넣어 연구 담당의 wiki_read → 근거 전달 → 주 에이전트 읽기 → 연속 두 번의 압축을 확인한다. 요약의 references를 일부러 비워도 원래 출처가 남는지 검사한다. 실제 사내 OpenWiki 서버의 응답이나 Qwen의 자율 판단을 측정한 검사는 아니다.

전체 단위 검사 **497개**, 디자인 검사와 후보 빌드가 통과했다. 실제 Chrome 검사 **30회**가 통과했다. 변경 영향이 있는 9개 흐름은 새 프로필로 각 3회, OpenWiki 3개 흐름은 각 1회 검사했다. 전체 브라우저 매트릭스를 다시 실행한 것은 아니다. npm audit의 보고된 취약점은 0개다. [검증 요약](verification/beta14-prior-quality-summary.json), [브라우저 기록](verification/beta14-prior-quality.json). 기존 공개 Beta 13 ZIP을 검증 후보로 덮어쓰지 않는다. 이 점검은 새 릴리스를 발행하지 않으며 수정 코드는 다음 배포에 포함한다.

## 방법론과 라이브러리 판단

- [Anthropic 컨텍스트 엔지니어링](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): 필요한 원문을 재조회할 수 있는 작은 참조를 유지한다. 출처의 종류/해시/범위를 요약과 독립적으로 보존하는 기준으로 적용했다.
- [Anthropic 멀티 에이전트 사례](https://www.anthropic.com/engineering/multi-agent-research-system): 역할별 근거 전달을 평가한다. 이번에는 하위 분석의 성공만 보지 않고 주 에이전트의 두 번째 압축까지 이어지는 경로를 검사했다.
- [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/): 실패 원인을 재현 가능한 검사로 바꾸고 에이전트가 필요로 하는 근거를 읽을 수 있게 한다. 이 원칙을 출처 전달 회귀에 적용했다.
- [Pi 0.86.1](https://github.com/earendil-works/pi/tree/v0.86.1), MIT를 실제 실행 테스트에 사용한다. [MiniSearch](https://github.com/lucaong/minisearch), MIT의 기존 검색을 유지한다. 두 결함은 실행 라이브러리 부족이 아닌 누비의 자료 전달 문제이므로 새 프레임워크/의존성을 추가하지 않았다.

## 아직 확인하지 못한 품질

- 실제 Qwen 3.8 27B의 과제 분해와 도구 선택 정확도, 총 토큰/지연 비교.
- 회사망 SSO/API와 실제 JSM/MCP/OpenWiki 서버를 연결한 업무 완료율.
- Windows Chrome/Edge에서 팝업 전면 복원과 OS 폴더 선택 흐름.

이 항목은 합성 응답을 쓰는 Chrome 회귀로 통과 처리하지 않는다.

후속 배포: 이 점검의 수정은 전체 회귀를 통과한 [beta14](RELEASE-BETA14.md)에 포함했습니다.
