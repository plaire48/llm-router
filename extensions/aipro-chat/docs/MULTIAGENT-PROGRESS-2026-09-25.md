# 문서 분업과 전체 진행 기록

브라우저 누비의 기존 Pi와 OpenWiki DeepAgents를 재사용한다. 문서를 나누어 조사하고 누락을 보완한 뒤 결과를 합치는 과정은 실제 모델/도구 이벤트로 표시한다. 현재 선택 모델과 제공자를 유지하며 내장 Wiki, 외부 Wiki, 첨부 문서의 출처를 섞지 않는다.

## 방법론과 선택

| 공식 근거 | 선택과 적용 |
| --- | --- |
| [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system), [LangGraph orchestrator-worker](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents) | 독립 범위, 제한된 동시 워커, 결과 합성과 부분 실패 유지 원칙. 기존 DeepAgents 조회 코어의 분할/미열람 보완/네 보고서씩 합성을 재사용한다. 모델 수를 늘린 것만으로 품질 향상을 주장하지 않는다. |
| [Claude subagents](https://code.claude.com/docs/en/sub-agents), [OpenCode task permissions](https://opencode.ai/docs/agents/) | 역할별 문맥/도구 범위를 분리한다. 조사 담당에게 페이지 입력이나 승인 권한을 전달하지 않는다. Claude 실행기나 OpenCode CLI를 확장에 추가하지 않는다. |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Codex compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs) | 원래 목표와 필수 조건을 요약과 분리하고 필요한 원문만 다시 조회한다. 기존 MiniSearch 원문/하위 결론 재조회와 근거 ID를 유지한다. Codex의 Rust 실행기나 특정 토큰 예산을 복사하지 않는다. |
| [DeepAgents subagent streaming](https://docs.langchain.com/oss/javascript/deepagents/frontend/subagent-streaming) | 주 실행기와 담당별 identity/status를 분리해 표시하는 패턴을 적용한다. 역할, 담당 번호, 원문 구간, 보완, 합성, 전달을 기존 trace/React에 연결한다. 최신 `@langchain/react` API나 서버를 별도로 추가하지 않는다. 비공개 추론은 표시하지 않는다. |
| [Claude computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | 캡처의 좌표/시각/화면 상태 연결과 이미지 문맥 관리 원칙을 참고한다. 기존 화면 관찰과 이미지 지원 모델 경계를 유지하며 이미지 확인을 실제 저장/등록 성공으로 대체하지 않는다. |

실제 설치 패키지는 Pi Agent Core 0.87.1, DeepAgents 1.13.2, LangChain/core 1.2.9, textsplitters 1.0.1, p-limit 7.3.3, MiniSearch 7.2.0, idb 8.0.3이다. idb는 ISC이며 나머지는 MIT다. Playwright CRX 1.21.4는 Apache-2.0이다. 이번 진행 기록 저장은 기존 idb를 직접 사용한다. 신규 런타임/인증/서비스 의존성은 추가하지 않는다. OpenCode(MIT)와 Codex(Apache-2.0)는 방법론/소스 참고이며 전체 제품을 채택한 것이 아니다. Pi의 공식 subagent 예제는 Node 자식 프로세스를 사용하므로 MV3에 그대로 넣지 않는다.

## 최근 표시와 전체 기록

`normalizeTrace`의 최근 32개는 화면 갱신용 요약이다. 긴 문서의 전체 워커 실행 기록과 구분한다.

- 실행기가 각 이벤트에 호스트 생성 ID와 순서를 붙여 전달한다. 최근 32개 밖으로 나가도 개별 이벤트는 별도 IndexedDB에 남는다. 최근 갱신 기준으로 32개를 보존하되 화면에는 원래 작업 시작 순서를 유지한다. 주 실행기의 trace 배열은 32개로 제한하며 실행 중 ID만 최대 64개 따로 유지한다.
- 저널은 제공자, 대화 ID, 답변/실행 ID로 분리한다. 이벤트의 도구, 상태, 역할, 워커/합성 ID, 그룹 ID, 숫자 구간, 카운트, 시각만 저장한다. 원문, 이미지, 모델 입력/출력, 요약, 제목, 문서 경로, 자유형 설명, 인증, 토큰 사용량과 비공개 추론은 넣지 않는다.
- 전체 기록은 사용자가 펼칠 때 50개씩 최신순으로 조회한다. 기본 `GET_STATE`에 저널 전체를 넣지 않는다. 페이지가 바뀌면 이전 페이지 배열을 교체하며 최대 50개만 렌더링한다.
- 실행당 최대 10,000개 이벤트, 전체 50,000개, 실행 메타데이터 512개를 보관한다. 초과한 이전 이벤트/실행은 제거한다. 제거 수, 순서 누락과 저장 실패를 표시하며 무제한 전체 기록이라고 부르지 않는다. 전체 보관 실행이 제거되면 해당 대화의 표시에는 보관 한도로 제외됐음을 안내한다.
- 저장 실패는 브라우저 동작을 재실행하거나 모델 작업을 중단하지 않는다. 해당 답변에 기록 누락 상태를 남긴다. 대화 삭제 후 기록을 정리하고 시작 시 남은 대화/답변과 대조해 고아 기록을 정리한다.
- 취소 후 `SAVE_CONTEXT`가 거부한 마지막 이벤트도 최종 호스트 순서와 비교해 누락으로 기록한다. `FINISH_CHAT`의 기존 소유권 검사를 통과한 실행만 저널을 닫는다. 종료 알림을 다시 받아도 누락 수를 중복 가산하지 않고, 닫힌 실행의 늦은 이벤트는 재개하지 않는다. 이 확인은 빠진 이벤트 내용을 만들어내거나 취소한 동작을 재실행하지 않는다.
- 읽기는 확장 내부 화면만 허용하며 제공자/대화/assistant 답변의 소유권을 확인한다. 존재하지 않는 대화나 user 메시지로 조회할 수 없다. 기록에서 실행이나 승인을 재개하는 기능은 없다.

역사 이벤트의 `running`은 당시의 **실행 시작**이다. 완료한 과거 실행에 현재 동작 중 스피너를 표시하지 않는다. 부분 확인/확인 필요는 완료와 구분한다. 최신 작업이 추가돼도 사용자가 읽는 페이지를 자동으로 바꾸지 않으며 새로고침 버튼으로 최신 기록을 조회한다.

## 검증

- `tests/trace-journal.test.mjs`: 원문 제외, 제공자/대화/실행 분리, 130개 이벤트의 50/50/30 페이지, 중복 순서, 보관 한도, 누락 수, 삭제와 저장 실패. 메모리 저장 어댑터 검사이며 실제 IndexedDB 검증과 구분한다.
- `tests/trace-journal-runner.test.mjs`: 132개 개별 이벤트를 모두 전달하면서 최근 trace를 32개로 제한하고, 오래 실행된 부모 도구의 시작/완료 ID를 보존한다.
- `tests/login-lifecycle.test.mjs`: 기존 진행 lease 검증과 별도로 신뢰하지 않은 화면, 다른 제공자/대화/메시지 조회 거부, 대화 삭제 시 저널 정리를 검사한다.
- `tests/trace-journal-browser.mjs`: 실제 Chrome IndexedDB에 공개 fixture 이벤트 132개를 저장한 뒤 UI의 50/50/32 페이지, 새로고침, 320/360/1100px, 키보드, 소유권 거부와 실제 삭제를 검사한다. 이 fixture는 저널을 직접 seed하며 실제 모델 성능이나 모델이 132개 과제를 선택했다는 증거가 아니다. 실행 여부와 결과는 `verification/trace-journal-browser.json`으로 확인한다.

실제 Qwen/사내 계정의 분업 판단 정확도, 토큰 비용과 문서 답변 정확도는 별도 평가 대상이다. 동일 질문/자료에서 단일 실행과 분업 실행의 정답 근거, 누락, 첫 유효 결과 시간, 전체 시간, 전체 usage와 중복 조회를 함께 측정해야 한다. 앱 실행/화면 확인의 성공과 업무 서버의 최종 완료를 구분한다.
