# 계획과 브라우저 실행 품질 재검토

검토일: 2026-09-26. 대상은 Chrome 확장 누비의 계획, 첫 행동, 결과 검증과 읽기 전용 하위 분석이다. 아래 소스 리뷰는 실행 경로의 결함 후보를 찾은 근거이며 실모델 성공률을 측정한 결과가 아니다. 구현과 회귀 결과는 별도로 연결한다.

## 수정 전 구현과 발견한 차이

검토 시작 시 실행기는 Pi 0.87.1을 사용한다. 사용자 요구를 `expected_outcome`이 있는 계획으로 만들고, 독립된 한 동작 뒤 실제 결과를 모델에게 돌려준다. 페이지 쓰기에는 `verify_page`, 계획 단계 완료에는 별도의 결과 검토, 최종 완료에는 원래 요구사항 전체 검토를 요구한다. 질문과 승인은 같은 실행을 유지하고 미확정 쓰기는 재전송하지 않는다. 계획 표시만 추가하거나 워커 숫자를 늘리는 것은 이 경로의 정확성을 높였다는 근거가 아니다. 아래는 수정 전 문제와 권고이며 현재 구현/회귀 결과는 별도 완료 기록에 따른다.

| 우선순위 | 현재 소스에서 확인한 문제 | 적용할 방법 | 경계 |
| --- | --- | --- | --- |
| P0 | `agent-runtime.js`의 `changesObservation` 처리는 다른 페이지 이동 뒤 첫 페이지의 `read_page` 본문까지 `superseded`로 만든다. 같은 탭에서 두 출처를 읽는 비교가 최종 검토 전에 첫 인용을 잃는다 | `browser-content.js`의 `page_content`를 URL, frame, `content_hash`, 읽은 `ranges`, 부분 범위를 가진 원문 스냅샷으로 보존한다. DOM/ref와 현재 상태 검사는 그대로 무효화한다 | 과거 본문은 당시 관찰한 내용의 근거다. 현재 입력, 클릭 대상, 승인, 저장 완료, 미확정 쓰기 해소의 증거가 아니다 |
| P0 | `goal-review.js`의 보호 대상은 `ask_openwiki`와 `ask_documents`뿐이다. 직접 읽은 두 웹 출처는 검토 예산 축소에서 한쪽만 빠질 수 있다 | 올바른 본문 스냅샷을 검토 예산에서도 보호하고 원문 hash/범위를 유지한다. 예산이 부족하면 명시적으로 검토 불가를 반환한다 | 모델에게 모든 출처를 봤다고 말하면서 한쪽을 조용히 제거하지 않는다. 오류/빈 범위/절단 결과는 사용 가능 근거가 아니다 |
| P1 | `analysis-agents.js`에 `recovery` 역할은 있지만 자동 위임은 비교의 `page` 역할에만 있다. 주 모델이 실패 복구 위임 도구를 직접 떠올리지 못하면 같은 실패를 반복할 수 있다 | 반복된 타깃 실패 시 실패 입력, 부분 실행 영수증, 새 관찰의 고정 근거 ID로 짧은 복구 분석 한 건을 시작한다. 실패 호출과 근거 버전으로 중복을 막는다 | 하위 분석은 변경한 접근법과 구체 검사만 제안한다. 브라우저 동작, force click, 승인 우회, 미확정 쓰기 재전송 권한을 주지 않는다 |
| P1 | 모든 브라우저 액션을 병렬 워커에 분산하면 같은 탭의 DOM/ref와 승인이 충돌한다 | 독립된 읽기와 실패 분석만 동시 2개로 처리하고 의존하는 화면 변경은 리더가 순차 실행한다. 완료 보고는 다음 판단 경계에서 자동 전달한다 | 두 워커가 실시간 화면을 함께 제어하는 방식은 채택하지 않는다. 수집 완료와 사용자 업무 완료는 다른 상태다 |

위 P0는 `contentPacket`이 이미 본문을 “reference evidence, not actionable refs or proof of browser writes”로 반환함에도 실행기가 일반 DOM 증거와 함께 폐기하는 계약 불일치다. 본문 자체의 읽기 시간이 줄어든다는 추정이 아니라, 이미 확보한 근거를 잃어 재탐색하는 경로를 제거하는 변경이다.

새 `page_content`를 보존할 때 같은 출처/프레임에서 새로운 `content_hash`를 읽으면 과거 버전을 대조해야 한다. 부분 본문은 전역 부재나 전체 조사 완료를 증명하지 않는다. 자료의 URL이 같다는 이유로 현재 DOM/ref를 재사용해서는 안 된다.

