# PC 시간 문맥

## 동작

현재 날짜는 PC의 로컬 날짜다. 모델 요청마다 `Date`와 브라우저 내장 `Intl.DateTimeFormat().resolvedOptions().timeZone`으로 로컬 ISO 시각, UTC offset, 요일, IANA 시간대와 UTC 기준 시각을 다시 읽는다. 지역을 언어나 IP로 추측하지 않는다. 새벽의 UTC 날짜와 한국 날짜, 30/45분 오프셋, 서머타임을 구분한다. 시간대를 읽을 수 없으면 로컬 오프셋은 유지하고 이름은 미확인으로 표시한다.

공유 추론 경계에서 기존 첫 system 메시지의 짧은 호스트 블록을 교체한다. Qwen의 단일 system 계약을 유지하며 원본 대화/첨부/도구 결과에는 시각을 덧붙이지 않는다. 최초 preamble에도 포함해 입력 예산에 반영한다. 주 에이전트, 독립 분석, 계획, 요약, 검토와 모델 재시도가 같은 경계를 쓴다. 대기열에서 다음 작업을 시작해도 새 시각을 읽는다.

“오늘/지금”은 최신 PC 시각을 기준으로 하되 사용자가 정한 시간대를 우선한다. 명시하거나 이미 확정한 작업 날짜는 자정이 지나도 자동 변경하지 않는다. 오래된 상대 날짜가 모호하면 질문한다. 사이트 자체 시각과 PC 시각을 구별하며 예약 실행이나 승인 기능으로 해석하지 않는다. PC의 잘못된 시계 설정을 외부 서버로 교정하는 기능은 아니다.

## 방법 선택

[Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)의 추론 시점에 필요한 작은 문맥을 구성하는 원칙을 적용했다. [OpenCode V2 session 명세](https://github.com/anomalyco/opencode/blob/dev/specs/v2/session.md)의 host-local date 및 안전한 provider 경계 갱신도 참고했다. 이 명세의 전체 런타임이나 이벤트 저장 방식을 도입한 것은 아니다.

[MDN Intl 문서](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/resolvedOptions)에 따라 PC 기본 시간대를 읽는다. 날짜 계산 라이브러리나 외부 시간 MCP는 추가하지 않았다. 표시와 갱신에는 브라우저 표준 API가 충분하며 권한이나 네트워크 요청도 추가되지 않는다.

## 검증 범위

`tests/computer-time.test.mjs`는 한국 자정, 네팔 오프셋, 뉴욕 DST 전환, 시간대 이름 실패, 중복/원본 불변, 도구 실행 뒤 실제 요청 갱신을 검사한다. `analysis-api`와 `goal-review`는 담당별 및 ChatGPT 요청 전달을 확인한다. Chrome 대기열 회귀에서는 실제 worker 요청의 시각 신선도와 단일 system을 검사한다. 합성 제공자 검증이며 실계정의 날짜 해석 정확도 평가는 별도다.

## Beta 18 최종 검증

`1.0.0-beta.18` / manifest `1.4.21`: 단위 테스트 516개와 동일 빌드의 Chrome suite 25회 통과. 큐/문맥은 새 프로필에서 3회 반복했고 ChatGPT/FabriX 어댑터 및 CX 17개 suite를 포함한다. 키보드 정렬 검사는 저장 후 버튼이 다시 활성화되고 drag 측정 프레임이 준비된 뒤 입력하도록 대기 조건을 보완했다.

검증 ZIP: `verification/clock-queue/nubi-beta-1.0.0.zip`. 무결성과 dist 바이트 일치 확인. SHA-256 `cccbd8feb213ddab521023c4898c7c0c59fbe136ea924e017b7ca8064d1b38cf`. 상세 결과는 `verification/clock-queue/verification.json`. 합성 모델 응답을 사용했고 실계정 검증이나 GitHub 업로드는 실행하지 않았다.
