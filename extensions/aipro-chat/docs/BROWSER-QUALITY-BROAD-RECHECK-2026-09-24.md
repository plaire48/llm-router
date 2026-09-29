# 브라우저 누비 확대 재검증과 OpenWiki 계획 복구

2026-09-24. 앞선 [재검증](BROWSER-QUALITY-RECHECK-2026-09-24.md)에 이어 8개 품질 영역의 18개 시나리오를 새 Chromium 프로필로 각각 3회 실행했다. 54회 모두 통과했다. 별도 오류 주입으로 OpenWiki 계획의 JSON/스키마 오류가 즉시 종료되는 문제를 재현해 수정했다.

## 실제 수정

`packages/openwiki/src/agent/wiki-question.ts`의 최초 계획은 기존에 한 번 파싱하고 종료했다. 잘못된 `{"mode":` 응답에서 모델 호출 1회 후 SyntaxError가 발생했고 형식 교정이나 문서 탐색으로 이어지지 않았다.

- 기존 Zod 검증을 유지하고 잘못된 JSON과 계획 스키마 오류에만 교정을 한 번 요청한다. 정상 계획에는 추가 호출이 없다.
- 원래 질문과 같은 위키의 문서 목록, 현재 누비 모델을 그대로 사용한다. 질문 1~6개와 각 1,000자 제한을 프롬프트에 명시하고 공백뿐인 질문도 거부한다.
- 이전 잘못된 출력은 최대 6,000자만 비신뢰 참고 데이터로 전달한다. 임의의 오류 본문이나 다른 위키의 문맥을 추가하지 않는다.
- 계획 단계에는 도구를 제공하지 않는다. 두 번째 형식 오류는 기존 `response_invalid`로 종료하고 임의의 전체 탐색으로 대체하지 않는다.
- 연결 오류와 사용자 취소는 형식 교정 대상으로 재호출하지 않는다. 취소 후 늦게 도착한 정상 계획으로 탐색을 시작하거나 결과를 완료 처리하지 않는다.

내장/외부 위키의 분리, 읽기 전용 근거, 긴 문서의 독립 연구와 누락 구간 복구는 기존 공통 실행기를 유지한다. 이번 수정은 형식 복구이며 계획의 의미적 정확도나 실제 모델의 검색 성능 향상을 수치로 입증한 것은 아니다.

## 오픈소스와 방법론 선택

| 후보와 근거 | 적용 판단 |
| --- | --- |
| [LangChain structured output](https://docs.langchain.com/oss/javascript/langchain/structured-output), 설치된 LangChain 1.5.10 / Zod 4.4.3, MIT | **기존 의존성 재사용과 방법론 적용**. 스키마 오류를 모델에 알려 교정하는 패턴을 계획 단계에 적용했다. 설치 소스 `langchain/dist/agents/nodes/AgentNode.js`의 파싱/오류 반환 처리도 확인했다. 기본 자동 출력 도구를 도입한 것은 아니다. 현재 호스트 모델의 native structured output 지원을 추정하거나 읽기 전용 도구 경계를 바꾸지 않도록 명시적인 1회 교정을 선택했다. |
| [p-limit](https://github.com/sindresorhus/p-limit), 설치 7.3.3, MIT | **기존 적용 확인 후 유지**. 취소 때 대기 작업이 영원히 남지 않도록 `rejectOnClear: true`가 이미 두 실행기에 적용되어 있다. 큐/취소 코드를 다시 작성하거나 다른 병렬 실행기를 추가할 필요가 없었다. |
| [Playwright 확장 검사](https://playwright.dev/docs/chrome-extensions), 설치 1.62.1, Apache-2.0 | **기존 검사 재사용**. persistent context와 새 프로필을 사용한다. 실패를 통과할 때까지 재시도하지 않고 첫 실패에서 중단한다. 실제 확장 서비스 워커에서 내장 위키에는 잘못된 JSON, 외부 위키에는 잘못된 스키마를 각각 주입해 복구를 검사한다. |
| [Chrome 서비스 워커 수명](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) | **공식 동작 기준 재검토**. 디버거가 수명에 영향을 주므로 기존 수명 검사는 워커 디버거 연결 없이 진행한다. UI 종료/재진입, 취소, 강제 종료 뒤 자동 재실행 금지를 확인한다. 5분 초과 실행이나 모든 실제 Chrome 종료 조건을 입증한 것은 아니다. |
| [Anthropic 에이전트 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | **방법론 참고**. 실행 횟수, 관찰 결과와 실모델 능력을 분리한다. 8개 영역의 회귀 근거를 채우되 임의의 제품 종합 점수나 사내 업무 정확도로 환산하지 않는다. |
| MiniSearch 7.2.0 / DeepAgents 1.13.2, MIT, 이전 FlexSearch 비교 | **기존 선택 유지**. 이번 재현 원인은 계획 파싱이므로 검색 엔진 교체가 해결책이 아니다. 기존 [검색 비교](WIKI-QUALITY-2026-09-24.md)와 [위임 구조](OPENWIKI-AGENT-DELEGATION.md)의 전제를 재사용한다. 신규 검색 서버, 벡터 DB, CLI 설치나 런타임 의존성을 추가하지 않는다. |

패키지 버전과 라이선스는 설치된 package.json에서 확인했다. 기존 고정 버전의 재사용이며 최신 버전으로 일괄 업그레이드했다고 표현하지 않는다.

## 검증 근거

- 수정 전 확대 검사: 단위 675개, 디자인 검사, 후보 빌드, 18개 시나리오 × 3회 = **54회 통과**. [원본 보고서](../verification/pre-release-2026-09-24T13-04-06-477Z/report.json)
- 수정 후 OpenWiki 단위 검사: **38개 통과**, 이 중 새 형식 복구/실패/취소 검사 6개. OpenWiki TypeScript 서버/클라이언트 `typecheck` 통과.
- 수정 후 최종 후보: **단위 681개**, 디자인 검사, 후보 빌드와 **브라우저 13회 통과**. browser-wiki, completion-review, review-context를 각각 3회, OpenWiki 에이전트, 폴더 위키, 서버 OpenWiki 연결과 CSP를 각각 1회 실행했다. [최종 후보 보고서](../verification/pre-release-2026-09-24T13-14-40-553Z/report.json)
- 서비스 워커의 내장/외부 위키에서 계획 교정 각각 1회, 같은 모델, 문맥 분리, 읽기 전용 도구, 긴 문서 미독 구간 0을 확인했다. 합성 모델 호출 47회는 실제 모델 품질 평가 횟수가 아니다.
- [통합 근거](../verification/browser-quality-broad-recheck-2026-09-24/report.json)에 수정 전/후 보고서와 후보 해시를 분리해 남겼다. 두 후보의 소스와 dist 트리 해시를 각각 검사했다. **54회는 수정 전 기준선이고 최종 후보는 영향 경로 13회로 검증했다.** 서로 다른 빌드의 검사를 동일 빌드의 전체 통과로 합산하지 않는다.

확대 검사는 요구사항/질문, 계획, 도구, 화면 조작, 복구, 문맥, 하위 분석, 최종 검증/승인을 포함한다. 저장소의 모든 브라우저 시나리오를 실행한 전체 매트릭스는 아니다. 실제 Qwen/AI Pro/ChatGPT 응답 품질과 사내 SSO는 미측정이다. 합성 모델 결과를 실제 계정 성공으로 표시하지 않는다. 배포/설치/업로드는 수행하지 않는다.