## 공식 방법론과 공개 소스 비교

| 후보 | 이번에 확인한 근거 | 라이선스와 실행 환경 | 선택 판단 |
| --- | --- | --- | --- |
| Codex | [plan handler](https://github.com/openai/codex/blob/e72da2b53805894878023d01949a25a082e0a5cb/codex-rs/core/src/tools/handlers/plan.rs)는 계획 갱신 이벤트를 실행 성공과 분리한다. 기존 [문맥 압축 리뷰](HARNESS-METHODS-2026-09-25.md)의 원 요구 보존을 재사용한다 | Apache-2.0, Rust/CLI 실행기. 확장에 직접 이식하면 별도 런타임과 인증 운영이 필요하다 | 계획과 실행 결과의 분리 패턴 참고. 전체 런타임, Codex 계정 저장소, Rust 바이너리는 도입하지 않는다 |
| OpenCode | [processor](https://github.com/anomalyco/opencode/blob/696f41bc8e7586657375d53390925fc54c25d34c/packages/opencode/src/session/processor.ts)는 동일 도구/입력 3회 반복 검사, 도구 호출 종료 처리, 추론 전송 재시도를 구분한다 | MIT, Bun/서버 실행기. 기존 누비의 브라우저 확장 단독 설치와 다르다 | 이미 적용한 상태 기반 반복 감지와 전송 재시도를 유지하고 실패 근거별 복구 위임을 보완한다. Effect/Bun 실행기 전체는 추가하지 않는다 |
| Claude Code | 공식 [subagents 문서](https://code.claude.com/docs/en/sub-agents)는 별도 문맥, 도구 제한, 특정 조사 역할과 결과 전달을 설명한다 | 공식 제품 문서. 내부 구현 코드나 재사용 라이선스가 공개된 근거로 취급하지 않는다 | 같은 선택 모델의 읽기 전용 page/research/review/recovery 역할과 간결한 인계 계약에 적용한다 |
| Claude in Chrome | 공식 [도움말](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)과 [이전 배포 JS 분석](CLAUDE-BROWSER-RECHECK-2026-09-25.md)을 재사용한다 | 제품 배포 JS는 오픈소스 저장소/라이선스 확인과 다르다 | 기능/권한/UX 참고만 한다. Claude 내부 하네스 코드를 확인하거나 복사했다고 주장하지 않는다 |
| Anthropic | [effective agents](https://www.anthropic.com/engineering/building-effective-agents)는 단순한 도구 루프부터 시작하고 독립 분해가 유효할 때 orchestrator/worker를 사용한다. [장기 실행](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)의 작은 기능 단위와 실제 결과 확인을 재사용한다 | 공식 방법론 문서. 라이브러리 설치나 실제 Qwen 성능 근거가 아니다 | 첫 계획을 관찰 가능한 결과로 작게 만들고 독립 조회만 분해한다. 모든 클릭마다 추가 모델 검토를 붙이는 확장은 비용을 먼저 측정한다 |
| Stagehand | [MV3 action utils](https://github.com/browserbase/stagehand/blob/c82febccf7d2255c4f3e1e9c3b41595ce33ab13e/packages/extension/handlers/handlerUtils/actHandlerUtils.ts#L442)는 전체 남은 기한 안에서 DOM/네트워크 정리 대기를 수행하고 이벤트 리스너를 제거한다 | MIT, TypeScript. 관찰/행동 패턴은 적합하나 전체 SDK 교체는 제공자/권한/브라우저 연결 계약을 다시 검증해야 한다 | 기존 Playwright CRX 경로에서 기한과 관찰/행동 분리를 유지한다. 단순 network quiet를 업무 저장 완료로 승격하지 않는다 |
| Nanobrowser | [executor](https://github.com/nanobrowser/nanobrowser/blob/24a14b76e14a9c30fd84878ca7985049d1e7d064/chrome-extension/src/background/agent/executor.ts)는 Planner/Navigator와 선택적 extractor를 분리한다. 2026-09-26 확인한 master SHA는 이전 리뷰와 동일하다 | Apache-2.0, Chrome 확장/TypeScript로 배포 형태는 가장 가깝다 | 기존 Pi의 계획/실행/최종 검토 분리를 유지한다. 전체 앱 교체보다 재현된 근거 폐기와 복구 위임을 수정한다 |

최신 조회 SHA는 위 permalink에 고정했다. 최신이라는 말은 2026-09-26 조회 시점의 브랜치 HEAD이며 배포된 제품의 버전이나 누비가 해당 프로젝트 전체를 채택한 의미가 아니다. GitHub API 조회는 시스템 신뢰를 사용하는 curl로 수행했으며 TLS 검증을 비활성화하지 않았다.

## 실제 활용할 기존 라이브러리

| 현재 의존성 | 고정 버전/라이선스 | 이번 활용과 비용 |
| --- | --- | --- |
| Pi Agent Core / Pi AI | 0.87.1 / MIT | 기존 도구 이벤트, 후속 모델 판단과 하위 에이전트 실행을 재사용. 외부 설치 없음 |
| p-limit | 7.3.3 / MIT | 읽기 전용 분석 동시 2개, 전체 대기/미수집 한도 6개를 유지. 공유 페이지 쓰기 병렬화 없음 |
| p-retry | 8.0.1 / MIT | 추론 전송 복구만 사용. 완료/미확정 브라우저 동작을 재전송하지 않음 |
| Readability | 0.6.0 / Apache-2.0 | 현재 DOM 복제에서 본문 추출. 이미 포함되어 새 의존 비용 없음 |
| Turndown / LangChain textsplitters | 7.2.4 / 1.0.1 / MIT | 기존 Markdown 본문과 범위/해시 분할을 재사용. 입력칸/숨김/이미지 영역을 전체 본문으로 추정하지 않음 |

패키지를 추가해야 해결되는 결함은 확인되지 않았다. 기존 검증된 라이브러리 위에서 본문 스냅샷의 생명주기와 실제 복구 역할의 시작 조건을 수정하는 방식이 확장 단독 설치, 제공자 선택, HITL 계약을 유지한다. 복구 하위 분석은 추가 모델 호출 비용이 있으므로 반복된 같은 실패에 한정하고 실제 호출 수와 시간을 기록한다.

## 재현 및 완료 기준

1. 같은 작업 탭에서 출처 A 본문을 읽고 B로 이동해 읽는다. 최종 정보 검토에 A/B의 원래 URL/hash/ranges가 모두 남아야 한다. 첫 출처를 다시 열지 않아도 원문 인용을 검토할 수 있어야 한다.
2. A의 DOM/ref/입력값/현재 검증 결과는 B 이동 뒤 사용 불가여야 한다. A의 본문으로 B의 입력 완료나 미확정 쓰기를 해소하려는 경로는 실패해야 한다.
3. 같은 출처의 본문 hash가 달라지면 구버전과 새 범위를 섞지 않는다. 오류/절단/빈/부분 조회로 전체 조사 완료를 표시하지 않는다. `ranges: []`인 검색 no-match는 긍정 사실의 인용 근거가 아니며 전체 부재도 증명하지 않는다.
4. 검토 입력 예산 안에는 두 출처를 함께 전달한다. 예산이 부족하면 한쪽 삭제 후 완료 대신 명시적으로 검토 불가를 반환한다.
5. 반복된 타깃 실패에는 고정된 근거를 읽는 복구 워커 한 건과 실제 호출 시작/결과가 표시된다. 같은 실패/근거로 추가 워커가 무한 생성되지 않는다. 취소/질문/승인 대기는 기존 경계를 따른다.
6. 실패 후 실제 화면을 새로 읽고 변경한 타깃/방법으로 한 동작을 수행한 뒤 요청 값/상태를 독립 검증한다. 화면 이미지는 타깃 보완에 사용하며 이미지 존재 자체를 성공으로 표시하지 않는다.

합성 모델 단위/Chrome fixture는 원문 보존, 타깃 실패, 복구 워커 호출과 상태 전이를 검증한다. 실제 Qwen/선택 모델의 첫 계획 완료율, 전체 성공률, 잘못된 완료율, 불필요한 재탐색 수, 도구/모델 시간과 토큰 비용은 같은 사이트/계정/과제/정답 기준으로 별도 측정해야 한다. 이번 소스 리뷰만으로 Claude/Codex와 동등한 브라우저 업무 정확도를 주장하지 않는다.

관련 기존 근거: [하네스 방법론](HARNESS-METHODS-2026-09-25.md), [오픈소스 선택](OPEN-SOURCE-HARNESS.md), [페이지 읽기 멀티에이전트](PAGE-READING-MULTIAGENT-BP.md), [실제 하위 호출과 대기](MODEL-WAIT-AND-DELEGATION-2026-09-26.md).
