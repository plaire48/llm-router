# Claude 브라우저 실행 루프 재검토

## 결론

공식 배포 확장 1.0.94의 실제 클라이언트 제어 흐름을 확인했다. 도구 실패를 대화의 `tool_result`로 돌려주고 다음 모델 판단을 이어가는 구조, 사용자 권한 대기와 API 통신 대기의 분리, 세션의 탭 그룹 검증이 참고할 만하다. 그러나 이 코드만으로 Claude의 완주율이나 누비보다 높은 품질을 증명할 수 없다. 확인한 일반 사이드패널 루프에서는 도구 호출이 없는 모델 응답 뒤 요구사항별 완료를 독립적으로 검증하는 게이트가 보이지 않는다. 누비의 기존 단계 검토와 최종 검토를 제거할 근거가 아니다.

이번 검토는 실행 코드의 흐름을 읽은 정적 분석이다. 확장 설치, 실행, 실계정 호출, 서버 코드 열람, 모델 성능 비교는 하지 않았다. 원본 번들이나 프롬프트를 제품에 복사하지 않는다.

## 대상과 재현 기준

1. [공식 스토어](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn)의 확장 ID `fcoeoabgfenejglbffodgkkbkcdhcgfn`을 대상으로 Chrome 공식 업데이트 서버에서 다시 받은 CRX와 기존 해제본을 대조했다. manifest 이름은 Claude, 버전은 1.0.94, MV3다. 이전 [다운로드 메타데이터](../verification/claude-comparison-2026-09-25/claude-package.json)와 CRX 해시도 일치한다.
2. CRX SHA-256: `325905e34e61ad37f3ff07eb5ecf81aa96eb8c310adca6ded2309fb9b724649d`.
3. `assets/mcpPermissions-tSjXinpi.js`: 569971 bytes, SHA-256 `e240270612684e9108303513f4a5f0cacb83a5d6876fec4d05a4fd7d2d990ed9`.
4. `assets/sidepanel-so8SIo6y.js`: 1764862 bytes, SHA-256 `a5bb018a6faeda6e619d4b54d51961f1a689624f942335501c073d54f6242908`.
5. 원본은 임시 경로 `/var/folders/30/2ns17vk15kn_689zclbvz07c0000gn/T/nubi-claude-public-xxlbgoah/unpacked`에만 있다. 아래 위치는 Python `read_text()` 문자열의 0부터 시작하는 문자 오프셋이며 파일 byte 위치와 다르다. 파일은 minify되어 원본 줄 번호만으로 함수를 식별하기 어렵다.

공개 배포 JavaScript는 공개 저장소의 오픈소스와 다르다. 이 산출물은 별도 재사용 라이선스를 확인하지 않았으므로 자체 설명과 관찰 메타데이터만 저장한다. 라이선스가 명확한 OSS 패턴과 기존 누비 Pi 실행기로 구현하는 것이 채택 경로다.

## 실제로 확인한 제어 흐름

