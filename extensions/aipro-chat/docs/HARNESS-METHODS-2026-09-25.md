# 임무 완수를 위한 하네스 재검토

2026-09-25. 대상은 브라우저 누비다. 현재 제공자/선택 모델, 내장/외부 Wiki의 별도 문맥, 읽기 전용 하위 분석과 기존 반영 승인을 유지한다. 이번 변경은 재현된 반복/문맥 결함의 수정이다. 실모델 성공률 상승이나 Office/Desktop 품질 향상을 측정한 결과가 아니다.

## 공식 방법론 비교와 적용

| 출처 | 확인한 방법 | 누비 적용과 선택 근거 |
| --- | --- | --- |
| [OpenCode processor](https://github.com/anomalyco/opencode/blob/0f549842ee746e400b1f72516b0b2e292e267e2c/packages/opencode/src/session/processor.ts) | 최근 동일 도구/입력 반복을 감지하고 별도 판단으로 전환 | **이번 수정:** Acorn으로 정규화한 기존 호출 비교에 최근 128개 관찰 상태 재방문 검사를 추가했다. A→B→A 왕복이 같은 실패를 지우지 못한다. 처음 관찰한 변경은 진행으로 인정한다. OpenCode 소스 복사나 CLI 번들은 없다. |
| [Codex compact.rs](https://github.com/openai/codex/blob/3e9d1d29370ee7239585b9d1d576bea8263768ec/codex-rs/core/src/compact.rs) | 요약과 별도로 원래 사용자 메시지를 예산 안에서 보존 | **이번 수정:** 명시적으로 전달한 필수 조건을 마지막 2개로 자르던 처리를 제거했다. 브라우저 API는 사전 요약이 없어도 원래 요청의 별도 보존 목록을 준비한다. Codex의 잘린 메시지 방식은 복사하지 않고 기존 전체 메시지 보존 정책을 유지한다. |
| [Anthropic 장기 실행 하네스](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 기능별 완료 조건, 작은 진전, 실제 브라우저 결과 검증 | **기존 적용 재검증:** 계획/단계 결과/최종 요구사항 검토와 실행 영수증을 유지한다. 작업 목록에 재현과 검사 증거를 연결한다. 모델의 완료 선언과 실제 페이지/서버 결과를 구분한다. |
| [Anthropic 멀티에이전트 연구](https://www.anthropic.com/engineering/multi-agent-research-system) | 지휘자와 독립 연구자, 명확한 범위/출력 계약, 복잡도에 따른 노력 배분 | **기존 적용 재검증:** 같은 선택 모델의 page/research/review/recovery 역할, task/constraints/done_when, 근거 ID와 부분 결과 인계를 재사용한다. 동시 2개/대기 포함 6개를 유지한다. 탐색 범위가 독립적인 작업에 적용하며 공유 페이지 쓰기는 병렬화하지 않는다. |
| [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | 별도 문맥과 제한된 도구/권한 | **기존 적용 재검증:** 원문 전체와 주 실행 권한을 넘기지 않고 배정한 문서/근거만 읽게 한다. 큰 문서의 읽은 범위/남은 범위와 부족한 근거를 부모에게 반환한다. Claude 런타임이나 전용 모델 연결은 도입하지 않았다. |

위 방법이 Qwen에서도 같은 성능 개선을 낸다고 추정하지 않는다. OpenCode/Codex의 조회 commit은 [upstream.json](../verification/harness-methods-2026-09-25/upstream.json)에 기록했다.

## 실제 사용하는 오픈소스

| 라이브러리 | 현재 고정 버전 / 라이선스 | 이번 선택 |
| --- | --- | --- |
| [Pi Agent Core](https://github.com/earendil-works/pi) | 0.86.1 / MIT | 주 실행기와 읽기 전용 분석 루프를 재사용한다. 반복 감지와 압축 후 실제 다음 모델 요청을 이 실행기로 검증한다. |
| [p-limit](https://github.com/sindresorhus/p-limit) | 7.3.3 / MIT | 동시 분석 2개와 대기 취소 시 promise 종료를 재사용한다. 별도 큐 시스템을 추가할 근거가 없다. |
| [p-retry](https://github.com/sindresorhus/p-retry) | 8.0.1 / MIT | 일시적인 추론 전송 오류만 복구한다. 완료/미확정 브라우저 쓰기를 재전송하지 않는다. |
| [Acorn](https://github.com/acornjs/acorn) | 8.18.0 / MIT | 생성 스크립트를 실행하지 않고 토큰으로 비교한다. 주석/공백/새 요소 참조만 바꾼 재시도를 같은 호출로 식별한다. 이번 반복 상태 보완도 이 비교 결과를 사용한다. |
| DeepAgents / LangChain textsplitters | 1.13.2 / 1.0.1 / MIT | 기존 Wiki 연구와 긴 문서 분할을 유지한다. 문맥 격리/인용/남은 범위 검사를 계속 사용한다. |

새 패키지나 버전 변경은 없다. CLI 중심 OpenCode/Codex 전체 런타임 이식은 확장 단독 설치 조건과 맞지 않는다. Claude 방법론은 참고이며 오픈소스 라이브러리를 설치한 것으로 표시하지 않는다. 이미 쓰는 라이브러리 위에서 재현 가능한 결함을 수정하는 쪽이 추가 번들/인증/운영 비용 없이 현재 목적에 맞는다.

## 변경의 정확한 범위

1. 반복 상태는 실행 메모리에만 보관한다. 관찰 종류와 정규화한 값을 조합해 최근 128개 상태를 비교하고 실행 종료 시 비운다. 128개 밖의 장주기 순환이나 매번 본문이 달라지는 실패까지 검출하는 일반 목적 진행 증명은 아니다.
2. 같은 실패/결과 3회면 기존 중간 검토와 질문 경로로 전환한다. 읽기 성공이나 이전 화면 재방문만으로 실패를 초기화하지 않는다. 새 결과가 있는 정상 탐색은 계속한다.
3. 실행기에 명시적으로 전달된 필수 조건은 모두 원문으로 보존한다. 한도 안에 들어가지 않는 강제 압축은 실패하고 손실된 요약을 저장하지 않는다.
4. 대화 전체는 별도 정책이다. 원래 사용자 요청에서 **최대 2,048 추정 토큰 또는 입력 예산 8% 중 작은 값**으로 전체 메시지를 선택하고 생략 수를 표시한다. 첨부 원문/도구 결과/하위 분석을 사용자 지시로 승격하지 않는다. 무제한 과거 요구사항의 완전 보존이라고 표시하지 않는다.
5. 원래 대화 저장, 도구 호출/결과 쌍, 미확정 쓰기 영수증과 현재 승인 상태는 그대로 유지한다. 소비한 승인은 원문을 다시 보여줘도 갱신되지 않는다.

## 재현과 검증

- 수정 전: 새 회귀 5개에서 문제 재현. A/B 화면/문서 순환 3개, 필수 조건 5개 보존 1개, 사전 요약 없이 첫 실행 압축 1개.
- 추가 경계: 필수 조건이 입력 한도를 넘으면 저장 없이 압축 실패. 새 결과가 있는 탐색, 변경된 프레임/대상 구분, 미확정 쓰기 차단과 기존 멀티에이전트 전달 검사를 유지한다.
- [변경 전 로그](../verification/harness-methods-2026-09-25/before-unit.log), [API 변경 전 로그](../verification/harness-methods-2026-09-25/before-api.log), [단위 로그](../verification/harness-methods-2026-09-25/unit.log).
- Chrome fixture의 첫 실행은 기존의 단일 system 메시지 검사와 질문 전용 스키마 메시지가 충돌했다. 질문 전용 요청만 예외로 명시한 뒤 재실행한다. 실패 로그를 별도로 보존하며 제품 성공으로 합산하지 않는다.
- [최종 동일 후보 보고서](../verification/pre-release-2026-09-24T15-40-57-227Z/report.json): 단위 **737/737**, 핵심 Chrome **65/65**(19개 × 3회 + 추가 8개), 디자인/후보 빌드 통과. `quality-baseline-v2`, `fullMatrix=false`. 소스/테스트/빌드 해시 불변.
- [상세 변경 보고서](../verification/harness-methods-2026-09-25/report.json), [실제 Chrome 반복 감지](../verification/harness-methods-2026-09-25/browser.json): A/B 페이지를 6회 읽은 뒤 질문 1회로 전환하고 대기 중 추가 호출/이전 클릭 재실행 없음. 새 프로필의 3회 반복에서도 통과했다.
- 전체 의존성의 `npm audit` 알려진 취약점 0건. 새 의존성 추가/업데이트 없음.
- 합성 모델은 코드 경로를 검증하며 실제 Qwen 정확도 평가는 별도다. 실제 계정/Office/Desktop/설치/배포 검증으로 표시하지 않는다.
