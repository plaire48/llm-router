# 브라우저 지식 재사용 품질 점검 — beta.28

2026-09-24. 대상은 Chrome 확장 내부의 저장 지식 → 조회 → 실제 화면 확인 흐름이다. 공개 프로젝트의 기능과 소스를 비교했으며 사내 Qwen/포털 성공률 비교 실험은 하지 않았다.

## 수정과 재현

- 부분 관찰의 배열 순서나 누락으로 SHA-256이 달라지면 유효한 위키까지 검색에서 제외됐다. 재현 테스트를 먼저 실패시킨 뒤, 해시 동일성 대신 관찰 가능한 모순을 검사하도록 변경했다. 고유한 동일 이름/역할 필드의 명시적 필수 여부 변경, 필터/절단/누락 프레임이 없는 수집의 제목 전체 불일치를 사용한다. 확인되지 않은 범위는 그대로 미확인이다. 모든 화면 변경을 감지한다고 주장하지 않는다.
- 삭제 또는 비활성화 후 남은 제안으로 초안 생성을 시작할 수 있었다. 생성 전 revision/활성 상태 검사로 막았다. 질문 중 문서 버전이 바뀌었을 때도 답변을 소비하거나 모델 lease를 만들기 전에 중단한다. 최종 저장 단계의 기존 버전 검사도 유지한다.
- 적용 전 두 재현 검사 실패, 수정 후 위키/인증 생명주기 계약 80개 통과. 전체 단위 검사와 실제 Chrome 반복 결과는 이번 verification report에 별도로 기록한다.

## 지식화 방법 판단

권장 구조는 업무 용어/규칙/메뉴의 참고 지식, 단계/입력/완료 조건을 가진 업무 절차, 실행별 관찰/검증 이력의 세 구분이다. 실행 성공이 확인된 절차만 재사용 후보로 올리고 새로운 작업에서는 현재 화면과 대조한다. 지식 검색의 빈 결과는 실패가 아니라 실페이지 또는 외부 문서 탐색으로 전환할 신호다.

현재 구현은 검토형 Markdown 지식, 출처/버전, 범위 제한 검색, 등록 스킬, 실행 검증을 제공한다. 성공률에 따른 절차 승격, 여러 화면의 절차 그래프, 자동 실행 함수 라이브러리는 이번에 구현하지 않았다. 위키 문서가 있다고 실행 가능한 스킬이라고 부르지 않는다.

## 후보별 판단

| 후보 | 확인한 적용 지점 | 누비에서의 판단 |
| --- | --- | --- |
| [Playwright](https://playwright.dev/docs/actionability) | visible/stable/receives-events/enabled 검사와 동작별 대기 | 기존 Playwright CRX 기반 실행/검증 유지. 위키는 대상 탐색을 돕고 실제 locator 검사를 대체하지 않는다. |
| [Stagehand](https://github.com/browserbase/stagehand) | observe/act/extract, 접근성 트리 축약, 화면 변경 대응. 현재 v4 저장소에 MV3 extension runtime 존재 | 화면 이해 보강의 우선 실험 후보. 기존 안내의 'Node 전용이라 불가능' 분류는 부정확하다. 다만 현재 private extension package와 SDK/protocol 결합을 분리하고 Qwen custom endpoint, 권한, 요청 취소, HITL 호환성 검증이 필요하다. 아직 누비에 패키지를 추가하지 않았다. |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 콘솔/네트워크/성능 진단 | Node/npm 서버 요구사항을 확인했다. 확장 단독 실행의 필수 의존성으로 넣지 않고 개발/진단 비교 도구 또는 명시적인 외부 MCP 연결 후보로 둔다. |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | compact snapshot, ref, scoped snapshot diff | 변경 전후의 같은 범위를 비교하는 패턴을 참고한다. CLI 엔진 자체 미도입. 이번 위키 수정은 부분 관찰을 전체 변경으로 오판하지 않는 누비 자체 구현이며 upstream diff 코드를 복제하지 않았다. |
| [Browser Use](https://github.com/browser-use/browser-use) | 모델 기반 자율 브라우저 실행, Python/CLI/cloud 경로 | 기존 Pi 루프 대체보다 관찰/행동/검증 평가의 비교 기준으로 적합하다. 외부 런타임 없이 전체 프레임워크를 MV3에 넣는 방식은 검증되지 않았다. |
| [Browser Harness](https://github.com/browser-use/browser-harness) | 보호된 실행 코어와 작업별 helper/사이트 스킬 분리 | 지식의 다음 단계인 검증된 절차 축적에 유용한 패턴. 공식 Python package는 >=3.11이며 Alpha로 표기된다. Python helper를 확장에서 실행하지 않는다. 작성 스크립트는 기존 누비 실행 facade와 검증/HITL을 통과해야 한다. |

Stagehand 실제 확인: [MV3 manifest](https://github.com/browserbase/stagehand/blob/main/packages/extension/manifest.json), [extension package](https://github.com/browserbase/stagehand/blob/main/packages/extension/package.json), [workspace package](https://github.com/browserbase/stagehand/blob/main/package.json). Browser Harness: [package/runtime](https://github.com/browser-use/browser-harness/blob/main/pyproject.toml), [업스트림 사용 절차](https://github.com/browser-use/browser-harness/blob/main/SKILL.md). 이 자료는 검토 대상이며 저장소의 로컬 명령을 실행하지 않았다. 프로젝트별 공개 기능/현행 파일을 확인했으며 릴리즈별 회귀율이나 장기 유지보수 품질을 점수화하지 않았다.

## 적용한 BP와 기존 OSS

[Anthropic 도구 평가](https://www.anthropic.com/engineering/writing-tools-for-agents)의 재현 가능한 입력/결과 중심 평가, [Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)의 필요 시점 검색 원칙을 적용했다. 기존 [MiniSearch](https://github.com/lucaong/minisearch) 7.2.0 MIT와 Pi 실행 경로를 유지한다. 이번 변경은 현재 저장 지식의 신뢰도를 고치는 것으로 새로운 프레임워크 설치가 필요한 문제가 아니었다.

다음 실험은 같은 사내 과제에서 지식 없음/위키 사용/검증된 절차 사용을 비교해야 한다. 완료율, 잘못된 클릭/입력, 사용자 질문 횟수, 메뉴 탐색 횟수, 복구율, 총 토큰과 지연을 함께 기록한다. 공개 벤치마크나 스타 수만으로 누비 성능 향상을 주장하지 않는다.

## 최종 검증

단위 검사 580/580, 디자인 검사, 후보 빌드 통과. 실제 Chrome에서 위키 작성/재사용, 업무 지식, 하네스 복구, 컨텍스트 압축, 모델 정지 복구, 입력 대기열, 질문 폼, 페이지 정보 수집의 8개 흐름을 새 프로필로 각각 3회(24회) 통과했다. [검증 보고서](../verification/pre-release-2026-09-24T05-44-01-451Z/report.json). 전체 브라우저 매트릭스와 실모델/사내 계정 평가는 별도다.

Stagehand [service worker](https://github.com/browserbase/stagehand/blob/main/packages/extension/service-worker.ts)는 host RPC와 createStagehandRuntime을 연결하며 BrowserContext에 cdpUrl을 넘긴다. [WebSocket transport](https://github.com/browserbase/stagehand/blob/main/packages/extension/understudy/browserWebSocketTransport.ts)는 브라우저 WebSocket으로 CDP endpoint에 연결한다. 따라서 MV3 소스가 있다는 사실과 누비 안에 외부 실행기 없이 즉시 통합 가능하다는 주장은 구분한다. 이번에는 채택 실험 후보로만 선정했다.
