# 공개 에이전트 코드 비교와 적용

2026-09-25. 비교 대상은 OpenCode 공개 실행기, Codex 공개 CLI/코어와 Claude Code 공식 문서다. 비공개 Desktop 전체 소스를 분석했다는 뜻이 아니다. 비교를 통해 확인한 누비의 빈틈부터 수정하며 프레임워크 전체를 교체하지 않는다.

## 소스와 적용 판단

| 대상 | 확인한 강점 | 누비 적용 | 선택 범위 |
|---|---|---|---|
| OpenCode `tool/truncate.ts` | 긴 결과를 보존하고 짧은 응답에 조회 경로를 제공. 검색/부분 읽기와 하위 분석 연결 | **신규:** 저장된 실행 로그의 구간 조회와 리터럴 검색. 이미 저장한 로그를 활용 | MIT. Effect 기반 실행기 전체를 가져오면 기존 Pi/SQLite와 상태가 이중화되므로 패턴만 적용 |
| OpenCode `tool/task.ts` | 부모 권한에서 하위 권한 도출, 깊이 제한, 작업 ID로 결과 연결 | **유지 및 연결 검사:** 독립된 읽기 전용 복구 워커에 조회한 로그만 전달 | 기존 Pi/p-limit 사용. 재귀 위임과 자식의 shell/승인 권한은 추가하지 않음 |
| OpenCode `session/compaction.ts` | 오래된 도구 결과와 최근 문맥 구분, 스킬 도구 보호 | **유지:** 누비의 원래 요구사항/답변 보호, 압축 후 스킬 재조회 | 프롬프트와 런타임 전체 복사 없음 |
| Codex `utils/output-truncation` | 긴 텍스트 중간 생략, 출력 상태/매체를 별도로 유지 | **신규:** 보존된 출력 버퍼 앞뒤 미리보기와 생략 표시, 원문 조회 ID | Apache-2.0. Rust 실행기 추가 없이 Node 표준 I/O 사용 |
| Codex `core/src/compact.rs` | 사용자 메시지를 수집해 요약과 함께 문맥 재구성, live 초기 문맥 재주입 | **유지 및 회귀 검사:** 사용자 원문, 조건, 답변과 현재 호스트 영수증 재주입 | 기존 공유 문맥 관리 사용. 타 제품의 토큰 예산을 그대로 복제하지 않음 |
| Claude Code 공식 subagents | 독립 문맥, 구체적인 도구 제한, 대량 출력을 하위 분석에서 처리 | **신규 연결 검사:** Pi 주 실행기 → 로그 검색 → 독립 복구 역할 → 근거/미확인 반환 | Claude Code 저장소는 Commercial Terms 적용. 구현 코드를 OSS로 간주하거나 번들하지 않음 |
| Anthropic context engineering | 필요한 근거만 그때 조회하고 참조 ID로 원문 접근 | **신규:** 전체 로그를 매번 문맥에 넣지 않고 bounded lookup 수행 | 다른 제품의 성능 수치를 누비 성능으로 주장하지 않음 |

고정 소스:

