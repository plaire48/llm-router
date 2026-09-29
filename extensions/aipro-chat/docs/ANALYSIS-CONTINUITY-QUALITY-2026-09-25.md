# 하위 분석의 압축 후 재조회 품질

2026-09-25. NQ-12. 직전의 전체 assignment 보존에 이어, 긴 작업의 문맥 압축에서 해당 결과를 찾는 task_id가 사라지는 문제를 수정했다. 결과 내용의 의미 정확도를 측정한 변경은 아니다.

## 재현과 반영

기존 continuity는 실행 영수증, 출처 위치와 문서 읽기 범위를 보존했지만 일반 하위 분석 ID는 보존하지 않았다. 요약 모델이 ID를 누락하면 주 실행기가 원래 조건과 부분 보고를 다시 조회할 경로를 잃었다. [수정 전 실패](../verification/analysis-continuity-2026-09-25/before.log)를 보존했다.

`context-evidence.js`는 delegate/collect/cancel 도구 결과와 자동 인계의 작업 ID, 역할, 실행 상태, 보고 상태만 별도 보존한다. 최대 12개에서 미완료 작업을 우선하며 생략 개수를 표시한다. 취소 상태는 유지하고 자동 재시작하지 않는다. 이전 상태는 현재 완료 근거가 아니며, 기존 `collect_analysis`가 실행 메모리에서 원래 assignment와 보고를 다시 검증해 반환한다. 만료된 ID는 미확인 작업이다. 원문이나 임의 실행 인수는 보존 목록에 넣지 않는다.

전체 원본 실행 기록에서 매번 재구성하므로 두 번 연속 요약이 ID를 누락해도 재조회가 가능하다. 이 변경은 worker 종료 후 복구나 12개를 넘는 모든 과거 작업의 영구 보존을 추가하지 않는다.

## BP와 오픈소스 판단

| 근거 | 실제 적용 또는 유지 | 선택 이유와 한계 |
| --- | --- | --- |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 요약과 별도로 제한된 구조화 작업 상태를 보존하고 필요한 결과를 다시 조회 | 요약의 누락을 복구하며 전체 transcript 재주입 비용을 피한다. 방법론 적용이며 Anthropic SDK나 비공개 코드 도입이 아니다. |
| [DeepAgents subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents) 및 설치된 1.13.2 소스의 `filterStateForSubagent`/`EXCLUDED_STATE_KEYS` | 격리된 문맥과 간결한 인계 유지. 현재 Pi 분석기에 재조회 메타데이터 추가 | MIT. 하위 요약 상태의 인덱스를 부모 문맥에 그대로 복사하지 않는 기존 구현을 확인했다. Wiki 실행기를 교체하지 않는다. |
| Pi agent-core 0.86.1 `prepareNextTurn`/`transformContext` | 기존 MIT 라이브러리의 호출 경계와 누비 문맥 관리 재사용 | 별도 실행기/서버/프레임워크 없이 확장 안에서 처리한다. |
| [p-limit](https://github.com/sindresorhus/p-limit) 7.3.3 | 기존 2개 동시 실행, 6개 미수집 제한 유지 | MIT. 문맥의 조회 ID 누락은 큐 라이브러리 교체로 해결되지 않는다. |

### 새 버전 검토

[npm outdated](../verification/analysis-continuity-2026-09-25/outdated.json)에는 Pi 0.87.1, DeepAgents 1.14.1 등 새 버전이 있다. 이번에는 의존성/lockfile을 변경하지 않았다.

- [Pi 0.87.0/0.87.1 변경](https://github.com/earendil-works/pi/blob/v0.87.1/packages/agent/CHANGELOG.md): 실제 소스의 `shouldStopAfterTurn` 제거와 `finishTurn` 전환을 확인했다. 누비는 해당 중지 API를 질문/승인 경계에 사용한다. 새 API는 오류/취소에서도 호출되며 이벤트 순서도 달라, 별도 마이그레이션과 경계 회귀 없이 버전만 올리지 않는다. 이번 ID 누락은 라이브러리 결함이 아닌 호스트 continuity 누락이다.
- [DeepAgents 1.14.1](https://github.com/langchain-ai/deepagentsjs/releases/tag/deepagents%401.14.1): 긴 도구 ID의 파일 경로 제한과 가상 파일시스템 symlink 이탈 방지. [1.14.0](https://github.com/langchain-ai/deepagentsjs/releases/tag/deepagents%401.14.0)은 스킬 목록 갱신이다. 현재 위키는 `deepagents/browser`와 허용된 읽기 도구만 사용하고 파일시스템 읽기/쓰기를 deny하며 skills를 구성하지 않는다. 이번 Pi 결과 재조회 문제를 직접 해결하는 변경은 없어 유지한다. 버전 후보를 채택 완료로 표시하지 않는다.
- React/Vite 등 다른 업데이트는 이번 UI 변경 없는 하네스 수정에 묶지 않는다. [전체 npm audit](../verification/analysis-continuity-2026-09-25/audit.json)의 알려진 취약점은 0건이며, 모든 업데이트의 호환성을 검증했다는 뜻은 아니다.

## 검증

- 신규 단위 4개. 두 번의 실제 run-context 압축과 coordinator 재조회, 자동/수동 인계와 취소, 형식 검증/12개 상한/생략 수, 미완료 우선 보존을 검사한다.
- [집중 검사](../verification/analysis-continuity-2026-09-25/focused.log): 관련 24/24 통과.
- [실제 Chrome MV3 검사](../verification/analysis-continuity-2026-09-25/browser.json): 하위 분석 6개, 합성 모델 호출 12회. 압축 2회(요약 조각 호출 4회) 뒤 원래 제약과 partial 보고 재조회. 분석 모델 호출은 추가되지 않았다. 원문 해제 후 오래된 인용을 사실로 복원하지 않는다.
- [동일 후보 공통 gate](../verification/pre-release-2026-09-25T01-26-55-108Z/report.json): **전체 단위 769/769**, **Chrome 71/71**(21종 × 3회 + 8종), 디자인/후보 빌드 통과. `quality-baseline-v4`, `fullMatrix=false`, `actualModel=false`, `releaseApproved=false`. 검사 중 소스/테스트/의존성과 빌드 해시 불변.
- [최종 요약](../verification/analysis-continuity-2026-09-25/report.json), [공식 소스/버전 판단](../verification/analysis-continuity-2026-09-25/upstream-decisions.json). 제품 빌드 SHA-256 `21e6159d4bbfe49f70077595b2aec4863e11fb5abe9fd04c07b4d4e517253b5d`, 후보 ZIP SHA-256 `ddbd009b95c8c4ca93aac7efb04c8fa073fb79f9ef180c27fb937d94716a99a1`.
- 실제 Qwen/회사 사이트/Windows/Edge와 공개 배포는 별도다. 기존 후보의 검사 수를 이번 결과에 합산하지 않았다.