| 관찰 | 파일과 함수 위치 | 제어 흐름 | 누비 적용 판단 |
| --- | --- | --- | --- |
| 모델과 도구 반복 | sidepanel `Wse` 1656859, 내부 `Ce` 1670063~1681460 | 메시지에 `tool_use`가 있으면 `we`를 기다린다. 원래 tool ID에 연결된 결과를 user 역할 메시지로 추가하고 반복 플래그를 설정해 다음 모델 요청을 한다. 도구 오류도 결과로 반환한다. tool_use가 없으면 이번 응답이 끝난다. | 동작 실패와 전체 작업 중단을 구분한다. 실패 원문을 다음 결정에 포함한다. 기존 누비의 요구사항 검증은 유지한다. |
| 도구의 순차 실행 | sidepanel `we` 1668030~1670063, mcpPermissions `dy.processToolResults` 553505~555910 | `for ... of` 안에서 각 도구 실행을 await한다. 성공, 거절, 예외를 tool_result로 반환한다. 별도 SDK의 병렬 도구 실행 코드와 구분된다. | 읽기 전용 분석은 병렬화할 수 있지만 실제 탭 변경과 쓰기는 순차 처리한다. |
| 권한 승인 후 동일 요청 재개 | sidepanel `we`, mcpPermissions `dy.processToolResults` | permission_required이면 handler를 await한다. 거절은 오류로 반환한다. update_plan 승인은 계획 승인 결과만 반환한다. 다른 도구는 승인 후 같은 tool ID로 한 번 실행하며 여전히 권한이 필요하면 예외 결과로 바꾼다. | 권한을 요청했다는 이유로 사용자의 답변 전에 작업을 끝내지 않는다. 승인 대기와 실행 실패를 다른 상태로 기록한다. 이미 실행된 미확정 쓰기에 이 경로를 적용하지 않는다. |
| API 통신의 일시 오류 복구 | sidepanel `Ce` 약 1674950~1681270, mcpPermissions `Nw` 528225 | API stream 이벤트가 올 때마다 idle 타이머를 다시 설정한다. idle 기준은 300초다. 서버 5xx, overload, network/connection, idle 등의 오류는 첫 시도 포함 최대 10회 범위에서 지수 지연과 jitter로 재요청한다. 일반 사용자 대기를 이 API 타이머로 처리하지 않는다. | 오류 원인별 inference 복구를 적용한다. 단순히 횟수와 전체 실행 시간을 늘리는 것은 채택하지 않는다. 도구 실행 영수증 없이 작업 전체를 다시 보내지 않는다. |
| 별도 MCP 팝업의 만료 | mcpPermissions `Uy` 566581~567739 | MCP 권한 팝업은 별도 요청 ID와 local 저장 기록을 만들고 30초 후 미응답을 거절로 처리한다. 일반 사이드패널의 권한 Promise에서는 이 타이머가 보이지 않는다. | MCP 팝업 정책을 일반 누비 질문 폼에 복제하지 않는다. 사용자가 작성하는 폼은 취소와 답변을 기다리는 계약을 유지한다. |
| 실제 탭 격리 | mcpPermissions `Gi.getEffectiveTabId` 146640, `ay` tabs_context_mcp 543486, sidepanel `be` 1667511 | 요청 탭이 현재 세션의 동일 그룹에 속하는지 확인하며 다른 그룹이면 유효한 ID를 포함해 오류를 반환한다. 탭 목록이 달라지면 sidepanel `be`가 모델 문맥을 갱신한다. | 현재 누비 탭과 작업 탭의 소유권을 확인하고 사용자 다른 탭을 임의로 활성화하지 않는다. Claude 도구 설명의 새 탭 기본값은 기존 누비 탭을 재사용하려는 사용자 선호에 적용하지 않는다. |
| 문맥 압축 | sidepanel `qre.compactConversation` 1607253~1616970, `Ce` 압축 분기 1670605 부근 | 수동 compact 또는 시작 시 문맥 한도 초과이면 별도 요약 요청을 한다. history를 요약 메시지로 교체하고 최근 사용자 image 메시지를 최대 3개 별도 보존한다. 성공하면 이어서 요청한다. 실패하면 압축 오류를 표시하고 그 호출은 반환한다. | 원래 요청, 명시적 답변, 완료 기준, 미확정 영수증은 호스트 상태로 보존한다. 요약의 정확성에 이 상태를 전부 맡기지 않는다. |
| 종료 원인과 결과 표시 | sidepanel `Ce` message callback 1677253, `CG` 950708 부근 | stop_reason을 기록하고 UI에 넘긴다. 도구 반복 여부는 stop_reason switch가 아니라 실제 tool_use 블록으로 정한다. UI는 end_turn과 turn_answer_start 신호 등을 이용해 진행 텍스트와 최종 텍스트를 나눈다. | 모델 출력 종료와 요구사항 완료를 분리해서 표시한다. 완료한 행동, 사용자 대기, 검토 오류, 실제 미완료를 같은 종료 문장으로 덮지 않는다. |

