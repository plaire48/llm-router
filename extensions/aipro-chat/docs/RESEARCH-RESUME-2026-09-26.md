# 출처 재연결과 긴 문서 작업 복원

NQ-49의 남은 로컬 구현이다. 원래 조건을 유지한 일반 역할 워커 인계에 현재 출처 재조회와 OpenWiki/첨부 문서의 계층형 연구 체크포인트를 연결했다. 외부 검증 5개는 완료로 계산하지 않는다.

## 구현

- `read_analysis_handoff`의 선택적 `source_keys`로 최대 6개 출처를 현재 허용된 읽기 도구로 다시 확인한다. 프로젝트 ID/출처 종류/경로가 다르면 새 근거로 연결하지 않는다. 같은 프로젝트의 해시와 실제 범위를 비교하며 브라우저의 새 관찰은 과거 문서 동일성 증거로 표시하지 않는다. 워커 시작이나 브라우저 쓰기는 수행하지 않는다. 기존 기록에 연결 정보가 없으면 `unavailable`로 두고 원래 목표에 따라 새로 관찰한다.
- OpenWiki 코어는 계획, 하위 읽기, 구간 복구, 계층 합성 호출의 결과와 실제 읽은 위치를 저장한다. 원문 본문, 실행 중 그래프, 인증값과 승인 상태를 저장하지 않는다. 호스트가 다시 허용한 스냅샷에서 같은 문서/제목/경로/종류/버전/본문 해시, 질문, 모델과 sourceComplete를 확인한다. 중단된 읽기는 위치와 제한된 원문 미리보기를 복구하고, 완료한 호출은 다시 모델에 보내지 않는다. 임시 taskId/synthesisId는 캐시 키에서 제외한다. 최초 실행과 재개에서 병렬 완료 순서를 뒤바꾼 회귀에서 변경 전 재조회가 발생하고 변경 후 모델 호출 0회로 동일 결과가 복구됨을 확인했다.
- 현재 스냅샷이 달라지면 `research_checkpoint_changed`를 반환한다. 주 실행기가 원래 요청과 새 출처를 검토하고 `restart_research=true`로 새 계획을 요청할 수 있다. 이전 결과를 새 출처의 답변으로 내보내지 않는다.
- 내장/외부 위키 ID, 첨부 문서 ID 집합, 원래 질문과 모델을 키로 분리한다. 대화/제공자/현재 작업의 기존 worker 권한으로만 저장한다. 사용자 취소 시 실행 중인 체크포인트는 cancelled로 전환한다. 취소 기록은 자동 재사용하지 않는다. 이미 끝난 결과는 과거 참고 자료이며 브라우저 동작이나 승인 권한을 만들지 않는다.
- 호출 전 저장과 도구 읽기/호출 종료 후 저장을 확인한다. 저장 실패는 다음 모델 호출 전에 중단하며, 저장 대기는 사용자 취소와 15초 저장 기한에 반응한다. 두 연구 워커의 저장은 순차 연결하며 실패 시 같은 연구 호출의 형제 모델 요청도 중단한다. 이 기한은 사용자 업무 전체 시간 제한이 아니다.
- 체크포인트 한 개는 512개 호출/900,000자 이하, 대화 내 연구 기록은 최근 최대 4개/1,800,000자 이하로 제한한다. 최초 계획 호출은 보관 한도에서도 보존한다. 생략된 하위 호출은 성공으로 추정하지 않고 다시 연구한다. 전체 호출 스택이나 모델의 비공개 추론을 복원하지 않는다. 일반 하위 작업 인계 한도는 기존 12개/96,000자를 유지한다.

## 비교와 적용 근거

