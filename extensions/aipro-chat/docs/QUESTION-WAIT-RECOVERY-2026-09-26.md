# 질문 입력과 작업 재개 검증

사용자 제보: 내용을 작성하는 중 작업이 끝나고, 답변한 뒤에도 폼이 반복된다.

## 확인한 원인과 반영

| 항목 | 기존 동작 | 반영 |
| --- | --- | --- |
| 작성 중 전송 | 모델이 기본 text 모드를 고르면 Enter가 바로 전송 | 모든 질문 입력에서 Enter는 줄바꿈. 보내기 또는 Ctrl/⌘+Enter만 전송. IME 조합 중 전송 방지 유지 |
| 답변 맥락 | 사용자 답변은 원문만 저장. 질문은 assistant 메시지여서 검토 예산 절감 시 먼저 제거됨 | 사용자 답변에 질문 ID와 질문/답변 쌍을 결합. 실행, 계획, 검토와 요약 입력에서 대응 관계 보존 |
| 반복 폼 | 같은 질문 호출마다 새 ID와 폼 생성 | 현재 재개에서 바로 답한 질문과 선택지가 동일하면 모델에 기존 답변과 구체화 안내 반환. 새 폼을 만들지 않음 |
| 질문의 검증 근거 혼입 | ask_user 결과도 브라우저 작업 evidence에 포함 | 질문은 입력 문맥에만 남기고 외부 작업 완료 근거에서 제외 |
| 후속 질문 | 질문이 필요한지 모델에 맡김 | 다른 질문과 변경된 선택지는 허용. 의미가 비슷한 질문을 임의로 합치지 않음 |
| 일반 질문 대기 | ask_user 뒤 실행 종료, 질문은 local 저장 | 기존 무기한 대기 유지. 시간 경과를 답변이나 완료로 취급하지 않음 |
| 별도 양식 검토 | live runner의 fill review에도 10분 비활동 타이머 적용 | 사람이 검토하는 동안 타이머 정지. 소유 runner만 lease 유지. 명시적 답변 뒤 재개, 취소/종료 뒤 자동 재실행 없음 |

일반 질문에 답변 제한시간이 있다는 가설은 코드에서 확인되지 않았다. Enter 조기 전송과 별도 fill review 제한시간을 구분한다. 실제 제보 당시 로그는 없으므로 모든 현상의 단일 원인이라고 단정하지 않는다.

## 공개 구현 비교와 선택

2026-09-26에 공식 소스와 라이선스를 확인했다. 배포본을 역공학하거나 비공개 구현을 분석했다고 표현하지 않는다.

| 구현 | 확인한 근거 | 누비 적용 |
| --- | --- | --- |
| [OpenCode question](https://github.com/anomalyco/opencode/blob/adee738d1e4597a2d0d317ca61a1625eff289efa/packages/opencode/src/question/index.ts) / MIT | pending ID와 Deferred, reply/reject 때 해소 | 질문 ID 결합과 명시적 응답 경계. MV3에서 서버 Deferred 런타임 도입 대신 기존 local 체크포인트 활용 |
| [Codex request_user_input](https://github.com/openai/codex/blob/8b78f4796605bda8e31329537f5fef036e405e66/codex-rs/core/src/tools/handlers/request_user_input.rs) / Apache-2.0 | 자동 해소 시간 없음, 질문/답변을 연결한 retained context 경로 | Enter 자동 전송 제거와 질문/답변 대응 보존. Rust 런타임 추가 없음 |
| [OpenAI Agents JS RunState](https://github.com/openai/openai-agents-js/blob/7b534bbfa2f78be0b815001daa076bb82508536b/packages/agents-core/src/runState.ts) / MIT, [HITL 문서](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) | 중단 상태와 pending input 직렬화, 원 실행 재개 | 대기와 실행 타이머 분리, 기존 Pi와 Chrome 저장소 재사용. 추가 SDK로 실행기를 이중화하지 않음 |
| [Claude Code Agent SDK 입력](https://code.claude.com/docs/en/agent-sdk/user-input), [Python SDK client](https://github.com/anthropics/claude-agent-sdk-python/blob/dbc975eb2771acac751258a8c3b08100cdc54a50/src/claude_agent_sdk/_internal/client.py) / SDK MIT | AskUserQuestion의 원 질문+답변 매핑, 자유 입력, can_use_tool 연결 | 자유 답변 보존. SDK 초기화 제한시간과 인간 답변 대기를 혼동하지 않음. Claude 전용 런타임 추가 없음 |
| [Claude in Chrome 권한 안내](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide) | 요구 확인 질문과 실행 승인을 구분 | 일반 답변은 승인으로 취급하지 않음. 확장 내부 구현 소스는 확인하지 못했으며 문서 벤치마킹만 수행 |

새 의존성 추가 없음. 기존 Pi, CX 입력/폼, Playwright를 사용하고 공개 구현의 패턴을 적용했다. 기존 제공자, 모델, 설치 방식과 승인 권한은 유지한다.

## 검증과 한계

- 질문 폼 Chrome 시험 6개 시나리오와 질문 재개 Chrome 시험 8개 시나리오 통과. `verification/question-forms-browser.json`, `verification/clarification-browser.json`에 기록한다.
- 단위 검사 881개 통과(최종 동일 후보 화면 gate는 아래 별도 기록).
- 품질 목록 `NQ-31`에 구현/다음 실증 검증을 등록했다. quality:status의 전체 핵심 gate 미검증 표시는 유지하며 부분 검사를 전체 통과로 승격하지 않는다.
- 합성 모델 Chrome 시험은 실제 질문 도구, 저장, UI 입력, 재개 경로를 실행한다. 실제 LLM의 질문 품질/실사이트 성공률은 측정하지 않는다.
- 15분 대기는 가상 시계 검사다. 실제 15분 실계정 시험이나 Chrome 전체 종료 후 live fill review 복원 증거가 아니다.
- 중복 방지는 현재 재개의 직전 답변과 동일한 질문/선택지에 한정한다. 다른 말로 반복하는 질문은 모델 품질 과제로 남는다.
- 공유 QuestionForm 소비 호스트는 Enter 변경을 상속한다. Office/Windows 실제 호스트 검증은 별도다.

최종 동일 후보 gate: [report.json](../verification/pre-release-2026-09-25T18-33-25-307Z/report.json). 33개 단계 전체 통과(단위 881개, 디자인, 후보 빌드, Chrome 30종). 소스/검사/의존성 입력 해시와 후보 빌드 해시의 전후 일치 확인. 별도 clarification-browser 8개 시나리오도 통과했다. 이 selected gate는 전체 품질 baseline 또는 실계정 모델 평가가 아니다. 배포 ZIP/업로드는 변경하지 않았다.