일반 sidepanel `Ce`의 반복 변수 q에는 이번 정적 검토 범위에서 전체 도구 라운드 상한이 보이지 않았다. 이는 무한한 지속 실행이나 고품질 완주 보장을 뜻하지 않는다. 네트워크 제한, 문맥 한도, 서버 정책, 모델의 도구 선택과 사용자의 취소가 별도 영향을 준다.

## SDK 코드와 제품 루프를 혼동하지 않기

이 분석의 항목별 실제 구현/보강/유지 상태와 최종 검토 복구, 종료 진단 검증은 [누비 적용 상태](CLAUDE-GAP-IMPLEMENTATION-2026-09-26.md)에 별도로 기록했다.

같은 mcpPermissions 파일에는 Anthropic SDK ToolRunner `cg` 449175, 중단 분류 함수 `lg` 454684도 번들되어 있다. `lg`는 tool_use를 도구 실행, pause_turn과 compaction을 재개, 나머지를 stop으로 분류한다. 해당 SDK의 compactionControl, max_iterations, Promise.all 도구 호출이 존재한다는 사실만으로 sidepanel `Wse`가 그것을 사용한다고 결론내리면 안 된다. 확인한 `Wse`는 직접 messages.stream과 `we` 실행 루프를 사용한다.

MCP 경로 `dy`는 브라우저 도구 실행과 추론 relay를 지원하지만 외부 Claude Code, Desktop, 서버 측 전체 에이전트 제어는 이 확장 파일만으로 확인할 수 없다. 조직별 system prompt와 모델 설정도 서버 응답 또는 설정에 따라 달라질 수 있다. 비공개 서버 하네스를 분석했다거나 전체 에이전트 소스가 공개됐다고 표현하지 않는다.

## 왜 누비가 멈추는지 판단할 기준

1. 모델이 답변을 끝낸 이유와 호스트가 실행을 끝낸 이유를 따로 기록한다. 정상 종료, token 한도, 도구 오류, 문맥 부족, 검토 실패, 사용자 질문과 취소를 분리한다.
2. 현재 실행의 진전을 실제 도구 결과로 측정한다. 같은 페이지 탐색과 같은 오류의 반복은 진전이 아니다. 두 번 실패한 대상은 제한된 읽기 전용 복구 분석에 맡기고 새로운 근거와 접근을 받아 주 실행기가 결정한다.
3. 수정 없이 같은 요청을 반복하는 대신 실패한 계약을 좁힌다. 대상이 관찰되지 않았는지, 쓰기는 실행됐는데 검증이 없는지, 두 출처의 근거가 문맥에서 탈락했는지, 계획 검토 형식이 깨졌는지를 구분한다.
4. 완료된 행동과 출처 근거를 보존한다. 검토가 잠시 실패했다면 검토와 필요한 추가 조회만 복구한다. 이미 수행한 행동을 다시 실행해 완료를 시도하지 않는다.
5. 마지막 품질 기준은 요구사항별 관찰 결과와 실제 모델 시험이다. 도구 오류 회귀 통과나 Claude 코드 비교를 실모델 완주 성공으로 계산하지 않는다.

이번 분석은 중단을 설명할 후보를 제시한다. 특정 누비 실측의 근본 원인은 그 실행의 trace와 독립 결과 검사로 연결해야 확정할 수 있다.

## 공식 참조

1. [Claude in Chrome 시작](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome): 제품과 브라우저 확장 경계.
2. [Claude in Chrome 권한](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide): 사용자가 결정하는 사이트와 동작 권한.
3. [Anthropic stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons): 모델 응답 종료 상태와 후속 처리의 의미. 이 문서는 제품의 모든 브라우저 하네스 동작을 공개하는 자료가 아니다.
4. [Anthropic tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works): tool_use ID와 tool_result로 이어지는 프로토콜.
5. [누비 기존 BP 검토](HARNESS-BP-2026-09-26.md): 라이선스가 명확한 Codex, OpenCode, Stagehand, Nanobrowser의 실제 도입 여부와 선택 근거.
