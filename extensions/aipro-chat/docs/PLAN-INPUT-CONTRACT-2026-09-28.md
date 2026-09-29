# 요청 해석과 첫 계획 입력 수정

2026-09-28. 사용자가 참고 대상을 OpenCode에서 **Claude Code와 연동하는 Claude in Chrome 확장**으로 정정했다. 방법론은 Anthropic Claude Code와 OpenAI Codex를 함께 참고한다.

## 원인과 변경

별도 planner에 보내던 이전 대화는 최근 6개 문자열 메시지의 앞 1,500자였다. 긴 이전 발언 끝의 금지 조건, 오래된 사용자 결정, 배열형 text 부분이 계획 입력에서 빠지는 것을 실제 함수 호출로 재현했다. 또 새 계획은 완료 조건을 요구하는 안내와 달리 `확인`이라는 이름과 상태만 있어도 파서를 통과했다.

- `task-plan.js`가 원래 사용자 발언을 `user_requests`에 순서대로 전달한다. 압축 요약과 잘린 참고 대화는 별도 context다. 문자열과 배열의 모든 text 부분을 같은 함수로 처리하고 image/tool payload는 사용자 발언으로 가져오지 않는다.
- `src/api.js`가 packed history가 아닌 실제 `request.messages`에서 보존한 사용자 발언을 planner에 전달한다. 실행 중 도착한 정정도 기존 scopeUserHistory에 누적된다. 배열형 최신 사용자 발언은 문자열 goal로 정규화한다.
- 원문과 도구 스키마, 시간 안내를 합친 입력이 기존 추정 예산을 넘으면 `context_input_too_large`로 중단한다. 조건을 잘라 계획을 만들거나 같은 입력을 재전송하지 않는다. 토큰 추정은 실제 Qwen tokenizer 측정과 다르다.
- 새 planner 응답에는 각 단계의 expected_outcome을 요구한다. 별도 planner에 광고하는 스키마만 복제해 필수 필드로 보강한다. 주 모델이 직접 낸 첫 계획에 완료 조건이 없으면 별도 계획 교정을 거친 뒤 실행한다.
- 기존 저장 계획의 상태만 바꾸는 요청은 기존 완료 조건을 상속한다. 구버전 계획 재개와 다른 호스트의 `runAgent` 기본값은 유지한다. 브라우저 API에서만 `requirePlanOutcomes`를 활성화한다.

원래 발언 전체가 입력 예산을 넘는 긴 대화는 명시적 입력 한도 오류로 남을 수 있다. 무손실 요구사항 추출/조회 체계 전체를 구현한 것은 아니다. 첫 계획 이후 모든 재계획의 새 항목까지 엄격한 스키마로 바꾸는 작업도 이번 범위에 포함하지 않는다. 관찰/동작/HITL/미확정 쓰기/최종 완료 보호는 변경하지 않았다.

## 참고한 코드와 방법론

기존 [Claude 확장 분석](CLAUDE-HARNESS-STATIC-2026-09-26.md)의 로컬 배포본 1.0.94를 다시 읽었다. mcpPermissions SHA-256 `e240270612684e9108303513f4a5f0cacb83a5d6876fec4d05a4fd7d2d990ed9`, sidepanel SHA-256 `a5bb018a6faeda6e619d4b54d51961f1a689624f942335501c073d54f6242908`가 기존 기록과 일치했다. 최신 배포판이라고 주장하지 않는다.

정렬본 `/tmp/claude-code-review-7G7iDf/sidepanel-so8SIo6y.js`의 84326 부근에서 문맥 압축과 사용자 조건 보존 의도를, 86650 부근에서 도구 ID에 묶인 결과/오류 반환과 권한 대기를 재확인했다. 이는 사이드패널 클라이언트 분석이며 Claude Code 외부 호스트나 서버 전체 하네스 분석은 아니다. 원본 코드와 프롬프트는 누비에 복사하지 않았다.

