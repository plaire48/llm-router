# Open-source harness selection

2026-09-23 후속: [완료 판단과 실제 작업 평가](COMPLETION-QUALITY.md)에 Pi followUp 기반 보완 실행, 행동 없는 완료 답변 검사, 실제 소유 탭 평가를 연결했다. AgentLab은 외부 비교 평가 후보로 검토했으며 이번 번들에 포함하지 않았다.

검토일: 2026-09-22

누비는 **Pi Agent Core + Playwright CRX**를 실제 오픈소스 실행 기반으로 유지한다. Nanobrowser의 실행 담당과 완료 판단 분리 구조를 참고해 사용자 요구사항 검토를 추가했다. 기존 AI Pro, ChatGPT, FabriX 연결과 누비 CX 화면을 유지하며 확장만으로 실행하는 조건에 맞춘 판단이다.

## 비교

| 후보 | 확인한 구성 | 누비에 적용 |
| --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi) | MIT Agent SDK, 도구 실행과 이벤트, 실행 전후 hook, 후속 요청 | 설치된 `@earendil-works/pi-agent-core` 0.86.1을 실제 사용. 제공자 연결과 브라우저 정책을 분리하기에 적합 |
| [Nanobrowser](https://github.com/nanobrowser/nanobrowser) | Apache-2.0 Chrome 확장, Planner/Navigator, OpenAI 호환 제공자 | 브라우저 제품 구조가 가장 가까운 참고 대상. 전체 앱을 가져오는 대신 완료 판단 분리 원칙을 적용 |
| [Stagehand](https://github.com/browserbase/stagehand) | MIT SDK, observe/act/extract, 브라우저 옆 확장 실행, 로컬 브라우저 또는 Browserbase | 요소 관찰과 동작 API의 참고. 확인한 공식 사용 경로는 외부 SDK 클라이언트에서 브라우저를 시작하는 구성으로, 현재 누비 안의 Pi를 대체하는 배포 경로는 아님 |
| [Browser Use](https://github.com/browser-use/browser-use) | Python Agent와 브라우저 런타임 | 외부 런타임 허용 시 후보. 현재의 확장 단독 설치 조건에는 추가 연결 계층이 필요 |

이 비교는 배포 구조와 공개 소스 기준이다. AI Pro의 GLM/Qwen을 동일 업무에서 비교한 성능 순위나 사용자 만족도 순위가 아니다.

## 직접 확인한 소스

- Nanobrowser 검토 커밋: `24a14b76e14a9c30fd84878ca7985049d1e7d064`, package version 0.1.13.
- [Executor](https://github.com/nanobrowser/nanobrowser/blob/24a14b76e14a9c30fd84878ca7985049d1e7d064/chrome-extension/src/background/agent/executor.ts): Navigator가 종료를 제안하면 Planner가 다음 단계에서 검토하고 `done`을 판정한다.
- [Planner](https://github.com/nanobrowser/nanobrowser/blob/24a14b76e14a9c30fd84878ca7985049d1e7d064/chrome-extension/src/background/agent/agents/planner.ts): 별도 지침과 구조화된 결과를 사용한다.
- Pi의 설치 패키지 README와 public exports: 현재 안정 `Agent` API의 실행 전후 hook/후속 큐를 사용한다. `experimental/pico3`나 Node 실행 환경으로 이관하지 않는다.
- [Stagehand 공식 예제](https://github.com/browserbase/stagehand#readme): `localBrowser.launch`와 `Stagehand.create`로 브라우저를 시작한다.

Nanobrowser 코드는 복사하거나 번들하지 않았다. 실제 포함한 Pi, Playwright CRX, QuickJS 버전은 lockfile과 설치 ZIP의 build-info.json에 있으며 라이선스는 ZIP에 함께 배포한다.

## 적용과 평가

[실행 계약](AGENT-HARNESS.md)은 목표 해석 → 동적 도구 선택 → 행동 → 페이지 검사 → 요구사항 검토 → 누락 보완을 구분한다. 계획 표시를 성공의 근거로 사용하지 않는다. 별도 검토는 같은 모델을 쓰므로 실패가 상관될 수 있다.

[0.12.0 검증](VERIFICATION-0.12.0.md)은 실제 Chrome 동작과 합성 모델 판단을 구분한다. 사내 모델 비교는 같은 초안 작성/다중 입력/오류 복구 작업에서 완료율, 잘못된 완료율, 반복 쓰기 횟수, 지연과 실제 토큰 사용량을 측정해야 한다. 공개 프로젝트 인기도만으로 누비의 성능을 단정하지 않는다.

## Beta 1.0.0 보강

2026-09-22에 [Nanobrowser](https://github.com/nanobrowser/nanobrowser), [Stagehand](https://github.com/browserbase/stagehand), [Browser Use 평가 코드](https://github.com/browser-use/benchmark/blob/main/judge.py)를 다시 확인했다. 확장 단독 설치와 현재 제공자 계약을 유지하기 위해 Pi를 그대로 사용한다. 새 외부 서비스나 Python 런타임은 추가하지 않았다.

- Nanobrowser의 역할 분리 원칙을 중간 검토에도 적용한다. 연속 실패나 여러 동작 뒤에 원래 요구를 다시 대조하고 접근법을 수정한다.
- Stagehand의 관찰/행동/추출 구분을 참고해 읽기는 수동 DOM 조회를 우선하고, 읽기만 하는 작업에 불필요한 동작 검증을 요구하지 않는다.
- Browser Use의 평가 기준처럼 모델의 완료 선언과 실제 정답/화면 상태를 구분한다. [실모델 평가 실행기](AGENT-EVALUATION.md)는 요구사항별 정답, 실제 필드값, 중복 입력, 질문 여부로 점검한다.

구조를 참고했으며 해당 프로젝트 코드를 복사하거나 새 패키지를 번들하지 않았다. 로컬 합성 회귀가 실제 AI Pro 모델 성능 개선을 입증하지는 않는다. 실모델 인증 없는 이번 환경의 실행 기록은 `not_configured`로 남긴다.