- OpenCode [`16c56fe5ecc3305028d1f0a9cff5806e51c9d480`](https://github.com/anomalyco/opencode/tree/16c56fe5ecc3305028d1f0a9cff5806e51c9d480): [출력 보존](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/tool/truncate.ts), [하위 작업](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/tool/task.ts), [압축](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/session/compaction.ts), [MIT](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/LICENSE).
- Codex [`aa380897f67b91e1a47d530d7286d497b6726d3f`](https://github.com/openai/codex/tree/aa380897f67b91e1a47d530d7286d497b6726d3f): [출력 생략](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/utils/output-truncation/src/lib.rs), [압축](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/codex-rs/core/src/compact.rs), [Apache-2.0](https://github.com/openai/codex/blob/aa380897f67b91e1a47d530d7286d497b6726d3f/LICENSE).
- Claude [subagents](https://code.claude.com/docs/en/sub-agents), [라이선스](https://github.com/anthropics/claude-code/blob/main/LICENSE.md).
- Anthropic [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

## 이번에 바꾼 동작

기존 모델 문맥에는 프로세스 출력 끝 8,000자만 있었다. 디스크에는 원문 로그가 남아 있어도 주 실행기가 그 앞부분을 읽는 도구가 없었다. 빌드/테스트 초반 원인을 확인하려고 같은 명령을 다시 실행할 여지가 있었다.

`read_process_output`은 현재 작업의 process ID로만 저장 로그를 읽는다. 기본 조회는 최대 8,000바이트다. `query`는 정규식이 아닌 대소문자를 구분하는 문자 그대로 검색이며 한 번에 256 KiB 범위와 경계 여유분만 읽고 최대 10개 발췌를 반환한다. `nextOffset`이 있으면 아직 미조회/미검색 범위가 있다. 이력 조회, 검색과 하위 분석은 프로세스를 시작하지 않는다.

연속 조회는 `revision`을 요구한다. 파일 크기/수정 시각/식별 정보가 달라지면 결과를 섞지 않고 `process_log_changed`를 반환한다. revision은 메타데이터 식별자이며 전체 내용 해시나 악의적인 변조에 대한 보증이 아니다. 계속 출력되는 로그는 변경될 수 있으므로 안정된 뒤 조회하거나 새 버전에서 필요한 부분만 다시 검색한다.

호스트 문맥과 recovery snapshot은 보존 버퍼의 앞뒤와 생략 상태, 원문 조회 도구/ID를 제공한다. 버퍼 자체가 최근 128,000자일 수 있으므로 앞부분 미리보기를 전체 로그의 시작으로 표시하지 않는다. 원문이 없거나 저장이 불완전하면 retained buffer와 `logIncomplete`를 구분한다. 관리자 실행도 기존 전용 디렉터리의 로그만 조회하며 UAC나 실행 승인 계약을 바꾸지 않는다.

읽은 발췌는 실제 공유 Pi coordinator에 historical 근거로 등록한다. 주 실행기는 필요한 경우 복구 역할에 해당 근거 ID만 전달한다. 하위 실행기는 원본 작업 대화나 임의 로그 경로, shell, 쓰기와 승인 권한을 받지 않는다. 해당 기록은 소스 수정 관찰이나 새로운 실행 권한이 아니다.

추가 패키지는 없다. 기존 Pi, SQLite, p-limit, p-retry를 그대로 쓰고 원문 I/O는 Node 표준 API로 연결했다. 별도 인덱스/모델 호출/외부 서버 없이 검색 비용과 문맥 크기를 제한한다. upstream 코드는 복사하거나 번들하지 않았다.

## 검증과 남은 범위

- 실제 Bash 출력 200KB에서 최근 버퍼 밖의 최초 오류를 찾아 재실행이 없는지 검사한다.
- 한글/이모지 UTF-8 페이지 연결, 검색 경계에 걸친 문자열, 10개 이상 검색 결과와 이어 읽기를 검사한다.
- 로그 변경/삭제, 다른 작업, 임의 경로/저장 경로 변조, 링크, 잘못된 입력과 취소를 검사한다.
- 관리자 로그 위치 계약은 합성 검사다. 실제 Windows 11 PowerShell/UAC 실행 검증은 별도다.
- 합성 모델로 Pi 로그 검색 → 하위 복구 분석 → 주 실행기 응답과 프로세스 1개 유지를 검사한다. 오류 분석 정확도나 실제 모델 성능 향상 수치를 측정한 것은 아니다.
- 기존 다중 문서 분할/합성, 화면 캡처 분석, 작업 이력과 HITL을 유지한다. A2A, 새 Windows 입력 방식과 무인 승인은 추가하지 않는다.

## 후속 비교: 작업공간의 기존 변경 확인

Codex의 [기본 코딩 지침](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_codex_prompt.md)은 더러운 Git 작업공간을 전제로 다른 사람의 수정을 보존한다. OpenCode의 [VCS 구현](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/project/vcs.ts)은 상태와 파일별 diff를 함께 제공하고 출력 크기를 제한한다. Claude Code의 [체크포인트 문서](https://code.claude.com/docs/en/checkpointing)는 자체 편집 이외의 외부 변경과 Bash 변경이 자동 복원 범위가 아님을 명시한다. Claude Code 구현 코드는 상용 약관 대상이므로 복사하지 않았다.

누비는 파일 해시와 읽은 줄 범위를 검사하지만, 주 실행기가 수정 전 Git 상태나 반영 후 실제 diff를 조회하는 도구가 없었다. `inspect_workspace_changes`를 읽기 전용 Pi 도구로 추가했다. 먼저 작업별 Git 상태에서 비공개 경로를 제외한 변경 파일을 최대 100개 보여준다. 파일 하나를 지정하면 HEAD와 현재 파일 사이의 diff를 최대 24 KiB만 보여주고 잘림, 전체 바이트 수와 해시를 명시한다. 1 MiB가 넘는 파일은 내용을 출력하지 않고 미확인으로 남긴다. 추적되지 않은 파일은 `read_source`로 현재 내용을 읽도록 안내한다.

도구는 Git 명령의 인자를 배열로 전달하고 외부 diff/textconv를 끈다. 파일 경로는 기존 작업 범위와 링크 검사를 따른다. Git 상태와 diff는 다른 사람의 변경을 알아보는 단서이며 작성자 식별, 전체 코드 이해, 편집 권한 또는 테스트 통과의 증거가 아니다. 누비의 기존 제안 승인, 해시 비교, 저장 후 확인은 유지한다. 별도 의존성은 추가하지 않고 이미 번들된 Git과 기존 Pi를 재사용했다.

검증은 기존 수정, 비공개 파일, 작업공간 밖 링크, 큰 diff, 디렉터리 확장 거부와 실제 Pi 도구 호출을 포함한다. 테스트는 로컬 Git 픽스처다. Windows 11의 Git 설치 상태와 실모델이 이 근거를 활용하는 품질은 별도로 확인해야 한다.