| 참고 | 이번 선택 | 적용하지 않은 범위 |
|---|---|---|
| [Claude Code Chrome 연결](https://code.claude.com/docs/en/chrome) | 외부 호스트, 세션 탭, 확장의 역할을 구별해서 비교 | Native Messaging 설치와 Claude 계정 연결을 누비의 필수 구성으로 추가하지 않음 |
| [Claude Code 실행 원리](https://code.claude.com/docs/en/how-claude-code-works) | 문맥 수집 → 행동 → 결과 확인의 반복을 유지 | 새로운 에이전트 프레임워크로 교체하지 않음 |
| [Anthropic 문맥 설계](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 작업에 필요한 원래 조건과 참고 문맥을 구분 | 요약을 원래 사용자 승인으로 취급하지 않음 |
| [Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) | 메시지/도구 결과를 보존하는 기존 Pi loop 위에서 계약 보강 | Codex 런타임이나 인증 저장소를 가져오지 않음 |
| [OpenAI harness engineering](https://openai.com/index/harness-engineering/) | 문구 안내에만 의존하지 않고 새 계획 경계에서 완료 조건 검증 | API 호출 수를 늘리는 새 감사 계층을 추가하지 않음 |

기존 MIT Pi/TypeBox 기반 코드를 사용했다. 새 패키지나 실행 프로세스는 추가하지 않았다. Claude 배포 JS의 재사용 라이선스가 확인된 OSS라고 표시하지 않는다.

## 검증

- 변경 전: 조건 손실 3종과 완료 조건 없는 계획 수용을 함수 입력/출력으로 재현했다.
- 변경 후: 신규 검사 8개 추가. 오래된/긴 조건, 배열형 text, 원문과 요약 분리, 완료 조건 강제, 주 모델 계획 교정, 잘못된 교정 차단, 실제 API planner 연결, 입력 예산 초과 시 무실행을 확인했다.
- 계획 입력/형식 관련 21/21 통과. 앞선 관련 5개 파일 검사 51/51 통과 이후 예산 초과 검사를 추가했다. 중복 검사 수를 합산하지 않는다.
- 전체 `node --test tests/*.test.mjs`: **1,322/1,332 통과, 10 실패**. 전체 회귀 통과로 표시하지 않는다.
- 실패 10개는 `review-context.test.mjs`, `verification-recovery.test.mjs`, `visual-recovery-context.test.mjs`에 있다. 자동 본문 조회가 추가돼 실제 read 횟수/명령열이 기존 기대와 다른 것이 출력에서 확인됐다. 올바른 제품 동작인지 fixture가 오래된 것인지는 별도 판단이 필요하다.
- 격리한 복사본에서 이번 변경 전 `agent-runtime.js`와 `task-plan.js`를 복원하고 아래 기존 해시 일치를 확인한 뒤 실패 관련 3개 파일을 실행했다. **22개 중 동일한 10개 실패**를 재현했다. 이번 변경 전부터 존재한 실패로 분리하며 기대값을 수정해 통과시키지 않았다.

변경 전 runtime SHA-256: `18cd49af613a36ee60f10450aee440e2cf24af10831fa135f0acfcd39ac3bd2c`.
변경 전 task-plan SHA-256: `c08ac7e5fd27bd6fd80c87a073a757004d747a8ca3a9924debcc8a8329725af8`.

검증 로그와 현재 소스 해시는 [검증 기록](../verification/plan-input-2026-09-28/result.json)에 있다. 신규 실제 Chrome/실계정 모델 평가, 후보 빌드, 설치 및 배포는 하지 않았다. 현재 Qwen 완주율이나 과거 E01/E04/E08 해결을 주장하지 않는다.

전체 순서와 남은 진단은 [요청부터 완료까지 재점검](../../../docs/plans/2026-09-28-nubi-browser-first-principles-audit.md)을 따른다. 다음 원인 분석 대상은 첫 관찰과 자동 본문 조회의 필요성, 계획/검토 범위 교정 반복이다.