| 참고 | 적용과 비채택 근거 |
| --- | --- |
| [LangGraph checkpoint 실제 소스](https://github.com/langchain-ai/langgraphjs/tree/main/libs/checkpoint)와 설치된 `@langchain/langgraph-checkpoint@1.1.5`의 `dist/memory.js` put/putWrites | MIT. thread/namespace 격리, 저장 응답 확인, 완료한 작업의 결과 재사용 방식을 확인했다. 기존 DeepAgents/LangGraph 실행을 유지하되 원문/전체 메시지/동적 그래프를 저장하는 일반 serializer 대신 누비의 제한된 읽기 전용 연구 계약에 맞춘 체크포인트를 추가했다. MemorySaver 자체는 프로세스 메모리이므로 Chrome 종료 복구 저장소로 그대로 쓰지 않았다. |
| [LangGraph persistence](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint/README.md) | 실패한 단계 때문에 이미 완료한 병렬 작업을 반복하지 않는 방법을 적용했다. 현재 스냅샷으로 인용을 복구한 후 완료 호출을 재사용한다. |
| [Codex 저장 완료/재개 구조](https://github.com/openai/codex/blob/e72da2b53805894878023d01949a25a082e0a5cb/codex-rs/rollout/src/recorder.rs) | 앞선 검토의 Persist/Flush 응답 확인과 명시적 기록 복구 원칙을 이어 사용했다. Rust 코드나 외부 Codex 실행기를 번들하지 않았다. |
| [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | 독립 문맥과 제한된 권한을 유지했다. 전체 세션 복원과 완료한 읽기 결과 재사용을 구분한다. 비공개 전체 소스를 복제했다는 의미가 아니다. |
| [OpenCode agents](https://opencode.ai/docs/agents/) | 주 실행기/하위 분석 권한 분리 기준을 재확인했다. 하위 연구 복원으로 브라우저 쓰기나 승인 권한을 확대하지 않는다. |
| [Claude 배포 확장 정적 분석](CLAUDE-HARNESS-STATIC-2026-09-26.md) | 기존 실행 소유권과 승인 대기 분리를 유지했다. 상용 번들을 오픈소스로 취급하거나 복사하지 않았다. |

새 서버/런타임 의존성은 추가하지 않았다. 실제 실행에는 기존 DeepAgents, LangGraph, MiniSearch, Pi, Chrome 저장소를 사용한다.

## 검증과 한계

신규 회귀는 새 실행기에서 완료한 leaf/부분 읽기 복원, 재수행 없는 전체 결과 재사용, 출처/질문/모델 변경 거부, 저장 실패와 취소, 위키 ID/모델/질문별 격리, 현재 출처로 새 계획, 실제 위키 delegate 재사용, 프로젝트 변경 거부와 새 브라우저 근거 생성에 연결된다. 공유 OpenWiki TypeScript 검사도 통과했다.

Chrome 회귀는 실제 확장 worker 권한 검사와 로컬 저장을 거쳐 프로세스를 종료/재시작하고 원래 작업의 두 인계 기록을 확인한다. 인증과 모델은 합성이므로 실모델 완주나 실제 서버 등록 검증이 아니다. 외부 평가와 배포는 수행하지 않는다.

## 최종 로컬 검증

- [현재 후보 핵심 보고서](../verification/pre-release-2026-09-26T14-43-19-053Z/report.json): quality-baseline-v8 110개 단계 통과. 단위 **1,005개**, 디자인 검사, 후보 빌드와 실제 Chrome **107회**다.
- [현재 소스/빌드/ZIP 대조](../verification/research-resume-integrity.json): 입력 해시, dist, 보고서 보관 ZIP, 현재 후보 ZIP 모두 일치한다. SHA-256은 `9ca10aa787db3161cb303f18bf4899af2b99bd9a06302adbe5e39c6ae63f018b`다.
- [Chrome 재시작 상세](../verification/pre-release-2026-09-26T14-43-19-053Z/resume-target-browser.log): 두 인계 기록 저장 권한과 종료/재실행/명시적 재개 전달 통과. 입력 재전송 없음.
- [신규 복원 검사](../verification/checkpoint-new-tests-final.log): 9개 통과. [병렬 완료 순서 변경 전 재현](../verification/checkpoint-order-before.log)은 실패 근거로 보존한다. 개발 중 더 이전 소스에서 중단한 전체 gate는 완료 근거로 사용하지 않는다.
- 공유 OpenWiki의 서버/클라이언트 TypeScript 검사 통과. 제품 UI 레이아웃이나 디자인 토큰은 변경하지 않았다.

[항목별 현재 상태](../verification/research-resume-status.json): 등록된 로컬 구현 **46/46 = 100%**, 채택한 전체 **46/51 = 90.2%**. 로컬 항목은 동일 후보 핵심 회귀에 모두 연결되어 있다. 이는 항목 수 기준이며 품질/실제 업무 성공률이 아니다. 실제 모델 품질은 미측정으로 유지한다.

사용자는 이번에는 로컬 구현과 검증을 먼저 진행하도록 선택했다. 다음 5개는 외부 검증 상태로 유지한다.

| 항목 | 남은 조건 |
| --- | --- |
| NQ-02 | 회사망 Qwen의 실제 업무 8과제 3회와 독립 정답 평가 |
| NQ-04 | 대표 실제 사이트에서 저장/등록 서버 결과 확인 |
| NQ-07 | 실제 SSO 및 Windows/Edge 설치/업데이트 검증 |
| NQ-08 | 공식 WebArena Docker 환경에서 독립 grader 평가 |
| NQ-50 | 선택한 GPT-5.6 Luna의 네이버 실계정 완주 재측정 |

후보만 생성했다. 외부 배포나 릴리즈 ZIP 교체는 하지 않았다.
