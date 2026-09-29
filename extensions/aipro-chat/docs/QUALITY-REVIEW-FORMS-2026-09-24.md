# 브라우저 누비 양식 품질 재검증

2026-09-24. beta34 소스에 대한 후속 수정이다. Chrome 확장만 변경했으며 공개 배포와 버전 변경은 수행하지 않았다.

## 실제로 재현한 결함과 반영

| 결함 | 수정 전 실제 Chrome 결과 | 반영 |
| --- | --- | --- |
| 입력/검증 수의 불일치 | 20개 입력 후 영수증 유실. 8개 부분 검증은 원래 요청 전체를 해소하지 못하고 20개 검증은 스키마에서 거부 | 입력/검증 최대 20개와 값 길이 16,000자를 모델 스키마와 호스트가 공유. 전체를 한 호출에서 검증하고 기존 2회 연속 통과 조건 유지 |
| 사라진 입력란의 성공 판정 | input 이벤트로 원래 입력란을 빈 새 노드로 바꾸어도 detached handle의 값으로 verified=true | 실제 DOM 연결 상태를 검사. fill_form과 verify_form이 같은 확인 함수를 사용하며 분리된 입력/토글은 성공에서 제외 |
| 중복 대상에 두 번 입력 | 동일 ref를 다른 값으로 두 번 전달하면 input 이벤트 2회 | 전체 입력 목록 검증에서 중복 ref를 거부. 실제 입력 0회와 actionIssued=false 확인 |

처음 세 반례는 수정 전 코드에서 모두 실패했다. `verification/quality-forms-2026-09-24/before.log`에 원본 실패를 남겼다. 수정 후에는 체크박스 교체 뒤 verify_form의 잘못된 성공도 방지하는 회귀를 추가했다. 실제 입력값/쓰기 횟수와 fresh ref 검증을 함께 확인하며 재입력으로 검사를 통과시키지 않는다.

## BP와 오픈소스 판단

| 방법/소스 | 실제 적용 또는 비선택 근거 |
| --- | --- |
| [Playwright actionability](https://playwright.dev/docs/actionability), [실제 injectedScript 구현](https://github.com/microsoft/playwright/blob/main/packages/injected/src/injectedScript.ts) | isConnected를 확인한 뒤 상태를 판정하는 원칙을 입력 영수증에 적용. 설치된 Playwright 1.62.1의 같은 구현도 확인했다. 기존 Playwright CRX 1.21.4와 함께 재사용하며 Apache-2.0과 기존 NOTICE 유지 |
| [Playwright ElementHandle 지침](https://playwright.dev/docs/api/class-elementhandle) | 일반적으로 locator와 현재 상태 assertion을 권장한다. 누비의 ref는 검증한 실제 노드와 승인에 묶이므로 자동으로 다른 노드를 찾는 locator로 일괄 교체하지 않았다. 노드 교체 시 실패와 새 관찰을 반환하고 검증만 이어간다 |
| [Anthropic 도구 설계](https://www.anthropic.com/engineering/writing-tools-for-agents), [Agent 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 도구 계약끼리의 모순을 제거하고 잘못된 호출을 실행 전에 거부. 모델의 완료 문구 대신 실제 DOM/부작용을 기준으로 반례와 회귀를 구성 |
| [Pi 0.86.1 실행 루프](https://github.com/earendil-works/pi/blob/v0.86.1/packages/agent/src/agent-loop.ts), MIT | 기존 스키마 검사, 도구 결과 피드백과 미확정 작업 차단을 재사용. 실사용 소스 실행기에 합성 판단을 공급하고 번들 Chrome 호스트의 실제 입력/검증을 연결해 검사 |
| [Stagehand](https://github.com/browserbase/stagehand), MIT | 기존 검토의 observe/act/extract 대안 후보로 재확인. 이번 재현은 모델 추론보다 누비의 계약/영수증 문제이므로 별도 SDK 전환이나 추가 추론 호출의 비용 없이 현재 실행기를 수정하는 편이 직접적이다. 이번에 설치하거나 도입하지 않음 |

새 의존성은 추가하지 않았다. 단순 최신 버전 교체로 이번 로컬 계약 결함이 해결되는 근거가 없어 버전 고정을 유지했다. 운영 의존성 `npm audit --omit=dev`는 보고된 취약점 0개이며 전체 보안 감사 결과가 아니다.

## 검증 범위

최종 결과: **단위 검사 614/614, 실제 Chrome 회귀 32/32 통과**. 영향 범위 10개 스위트는 새 프로필로 각각 3회, 채팅과 글꼴 스위트는 각각 1회 실행했다. 디자인 검사와 candidate 빌드도 통과했다. 4개 신규 반례는 한 스위트 안에서 각 3회 검사했으며 32회에 별도 가산하지 않는다. UI 소스는 변경하지 않았고 양식 승인 화면을 직접 검토했다. 전체 브라우저 매트릭스 또는 전체 화면 검사를 다시 수행한 결과는 아니다.

Chrome for Testing **151.0.7922.34**를 명시해서 사용했다. 최초 기본 실행 파일로 시도한 환경 확인에서는 service worker 생성이 제한 시간 안에 확인되지 않아 제품 반례 판정 전에 종료했다. 실행 파일을 명시한 뒤 수정 전 3개 반례와 수정 후 회귀를 확인했다.

원본: `verification/pre-release-2026-09-24T08-13-08-095Z/report.json`. 요약: `verification/quality-forms-2026-09-24/SUMMARY.json`. 수정 소스와 후보 ZIP의 실제 파일 내용 및 SHA-256을 대조했다. 검사 이후 후보를 재빌드하거나 공개 릴리스로 승격하지 않았다. 기존 612개 검사는 수정 전 모두 통과했지만 새 반례를 잡지 못했다. 새 계약 단위 검사와 실제 Chrome 회귀를 정규 검증 목록에 포함했다.

실모델 평가 명령도 실행했으나 `NUBI_EVAL_TOKEN`이 없어 not_configured로 종료했다. 환경변수와 `.env*` 파일 유무를 확인했으며 다른 앱의 인증 저장소는 사용하지 않았다. 실제 Qwen 3.8 27B의 도구 선택 정확도와 사내 SSO/실업무 성공률은 미측정이다. 이번 합성 판단/페이지 검사를 실모델 성능으로 표시하지 않는다.

같은 이름의 새 노드를 기존 노드와 동일하다고 증명하지 않으며 DOM 값 유지를 서버 저장 성공으로 표현하지 않는다. 재렌더링 후 값이 올바르게 남아 있어도 새 관찰과 독립 검증이 필요할 수 있다. 사이트별 최종 저장 영수증과 실제 모델 반복 평가는 기존 후속 과제로 남긴다.
