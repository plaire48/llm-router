# 누비 Desktop 대화 자동 압축

## 판단과 적용

원본 대화는 SQLite에 보존하고 모델에 보내는 문맥만 줄인다. 기존 Pi 0.86.1 실행기와 누비의 공용 `context-manager.js`를 재사용한다. 별도 에이전트 프레임워크나 Python 추론 프로세스는 추가하지 않았다. OpenWiki-SDS 문서와 소스는 필요할 때 기존 검색/읽기 도구로 다시 조회한다.

| 근거 | 적용 | 도입 경계 |
|---|---|---|
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 중요한 결정과 미완료 사항을 구조화하고 원문을 필요한 시점에 다시 조회 | 공개 방법론 참고. Claude 전용 서버 압축 API를 다른 제공자에 이식하지 않음 |
| [Codex compact.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs) | 요약과 별도로 사용자 요청을 유지하고 현재 실행 문맥을 다시 구성 | Apache-2.0 공개 코드 참고. Codex 런타임이나 계정 세션을 가져오지 않음 |
| [Pi compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md) | 원문 보존, 저장 경계, 최근 문맥 유지, 도구 호출/결과 쌍 보존 | MIT Pi agent-core/pi-ai 0.86.1은 기존 실제 의존성. coding-agent CLI 전체는 도입하지 않음. 압축 알고리즘은 누비 공용 어댑터 |
| [LangChain summarization middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#summarization) | 임계점과 최근 대화 유지 방식 비교 | MIT. 기존 Pi 상태/도구 루프와 중복되므로 추가하지 않음 |
| [Microsoft LLMLingua](https://github.com/microsoft/LLMLingua) | 학습 모델을 통한 토큰 압축 후보 검토 | MIT. 추가 모델/런타임 비용과 한국어 요구사항/부정문 보존 평가가 필요하므로 도입하지 않음 |

공식 문서와 공개 소스는 2026-09-23에 확인했다. 위 `main` 링크는 이후 바뀔 수 있다. 외부 벤치마크 수치를 누비의 성능으로 제시하지 않는다. 새 라이선스 의무가 발생하는 소스 복사나 패키지 추가는 없다.

## 구현

- 모델 입력 예산의 75%에서 공용 압축기를 사용한다. 시스템 지침, 도구 스키마, 현재 호스트 기록도 예산에 넣는다. Desktop 제공자가 현재 예약하는 응답 4096 토큰을 반영한다. 입력/출력 한도가 없는 모델의 120K 입력 예산은 클라이언트 추정 기본값이며 모델의 실제 한도가 아니다.
- 오래된 대화는 목표, 제약, 결정, 확인된 결과, 미완료 작업, 참조로 요약한다. 기본적으로 최근 두 사용자 턴과 제한된 과거 사용자 요청 원문을 유지한다. 시스템/도구를 포함한 최근 두 턴이 입력 예산의 80%를 넘으면 최근 한 턴을 유지한다. 이때도 턴 내부를 임의로 자르지 않는다. 원래 목표, 완료 조건과 HITL 답변은 호스트 기록으로 따로 제공한다. 모든 과거 정정이 무손실로 보존된다는 보장은 하지 않는다.
- `context-history:<taskId>`에 완료 메시지 ID와 해당 원문 구간의 SHA-256을 저장한다. 다음 실행에서는 해당 구간 원문을 중복 전송하지 않는다. 원문 수정, 삭제, 순서 변경, 다른 작업의 요약은 일치하지 않아 재사용하지 않는다. 원본 `task.messages`는 삭제하거나 요약문으로 교체하지 않는다.
- 실행 중 압축은 공용 `createRunContext`의 도구 쌍 경계를 유지한다. 선택적 `getRequirements` 훅으로 최신 계획, 질문/답변, 실행 기록, 미확정 동작과 승인 상태를 다시 넣는다. 기존 Browser 호출자의 정적 요구사항 계약은 유지한다.
- `read_conversation`은 현재 작업의 원문을 한 번에 최대 8000자로 읽는다. 결과의 `next`로 이어 읽을 수 있다. 과거 대화는 현재 파일/화면 관찰이나 새 승인으로 인정하지 않는다. 읽기 전용 하위 분석에는 이 도구 권한을 추가하지 않는다.
- 압축 후 소스, 새 파일, Wiki와 컴퓨터 관찰 권한을 비운다. 수정/조작 제안 전에 실제 근거를 다시 읽어야 한다. 요약을 실행 성공이나 HITL 승인으로 사용하지 않는다.
- 요약은 같은 제공자와 모델에 도구 없이 요청한다. 잘못된 형식은 원본으로 한 번 다시 작성한다. 원문이 입력 예산 안에 있으면 정리를 미루고 계속할 수 있다. 한도 초과, 저장 실패, 취소는 원문과 이전 저장 경계를 보존한다. 필수 조건을 임의로 자르지 않는다.
- 명시적 문맥 초과는 공용 압축 뒤 모델 호출만 한 번 다시 시도한다. 완료한 도구나 실행 명령을 재실행하지 않는다. 화면의 “이전 대화를 정리하고 있어요”는 실제 요약 요청 동안만 표시하며 작업 중지를 유지한다.

주요 파일: `packages/nubi-desktop/runtime/conversation-context.mjs`, `runtime/agent.mjs`, `ui/Workbench.jsx`, `extensions/aipro-chat/context-manager.js`.

## 검증과 한계

집중 검사는 SQLite 재열기, 원문 보존, 잘못된 경계 무효화, 최근 정정, 손실 요약에 대한 원문 요청 보강, 최신 호스트 상태, 도구 쌍, 취소, 저장 오류, 입력 초과, 원문 구간 조회, 실제 Desktop 실행기 연결과 압축 후 수정 권한 무효화를 확인한다. 고정 응답을 사용하는 계약 검사이며 실모델 정확도 검사가 아니다.

최종 검증: Desktop 167개, 공용 압축기 23개 검사 통과. 합성 공유 UI 17개와 실제 로컬 Theia 브라우저 46개 검사 통과. 개발 번들 빌드 완료. 전체 결과는 `packages/nubi-desktop/verification/context-compaction-*.log`, `shared-ui-result.json`, `ui-result.json`에 남겼다. 브라우저의 합성 화면 검사는 실제 압축 호출 중 상태 변화에 대한 런타임 검사와 구분한다.

실제 AI Pro/Qwen, ChatGPT, FabriX의 장시간 대화 요약 품질, 요약 호출 지연/비용과 Windows 설치본의 실행은 이번 검증 범위 밖이다. 출시 전 같은 과제의 압축 전후 정답을 비교하고 최신 정정, 금지 조건, 미확정 쓰기 상태, 미완료 작업 회상률과 불필요한 재실행 여부를 별도로 측정해야 한다. 요약이 승인이나 상태 검증을 대신할 수 없다는 호스트 제약은 모델 품질과 관계없이 유지한다.
