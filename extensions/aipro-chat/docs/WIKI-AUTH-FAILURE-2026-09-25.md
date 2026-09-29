# Wiki 위임 중 인증 오류의 전파

2026-09-25 KST. 브라우저 누비 NQ-03a/03b 추가 검토. 내장/외부 Wiki의 독립 문맥, 동일 선택 모델, 읽기 전용 하위 실행은 유지한다.

## 재현과 변경

- 여러 문서를 연구하다 모델이 HTTP 401/403 또는 표준 스트림 인증 오류를 반환하면 OpenWiki 코어의 일반 실패 보존 경로가 이를 partial/blocked 보고서로 바꿨다. 이후 남은 연구와 합성 요청이 계속 발생했다.
- 누비의 Wiki 어댑터에 **호출별 AbortController**를 두고 부모 취소와 결합했다. 인증 오류는 해당 Wiki의 대기/진행 중 모델 호출을 함께 중단한다. 이미 전송한 요청을 취소 전 상태로 되돌릴 수 있다는 뜻은 아니다. 새 연구/합성 요청을 막고 진행 중 요청에는 취소 신호를 전달한다.
- HTTP 401/403 외에 기존 전송기가 정규화한 `unauthorized`, `forbidden`, `no_credential`, `expired_token`을 처리한다. 스트림 오류에 가짜 HTTP 상태를 붙이지 않는다. 프레임워크나 다른 하위 작업의 취소 오류가 최초 인증 오류를 덮지 않도록 원래 코드를 유지한다.
- 상위 Pi 실행도 인증 오류를 일반 도구 피드백으로 바꿔 추가 추론하지 않도록 중단한다. 기존 로그인/권한 안내 경로로 오류를 전달한다. 인증 오류를 성공/일반 자료 부재로 표시하지 않는다.
- 비교 평가기는 위임 내부 오류와 HTTP 상태 없는 스트림 인증 오류도 실패 trial로 보존한 뒤 나머지 조건/반복을 중지한다.
- 다른 Wiki 호출이나 부모 AbortController 자체는 취소하지 않는다. 이후 새로운 호출은 새 실행 상태를 사용한다. 일반 네트워크/형식/부분 읽기 실패의 기존 복구와 근거 보존은 유지한다. 인증 오류 뒤 연구 자동 재개나 브라우저 종료 후 복원은 이번 변경이 아니다.

## 방법론과 오픈소스 판단

| 후보/근거 | 선택과 실제 적용 |
| --- | --- |
| [DeepAgents 하위 문맥](https://docs.langchain.com/oss/javascript/deepagents/subagents), 기존 MIT DeepAgents 1.13.2/LangChain | 독립 문맥과 최소 읽기 도구는 유지. 코어의 부분 실패 보존 계약을 전체 교체하지 않고 브라우저 어댑터에서 공유 인증 오류만 구분했다. 공식 문서는 설치 버전보다 최신 API를 포함하므로 실제 설치 코드/동작을 기준으로 검증했다. |
| [p-retry](https://github.com/sindresorhus/p-retry), 기존 MIT 8.0.1 | 설치 소스의 `signal.throwIfAborted`, 대기 중 취소와 원래 reason 전달을 확인했다. 기존 호스트의 일시적 전송 복구를 재사용하고, 위임 계층에 별도 재시도를 추가하지 않았다. 인증 실패 재시도 중첩은 새로운 인증을 만들지 못한다. |
| [AbortSignal.any/reason](https://nodejs.org/api/globals.html#static-method-abortsignalanysignals) | 부모 취소와 Wiki별 인증 중단을 결합하는 표준 API를 실제 사용했다. Node 검사뿐 아니라 Chrome MV3 worker의 동일 실행 경로도 검사한다. 새 큐/취소 라이브러리와 외부 런타임은 추가하지 않았다. |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 하위 문맥 격리와 원래 근거 보존 원칙 참고. 인증 중단을 새로운 답변 합성이나 요약 성공으로 해석하지 않는다. 공개 성능 수치를 누비의 검증 결과로 가져오지 않는다. |
| MiniSearch/FlexSearch/벡터 검색 | 이번 재현 원인은 검색 순위가 아닌 실패 전파다. 기존 MiniSearch/MDAST 검색을 유지한다. 검색 엔진 업그레이드가 인증 오류를 해결한다고 판단하지 않는다. |

새 production 의존성, 인증 저장소, 외부 서버, Office/Desktop 변경은 없다. npm audit은 알려진 취약점 데이터베이스 기준이며 전체 보안 보증이 아니다.

## 검증 범위

- 수정 전 8개 단위 실패와 상위 Pi의 추가 호출 재현 1개를 보존했다. 수정 후 단위 검사는 HTTP/스트림 인증 오류, 진행 중 동료 취소, 별도 Wiki/부모 실행 격리, 새 호출 정상 동작, 합성 중 인증 오류, 평가 중단과 기존 긴 문서/원문 인용 회귀를 확인한다.
- 실제 Chrome worker는 내장 401 및 외부 스트림 forbidden 각각에서 첫 상위 호출 1회, 이미 시작된 연구자 2개, 스냅샷 조회 1회와 동료 취소를 검사했다. 이후 정상 내장/외부 Wiki 실행으로 같은 모델 연결, 검색/합성 재조회, 긴 문서 미열람 보완을 확인한다.
- 모델 응답/인증 실패는 합성 데이터다. 실제 Qwen의 정확도나 실제 계정 만료/재로그인 성공을 측정한 것은 아니다. 상세 결과/후보 해시는 `verification/wiki-auth-2026-09-25/` 및 [품질 목록](BROWSER-QUALITY-BACKLOG.md)에 기록한다.
