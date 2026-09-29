# 웹페이지 읽기와 역할별 조사: 공개 구현 비교 및 적용 기준

2026-09-26. 대상은 **브라우저 누비가 웹페이지를 읽고 여러 출처를 조사하는 과정**이다. 코드 파일 탐색이나 OpenWiki 전용 검색의 속도와 구분한다. 이 문서는 공개 소스와 공식 자료, 현재 누비 코드, 로컬 측정에 근거한 설계 판단이다. 아래의 적용·검증 기록만 실제 변경이며, 실모델 과제 성공률은 별도로 측정한다.

## 현재 병목과 이미 있는 기능

누비는 `read_page(mode="content", query)`로 본문을 Markdown으로 읽고 해시·구간·미열람 범위를 반환한다. `browser_snapshot(query)`는 조작 대상·프레임·폼·표를 확인하는 별도 관찰이다. 본문 경로는 이미 [Mozilla Readability](https://github.com/mozilla/readability), [Turndown](https://github.com/mixmark-io/turndown), [LangChain MarkdownTextSplitter](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-textsplitters), [MiniSearch](https://lucaong.github.io/minisearch/)를 사용한다. `analysis-agents.js`는 기존 Pi Agent Core와 p-limit로 최대 6개 독립 읽기 과제를 등록하고 **2개만 동시 실행**한다. 각 하위 실행은 최대 6,000자씩 배정 근거를 다시 읽으며, 요약·인용 ID·불확실성을 주 실행기에 돌려준다. 클릭·이동·입력·승인·재귀 위임 권한은 없다. 긴 첨부/Wiki의 전 문서 조사는 별도 `ask_documents`/`ask_openwiki` 경로가 담당한다. 현재 설치 패키지에서 Pi `0.87.1`, DeepAgents `1.13.2`, MiniSearch `7.2.0`, p-limit `7.3.3`을 확인했다.

[Naver 페이지 읽기 마이크로벤치마크](../verification/naver-page-reading-2026-09-26.json)는 동일 검색 화면의 3회 중앙값에서 전체 화면 관찰 **276ms/63,501B**, 질의 중심 화면 관찰 **281ms/32,797B**, 본문 추출+질의 **40ms/6,034B**였다. 질의 중심 화면도 DOM 수집 자체는 거의 줄이지 못했으며 반환량만 줄었다. 반면 본문 경로는 빠르지만 링크 조작, 프레임, 접힌 내용, 이미지, 가상 목록을 완전히 보지 못한다. 이 수치는 페이지 내 추출과 직렬화만 재며 모델 왕복, 페이지 이동, 확장 메시징, 과제 완료를 측정하지 않는다. [Luna 실측 기록](NAVER-50-EVALUATION.md)은 실제 모델 응답이 한 과제에서 수십 차례 반복된 사례를 보여준다. **전체 지연의 주원인이 DOM이라고 이 측정만으로 단정할 수 없다.**

현재 본문 구현(`browser-content-dom.js`)은 상한 검사 뒤 문서 전체 복제, 요소별 표시 상태 검사, 필요할 때 Readability, Turndown을 수행한다. `browser-content.js`는 후속 구간·질의마다 다시 페이지 스크립트를 실행하고, 반환한 본문을 해시·분할·검색한다. 즉 같은 화면에 대한 후속 읽기에는 재추출 비용이 생길 수 있다. 다만 동적 페이지가 바뀔 수 있으므로 단순 URL 캐시로 이를 생략하면 오래된 근거를 현재 사실로 오인한다. `analysis-agents.js`의 고정 근거 재조회는 이미 이 위험을 줄이는 별도 경로다.

**하위 실행이 덜 보였던 이유도 코드에서 확인했다.** 종전에는 주 실행기에 `delegate_analysis`가 있어도 모델이 선택해야만 호출됐고, 네이버 실측에서는 0회였다. 지금은 명시적 읽기 전용 비교에서 서로 다른 URL의 실제 본문 근거를 두 개 이상 모았을 때만, 두 개의 짧은 읽기 전용 워커를 한 번 자동 시작하는 후보를 추가했다. 하위 실행은 이미 고정한 근거만 읽으며 공유 탭을 이동하지 못한다. 첫 페이지에서 다른 출처를 아직 찾지 못했거나 다음 링크가 앞선 결과에 의존하면 워커 수를 늘려도 탐색이 빨라지지 않는다. `ANALYSIS_CONCURRENCY=2`는 동시 실행 상한이며, 모든 요청에서 두 워커를 시작하지 않는다. 사용자에게 보이는 계획과 워커 진행은 실제 도구 시작/종료 이벤트에만 연결한다.

## 공개 사례와 도입 판단

| 사례와 직접 근거 | 확인한 패턴 | 누비 판단, 비용·라이선스 |
| --- | --- | --- |
| [OpenCode의 범위 읽기](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/read.ts), [도구 결과 정리](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/compaction.ts), [하위 세션](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts) | 파일을 offset/limit로 읽고 다음 범위를 명시한다. 오래된 도구 결과를 보호 구간 밖에서 줄인다. 하위 세션은 깊이·권한·취소를 따로 처리한다. | **방법론 채택**: 기존 페이지 해시/offset, 최근 근거 보존, 읽기 전용 하위 권한을 유지한다. [MIT](https://github.com/anomalyco/opencode/blob/dev/LICENSE) 소스는 참고만 한다. Node/Bun OpenCode 실행기를 MV3에 추가하면 기존 Pi와 실행·인증·설치 상태가 중복된다. |
| [Codex의 위임 도구 명세](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs), [컨텍스트 한도](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/context_window.rs), [압축](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs) | 독립적이고 경계가 명확한 일만 병렬 위임한다. 문맥 사용량과 상한을 구분하고 요약 뒤 원래 사용자 입력·출처 식별을 보존한다. | **방법론 채택**: 독립 출처만 2개 병렬, 원래 목표·근거 ID를 주 실행기에 남긴다. [Apache-2.0](https://github.com/openai/codex/blob/main/LICENSE) Rust/CLI 구현을 브라우저에 이식하지 않는다. 공개 Codex 코드로 데스크톱 앱의 비공개 동작까지 추정하지 않는다. |
| [Claude Code 하위 에이전트](https://code.claude.com/docs/en/sub-agents), [Claude Agent SDK 하위 에이전트](https://code.claude.com/docs/en/agent-sdk/subagents), [Claude Code와 Chrome](https://code.claude.com/docs/en/chrome) | 독립 문맥·좁은 도구·짧은 반환으로 대량 탐색 결과가 주 문맥을 잠식하지 않게 한다. 서로 독립적인 조사만 병렬화한다. Chrome 연계는 확장과 네이티브 메시징 호스트를 쓴다. | **문서화된 패턴만 채택**. Claude Code와 Claude in Chrome의 내부 에이전트 코드·속도 계약은 공개 확인 대상이 아니다. 배포된 확장 JavaScript를 열람할 수 있어도 오픈소스 허가를 뜻하지 않으므로 복사하지 않는다. [TypeScript Agent SDK 라이선스](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/LICENSE.md)는 일반 MIT가 아니고 사용에 Anthropic 상업 약관이 따른다. CLI/네이티브 호스트도 누비의 확장 단독 설치 조건과 맞지 않는다. |
| [Anthropic 다중 에이전트 연구](https://www.anthropic.com/engineering/multi-agent-research-system), [컨텍스트 설계](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [도구 설계](https://www.anthropic.com/engineering/writing-tools-for-agents) | 리더가 독립 질문을 나누고 워커가 서로 다른 자료를 읽은 뒤 압축해 인계한다. 필요한 원문만 적시에 재조회한다. 과다 위임·장황한 도구 결과는 비용과 오류를 키운다. 공식 사례는 복잡한 연구에서 병렬 검색이 시간을 줄였으나 토큰 비용도 크게 늘었다고 밝힌다. | **조건부 적용**: 단일 페이지·한 사실 조회에는 위임하지 않고, 2개 이상 독립 출처·긴 문서·상충 증거의 경우에만 위임한다. Anthropic 내부 성능 수치를 누비 또는 Luna의 성능으로 전용하지 않는다. |
| [OpenAI Agents SDK JS의 manager 패턴](https://openai.github.io/openai-agents-js/guides/multi-agent/), [agent-as-tool](https://openai.github.io/openai-agents-js/guides/tools/), [trace](https://openai.github.io/openai-agents-js/guides/tracing/) | 주 에이전트가 최종 답변을 소유하고 전문가를 도구로 호출한다. 독립 일은 `Promise.all` 같은 코드 흐름으로 병렬화할 수 있다. Trace는 단계·모델·도구·사용량을 구분한다. | **패턴 채택, SDK 미도입**. [MIT](https://github.com/openai/openai-agents-js/blob/main/LICENSE)이지만 Pi와 실행기·상태 관리가 겹친다. 공식 trace도 브라우저에서는 기본 비활성이라 누비의 기존 단계/사용량 기록을 개선하는 편이 작은 변경이다. 핸드오프가 사용자 대화 소유권을 넘기는 방식은 현재의 단일 HITL/브라우저 실행기와 맞지 않는다. |
| [DeepAgents JS](https://docs.langchain.com/oss/javascript/deepagents/subagents), [Mozilla Readability](https://github.com/mozilla/readability), [Turndown](https://github.com/mixmark-io/turndown) | 위임/긴 문서 조사, 주요 본문 선택, HTML→Markdown. | **기존 사용 유지**. DeepAgents는 이미 Wiki/첨부 조사에 있고 [MIT](https://github.com/langchain-ai/deepagentsjs/blob/main/LICENSE)다. Readability는 [Apache-2.0](https://github.com/mozilla/readability/blob/main/package.json), Turndown은 MIT다. 별도 RAG 엔진 추가나 Readability 재교체는 현재 반복 모델 호출의 원인을 해결한다는 근거가 없다. |

Claude Chrome 기능은 [공식 도움말](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)과 기존 [비교 기록](CLAUDE-BROWSER-COMPARISON-2026-09-25.md)의 범위에서만 비교한다. 공식 확장의 배포 JS는 라이선스가 확인된 공개 소스 저장소와 다르다. 내부 프롬프트, 병렬 조사 정책, 정확도, 실제 페이지 읽기 지연은 확인되지 않았다. Claude Code의 Chrome 연결은 네이티브 메시징 호스트가 필요하다는 [공식 문서](https://code.claude.com/docs/en/chrome)와 누비의 확장 단독 조건을 함께 적용한다.

## 적용할 실행 규칙과 순서

1. **한 번의 빠른 근거 읽기.** 읽기 전용 질문이고 현재 페이지에 본문이 있으면 짧은 질의로 `read_page(mode="content")`를 먼저 호출한다. 행동 대상, 누락된 범위, 표의 병합/가상 행, 프레임, 이미지가 필요할 때만 `browser_snapshot(query)` 또는 캡처로 넓힌다. `queryFiltered`와 `coverage.partial`은 부재의 증거가 아니다. 같은 전체 화면을 변경 없이 반복 읽지 않는다.
2. **독립 출처만 나누기.** 목표를 원래 요구사항과 출처별 질문으로 나눈다. 서로 다른 두 기사·문서·페이지, 긴 문서의 독립 구간, 상충 주장 검토처럼 결과 의존성이 낮은 경우만 2개 워커를 함께 시작한다. 한 페이지의 다음 링크가 이전 읽기의 결과에 따라 정해진다면 그 탐색은 순차다. 워커 6개를 채우는 것 자체가 목표가 아니다.
3. **고정 근거와 좁은 권한.** 워커에는 질문, 완료 조건, 제한, 출처/문서 ID·해시·읽을 범위만 전달한다. 이미 확보한 페이지 원문은 실행 메모리에서 필요한 구간만 읽는다. 워커가 공유 탭을 이동하거나 새 관찰 ref로 행동하지 않는다. 페이지가 바뀐 뒤에는 고정 근거를 역사적 자료로 표시한다. Chrome MV3 서비스 워커의 메모리는 유휴 종료로 사라질 수 있으므로 재시작 뒤 미확정 실행을 자동 이어서 썼다고 간주하지 않는다([공식 수명주기](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
4. **인계와 합성.** 각 워커가 근거 ID, 실제 읽은 구간, 결론, 반례/불확실성, 미열람 구간을 반환한다. 주 실행기는 중복 출처를 합치고 충돌을 명시한다. 필요한 인용 원문을 다시 읽고 URL·시점·단위를 확인한다. 존재하지 않거나 더는 사용할 수 없는 인용 ID는 충족으로 인정하지 않고 `unknown`/재조사로 돌린다. 완료 검토와 실제 브라우저 조작의 최종 검증은 주 실행기에 남긴다.
5. **상태에 따른 중지와 복구.** 같은 검색어·화면·도구 오류가 반복되면 새 워커 수를 늘리지 않는다. 변경된 근거가 없으면 쿼리·출처·방법을 바꾸거나 확인된 범위와 미확인을 보고한다. 다른 워커의 성공은 보존하고 실패한 분기만 보완한다. 읽기 실패를 근거 부재나 사이트 장애로 단정하지 않는다.

최우선 코드 후보는 **현재 문서의 고정 스냅샷을 한 번 추출한 뒤 그 스냅샷 안의 여러 질의를 재사용하는 경로**다. 사용 중인 `content_hash`와 문서 ID를 결합해 한 실행의 읽기 전용 조사에만 적용하고, 탭 이동·DOM 변경·권한 변경·취소 시 무효화하거나 역사적 근거로 내린다. URL만 같은 동적 페이지를 동일 스냅샷으로 취급하지 않는다. 캐시가 현재 화면을 재확인했다는 뜻은 아니므로 클릭/입력 전에는 반드시 새 관찰을 한다. **아직 구현·측정 전 후보**이며, 오염/수명주기 검증 없이는 기본 동작으로 전환하지 않는다.

## 검증 계약

같은 모델, 같은 브라우저 상태, 같은 과제에서 기존 경로와 변경 경로를 짝지어 비교한다. 단계별 `extract_ms`, 확장 메시징, 모델 대기, 호출 횟수, 도구 결과 바이트/토큰, 병렬 워커 실제 겹친 시간, 전체 경과의 p50/p95를 분리한다. 속도만 개선하고 인용 정확도·미열람 범위·모호성 질문·최종 답변을 악화시키면 채택하지 않는다. Naver 50 과제는 독립 정답/시점/출처를 마련한 뒤 실모델 trial로 채점한다. 본문 추출 3회 중앙값이나 합성 모델 Chrome 통과를 실모델 완료율로 표시하지 않는다.

회귀에는 (a) 같은 URL의 SPA 내용 변경과 캐시 무효화, (b) 탭/프레임·문서 ID 변경, (c) 지연 워커·취소·부분 실패, (d) 워커가 읽지 않은 근거의 허위 인용, (e) 두 독립 출처의 상충 결과, (f) 큰 표·접힌 영역·이미지·권한 없는 프레임에서 범위 누락 표시, (g) MV3 worker 종료 후 미확정 상태 보존을 포함한다. 읽기 전용 병렬화가 기존 승인·쓰기 영수증·새 관찰 검증 경계를 바꾸지 않는지도 확인한다.

## 이번 적용과 검증

`browser-dom.js`는 한 번의 동기 스냅샷 동안 가시성과 조상 컨텍스트 계산을 `WeakMap`으로 재사용한다. 캐시는 함수 호출 밖으로 나가지 않아 다음 관찰에서 새 DOM 상태와 ref를 다시 읽는다. 같은 네이버 페이지의 변경 전후 교차 측정 8회 중앙값은 전체 스냅샷 333→59ms, 질의 중심 스냅샷 327→52ms였다. 별도 실행한 [최적화 후 벤치마크](../verification/naver-page-reading-optimized-2026-09-26.json)는 HTTP 200 페이지에서 각각 69ms, 65ms, 본문 질의 29ms를 기록했다. 첫 벤치마크의 276ms/281ms와 직접 짝지은 시험은 교차 측정이며, 두 보고서의 수치만을 속도 배율로 계산하지 않는다. 모델·확장 메시징·페이지 이동 지연은 포함하지 않는다.

`analysis-agents.js`는 두 출처의 고정 근거를 먼저 수집한 뒤 병렬 위임하는 계약을 분명히 했고, 한 finding에 정상·실패 근거 ID가 섞인 경우 전체 인용을 거부하도록 고쳤다. `agent-runtime.js`의 자동 배정 후보는 원래 요청과 동결 근거 ID만 넘기며, 각 워커를 `quick`으로 제한한다. 새 사용자 지시·취소 때 오래된 자동 워커를 중단한다. `agent-harness.js`는 단순 탭·URL·실제 링크 이동을 새 화면 관찰로 확인하고, 입력·토글·저장 검증 부채는 보존한다. 일반 조사 프롬프트는 읽기 전용 조사에 추상적인 `verify_page` 반복을 요구하지 않고 본문 근거와 출처 범위를 우선한다. 선행 후보는 단위 871건, 선별 브라우저 8개, 새 스냅샷 경계 테스트가 통과했다([검증 보고서](../verification/pre-release-2026-09-25T17-45-43-665Z/report.json)). 후속 자동 배정·이동 분리 후보는 합성 테스트 외에 아직 실모델 완료 효과를 확인하지 못했다.

후속 후보는 [선별 검증 보고서](../verification/pre-release-2026-09-25T18-10-34-677Z/report.json)에서 단위 878건과 관련 Chrome 7개가 통과했다. [Luna 재시험 기록](../verification/naver-sso-luna-2026-09-25T18-14-08-255Z.json)은 로그인 미완료로 trial 0건이다. 따라서 자동 워커의 실제 호출과 과제 완료 시간·정답률은 현재 미측정이다.
